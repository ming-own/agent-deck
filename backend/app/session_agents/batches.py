"""Session router: atomic fan-out and a single durable join per input event."""

import hashlib
import json
from uuid import uuid4

from .store import Conflict, now


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
        event_id=row["event_id"],
        created_at=row["created_at"],
        spec=spec,
        state=summary["status"] if summary else row["state"],
        branches=[result(run_id) for run_id in ids],
        summary=summary,
    )


def batches(store, scope):
    with store.connect() as db:
        db.execute("BEGIN")  # One snapshot for the batch and all child results.
        store.require_open(db, *scope)
        return [
            receipt(db, row)
            for row in db.execute(
                "SELECT * FROM route_batches WHERE owner=? AND project=? ORDER BY rowid DESC LIMIT 30",
                scope,
            )
        ]


def admit(store, scope, body, harnesses):
    spec = body.spec()
    logical = {
        **spec,
        "settings": {
            str(k): [v.expected_revision, sorted(set(v.approved_tools))]
            for k, v in body.settings.items()
        },
    }
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
        for branch in body.branches:
            if branch.contains.casefold() not in body.message.casefold():
                ids.append(None)
                continue
            settings = body.settings.get(branch.agent_id)
            if not settings:
                raise Conflict("Branch model unavailable")
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


def join(store, scope, body, harnesses):
    key = (*scope, str(body.event_id))
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM route_batches WHERE owner=? AND project=? AND event_id=?",
            key,
        ).fetchone()
        if not row or row["state"] != "waiting":
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
