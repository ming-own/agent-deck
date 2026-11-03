"""Durable instance configs and immutable turn snapshots; no credentials."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .models import AgentConfig


class Conflict(ValueError):
    pass


class NotFound(LookupError):
    pass


def now():
    return datetime.now(UTC).isoformat()


class AgentStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS deleted_agent_sessions (
                    owner TEXT NOT NULL, project TEXT NOT NULL, PRIMARY KEY(owner, project)
                );
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL,
                    config TEXT NOT NULL, revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS agents_scope ON agents(owner, project);
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL,
                    agent_id TEXT NOT NULL, request_id TEXT NOT NULL,
                    snapshot TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
                    output TEXT NOT NULL DEFAULT '', error TEXT,
                    created_at TEXT NOT NULL, finished_at TEXT,
                    UNIQUE(owner, project, agent_id, request_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS agent_running ON agent_runs(agent_id)
                    WHERE status = 'running';
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def node(row):
        if row is None:
            raise NotFound("Agent not found")
        return {
            "id": row["id"],
            "revision": row["revision"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "role": "",
            "instructions": "",
            **json.loads(row["config"]),
        }

    @staticmethod
    def run(row):
        return {
            key: row[key]
            for key in (
                "id",
                "agent_id",
                "request_id",
                "prompt",
                "status",
                "output",
                "error",
                "created_at",
                "finished_at",
            )
        } | {
            "agent": {
                "role": "",
                "instructions": "",
                **json.loads(row["snapshot"]),
            }
        }

    def list(self, owner, project):
        with self.connect() as db:
            return [
                self.node(row)
                for row in db.execute(
                    "SELECT * FROM agents WHERE owner=? AND project=? ORDER BY rowid",
                    (owner, project),
                )
            ]

    def get(self, owner, project, agent_id):
        with self.connect() as db:
            return self.node(
                db.execute(
                    "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                    (owner, project, agent_id),
                ).fetchone()
            )

    def create(self, owner, project, config: AgentConfig):
        agent_id, timestamp = str(uuid4()), now()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_open(db, owner, project)
            db.execute(
                "INSERT INTO agents VALUES(?,?,?,?,?,?,?)",
                (
                    agent_id,
                    owner,
                    project,
                    config.model_dump_json(),
                    1,
                    timestamp,
                    timestamp,
                ),
            )
        return self.get(owner, project, agent_id)

    def update(self, owner, project, agent_id, revision, config: AgentConfig):
        with self.connect() as db:
            self.node(
                db.execute(
                    "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                    (owner, project, agent_id),
                ).fetchone()
            )
            changed = db.execute(
                "UPDATE agents SET config=?, revision=revision+1, updated_at=? WHERE owner=? AND project=? AND id=? AND revision=?",
                (
                    config.model_dump_json(),
                    now(),
                    owner,
                    project,
                    agent_id,
                    revision,
                ),
            )
            if changed.rowcount != 1:
                raise Conflict(
                    "Agent configuration changed; reload before editing"
                )
        return self.get(owner, project, agent_id)

    def runs(self, owner, project, agent_id):
        self.get(owner, project, agent_id)
        with self.connect() as db:
            return [
                self.run(row)
                for row in db.execute(
                    "SELECT * FROM agent_runs WHERE owner=? AND project=? AND agent_id=? ORDER BY rowid",
                    (owner, project, agent_id),
                )
            ]

    def begin(self, owner, project, agent_id, revision, request_id, prompt):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_open(db, owner, project)
            node = self.node(
                db.execute(
                    "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                    (owner, project, agent_id),
                ).fetchone()
            )
            previous = db.execute(
                "SELECT * FROM agent_runs WHERE owner=? AND project=? AND agent_id=? AND request_id=?",
                (owner, project, agent_id, request_id),
            ).fetchone()
            if previous:
                run = self.run(previous)
                if (
                    run["prompt"] != prompt
                    or run["agent"]["revision"] != revision
                ):
                    raise Conflict("Request already used for a different turn")
                return run, False
            if node["revision"] != revision:
                raise Conflict(
                    "Agent configuration changed; reload before running"
                )
            run_id = str(uuid4())
            try:
                db.execute(
                    "INSERT INTO agent_runs(id,owner,project,agent_id,request_id,snapshot,prompt,status,created_at) VALUES(?,?,?,?,?,?,?,'running',?)",
                    (
                        run_id,
                        owner,
                        project,
                        agent_id,
                        request_id,
                        json.dumps(node),
                        prompt,
                        now(),
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict("Agent already has a running turn") from exc
            return self.run(
                db.execute(
                    "SELECT * FROM agent_runs WHERE id=?", (run_id,)
                ).fetchone()
            ), True

    def finish(self, run_id, status, output="", error=None):
        if status not in {"completed", "failed", "interrupted"}:
            raise ValueError("Invalid final status")
        with self.connect() as db:
            db.execute(
                "UPDATE agent_runs SET status=?, output=?, error=?, finished_at=? WHERE id=? AND status='running'",
                (status, output, error, now(), run_id),
            )

    def history(self, owner, project, agent_id):
        return [
            (run["prompt"], run["output"])
            for run in self.runs(owner, project, agent_id)
            if run["status"] == "completed"
        ]

    def interrupt_unfinished(self):
        with self.connect() as db:
            db.execute(
                "UPDATE agent_runs SET status='interrupted', error='runtime_restarted', finished_at=? WHERE status='running'",
                (now(),),
            )

    @staticmethod
    def require_open(db, owner, project):
        if db.execute(
            "SELECT 1 FROM deleted_agent_sessions WHERE owner=? AND project=?",
            (owner, project),
        ).fetchone():
            raise NotFound("Session has been deleted")

    def close_session(self, owner, project):
        with self.connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO deleted_agent_sessions VALUES(?,?)",
                (owner, project),
            )

    def delete_session(self, owner, project):
        with self.connect() as db:
            db.execute(
                "DELETE FROM agent_runs WHERE owner=? AND project=?",
                (owner, project),
            )
            db.execute(
                "DELETE FROM agents WHERE owner=? AND project=?",
                (owner, project),
            )
