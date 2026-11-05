import asyncio
from uuid import uuid4

import pytest

from app.session_agents import batches
from app.session_agents.harnesses import Harness
from app.session_agents.models import (
    AgentConfig,
    BatchRequest,
    RecoverBatch,
    RouteRequest,
    RunRequest,
    RunSettings,
)
from app.session_agents.routing import inbox
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound

SCOPE = ("owner", "session")
SETTINGS = RunSettings(
    expected_revision=1,
    email="review@example.org",
    connection={
        "model_platform": "openai",
        "model_type": "model",
        "api_key": "ephemeral-secret",
    },
)


def setup_agent(store):
    return store.create(
        *SCOPE,
        AgentConfig(
            name="test",
            tool_policy={"utc_time": "turn"},
            model=dict(
                id="provider:1",
                name="M",
                model_platform="openai",
                model_type="model",
            ),
        ),
    )["id"]


def request(prompt, tools=()):
    return RunRequest(
        **SETTINGS.model_dump(exclude={"approved_tools"}),
        request_id=str(uuid4()),
        prompt=prompt,
        approved_tools=list(tools),
        queue_if_busy=True,
    )


@pytest.mark.asyncio
async def test_fifo_followups_have_distinct_context_and_cancel(tmp_path):
    store = AgentStore(tmp_path / "db")
    agent = setup_agent(store)
    seen = []

    async def run(config, turn):
        seen.append((turn.prompt, turn.history, turn.granted_tools))
        return turn.prompt + "!"

    service = AgentService(store, {"standard": Harness("test", run)})
    first = service.start(*SCOPE, agent, request("one"))
    routed = RouteRequest(
        **SETTINGS.model_dump(),
        event_id=uuid4(),
        target_agent_id=agent,
        task_id="default",
        message="two",
    )
    second = service.route(*SCOPE, routed)
    assert (
        second["status"] == "queued"
        and service.route(*SCOPE, routed) == second
    )
    third = service.start(*SCOPE, agent, request("three", ["utc_time"]))
    removed = service.start(*SCOPE, agent, request("skip"))
    await service.cancel(*SCOPE, agent, removed["id"])
    await service.tasks[first["id"]]
    while service.tasks:
        await asyncio.gather(*service.tasks.values())
    assert seen == [
        ("one", [], ()),
        ("two", [("one", "one!")], ()),
        ("three", [("one", "one!"), ("two", "two!")], ("utc_time",)),
    ]
    assert inbox(store, *SCOPE)[0]["output"] == "two!"
    assert store.runs(*SCOPE, agent)[2]["id"] == third["id"]
    assert not service.queued_settings


@pytest.mark.asyncio
async def test_queue_restart_requires_fresh_settings_in_order(tmp_path):
    path = tmp_path / "db"
    store = AgentStore(path)
    agent = setup_agent(store)
    first, _ = store.begin(*SCOPE, agent, 1, "first", "A")
    second, _ = store.begin(
        *SCOPE, agent, 1, "second", "B", ["utc_time"], queue_if_busy=True
    )
    third, _ = store.begin(*SCOPE, agent, 1, "third", "C", queue_if_busy=True)
    restarted = AgentStore(path)
    restarted.interrupt_unfinished()
    seen = []

    async def run(config, turn):
        seen.append((turn.prompt, turn.granted_tools, turn.history))
        return turn.prompt

    service = AgentService(restarted, {"standard": Harness("test", run)})
    rows = restarted.runs(*SCOPE, agent)
    assert rows[0]["can_resume"]
    assert [r["status"] for r in rows] == [
        "interrupted",
        "confirmation",
        "confirmation",
    ]
    assert not rows[1]["agent"]["granted_tools"]
    with pytest.raises(Conflict):
        service.confirm(SCOPE, agent, "default", third["id"], SETTINGS)
    again = service.confirm(SCOPE, agent, "default", first["id"], SETTINGS)
    with pytest.raises(Conflict):
        service.confirm(SCOPE, agent, "default", first["id"], SETTINGS)
    await service.tasks[again["id"]]
    for old in (second, third):
        service.confirm(SCOPE, agent, "default", old["id"], SETTINGS)
        await service.tasks[old["id"]]
    assert seen == [
        ("A", (), []),
        ("B", (), [("A", "A")]),
        ("C", (), [("A", "A"), ("B", "B")]),
    ]
    assert b"ephemeral-secret" not in path.read_bytes()


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", [False, True])
async def test_recover_only_failed_or_stopped_attempt_once(tmp_path, stop):
    store = AgentStore(tmp_path / "db")
    agent = setup_agent(store)

    async def initial(config, turn):
        if turn.prompt.endswith("B"):
            assert turn.granted_tools == ("utc_time",)
            if stop:
                await asyncio.Event().wait()
            raise RuntimeError()
        return "first review"

    service = AgentService(store, {"standard": Harness("test", initial)})
    body = BatchRequest(
        event_id=uuid4(),
        message="audit",
        branches=[
            dict(agent_id=agent, name=n, instructions=n) for n in ("A", "B")
        ],
        summary=dict(agent_id=agent, name="summary"),
        settings={agent: SETTINGS},
        branch_tools=[[], ["utc_time"]],
    )
    batch = service.dispatch_batch(*SCOPE, body)
    event = batch["event_id"]
    a, b = batch["branches"]
    await service.tasks[a["id"]]
    if stop:
        await service.stop_batch(SCOPE, event, batch["generation"])
    await asyncio.gather(*service.joins)
    saved = batches.batches(store, SCOPE)[0]
    assert saved["summary"] is None
    assert saved["state"] == ("stopped" if stop else "blocked")
    restarted = AgentStore(store.path)
    restarted.interrupt_unfinished()
    seen = []

    async def recover(config, turn):
        seen.append((turn.prompt, turn.granted_tools))
        return "second review" if len(seen) == 1 else "joined"

    service = AgentService(restarted, {"standard": Harness("test", recover)})
    action = RecoverBatch(
        expected_generation=saved["generation"],
        request_id=uuid4(),
        branches={b["id"]: SETTINGS},
        summary=SETTINGS,
    )
    with pytest.raises(NotFound):
        service.recover_batch(("other", "session"), event, action)
    restored = service.recover_batch(SCOPE, event, action)
    assert service.recover_batch(SCOPE, event, action) == restored
    # A delayed stop from the previous generation must not stop the retry.
    await service.stop_batch(SCOPE, event, 0)
    assert batches.join(store, SCOPE, body, service.harnesses, 0) is None
    await asyncio.gather(*service.joins)
    await asyncio.gather(*service.tasks.values())
    out = batches.batches(store, SCOPE)[0]
    assert out["branches"][0] == saved["branches"][0]
    assert (
        out["branches"][1]["task_id"] == b["task_id"]
        and out["branches"][1]["id"] != b["id"]
    )
    assert len(seen) == 2 and seen[0][1] == ()
    assert "first review" in seen[1][0] and "second review" in seen[1][0]
    assert len(store.runs(*SCOPE, agent, out["summary"]["task_id"])) == 1
    assert service.recover_batch(SCOPE, event, action) == out


def test_recover_after_branches_finished_before_join(tmp_path):
    store = AgentStore(tmp_path / "db")
    agent = setup_agent(store)
    body = BatchRequest(
        event_id=uuid4(),
        message="review",
        branches=[dict(agent_id=agent, name="A")],
        summary=dict(agent_id=agent, name="sum"),
        settings={agent: SETTINGS},
    )
    service = AgentService(store)
    event, jobs = batches.admit(store, SCOPE, body, service.harnesses)
    store.finish(jobs[0][0]["id"], "completed", "reviewed")
    store.interrupt_unfinished()
    action = RecoverBatch(
        expected_generation=0, request_id=uuid4(), summary=SETTINGS
    )
    record, jobs, settings = batches.recover(
        store, SCOPE, event["event_id"], action, service.harnesses
    )
    assert not jobs
    summary = batches.join(
        store, SCOPE, settings, service.harnesses, record["generation"]
    )
    assert (
        summary
        and batches.join(
            store, SCOPE, settings, service.harnesses, record["generation"]
        )
        is None
    )
