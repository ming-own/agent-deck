"""Immutable, account-owned templates. Only node configuration crosses Sessions."""

import hashlib
import json
from uuid import uuid4

from .models import AgentConfig, SaveTemplate
from .store import Conflict, NotFound, now

BUILTINS = {
    "builtin-agent": ("Agent", {"root": {"name": "Agent", "model": None}}),
    "builtin-team": (
        "Workforce",
        {
            "root": {
                "name": "Workforce",
                "workforce": {
                    "branches": [
                        {
                            "agent_id": "worker",
                            "name": "Worker",
                            "contains": "",
                            "instructions": "",
                        }
                    ],
                    "summary": {
                        "agent_id": "lead",
                        "name": "Summary",
                        "instructions": "",
                    },
                    "join": "all_success",
                },
            },
            "worker": {"name": "Worker", "model": None},
            "lead": {"name": "Coordinator", "model": None},
        },
    ),
}
SHELL_MODEL = {
    "id": "workforce",
    "name": "Workforce",
    "model_type": "workforce",
    "model_platform": "agentdeck",
}


def catalog(store, owner):
    with store.connect() as db:
        custom = [
            dict(r)
            for r in db.execute(
                "SELECT family,version,name,kind,base_family,base_version FROM workshop_versions WHERE owner=? ORDER BY rowid DESC",
                (owner,),
            )
        ]
    return [
        dict(
            family=f,
            version=1,
            name=name,
            kind="workforce" if "workforce" in g["root"] else "agent",
            builtin=True,
        )
        for f, (name, g) in BUILTINS.items()
    ] + custom


def remap(route, resolve):
    def target(value):
        return {**value, "agent_id": resolve(value["agent_id"])}

    return {
        "branches": [target(b) for b in route["branches"]],
        "summary": target(route["summary"]),
        "join": route["join"],
    }


def capture(store, db, scope, source):
    graph, seen = {}, {}

    visiting = set()

    def visit(node_id, depth=0):
        if node_id in visiting:
            raise Conflict("A team cannot contain itself")
        if node_id in seen:
            return seen[node_id]
        if depth > 4 or len(seen) >= 32:
            raise Conflict("Workforce too large")
        key = f"n{len(seen)}"
        visiting.add(node_id)
        seen[node_id] = key
        node = store.node(
            db.execute(
                "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
                (*scope, node_id),
            ).fetchone()
        )
        if "workforce" in node:
            graph[key] = {
                "name": node["name"],
                "workforce": remap(
                    node["workforce"], lambda member: visit(member, depth + 1)
                ),
            }
        else:
            graph[key] = AgentConfig(
                **{k: node[k] for k in AgentConfig.model_fields}
            ).model_dump()
        visiting.remove(node_id)
        return key

    if source.route:
        graph["root"] = {
            "name": source.name,
            "workforce": remap(
                source.route.model_dump(mode="json"),
                lambda member: visit(member, 1),
            ),
        }
    else:
        root = visit(str(source.node_id))
        graph["root"] = graph.pop(root)
        graph["root"]["name"] = source.name
    # Count executions, not just distinct nodes: the same nested team may occupy
    # several branches. Bound fan-out before this template can ever be installed.
    remaining = 64

    def check(key, depth):
        nonlocal remaining
        remaining -= 1
        if depth > 4 or remaining < 0:
            raise Conflict("Workforce too large")
        route = graph[key].get("workforce")
        if route:
            for target in [*route["branches"], route["summary"]]:
                check(target["agent_id"], depth + 1)

    check("root", 0)
    return graph


def update_instance(store, scope, node_id, change):
    """Edit the live route and validate all containing teams in one transaction."""
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        row = db.execute(
            "SELECT * FROM agents WHERE owner=? AND project=? AND id=?",
            (*scope, node_id),
        ).fetchone()
        current = store.node(row)
        if (
            not current.get("workforce")
            or current["revision"] != change.expected_revision
        ):
            raise Conflict("Team configuration changed")
        config = json.loads(row["config"])
        route = change.model_dump(
            mode="json", exclude={"name", "expected_revision"}
        )
        config.update(name=change.name.strip(), workforce=route)
        if not config["name"]:
            raise Conflict("Team name is required")
        db.execute(
            "UPDATE agents SET config=?,revision=revision+1,updated_at=? WHERE id=?",
            (json.dumps(config), now(), node_id),
        )
        # Verify the edited node and every team that can now reach it. A rejected
        # cycle or cross-session target rolls back the entire revision.
        rows = db.execute(
            "SELECT id,config FROM agents WHERE owner=? AND project=? AND json_type(config,'$.workforce')='object'",
            scope,
        )
        parents = {}
        for team in rows:
            r = json.loads(team["config"])["workforce"]
            for target in [*r["branches"], r["summary"]]:
                parents.setdefault(target["agent_id"], set()).add(team["id"])
        pending = [node_id]
        checked = set()
        while pending:
            root = pending.pop()
            if root in checked:
                continue
            checked.add(root)
            capture(
                store, db, scope, SaveTemplate(name=change.name, node_id=root)
            )
            pending.extend(parents.get(root, ()))
        return store.node(
            db.execute(
                "SELECT * FROM agents WHERE id=?", (node_id,)
            ).fetchone()
        )


def save(store, scope, source):
    owner = scope[0]
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        gesture = (*scope, str(source.request_id))
        fingerprint = hashlib.sha256(
            source.model_dump_json(exclude={"request_id"}).encode()
        ).hexdigest()
        if source.request_id:
            prior = db.execute(
                "SELECT s.fingerprint,v.family,v.version,v.name,v.kind FROM workshop_saves s "
                "JOIN workshop_versions v USING(owner,family,version) WHERE s.owner=? AND s.project=? AND s.request_id=?",
                gesture,
            ).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    raise Conflict("Save ID reused")
                return {
                    k: prior[k] for k in ("family", "version", "name", "kind")
                }
        graph = capture(store, db, scope, source)
        base = (
            db.execute(
                "SELECT family,version FROM workshop_installs WHERE root=?",
                (str(source.node_id),),
            ).fetchone()
            if source.node_id
            else None
        )
        family, version = str(uuid4()), 1
        if source.new_version:
            if not base or base["family"] in BUILTINS:
                raise Conflict("Derive a new template first")
            family = base["family"]
            latest = db.execute(
                "SELECT MAX(version) FROM workshop_versions WHERE owner=? AND family=?",
                (owner, family),
            ).fetchone()[0]
            if latest != base["version"]:
                raise Conflict("A newer template version exists")
            version = latest + 1
        kind = "workforce" if "workforce" in graph["root"] else "agent"
        db.execute(
            "INSERT INTO workshop_versions VALUES(?,?,?,?,?,?,?,?)",
            (
                owner,
                family,
                version,
                source.name,
                kind,
                json.dumps(graph, ensure_ascii=False),
                base["family"] if base else None,
                base["version"] if base else None,
            ),
        )
        if source.request_id:
            db.execute(
                "INSERT INTO workshop_saves VALUES(?,?,?,?,?,?)",
                (*gesture, fingerprint, family, version),
            )
        return dict(
            family=family, version=version, name=source.name, kind=kind
        )


def install(store, scope, request):
    owner, project = scope
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.require_open(db, *scope)
        # The client supplies a gesture ID; response loss cannot create two teams.
        existing = db.execute(
            "SELECT root,family,version FROM workshop_installs JOIN agents ON id=root WHERE owner=? AND project=? AND json_extract(config,'$.install_id')=?",
            (*scope, str(request.instance_id)),
        ).fetchone()
        if existing:
            if (existing["family"], existing["version"]) != (
                request.family,
                request.version,
            ):
                raise Conflict("Installation ID reused")
            return existing["root"]
        if request.family in BUILTINS and request.version == 1:
            graph = BUILTINS[request.family][1]
        else:
            row = db.execute(
                "SELECT graph FROM workshop_versions WHERE owner=? AND family=? AND version=?",
                (owner, request.family, request.version),
            ).fetchone()
            if not row:
                raise NotFound("Template version not found")
            graph = json.loads(row[0])
        members = {}

        def create(key):
            if key in members:
                return members[key]
            node = graph[key]
            if "workforce" in node:
                config = {
                    "name": node["name"],
                    "model": SHELL_MODEL,
                    "workforce": remap(node["workforce"], create),
                }
            else:
                model = node.get("model") or request.model
                if model is None:
                    raise Conflict("Select a model for this template")
                config = AgentConfig(**{**node, "model": model}).model_dump()
            if key == "root":
                config.update(
                    install_id=str(request.instance_id),
                    template_family=request.family,
                    template_version=request.version,
                )
            else:
                config["workforce_member"] = True
            members[key] = store.insert_node(db, owner, project, config)
            return members[key]

        root = create("root")
        db.execute(
            "INSERT INTO workshop_installs VALUES(?,?,?)",
            (root, request.family, request.version),
        )
        return root
