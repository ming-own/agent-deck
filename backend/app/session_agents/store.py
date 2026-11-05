"""Durable instance configs and immutable turn snapshots; no credentials."""

import json
import sqlite3
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .harnesses import DEFAULT_HARNESS_ID, HARNESSES
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
                CREATE TABLE IF NOT EXISTS agent_positions (
                    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
                    x REAL NOT NULL, y REAL NOT NULL, revision INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO agent_positions(agent_id,x,y,revision)
                    SELECT id, 24 + (slot % 2) * 256, 72 + (slot / 2) * 132, 0
                    FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY owner,project ORDER BY rowid)-1 AS slot FROM agents)
                    WHERE id NOT IN (SELECT agent_id FROM agent_positions);
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL,
                    agent_id TEXT NOT NULL, request_id TEXT NOT NULL,
                    snapshot TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
                    output TEXT NOT NULL DEFAULT '', error TEXT,
                    created_at TEXT NOT NULL, finished_at TEXT,
                    UNIQUE(owner, project, agent_id, request_id)
                );
                CREATE TABLE IF NOT EXISTS agent_tasks (
                    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                    name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS route_messages (
                    owner TEXT NOT NULL, project TEXT NOT NULL, event_id TEXT NOT NULL,
                    run_id TEXT UNIQUE NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
                    origin_agent_id TEXT, origin_task_id TEXT, origin_name TEXT, origin_task_name TEXT,
                    target_task_name TEXT, reply_to TEXT, fingerprint TEXT NOT NULL,
                    PRIMARY KEY(owner,project,event_id)
                );
                CREATE TABLE IF NOT EXISTS route_consumption (
                    event_run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
                    recipient_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS route_inbox ON route_messages(owner,project,origin_agent_id,origin_task_id);
                CREATE INDEX IF NOT EXISTS agent_tasks_by_node ON agent_tasks(agent_id);
            """)

            # Existing runs keep their row IDs, outputs and snapshots. A constant
            # default also puts runs from older clients in the default task.
            db.execute("BEGIN IMMEDIATE")
            columns = {
                r["name"] for r in db.execute("PRAGMA table_info(agent_runs)")
            }
            if "task_id" not in columns:
                db.execute(
                    "ALTER TABLE agent_runs ADD COLUMN task_id TEXT NOT NULL DEFAULT 'default'"
                )
            if "source_answer" not in columns:
                db.execute(
                    "ALTER TABLE agent_runs ADD COLUMN source_answer TEXT"
                )
            db.execute("DROP INDEX IF EXISTS agent_running")
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS agent_task_running ON agent_runs(agent_id,task_id) WHERE status='running'"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS agent_task_history ON agent_runs(agent_id,task_id)"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
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
            "skill_ids": [],
            "tool_policy": {},
            "harness_id": DEFAULT_HARNESS_ID,
            **json.loads(row["config"]),
        }

    @staticmethod
    def run(row):
        snapshot = json.loads(row["snapshot"])
        plan = snapshot.pop("execution_plan", None)
        return {
            key: row[key]
            for key in (
                "id",
                "agent_id",
                "request_id",
                "task_id",
                "prompt",
                "status",
                "output",
                "error",
                "created_at",
                "finished_at",
            )
        } | {
            "plan": plan,
            "returned_results": snapshot.pop("returned_results", []),
            "source_answer": json.loads(row["source_answer"])
            if row["source_answer"]
            else None,
            "agent": {
                "role": "",
                "instructions": "",
                "skill_ids": [],
                "tool_policy": {},
                **snapshot,
            },
        }

    def list(self, owner, project):
        with self.connect() as db:
            return [
                {
                    **self.node(row),
                    "position": None
                    if row["layout_revision"] is None
                    else {
                        "x": row["x"],
                        "y": row["y"],
                        "revision": row["layout_revision"],
                    },
                }
                for row in db.execute(
                    "SELECT a.*, p.x, p.y, p.revision AS layout_revision FROM agents a "
                    "LEFT JOIN agent_positions p ON p.agent_id=a.id "
                    "WHERE a.owner=? AND a.project=? ORDER BY a.rowid",
                    (owner, project),
                )
            ]

    def move(self, owner, project, agent_id, position):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_open(db, owner, project)
            row = db.execute(
                "SELECT p.x,p.y,p.revision FROM agents a LEFT JOIN agent_positions p ON p.agent_id=a.id "
                "WHERE a.owner=? AND a.project=? AND a.id=?",
                (owner, project, agent_id),
            ).fetchone()
            if row is None:
                raise NotFound("Agent not found")
            if row["x"] == position.x and row["y"] == position.y:
                return dict(row)
            revision = row["revision"] or 0
            if revision != position.expected_revision:
                raise Conflict("Node position changed; refresh the canvas")
            db.execute(
                "INSERT INTO agent_positions(agent_id,x,y,revision) VALUES(?,?,?,?) "
                "ON CONFLICT(agent_id) DO UPDATE SET x=excluded.x,y=excluded.y,revision=excluded.revision",
                (agent_id, position.x, position.y, revision + 1),
            )
        return {"x": position.x, "y": position.y, "revision": revision + 1}

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
            # Choose a free starting cell, including nodes moved off the original grid.
            occupied = db.execute(
                "SELECT x,y FROM agent_positions p JOIN agents a ON a.id=p.agent_id WHERE owner=? AND project=?",
                (owner, project),
            ).fetchall()
            slot = 0
            while True:
                x, y = 24 + slot % 2 * 256, 72 + slot // 2 * 132
                if all(
                    abs(x - row["x"]) >= 224 or abs(y - row["y"]) >= 100
                    for row in occupied
                ):
                    break
                slot += 1
            db.execute(
                "INSERT INTO agent_positions VALUES(?,?,?,0)", (agent_id, x, y)
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

    def tasks(self, owner, project, agent_id):
        self.get(owner, project, agent_id)
        with self.connect() as db:
            return [{"id": "default", "name": ""}] + [
                dict(row)
                for row in db.execute(
                    "SELECT id,name FROM agent_tasks WHERE agent_id=? ORDER BY rowid",
                    (agent_id,),
                )
            ]

    def create_task(self, owner, project, agent_id, body):
        task_id = str(body.id)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_open(db, owner, project)
            self.require_task(db, owner, project, agent_id, "default")
            db.execute(
                "INSERT OR IGNORE INTO agent_tasks(id,agent_id,name) VALUES(?,?,?)",
                (task_id, agent_id, body.name),
            )
            row = db.execute(
                "SELECT id,name FROM agent_tasks WHERE id=? AND agent_id=?",
                (task_id, agent_id),
            ).fetchone()
            if not row or row["name"] != body.name:
                raise Conflict("Task ID already used")
            return dict(row)

    @staticmethod
    def require_task(db, owner, project, agent_id, task_id):
        if not db.execute(
            "SELECT 1 FROM agents a WHERE a.owner=? AND a.project=? AND a.id=? AND "
            "(?='default' OR EXISTS (SELECT 1 FROM agent_tasks t WHERE t.agent_id=a.id AND t.id=?))",
            (owner, project, agent_id, task_id, task_id),
        ).fetchone():
            raise NotFound("Task not found")

    def runs(self, owner, project, agent_id, task_id="default"):
        with self.connect() as db:
            self.require_task(db, owner, project, agent_id, task_id)
            return [
                self.run(row)
                for row in db.execute(
                    "SELECT * FROM agent_runs WHERE owner=? AND project=? AND agent_id=? AND task_id=? ORDER BY rowid",
                    (owner, project, agent_id, task_id),
                )
            ]

    @staticmethod
    def capture_answer(db, owner, project, target_id, source_run_id):
        row = db.execute(
            "SELECT r.id,r.agent_id,r.task_id,r.output,r.finished_at,r.status,"
            "json_extract(r.snapshot,'$.name') AS agent_name,t.name AS task_name "
            "FROM agent_runs r LEFT JOIN agent_tasks t ON t.id=r.task_id AND t.agent_id=r.agent_id "
            "WHERE r.owner=? AND r.project=? AND r.id=?",
            (owner, project, source_run_id),
        ).fetchone()
        if row is None:
            raise NotFound("Source run not found")
        if (
            row["agent_id"] == target_id
            or row["status"] != "completed"
            or not row["output"].strip()
        ):
            raise Conflict("Select a completed answer from another Agent")
        return {
            k: row[k]
            for k in (
                "id",
                "agent_id",
                "agent_name",
                "task_id",
                "task_name",
                "finished_at",
                "output",
            )
        }

    @staticmethod
    def turn_prompt(run):
        source = run["source_answer"]
        returned = run.get("returned_results", [])
        if source is None and not returned:
            return run["prompt"]
        # Quotes and returned outputs are reference data at user priority.
        data = {}
        if source:
            data["quoted_answer"] = source["output"]
        if returned:
            data["returned_results"] = returned
        data["user_instructions"] = run["prompt"]
        instruction = (
            "Use the quoted answer as reference material for this task."
            if not returned
            else "Use the supplied results as reference material for this task."
        )
        return instruction + "\n" + json.dumps(data, ensure_ascii=False)

    @staticmethod
    def pending_returns(db, owner, project, agent_id, task_id):
        return [
            dict(row)
            for row in db.execute(
                """SELECT m.event_id, r.id AS run_id, json_extract(r.snapshot,'$.name') AS agent_name,
                      m.target_task_name AS task_name, r.prompt AS message, r.output
               FROM route_messages m JOIN agent_runs r ON r.id=m.run_id
               LEFT JOIN route_consumption c ON c.event_run_id=r.id
               LEFT JOIN agent_runs recipient ON recipient.id=c.recipient_run_id
               WHERE m.owner=? AND m.project=? AND m.origin_agent_id=? AND m.origin_task_id=?
                 AND r.status='completed' AND (recipient.status IS NULL OR recipient.status IN ('failed','interrupted'))
               ORDER BY r.finished_at,r.rowid""",
                (owner, project, agent_id, task_id),
            )
        ]

    def begin(
        self,
        owner,
        project,
        agent_id,
        revision,
        request_id,
        prompt,
        approved_tools=(),
        *,
        task_id="default",
        source_run_id=None,
        harnesses=HARNESSES,
        db=None,
        connection=None,
    ):
        with self.connect() if db is None else nullcontext(db) as db:
            if not db.in_transaction:
                db.execute("BEGIN IMMEDIATE")
            self.require_open(db, owner, project)
            node = self.node(
                db.execute(
                    "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                    (owner, project, agent_id),
                ).fetchone()
            )
            if connection is not None:
                model = node["model"]
                if (
                    connection.model_type != model["model_type"]
                    or connection.model_platform != model["model_platform"]
                    or (connection.auth_source == "codex_subscription")
                    != model["id"].startswith("codex:")
                ):
                    raise Conflict(
                        "Model connection does not match this Agent"
                    )
            self.require_task(db, owner, project, agent_id, task_id)
            previous = db.execute(
                "SELECT * FROM agent_runs WHERE owner=? AND project=? AND agent_id=? AND request_id=?",
                (owner, project, agent_id, request_id),
            ).fetchone()
            if previous:
                run = self.run(previous)
                if (
                    sorted(set(approved_tools))
                    != run["agent"].get("approved_tools", [])
                    or run["task_id"] != task_id
                    or (run["source_answer"] or {}).get("id") != source_run_id
                    or run["prompt"] != prompt
                    or run["agent"]["revision"] != revision
                ):
                    raise Conflict("Request already used for a different turn")
                return run, False
            if node["revision"] != revision:
                raise Conflict(
                    "Agent configuration changed; reload before running"
                )
            harness = harnesses.get(node["harness_id"])
            if harness is None:
                raise Conflict("Selected Harness is unavailable")
            node["harness_version"] = harness.version
            policy = node["tool_policy"]
            approved = sorted(set(approved_tools))
            if any(policy.get(tool) != "turn" for tool in approved):
                raise Conflict(
                    "Tool approval exceeds this Agent's permissions"
                )
            node["approved_tools"] = approved
            node["granted_tools"] = sorted(
                set(approved)
                | {tool for tool, mode in policy.items() if mode == "allow"}
            )
            source = (
                self.capture_answer(
                    db, owner, project, agent_id, source_run_id
                )
                if source_run_id
                else None
            )
            returned = self.pending_returns(
                db, owner, project, agent_id, task_id
            )
            if returned:
                node["returned_results"] = returned
            run_id = str(uuid4())
            try:
                db.execute(
                    "INSERT INTO agent_runs(id,owner,project,agent_id,request_id,task_id,snapshot,prompt,status,created_at,source_answer) VALUES(?,?,?,?,?,?,?,?,'running',?,?)",
                    (
                        run_id,
                        owner,
                        project,
                        agent_id,
                        request_id,
                        task_id,
                        json.dumps(node),
                        prompt,
                        now(),
                        json.dumps(source, ensure_ascii=False)
                        if source
                        else None,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict("Task already has a running turn") from exc
            db.executemany(
                "INSERT INTO route_consumption(event_run_id,recipient_run_id) VALUES(?,?) "
                "ON CONFLICT(event_run_id) DO UPDATE SET recipient_run_id=excluded.recipient_run_id",
                [(item["run_id"], run_id) for item in returned],
            )
            return self.run(
                db.execute(
                    "SELECT * FROM agent_runs WHERE id=?", (run_id,)
                ).fetchone()
            ), True

    def admit_tool_call(self, run_id, tool):
        """Only count and admit tools granted to this still-running turn."""
        with self.connect() as db:
            key = "$.tool_calls." + tool
            updated = db.execute(
                "UPDATE agent_runs SET snapshot=json_set(snapshot, ?, "
                "COALESCE(json_extract(snapshot, ?), 0) + 1) WHERE id=? "
                "AND status='running' AND (COALESCE(json_extract(snapshot, '$.harness_id'), 'standard') != 'plan_execute' "
                "OR json_type(snapshot, '$.execution_plan')='text') AND EXISTS (SELECT 1 FROM "
                "json_each(snapshot, '$.granted_tools') WHERE value=?)",
                (key, key, run_id, tool),
            )
            if not updated.rowcount:
                raise PermissionError("Tool unavailable for this turn")

    def record_plan(self, run_id, plan):
        with self.connect() as db:
            updated = db.execute(
                "UPDATE agent_runs SET snapshot=json_set(snapshot, '$.execution_plan', ?) "
                "WHERE id=? AND status='running' AND json_extract(snapshot, '$.harness_id')='plan_execute' "
                "AND json_type(snapshot, '$.execution_plan') IS NULL",
                (plan, run_id),
            )
            if not updated.rowcount:
                raise Conflict("Plan no longer accepted for this run")

    def record_skill_versions(self, run_id, versions):
        with self.connect() as db:
            db.execute(
                "UPDATE agent_runs SET snapshot=json_set(snapshot, '$.skill_versions', json(?)) WHERE id=? AND status='running'",
                (json.dumps(versions), run_id),
            )

    def finish(self, run_id, status, output="", error=None):
        if status not in {"completed", "failed", "interrupted"}:
            raise ValueError("Invalid final status")
        with self.connect() as db:
            db.execute(
                "UPDATE agent_runs SET status=?, output=?, error=?, finished_at=? WHERE id=? AND status='running'",
                (status, output, error, now(), run_id),
            )

    def history(self, owner, project, agent_id, task_id="default"):
        return [
            (self.turn_prompt(run), run["output"])
            for run in self.runs(owner, project, agent_id, task_id)
            if run["status"] == "completed"
        ]

    def running_in_session(self, owner, project):
        with self.connect() as db:
            return db.execute(
                "SELECT agent_id, task_id, id FROM agent_runs WHERE owner=? AND project=? AND status='running'",
                (owner, project),
            ).fetchall()

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
