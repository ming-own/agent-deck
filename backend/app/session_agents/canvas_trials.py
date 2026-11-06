"""Execute a snapshot of one linear canvas path, isolated from manual turns."""

import asyncio
import json
import logging
from uuid import uuid4

from .store import Conflict


def receipt(db, row):
    if row is None:
        return None
    steps = json.loads(row["steps"])
    for i, step in enumerate(steps):
        run = db.execute(
            "SELECT status,output,error FROM agent_runs WHERE owner=? AND project=? AND id=?",
            (row["owner"], row["project"], step["run_id"]),
        ).fetchone()
        if run:
            step.update(dict(run))
        else:
            step["status"] = (
                "failed"
                if i == row["failed_index"]
                else "waiting"
                if row["status"] == "running"
                else "skipped"
            )
            step["output"] = ""
    return {
        "id": row["id"],
        "prompt": row["prompt"],
        "status": row["status"],
        "steps": steps,
    }


def latest(store, scope):
    with store.connect() as db:
        db.execute("BEGIN")
        store.require_open(db, *scope)
        return receipt(
            db,
            db.execute(
                "SELECT * FROM canvas_trials WHERE owner=? AND project=? ORDER BY rowid DESC LIMIT 1",
                scope,
            ).fetchone(),
        )


def get(store, scope, trial_id):
    """Look up the exact idempotent execution, independent of later trials."""
    with store.connect() as db:
        db.execute("BEGIN")
        store.require_open(db, *scope)
        return receipt(
            db,
            db.execute(
                "SELECT * FROM canvas_trials WHERE owner=? AND project=? AND id=?",
                (*scope, trial_id),
            ).fetchone(),
        )


def start(service, scope, body):
    store = service.store
    key = (*scope, str(body.id))
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        old = db.execute(
            "SELECT * FROM canvas_trials WHERE owner=? AND project=? AND id=?",
            key,
        ).fetchone()
        path = [str(id_) for id_ in body.path]
        if old:
            saved = receipt(db, old)
            if (
                saved["prompt"] != body.prompt
                or [s["agent_id"] for s in saved["steps"]] != path
            ):
                raise Conflict("Trial ID already used")
            return saved
        if db.execute(
            "SELECT 1 FROM canvas_trials WHERE owner=? AND project=? AND status='running'",
            scope,
        ).fetchone():
            raise Conflict("Canvas trial in progress")
        if set(body.path) != set(body.settings) or len(set(path)) != len(path):
            raise Conflict("Invalid canvas trial path")
        steps = []
        for i, agent in enumerate(path):
            settings = body.settings[body.path[i]]
            node = store.execution_node(
                db,
                *scope,
                agent,
                settings.expected_revision,
                settings.approved_tools,
                settings.connection,
                service.harnesses,
            )
            targets = [
                r[0]
                for r in db.execute(
                    "SELECT target FROM canvas_links WHERE source=?", (agent,)
                )
            ]
            if targets != path[i + 1 : i + 2]:
                raise Conflict("Canvas path changed or has multiple outputs")
            steps.append(dict(agent_id=agent, name=node["name"], run_id=None))
        db.execute(
            "INSERT INTO canvas_trials(owner,project,id,prompt,steps,status) VALUES(?,?,?,?,?,'running')",
            (*key, body.prompt, json.dumps(steps)),
        )
        run = begin_step(service, db, scope, body, steps, 0)
        saved = receipt(
            db,
            db.execute(
                "SELECT * FROM canvas_trials WHERE owner=? AND project=? AND id=?",
                key,
            ).fetchone(),
        )
    waiter = asyncio.create_task(advance(service, scope, body, steps, run))
    service.joins.add(waiter)
    waiter.add_done_callback(service.joins.discard)
    return saved


def begin_step(service, db, scope, body, steps, i):
    agent = steps[i]["agent_id"]
    settings = body.settings[body.path[i]]
    task = str(uuid4())
    db.execute(
        "INSERT INTO agent_tasks(id,agent_id,name) VALUES(?,?,?)",
        (task, agent, body.prompt[:100]),
    )
    run, _ = service.store.begin(
        *scope,
        agent,
        settings.expected_revision,
        str(uuid4()),
        body.prompt if i == 0 else "",
        settings.approved_tools,
        task_id=task,
        source_run_id=steps[i - 1]["run_id"] if i else None,
        connection=settings.connection,
        harnesses=service.harnesses,
        db=db,
    )
    steps[i].update(run_id=run["id"], task_id=task)
    db.execute(
        "UPDATE canvas_trials SET steps=? WHERE owner=? AND project=? AND id=?",
        (json.dumps(steps), *scope, str(body.id)),
    )
    return run


async def advance(service, scope, body, steps, run):
    state = "failed"
    i = 0
    try:
        for i in range(len(steps)):
            if i:
                with service.store.connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    service.store.require_open(db, *scope)
                    run = begin_step(service, db, scope, body, steps, i)
            await service.schedule(*scope, run, body.settings[body.path[i]])
            with service.store.connect() as db:
                row = db.execute(
                    "SELECT status FROM agent_runs WHERE id=?", (run["id"],)
                ).fetchone()
            if not row or row[0] != "completed":
                return
        state = "completed"
    except asyncio.CancelledError:
        state = "interrupted"
        raise
    except Exception:
        logging.getLogger(__name__).exception(
            "Canvas trial stopped at step %d", i + 1
        )
    finally:
        with service.store.connect() as db:
            db.execute(
                "UPDATE canvas_trials SET status=?,failed_index=? WHERE owner=? AND project=? AND id=? AND status='running'",
                (
                    state,
                    i if state == "failed" else None,
                    *scope,
                    str(body.id),
                ),
            )
