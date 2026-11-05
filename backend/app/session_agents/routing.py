"""Canvas message addresses and receipts. A run is the single source of its result."""

import hashlib
import json
from uuid import uuid4

from .store import Conflict, NotFound

RECEIPT = """
    SELECT m.event_id,m.origin_agent_id,m.origin_task_id,m.origin_name,m.origin_task_name,
           m.target_task_name,m.reply_to,m.run_id,
           r.agent_id AS target_agent_id,r.task_id AS target_task_id,
           json_extract(r.snapshot,'$.name') AS target_name,r.prompt AS message,
           r.output,r.status,r.created_at,r.finished_at
    FROM route_messages m JOIN agent_runs r ON r.id=m.run_id
    WHERE m.owner=? AND m.project=?
"""


def inbox(store, owner, project, origin_agent=None, origin_task=None):
    with store.connect() as db:
        store.require_open(db, owner, project)
        query = RECEIPT
        params = [owner, project]
        if origin_agent is not None:
            store.require_task(db, owner, project, origin_agent, origin_task)
            query += " AND m.origin_agent_id=? AND m.origin_task_id=?"
            params += [origin_agent, origin_task]
        return [
            dict(row)
            for row in db.execute(query + " ORDER BY m.rowid DESC", params)
        ]


def task_name(db, task_id):
    if task_id == "default":
        return None
    return db.execute(
        "SELECT name FROM agent_tasks WHERE id=?", (task_id,)
    ).fetchone()["name"]


def admit_message(store, owner, project, body, harnesses):
    event_id = str(body.event_id)
    target = str(body.target_agent_id)
    origin = str(body.origin_agent_id) if body.origin_agent_id else None
    parent = str(body.reply_to) if body.reply_to else None
    # Transport credentials can rotate on retry; only the logical envelope is durable.
    envelope = body.model_dump(mode="json", exclude={"connection", "email"})
    envelope["approved_tools"] = sorted(set(body.approved_tools))
    fingerprint = hashlib.sha256(
        json.dumps(envelope, sort_keys=True).encode()
    ).hexdigest()
    scope = (owner, project)
    receipt = RECEIPT + " AND m.event_id=?"
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        existing = db.execute(
            "SELECT fingerprint FROM route_messages WHERE owner=? AND project=? AND event_id=?",
            (*scope, event_id),
        ).fetchone()
        if existing:
            if existing["fingerprint"] != fingerprint:
                raise Conflict("Event ID already used for a different message")
            return dict(
                db.execute(receipt, (*scope, event_id)).fetchone()
            ), None

        origin_name = origin_task_name = None
        if origin:
            store.require_task(db, *scope, origin, body.origin_task_id)
            origin_name = db.execute(
                "SELECT json_extract(config,'$.name') FROM agents WHERE id=?",
                (origin,),
            ).fetchone()[0]
            origin_task_name = task_name(db, body.origin_task_id)
        store.require_task(db, *scope, target, "default")
        if parent:
            prior = db.execute(receipt, (*scope, parent)).fetchone()
            if not prior or (
                prior["origin_agent_id"],
                prior["origin_task_id"],
                prior["target_agent_id"],
            ) != (origin, body.origin_task_id, target):
                raise NotFound("Original message not found for this route")
            destination = prior["target_task_id"]
        elif body.new_task_name is not None:
            destination = str(uuid4())
            db.execute(
                "INSERT INTO agent_tasks(id,agent_id,name) VALUES(?,?,?)",
                (destination, target, body.new_task_name),
            )
        else:
            destination = body.task_id
        if origin == target and body.origin_task_id == destination:
            raise Conflict("Choose a different task or Agent")
        run, _ = store.begin(
            *scope,
            target,
            body.expected_revision,
            str(uuid4()),
            body.message,
            body.approved_tools,
            task_id=destination,
            queue_if_busy=True,
            db=db,
            connection=body.connection,
            harnesses=harnesses,
        )
        db.execute(
            """INSERT INTO route_messages
             (owner,project,event_id,run_id,origin_agent_id,origin_task_id,origin_name,origin_task_name,target_task_name,reply_to,fingerprint)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (
                *scope,
                event_id,
                run["id"],
                origin,
                body.origin_task_id,
                origin_name,
                origin_task_name,
                task_name(db, destination),
                parent,
                fingerprint,
            ),
        )
        return dict(db.execute(receipt, (*scope, event_id)).fetchone()), run
