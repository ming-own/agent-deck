"""Execute a composite node using the same task, branch and join machinery as the canvas."""

import asyncio
import json
from uuid import UUID

from pydantic import Field

from . import batches
from .models import BatchRequest, RecoverBatch
from .store import Conflict


class WorkforceBatch(BatchRequest):
    # Internal prompt may include prior turns and the outputs of nested teams.
    message: str = Field(min_length=1)


class WorkforceFailed(Exception):
    pass


async def execute_team(service, scope, run, history, settings):
    store = service.store
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "INSERT OR IGNORE INTO workforce_events VALUES(?,?)",
            (run["id"], run["id"]),
        )
        event = db.execute(
            "SELECT event_id FROM workforce_events WHERE run_id=?",
            (run["id"],),
        ).fetchone()[0]
        prior = db.execute(
            "SELECT * FROM route_batches WHERE owner=? AND project=? AND event_id=?",
            (*scope, event),
        ).fetchone()
        record = batches.receipt(db, prior) if prior else None

    members = settings.connection.members
    route = run["agent"]["workforce"]
    prompt = store.turn_prompt(run)
    message = (
        json.dumps(
            {"task_history": history, "input": prompt}, ensure_ascii=False
        )
        if history
        else prompt
    )
    body = WorkforceBatch(
        **route, event_id=event, message=message, settings=members
    )
    if record:
        if record["state"] == "completed":
            return record["summary"]["output"]
        if record["state"] == "unmatched":
            raise WorkforceFailed("workforce_no_match")
        retry = RecoverBatch(
            expected_generation=record["generation"],
            request_id=run["id"],
            branches={
                r["id"]: members[UUID(r["agent_id"])]
                for r in record["branches"]
                if not record["summary"]
                and r
                and r["status"] in ("failed", "interrupted")
            },
            summary=members[body.summary.agent_id],
            summary_attempt=record["summary"]["id"]
            if record["summary"]
            else None,
        )
        record, jobs, joining = batches.recover(
            store,
            scope,
            event,
            retry,
            service.harnesses,
            batch_class=WorkforceBatch,
        )
    else:
        record, jobs = batches.admit(
            store, scope, body, service.harnesses, match_text=prompt
        )
        joining = body
    if record["state"] == "unmatched":
        raise WorkforceFailed("workforce_no_match")
    generation = record["generation"]
    try:
        tasks = [
            service.schedule(*scope, child, connection)
            for child, connection in jobs
        ]
        if tasks:
            # Explicit stop below persists cancellation before touching the tasks.
            await asyncio.shield(
                asyncio.gather(*tasks, return_exceptions=True)
            )
        if joining:
            summary = batches.join(
                store, scope, joining, service.harnesses, generation
            )
            if summary:
                task = service.schedule(
                    *scope, summary, members[body.summary.agent_id]
                )
                await asyncio.shield(task)
        with store.connect() as db:
            result = batches.receipt(db, batches.batch_row(db, scope, event))
        if result["state"] != "completed":
            raise WorkforceFailed("workforce_branch_failed")
        return result["summary"]["output"]
    except asyncio.CancelledError:
        await service.stop_batch(scope, event, generation, internal=True)
        raise
    except Conflict as exc:
        with store.connect() as db:
            db.execute(
                "UPDATE route_batches SET state='blocked' WHERE owner=? AND project=? AND event_id=? AND generation=? AND state='waiting'",
                (*scope, event, generation),
            )
        raise WorkforceFailed("workforce_branch_failed") from exc
