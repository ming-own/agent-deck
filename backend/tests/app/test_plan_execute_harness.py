import asyncio
import json

import pytest

from app.session_agents import runner
from app.session_agents.models import AgentConfig, RunRequest
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore

MODEL = {
    "id": "provider:1",
    "name": "Model A",
    "model_platform": "openai",
    "model_type": "model-a",
}


def setup_turn(tmp_path):
    store = AgentStore(tmp_path / "nodes.db")
    node = store.create(
        "o",
        "s",
        AgentConfig(
            name="A",
            model=MODEL,
            harness_id="plan_execute",
            tool_policy={"calculate": "turn"},
        ),
    )
    request = RunRequest(
        request_id="one",
        expected_revision=1,
        prompt="Compare options",
        email="fixture@example.org",
        approved_tools=["calculate"],
        connection={"model_platform": "openai", "model_type": "model-a"},
    )
    return store, node, request


@pytest.mark.asyncio
async def test_plan_checkpoint_drives_execution_and_replay(
    tmp_path, monkeypatch
):
    store, node, request = setup_turn(tmp_path)
    service = AgentService(store)
    calls = []
    plan = "Compare delivery times, then recommend one option."

    async def model(
        runtime, history, prompt, connection, email, *, stage_instruction
    ):
        calls.append((prompt, connection.model_type))
        run = store.runs("o", "s", node["id"])[0]
        if len(calls) == 1:
            assert request.prompt in prompt and not runtime["granted_tools"]
            with pytest.raises(PermissionError):
                runtime["admit_tool"]("calculate")
            assert run["plan"] is None
            return json.dumps({"steps": [plan]})
        assert run["plan"] == f"1. {plan}" and run["status"] == "running"
        assert plan in prompt and request.prompt in prompt
        runtime["admit_tool"]("calculate")
        return "Final deliverable"

    monkeypatch.setattr(runner, "run_text_agent", model)
    run = service.start("o", "s", node["id"], request)
    # Changing the node while a turn is pending cannot switch its harness.
    store.update("o", "s", node["id"], 1, AgentConfig(name="A", model=MODEL))
    await asyncio.gather(*service.tasks.values())
    replay = service.start("o", "s", node["id"], request)
    assert replay["id"] == run["id"] and replay["plan"] == f"1. {plan}"
    assert replay["agent"]["harness_id"] == "plan_execute"
    assert replay["agent"]["tool_calls"] == {"calculate": 1}
    assert store.history("o", "s", node["id"]) == [
        (request.prompt, "Final deliverable")
    ]
    assert [model_type for _, model_type in calls] == ["model-a", "model-a"]


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_stage", [1, 2])
async def test_cancel_keeps_only_a_finished_plan(
    tmp_path, monkeypatch, cancel_stage
):
    store, node, request = setup_turn(tmp_path)
    service = AgentService(store)
    entered = asyncio.Event()
    calls = 0

    async def model(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == cancel_stage:
            entered.set()
            await asyncio.Event().wait()
        return '{"steps":["Take an inventory"]}'

    monkeypatch.setattr(runner, "run_text_agent", model)
    run = service.start("o", "s", node["id"], request)
    await asyncio.wait_for(entered.wait(), 2)
    await service.cancel("o", "s", node["id"], run["id"])
    saved = store.runs("o", "s", node["id"])[0]
    assert calls == cancel_stage and saved["status"] == "interrupted"
    assert saved["plan"] == (
        "1. Take an inventory" if cancel_stage == 2 else None
    )
    assert store.history("o", "s", node["id"]) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw", ["  ", "The answer is 8.", '{"steps": []}', '{"steps":[123]}']
)
async def test_invalid_plan_stops_before_execution(tmp_path, monkeypatch, raw):
    from unittest.mock import AsyncMock

    model = AsyncMock(return_value=raw)
    monkeypatch.setattr(runner, "run_text_agent", model)
    store, node, request = setup_turn(tmp_path)
    service = AgentService(store)
    service.start("o", "s", node["id"], request)
    await asyncio.gather(*service.tasks.values())
    saved = store.runs("o", "s", node["id"])[0]
    assert saved["error"] == "invalid_plan" and saved["plan"] is None
    model.assert_awaited_once()
