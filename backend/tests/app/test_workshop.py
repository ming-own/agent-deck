import asyncio
from uuid import uuid4

import pytest

from app.session_agents import batches, workshop
from app.session_agents.harnesses import Harness
from app.session_agents.models import (
    AgentConfig,
    InstallTemplate,
    RunRequest,
    SaveTemplate,
)
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound

MODEL = dict(
    id="provider:1", name="Model A", model_platform="openai", model_type="A"
)


def install(store, scope, family, version=1, model=None):
    req = InstallTemplate(
        family=family, version=version, model=model, instance_id=uuid4()
    )
    root = workshop.install(store, scope, req)
    assert workshop.install(store, scope, req) == root
    return store.get(*scope, root)


def turn(store, scope, node, prompt):
    def connection(n):
        result = dict(
            model_platform=n["model"]["model_platform"],
            model_type=n["model"]["model_type"],
        )
        if "workforce" in n:
            route = n["workforce"]
            result["members"] = {}
            for target in [*route["branches"], route["summary"]]:
                child = store.get(*scope, target["agent_id"])
                result["members"][child["id"]] = dict(
                    email="test@example.org",
                    expected_revision=child["revision"],
                    connection=connection(child),
                )
        else:
            result["api_key"] = "fixture-ephemeral-key"
        return result

    return RunRequest(
        request_id=str(uuid4()),
        expected_revision=node["revision"],
        connection=connection(node),
        email="test@example.org",
        prompt=prompt,
    )


@pytest.mark.asyncio
async def test_nested_team_and_portable_versions(tmp_path):
    store = AgentStore(tmp_path / "workshop.db")
    src = ("owner", "source")
    dst = ("owner", "destination")
    other = ("other", "destination")
    inner = install(store, src, "builtin-team", model=MODEL)
    leaf = install(store, src, "builtin-agent", model=MODEL)
    # The same member can serve multiple roles without merging its task histories.
    route = dict(
        branches=[
            dict(agent_id=inner["id"], name="nested"),
            dict(agent_id=leaf["id"], name="skipped", contains="never"),
        ],
        summary=dict(agent_id=leaf["id"], name="final"),
    )
    gesture = SaveTemplate(name="Reviews", route=route, request_id=uuid4())
    team = workshop.save(store, src, gesture)
    assert workshop.save(store, src, gesture) == team
    with pytest.raises(Conflict):
        workshop.save(
            store, src, gesture.model_copy(update={"name": "Different"})
        )
    a = install(store, dst, team["family"])
    b = install(store, dst, team["family"])
    assert a["workforce"] != b["workforce"]
    seen = []

    async def execute(config, ctx):
        seen.append(
            (ctx.node_id, ctx.prompt, ctx.history, config.model.model_type)
        )
        return config.name + " received " + ctx.prompt[-120:]

    svc = AgentService(store, {"standard": Harness("1", execute)})
    for node, prompt in [(a, "alpha"), (b, "beta")]:
        run = svc.start(*dst, node["id"], turn(store, dst, node, prompt))
        await svc.tasks[run["id"]]
        saved = store.runs(*dst, node["id"])[0]
        assert saved["status"] == "completed" and prompt in saved["output"]
    assert len(seen) == 6 and all(not r[2] for r in seen)
    assert set(r[0] for r in seen[:3]).isdisjoint(r[0] for r in seen[3:])
    assert not batches.batches(store, dst)
    child = store.get(*dst, a["workforce"]["branches"][0]["agent_id"])
    worker = store.get(*dst, child["workforce"]["branches"][0]["agent_id"])
    config = {k: worker[k] for k in AgentConfig.model_fields}
    config["model"] = {**MODEL, "model_type": "B", "id": "provider:2"}
    store.update(*dst, worker["id"], 1, AgentConfig(**config))
    v2 = workshop.save(
        store,
        dst,
        SaveTemplate(name="Reviews B", node_id=a["id"], new_version=True),
    )
    assert v2["version"] == 2 and v2["family"] == team["family"]
    with pytest.raises(Conflict):
        workshop.save(
            store,
            dst,
            SaveTemplate(name="race", node_id=a["id"], new_version=True),
        )
    fork = workshop.save(
        store, dst, SaveTemplate(name="Derived", node_id=a["id"])
    )
    assert fork["family"] != team["family"]
    for version, expected in [(1, "A"), (2, "B")]:
        node = install(store, src, team["family"], version)
        run = svc.start(*src, node["id"], turn(store, src, node, "test"))
        await svc.tasks[run["id"]]
        assert seen[-3][-1] == expected
    assert all(
        t["family"] != team["family"] for t in workshop.catalog(store, "other")
    )
    with pytest.raises(NotFound):
        install(store, other, team["family"])
    with pytest.raises(NotFound):
        workshop.save(
            store, other, SaveTemplate(name="wrong", node_id=a["id"])
        )
    assert b"fixture-ephemeral-key" not in store.path.read_bytes()


@pytest.mark.asyncio
async def test_stop_composite_descendants(tmp_path):
    store = AgentStore(tmp_path / "db")
    scope = ("o", "s")
    node = install(store, scope, "builtin-team", model=MODEL)
    started = asyncio.Event()

    async def slow(config, ctx):
        started.set()
        await asyncio.Event().wait()

    svc = AgentService(store, {"standard": Harness("1", slow)})
    run = svc.start(*scope, node["id"], turn(store, scope, node, "test"))
    await asyncio.wait_for(started.wait(), 2)
    await svc.cancel(*scope, node["id"], run["id"])
    assert not store.running_in_session(*scope) and not svc.tasks


@pytest.mark.asyncio
async def test_workforce_retry_uses_recorded_success(tmp_path):
    store = AgentStore(tmp_path / "db")
    scope = ("owner", "project")
    leaf = install(store, scope, "builtin-agent", model=MODEL)
    route = dict(
        branches=[
            dict(agent_id=leaf["id"], name="one", instructions="REVIEW_ONE"),
            dict(agent_id=leaf["id"], name="two", instructions="REVIEW_TWO"),
        ],
        summary=dict(agent_id=leaf["id"], name="join"),
    )
    template = workshop.save(
        store, scope, SaveTemplate(name="review", route=route)
    )
    node = install(store, scope, template["family"])
    failing = True

    async def execute(config, ctx):
        if failing and "REVIEW_TWO" in ctx.prompt:
            raise ValueError("fixture failure")
        return "reviewed"

    svc = AgentService(store, {"standard": Harness("1", execute)})
    settings = turn(store, scope, node, "review me")
    first = svc.start(*scope, node["id"], settings)
    await svc.tasks[first["id"]]
    failed = store.runs(*scope, node["id"])[0]
    assert (
        failed["can_resume"] and failed["error"] == "workforce_branch_failed"
    )
    trace = batches.workforce_trace(store, scope, first["id"])
    assert trace["state"] == "blocked"
    assert not batches.workforce_trace(store, ("other", scope[1]), first["id"])
    with pytest.raises(Conflict):
        await svc.stop_batch(scope, trace["event_id"], trace["generation"])
    store = AgentStore(store.path)
    svc = AgentService(store, {"standard": Harness("1", execute)})
    failing = False
    retried = svc.confirm(scope, node["id"], "default", first["id"], settings)
    await svc.tasks[retried["id"]]
    done = batches.workforce_trace(store, scope, retried["id"])
    assert (
        done["state"] == "completed"
        and done["summary"]["output"] == "reviewed"
    )
    assert done["branches"][0]["id"] == trace["branches"][0]["id"]
    assert done["branches"][1]["id"] != trace["branches"][1]["id"]
    assert done["branches"][1]["task_id"] == trace["branches"][1]["task_id"]
