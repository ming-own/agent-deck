"""Session router: atomic fan-out and a single durable join per input event."""

import hashlib
import json
from uuid import uuid4

from .models import BatchRequest
from .store import Conflict, NotFound, now


def start_task(store, db, scope, target, settings, prompt, harnesses):
    agent = str(target.agent_id)
    store.require_task(db, *scope, agent, "default")
    task = str(uuid4())
    db.execute(
        "INSERT INTO agent_tasks(id,agent_id,name) VALUES(?,?,?)",
        (task, agent, target.name),
    )
    run, _ = store.begin(
        *scope,
        agent,
        settings.expected_revision,
        str(uuid4()),
        prompt,
        settings.approved_tools,
        task_id=task,
        db=db,
        connection=settings.connection,
        harnesses=harnesses,
    )
    return run


def workforce_trace(store, scope, run_id):
    with store.connect() as db:
        row = db.execute(
            "SELECT b.* FROM workforce_events e JOIN route_batches b ON b.event_id=e.event_id "
            "JOIN agent_runs r ON r.id=e.run_id AND r.owner=b.owner AND r.project=b.project "
            "WHERE b.owner=? AND b.project=? AND e.run_id=?",
            (*scope, str(run_id)),
        ).fetchone()
        return receipt(db, row) if row else None


def require_external(store, scope, event):
    with store.connect() as db:
        if db.execute(
            "SELECT 1 FROM workforce_events e JOIN agent_runs r ON r.id=e.run_id WHERE r.owner=? AND r.project=? AND e.event_id=?",
            (*scope, str(event)),
        ).fetchone():
            raise Conflict("Manage this execution from its Workforce task")


def receipt(db, row):
    spec = json.loads(row["spec"])
    ids = json.loads(row["branch_ids"])

    def result(run_id):
        if run_id:
            return dict(
                db.execute(
                    "SELECT id,agent_id,task_id,status,output,error,created_at,finished_at FROM agent_runs WHERE id=?",
                    (run_id,),
                ).fetchone()
            )
        return None

    summary = result(row["summary_id"])
    return dict(
        generation=row["generation"],
        event_id=row["event_id"],
        created_at=row["created_at"],
        spec=spec,
        state=summary["status"]
        if summary
        and (row["state"] != "stopped" or summary["status"] == "completed")
        else row["state"],
        branches=[result(run_id) for run_id in ids],
        summary=summary,
    )


def batches(store, scope):
    with store.connect() as db:
        db.execute(
            "BEGIN"
        )  # One snapshot for the batch and all child results.
        store.require_open(db, *scope)
        return [
            receipt(db, row)
            for row in db.execute(
                """
                SELECT * FROM route_batches WHERE owner=? AND project=? AND NOT EXISTS (SELECT 1 FROM workforce_events e WHERE e.event_id=route_batches.event_id AND e.run_id IN (SELECT id FROM agent_runs WHERE owner=route_batches.owner AND project=route_batches.project)) AND (
                    state IN ('waiting','blocked','interrupted','stopped')
                    OR rowid IN (
                        SELECT rowid FROM route_batches WHERE owner=? AND project=?
                        ORDER BY rowid DESC LIMIT 30
                    ) OR summary_id IN (
                        SELECT id FROM agent_runs WHERE owner=? AND project=?
                        AND status IN ('failed','interrupted','running')
                    )
                ) ORDER BY rowid DESC
                """,
                (*scope, *scope, *scope),
            )
        ]


def admit(store, scope, body, harnesses, *, match_text=None):
    spec = body.spec()
    logical = {
        **spec,
        "settings": {
            str(k): [v.expected_revision, sorted(set(v.approved_tools))]
            for k, v in body.settings.items()
        },
    }
    if body.branch_tools is not None:
        logical["branch_tools"] = [
            sorted(set(tools)) for tools in body.branch_tools
        ]
    fingerprint = hashlib.sha256(
        json.dumps(logical, sort_keys=True).encode()
    ).hexdigest()
    key = (*scope, str(body.event_id))
    select = "SELECT * FROM route_batches WHERE owner=? AND project=? AND event_id=?"
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        existing = db.execute(select, key).fetchone()
        if existing:
            if existing["fingerprint"] != fingerprint:
                raise Conflict("Event already used for a different batch")
            return receipt(db, existing), []
        ids, jobs = [], []
        for target in [*body.branches, body.summary]:
            store.require_task(db, *scope, str(target.agent_id), "default")
        for i, branch in enumerate(body.branches):
            if (
                branch.contains.casefold()
                not in (
                    body.message if match_text is None else match_text
                ).casefold()
            ):
                ids.append(None)
                continue
            settings = body.settings.get(branch.agent_id)
            if not settings:
                raise Conflict("Branch model unavailable")
            if body.branch_tools is not None:
                settings = settings.model_copy(
                    update={"approved_tools": body.branch_tools[i]}
                )
            run = start_task(
                store,
                db,
                scope,
                branch,
                settings,
                "\n\n".join(filter(None, [body.message, branch.instructions])),
                harnesses,
            )
            ids.append(run["id"])
            jobs.append((run, settings))
        if jobs and body.summary.agent_id not in body.settings:
            raise Conflict("Summary model unavailable")
        db.execute(
            "INSERT INTO route_batches(owner,project,event_id,fingerprint,spec,branch_ids,state,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                *key,
                fingerprint,
                json.dumps(spec, ensure_ascii=False),
                json.dumps(ids),
                "waiting" if jobs else "unmatched",
                now(),
            ),
        )
        return receipt(db, db.execute(select, key).fetchone()), jobs


def join(store, scope, body, harnesses, generation=0):
    key = (*scope, str(body.event_id))
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM route_batches WHERE owner=? AND project=? AND event_id=?",
            key,
        ).fetchone()
        if (
            not row
            or row["state"] != "waiting"
            or row["generation"] != generation
        ):
            return
        store.require_open(db, *scope)
        batch = receipt(db, row)
        results = [
            (b, r)
            for b, r in zip(body.branches, batch["branches"], strict=True)
            if r
        ]
        if any(r["status"] == "running" for _, r in results):
            return
        run = None
        if body.join == "all_success" and any(
            r["status"] != "completed" for _, r in results
        ):
            state = "blocked"
        else:
            outputs = [
                {
                    "task": b.name,
                    "status": r["status"],
                    "result": r["output"] or r["error"],
                }
                for b, r in results
            ]
            prompt = "\n\n".join(
                [
                    body.message,
                    body.summary.instructions
                    or "Summarize the branch results.",
                    json.dumps(outputs, ensure_ascii=False),
                ]
            )
            # If the summary Agent changed while reviews ran, never silently use a new revision.
            run = start_task(
                store,
                db,
                scope,
                body.summary,
                body.settings[body.summary.agent_id],
                prompt,
                harnesses,
            )
            state = "joined"
        db.execute(
            "UPDATE route_batches SET state=?, summary_id=? WHERE owner=? AND project=? AND event_id=?",
            (state, run["id"] if run else None, *key),
        )
        return run


def batch_row(db, scope, event_id):
    row = db.execute(
        "SELECT * FROM route_batches WHERE owner=? AND project=? AND event_id=?",
        (*scope, event_id),
    ).fetchone()
    if not row:
        raise NotFound("Batch not found")
    return row


def stop(store, scope, event_id, generation):
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        row = batch_row(db, scope, event_id)
        batch = receipt(db, row)
        if row["generation"] != generation or batch["state"] not in (
            "waiting",
            "running",
        ):
            return []
        db.execute(
            "UPDATE route_batches SET state='stopped',generation=generation+1 WHERE owner=? AND project=? AND event_id=?",
            (*scope, event_id),
        )
        return [
            r
            for r in [*batch["branches"], batch["summary"]]
            if r and r["status"] == "running"
        ]


def recover(
    store, scope, event_id, recovery, harnesses, *, batch_class=BatchRequest
):
    # Replay of the same user action cannot start a second attempt.
    def settings_key(s):
        return (
            s.expected_revision,
            sorted(set(s.approved_tools)),
        )

    logical = [
        recovery.expected_generation,
        sorted(
            (str(k), settings_key(v)) for k, v in recovery.branches.items()
        ),
        str(recovery.summary_attempt),
        settings_key(recovery.summary),
    ]
    fingerprint = hashlib.sha256(json.dumps(logical).encode()).hexdigest()
    key = (*scope, event_id)
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        row = batch_row(db, scope, event_id)
        batch = receipt(db, row)
        previous = db.execute(
            "SELECT fingerprint FROM route_recoveries WHERE owner=? AND project=? AND event_id=? AND request_id=?",
            (*key, str(recovery.request_id)),
        ).fetchone()
        if previous:
            if previous[0] != fingerprint:
                raise Conflict("Recovery request changed")
            return batch, [], None
        if row["generation"] != recovery.expected_generation:
            raise Conflict("Recovery action is out of date")
        if batch["state"] not in (
            "blocked",
            "stopped",
            "interrupted",
            "failed",
        ):
            raise Conflict("Batch is not ready for recovery")
        if any(r and r["status"] == "running" for r in batch["branches"]):
            raise Conflict("Branches are still stopping")
        spec = batch["spec"]
        body = batch_class(
            **spec,
            event_id=event_id,
            settings={spec["summary"]["agent_id"]: recovery.summary},
        )
        store.execution_node(
            db,
            *scope,
            str(body.summary.agent_id),
            recovery.summary.expected_revision,
            recovery.summary.approved_tools,
            recovery.summary.connection,
            harnesses,
        )
        generation = row["generation"] + 1
        jobs = []
        ids = json.loads(row["branch_ids"])
        summary_id = row["summary_id"]

        def retry(old, settings):
            row = db.execute(
                "SELECT * FROM agent_runs WHERE id=?", (old["id"],)
            ).fetchone()
            run = store.restart_turn(db, scope, row, settings, harnesses)
            jobs.append((run, settings))
            return run["id"]

        if batch["summary"]:
            old = batch["summary"]
            if (
                recovery.branches
                or str(recovery.summary_attempt) != old["id"]
                or old["status"] not in ("failed", "interrupted")
            ):
                raise Conflict("Summary attempt changed")
            summary_id = retry(old, recovery.summary)
            state = "joined"
        else:
            if recovery.summary_attempt:
                raise Conflict("No matching summary attempt")
            for prior, settings in recovery.branches.items():
                if str(prior) not in ids:
                    raise Conflict("Branch attempt changed")
                i = ids.index(str(prior))
                old = batch["branches"][i]
                if old["status"] not in ("failed", "interrupted"):
                    raise Conflict("Only unfinished branches may be retried")
                ids[i] = retry(old, settings)
            if (
                not jobs
                and body.join == "all_success"
                and any(
                    r and r["status"] != "completed" for r in batch["branches"]
                )
            ):
                raise Conflict("Select a failed branch")
            state = "waiting"
        db.execute(
            "UPDATE route_batches SET generation=?,branch_ids=?,summary_id=?,state=? WHERE owner=? AND project=? AND event_id=?",
            (generation, json.dumps(ids), summary_id, state, *key),
        )
        db.execute(
            "INSERT INTO route_recoveries VALUES(?,?,?,?,?)",
            (*key, str(recovery.request_id), fingerprint),
        )
        return (
            receipt(db, batch_row(db, scope, event_id)),
            jobs,
            body if state == "waiting" else None,
        )
