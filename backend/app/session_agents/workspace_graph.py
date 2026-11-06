"""Workspace metadata over canonical Agents and existing space Memory.

Membership is an additive assertion from the capability-authenticated renderer.
Resources and bindings share the AgentStore transaction, so admission captures
one immutable selection without copying other tasks or storing connections.
"""

import json
from uuid import uuid4

from .store import Conflict, NotFound, now


class WorkspaceGraphStore:
    def __init__(self, store):
        self.store = store
        with store.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS graph_spaces (
                    space TEXT PRIMARY KEY, owner TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS graph_sessions (
                    owner TEXT NOT NULL, space TEXT NOT NULL, project TEXT NOT NULL,
                    PRIMARY KEY(owner,project)
                );
                CREATE TABLE IF NOT EXISTS graph_contexts (
                    owner TEXT NOT NULL, space TEXT NOT NULL, id TEXT NOT NULL,
                    name TEXT NOT NULL, content TEXT NOT NULL, enabled INTEGER NOT NULL,
                    revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY(owner,space,id)
                );
                CREATE TABLE IF NOT EXISTS graph_positions (
                    owner TEXT NOT NULL, space TEXT NOT NULL, kind TEXT NOT NULL,
                    object_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, revision INTEGER NOT NULL,
                    PRIMARY KEY(owner,space,kind,object_id)
                );
                CREATE TABLE IF NOT EXISTS graph_agent_refs (
                    owner TEXT NOT NULL, space TEXT NOT NULL, project_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                    context_ids TEXT NOT NULL, memory_ids TEXT NOT NULL, revision INTEGER NOT NULL,
                    PRIMARY KEY(owner,space,agent_id)
                );
                CREATE TABLE IF NOT EXISTS graph_automations (
                    owner TEXT NOT NULL, space TEXT NOT NULL, trigger_id TEXT NOT NULL,
                    project_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision INTEGER NOT NULL,
                    PRIMARY KEY(owner,space,trigger_id)
                );
                CREATE TABLE IF NOT EXISTS graph_automation_executions (
                    owner TEXT NOT NULL, space TEXT NOT NULL, trigger_id TEXT NOT NULL,
                    execution_id TEXT NOT NULL, project_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                    source_project_id TEXT NOT NULL, source_agent_id TEXT NOT NULL,
                    PRIMARY KEY(owner,space,trigger_id,execution_id), UNIQUE(owner,project_id)
                );
            """)
            columns = {
                r["name"]
                for r in db.execute(
                    "PRAGMA table_info(graph_automation_executions)"
                )
            }
            if "execution_path" not in columns:
                db.execute(
                    "ALTER TABLE graph_automation_executions ADD COLUMN execution_path TEXT NOT NULL DEFAULT '[]'"
                )

    @staticmethod
    def memory_service():
        from app.lightweight_memory.service import (
            get_lightweight_memory_service,
        )

        return get_lightweight_memory_service()

    @staticmethod
    def public(row):
        result = {k: row[k] for k in row.keys() if k not in {"owner", "space"}}
        for key in ("context_ids", "memory_ids"):
            if key in result:
                result[key] = json.loads(result[key])
        if "enabled" in result:
            result["enabled"] = bool(result["enabled"])
        return result

    @staticmethod
    def require_space(db, owner, space):
        row = db.execute(
            "SELECT owner FROM graph_spaces WHERE space=?", (space,)
        ).fetchone()
        if row is None or row["owner"] != owner:
            raise NotFound("Workspace registration not found")

    def register_sessions(self, owner, space, session_ids):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._register(db, owner, space, session_ids)
        return self.get(owner, space)

    def _register(self, db, owner, space, session_ids):
        claimed = db.execute(
            "SELECT owner FROM graph_spaces WHERE space=?", (space,)
        ).fetchone()
        # Memory is keyed by physical Space ID in the existing journal. A Space
        # cannot be claimed by another account and expose that account's Memory.
        if claimed and claimed["owner"] != owner:
            raise Conflict("Workspace belongs to another account")
        db.execute(
            "INSERT OR IGNORE INTO graph_spaces VALUES(?,?)", (space, owner)
        )
        for project in sorted(set(session_ids)):
            prior = db.execute(
                "SELECT space FROM graph_sessions WHERE owner=? AND project=?",
                (owner, project),
            ).fetchone()
            if prior and prior["space"] != space:
                raise Conflict(
                    "Session is already registered in another workspace"
                )
            self.store.require_open(db, owner, project)
            db.execute(
                "INSERT OR IGNORE INTO graph_sessions VALUES(?,?,?)",
                (owner, space, project),
            )

    def get(self, owner, space):
        with self.store.connect() as db:
            result = {
                "space_id": space,
                "session_ids": [
                    r[0]
                    for r in db.execute(
                        "SELECT project FROM graph_sessions WHERE owner=? AND space=? ORDER BY project",
                        (owner, space),
                    )
                ],
            }
            for key, table in (
                ("contexts", "graph_contexts"),
                ("positions", "graph_positions"),
                ("agent_references", "graph_agent_refs"),
                ("automation_bindings", "graph_automations"),
            ):
                result[key] = [
                    self.public(r)
                    for r in db.execute(
                        f"SELECT * FROM {table} WHERE owner=? AND space=? ORDER BY rowid",
                        (owner, space),
                    )
                ]
            return result

    def create_context(self, owner, space, name, content, enabled=True):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_space(db, owner, space)
            identity, timestamp = str(uuid4()), now()
            db.execute(
                "INSERT INTO graph_contexts VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    owner,
                    space,
                    identity,
                    name,
                    content,
                    enabled,
                    1,
                    timestamp,
                    timestamp,
                ),
            )
            return self._context(db, owner, space, identity)

    def _context(self, db, owner, space, identity):
        row = db.execute(
            "SELECT * FROM graph_contexts WHERE owner=? AND space=? AND id=?",
            (owner, space, identity),
        ).fetchone()
        if row is None:
            raise NotFound(f"Context unavailable: {identity}")
        return self.public(row)

    @staticmethod
    def check_revision(row, expected):
        revision = row["revision"] if row else 0
        if revision != expected:
            raise Conflict("Resource changed; reload before editing")

    def update_context(
        self, owner, space, identity, expected_revision, name, content, enabled
    ):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.check_revision(
                self._context(db, owner, space, identity), expected_revision
            )
            db.execute(
                "UPDATE graph_contexts SET name=?,content=?,enabled=?,revision=revision+1,updated_at=? WHERE owner=? AND space=? AND id=?",
                (name, content, enabled, now(), owner, space, identity),
            )
            return self._context(db, owner, space, identity)

    def delete_context(self, owner, space, identity, expected_revision):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.check_revision(
                self._context(db, owner, space, identity), expected_revision
            )
            # Keep explicit dangling selections: the next admission must fail,
            # rather than silently remove material a user selected.
            db.execute(
                "DELETE FROM graph_contexts WHERE owner=? AND space=? AND id=?",
                (owner, space, identity),
            )
        return {"ok": True}

    def move(self, owner, space, kind, object_id, x, y, expected_revision):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_space(db, owner, space)
            if kind == "settings" and object_id != space:
                raise Conflict("Settings node must identify its workspace")
            key = (owner, space, kind, object_id)
            row = db.execute(
                "SELECT * FROM graph_positions WHERE owner=? AND space=? AND kind=? AND object_id=?",
                key,
            ).fetchone()
            self.check_revision(row, expected_revision)
            db.execute(
                "INSERT INTO graph_positions VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,space,kind,object_id) DO UPDATE SET x=excluded.x,y=excluded.y,revision=excluded.revision",
                (*key, x, y, expected_revision + 1),
            )
            return dict(
                kind=kind,
                object_id=object_id,
                x=x,
                y=y,
                revision=expected_revision + 1,
            )

    def require_agent(self, db, owner, space, project, agent):
        self.require_space(db, owner, space)
        member = db.execute(
            "SELECT 1 FROM graph_sessions WHERE owner=? AND space=? AND project=?",
            (owner, space, project),
        ).fetchone()
        if not member:
            raise NotFound("Agent Session is not in this workspace")
        self.store.require_open(db, owner, project)
        return self.store.node(
            db.execute(
                "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                (owner, project, agent),
            ).fetchone()
        )

    def resolve(self, db, owner, space, context_ids, memory_ids):
        self.require_space(db, owner, space)
        resources = []
        for identity in context_ids:
            doc = self._context(db, owner, space, identity)
            if not doc["enabled"]:
                raise Conflict(f"Context disabled: {identity}")
            resources.append(
                dict(
                    kind="context",
                    id=identity,
                    name=doc["name"],
                    space_id=space,
                    version=doc["revision"],
                    content=doc["content"],
                )
            )
        if memory_ids:
            memory = self.memory_service()
            if not memory.scope("space", space).use_enabled:
                raise Conflict("Workspace Memory use is disabled")
            for identity in memory_ids:
                entry = memory.journal.get_memory_entry(identity)
                if (
                    not entry
                    or entry.deleted_at is not None
                    or entry.scope_type != "space"
                    or entry.scope_id != space
                ):
                    raise NotFound(f"Workspace Memory unavailable: {identity}")
                resources.append(
                    dict(
                        kind="memory",
                        id=identity,
                        name=entry.kind,
                        space_id=space,
                        version=entry.version,
                        content=entry.content,
                    )
                )
        return resources

    def set_references(
        self,
        owner,
        space,
        project,
        agent,
        context_ids,
        memory_ids,
        expected_revision,
    ):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_agent(db, owner, space, project, agent)
            key = (owner, space, agent)
            row = db.execute(
                "SELECT * FROM graph_agent_refs WHERE owner=? AND space=? AND agent_id=?",
                key,
            ).fetchone()
            self.check_revision(row, expected_revision)
            self.resolve(db, owner, space, context_ids, memory_ids)
            db.execute(
                "INSERT INTO graph_agent_refs VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,space,agent_id) DO UPDATE SET context_ids=excluded.context_ids,memory_ids=excluded.memory_ids,revision=excluded.revision",
                (
                    owner,
                    space,
                    project,
                    agent,
                    json.dumps(context_ids),
                    json.dumps(memory_ids),
                    expected_revision + 1,
                ),
            )
            return dict(
                project_id=project,
                agent_id=agent,
                context_ids=context_ids,
                memory_ids=memory_ids,
                revision=expected_revision + 1,
            )

    def snapshot(self, db, owner, project, agent):
        row = db.execute(
            "SELECT * FROM graph_agent_refs WHERE owner=? AND project_id=? AND agent_id=?",
            (owner, project, agent),
        ).fetchone()
        if not row:
            return []
        self.require_agent(db, owner, row["space"], project, agent)
        return self.resolve(
            db,
            owner,
            row["space"],
            json.loads(row["context_ids"]),
            json.loads(row["memory_ids"]),
        )

    def bind_automation(
        self, owner, space, trigger, project, agent, expected_revision
    ):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_agent(db, owner, space, project, agent)
            row = db.execute(
                "SELECT * FROM graph_automations WHERE owner=? AND space=? AND trigger_id=?",
                (owner, space, trigger),
            ).fetchone()
            self.check_revision(row, expected_revision)
            db.execute(
                "INSERT INTO graph_automations VALUES(?,?,?,?,?,?) ON CONFLICT(owner,space,trigger_id) DO UPDATE SET project_id=excluded.project_id,agent_id=excluded.agent_id,revision=excluded.revision",
                (owner, space, trigger, project, agent, expected_revision + 1),
            )
            return dict(
                trigger_id=trigger,
                project_id=project,
                agent_id=agent,
                revision=expected_revision + 1,
            )

    def unbind_automation(self, owner, space, trigger, expected_revision):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM graph_automations WHERE owner=? AND space=? AND trigger_id=?",
                (owner, space, trigger),
            ).fetchone()
            if not row:
                raise NotFound("Automation binding unavailable")
            self.check_revision(row, expected_revision)
            db.execute(
                "DELETE FROM graph_automations WHERE owner=? AND space=? AND trigger_id=?",
                (owner, space, trigger),
            )
        return {"ok": True}

    def _execution(self, db, owner, space, trigger, execution):
        row = db.execute(
            "SELECT * FROM graph_automation_executions WHERE owner=? AND space=? AND trigger_id=? AND execution_id=?",
            (owner, space, trigger, execution),
        ).fetchone()
        if not row:
            return None
        agent = self.require_agent(
            db, owner, space, row["project_id"], row["agent_id"]
        )
        return dict(
            project_id=row["project_id"],
            agent=agent,
            created=False,
            source_project_id=row["source_project_id"],
            source_agent_id=row["source_agent_id"],
            execution_path=json.loads(row["execution_path"])
            or [row["agent_id"]],
        )

    def execution(self, owner, space, trigger, execution):
        with self.store.connect() as db:
            return self._execution(db, owner, space, trigger, execution)

    def instantiate(
        self,
        owner,
        space,
        trigger,
        execution,
        project,
        expected_binding_revision=None,
    ):
        from .workshop import remap

        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = self._execution(db, owner, space, trigger, execution)
            if prior:
                return prior
            binding = db.execute(
                "SELECT * FROM graph_automations WHERE owner=? AND space=? AND trigger_id=?",
                (owner, space, trigger),
            ).fetchone()
            if not binding:
                raise NotFound("Automation binding unavailable")
            if expected_binding_revision is not None:
                self.check_revision(binding, expected_binding_revision)
            source_project, source_agent = (
                binding["project_id"],
                binding["agent_id"],
            )
            if (
                project == source_project
                or db.execute(
                    "SELECT 1 FROM agents WHERE owner=? AND project=?",
                    (owner, project),
                ).fetchone()
            ):
                raise Conflict("Automation requires a new empty Session")
            source_path = []
            cursor = source_agent
            while cursor:
                if cursor in source_path or len(source_path) >= 32:
                    raise Conflict(
                        "Automation requires a linear canvas path without cycles"
                    )
                self.require_agent(db, owner, space, source_project, cursor)
                source_path.append(cursor)
                targets = [
                    r[0]
                    for r in db.execute(
                        "SELECT target FROM canvas_links WHERE source=?",
                        (cursor,),
                    )
                ]
                if len(targets) > 1:
                    raise Conflict(
                        "Automation requires a linear canvas path without forks"
                    )
                cursor = targets[0] if targets else None
            self._register(db, owner, space, [project])
            members, visiting = {}, set()

            def clone(identity, depth=0):
                if identity in visiting or depth > 4 or len(members) >= 32:
                    raise Conflict("Invalid or oversized Workforce")
                if identity in members:
                    return members[identity]
                visiting.add(identity)
                node = self.require_agent(
                    db, owner, space, source_project, identity
                )
                # Resolve now as well as at begin: never instantiate a target
                # with already missing selected material.
                self.snapshot(db, owner, source_project, identity)
                config = json.loads(
                    db.execute(
                        "SELECT config FROM agents WHERE id=?", (identity,)
                    ).fetchone()[0]
                )
                if node.get("workforce"):
                    config["workforce"] = remap(
                        node["workforce"],
                        lambda child: clone(child, depth + 1),
                    )
                config["automation_source"] = dict(
                    space_id=space,
                    trigger_id=trigger,
                    execution_id=execution,
                    project_id=source_project,
                    agent_id=identity,
                )
                fresh = self.store.insert_node(db, owner, project, config)
                members[identity] = fresh
                refs = db.execute(
                    "SELECT * FROM graph_agent_refs WHERE owner=? AND space=? AND agent_id=?",
                    (owner, space, identity),
                ).fetchone()
                if refs:
                    db.execute(
                        "INSERT INTO graph_agent_refs VALUES(?,?,?,?,?,?,?)",
                        (
                            owner,
                            space,
                            project,
                            fresh,
                            refs["context_ids"],
                            refs["memory_ids"],
                            1,
                        ),
                    )
                visiting.remove(identity)
                return fresh

            execution_path = [clone(identity) for identity in source_path]
            root = execution_path[0]
            db.executemany(
                "INSERT INTO canvas_links VALUES(?,?)",
                zip(execution_path, execution_path[1:]),
            )
            db.execute(
                "INSERT INTO graph_automation_executions VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    owner,
                    space,
                    trigger,
                    execution,
                    project,
                    root,
                    source_project,
                    source_agent,
                    json.dumps(execution_path),
                ),
            )
            return {
                **self._execution(db, owner, space, trigger, execution),
                "created": True,
            }
