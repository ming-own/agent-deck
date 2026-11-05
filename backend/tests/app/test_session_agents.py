import asyncio

import pytest

from app.session_agents.harnesses import Harness
from app.session_agents.models import AgentConfig, ModelReference
from app.session_agents.store import AgentStore, Conflict, NotFound


def config(model="gpt-a", name="Research"):
    return AgentConfig(
        name=name,
        model=ModelReference(
            id=f"codex:{model}",
            name=model,
            model_platform="openai",
            model_type=model,
        ),
    )


def test_instances_persist_and_scope_by_account_and_session(tmp_path):
    path = tmp_path / "agents.db"
    store = AgentStore(path)
    a = store.create("owner", "session-a", config())
    b = store.create("owner", "session-a", config("gpt-b"))
    c = store.create("owner", "session-b", config())
    store.update("owner", "session-a", a["id"], 1, config("gpt-c"))
    restored = AgentStore(path)
    assert (
        restored.get("owner", "session-a", a["id"])["model"]["model_type"]
        == "gpt-c"
    )
    assert (
        restored.get("owner", "session-a", b["id"])["model"]["model_type"]
        == "gpt-b"
    )
    assert (
        restored.get("owner", "session-b", c["id"])["model"]["model_type"]
        == "gpt-a"
    )
    assert restored.list("another", "session-a") == []
    with pytest.raises(NotFound):
        restored.get("owner", "session-b", a["id"])


def test_stale_edits_and_runs_fail_without_fallback(tmp_path):
    store = AgentStore(tmp_path / "agents.db")
    a = store.create("owner", "s", config())
    store.update("owner", "s", a["id"], 1, config("gpt-b"))
    with pytest.raises(Conflict):
        store.update("owner", "s", a["id"], 1, config("gpt-c"))
    with pytest.raises(Conflict):
        store.begin("owner", "s", a["id"], 1, "request-1", "Hi")


def test_run_snapshot_idempotency_and_history_isolation(tmp_path):
    store = AgentStore(tmp_path / "agents.db")
    a = store.create("owner", "s", config())
    b = store.create("owner", "s", config("gpt-b"))
    run, created = store.begin("owner", "s", a["id"], 1, "req", "Hello")
    assert created
    same, created = store.begin("owner", "s", a["id"], 1, "req", "Hello")
    assert not created and same == run
    with pytest.raises(Conflict):
        store.begin("owner", "s", a["id"], 1, "req", "Different")
    with pytest.raises(Conflict):
        store.begin("owner", "s", a["id"], 1, "req2", "Concurrent")
    store.update("owner", "s", a["id"], 1, config("gpt-c", "Changed"))
    store.finish(run["id"], "completed", output="Answer")
    result = store.runs("owner", "s", a["id"])[0]
    assert result["agent"]["name"] == "Research"
    assert result["agent"]["model"]["model_type"] == "gpt-a"
    assert result["agent"]["revision"] == 1
    assert store.runs("owner", "s", b["id"]) == []
    assert store.history("owner", "s", a["id"]) == [("Hello", "Answer")]
    store.finish(run["id"], "failed", error="late")
    assert store.runs("owner", "s", a["id"])[0]["status"] == "completed"


def test_restart_interrupts_without_replaying(tmp_path):
    path = tmp_path / "agents.db"
    store = AgentStore(path)
    a = store.create("owner", "s", config())
    store.begin("owner", "s", a["id"], 1, "req", "Hello")
    restored = AgentStore(path)
    restored.interrupt_unfinished()
    assert restored.runs("owner", "s", a["id"])[0]["status"] == "interrupted"
    assert restored.history("owner", "s", a["id"]) == []


@pytest.mark.asyncio
async def test_service_snapshots_and_cancels_owned_run(tmp_path):
    from app.session_agents.models import ModelConnection, RunRequest
    from app.session_agents.service import AgentService

    started = asyncio.Event()
    captured = []

    async def runner(config, turn):
        captured.append((config.model_dump(), turn.history, turn.connection))
        started.set()
        await asyncio.Event().wait()

    store = AgentStore(tmp_path / "agents.db")
    service = AgentService(store, {"standard": Harness("test", runner)})
    a = store.create("owner", "s", config())
    body = RunRequest(
        request_id="req",
        expected_revision=1,
        prompt="Hi",
        email="fixture@example.com",
        connection=ModelConnection(
            model_platform="openai",
            model_type="gpt-a",
            auth_source="codex_subscription",
        ),
    )
    run = service.start("owner", "s", a["id"], body)
    await started.wait()
    await service.cancel("owner", "s", a["id"], run["id"])
    assert store.runs("owner", "s", a["id"])[0]["status"] == "interrupted"
    assert captured[0][0]["model"]["model_type"] == "gpt-a"
    assert service.tasks == {}


@pytest.mark.asyncio
async def test_service_rejects_mismatched_connection_and_redacts_errors(
    tmp_path,
):
    from app.session_agents.models import ModelConnection, RunRequest
    from app.session_agents.service import AgentService

    async def runner(*args):
        raise RuntimeError("provider returned secret-token")

    store = AgentStore(tmp_path / "agents.db")
    service = AgentService(store, {"standard": Harness("test", runner)})
    a = store.create("owner", "s", config())
    body = RunRequest(
        request_id="req",
        expected_revision=1,
        prompt="Hi",
        email="fixture@example.com",
        connection=ModelConnection(
            model_platform="openai",
            model_type="wrong",
            auth_source="codex_subscription",
        ),
    )
    with pytest.raises(Conflict):
        service.start("owner", "s", a["id"], body)
    assert store.runs("owner", "s", a["id"]) == []
    body.connection.model_type = "gpt-a"
    service.start("owner", "s", a["id"], body)
    await asyncio.gather(*service.tasks.values())
    run = store.runs("owner", "s", a["id"])[0]
    assert run["status"] == "failed"
    assert "secret-token" not in str(run)


@pytest.mark.asyncio
async def test_delete_session_joins_runs_and_erases_only_owned_records(
    tmp_path,
):
    from app.session_agents.models import ModelConnection, RunRequest
    from app.session_agents.service import AgentService

    started = asyncio.Event()
    stopped = asyncio.Event()

    async def runner(*args):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    store = AgentStore(tmp_path / "agents.db")
    service = AgentService(store, {"standard": Harness("test", runner)})
    a = store.create("owner", "s", config())
    b = store.create("other", "s", config())
    service.start(
        "owner",
        "s",
        a["id"],
        RunRequest(
            request_id="req",
            expected_revision=1,
            prompt="Hi",
            email="fixture@example.com",
            connection=ModelConnection(
                model_platform="openai",
                model_type="gpt-a",
                auth_source="codex_subscription",
            ),
        ),
    )
    await started.wait()
    await service.delete_session("owner", "s")
    assert stopped.is_set()
    assert store.list("owner", "s") == []
    assert store.get("other", "s", b["id"])
    assert not service.tasks
    with pytest.raises(NotFound):
        store.create("owner", "s", config())


def test_controller_requires_local_capability_and_partitions_accounts(
    tmp_path, monkeypatch
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.auth import local_control
    from app.controller import session_agent_controller as controller
    from app.session_agents.service import AgentService

    monkeypatch.setattr(
        local_control, "_process_local_control_capability", "test-capability"
    )
    monkeypatch.setattr(
        controller,
        "service",
        lambda: AgentService(AgentStore(tmp_path / "agents.db")),
    )
    app = FastAPI()
    app.include_router(controller.router)
    with TestClient(app, client=("127.0.0.1", 123)) as client:
        assert client.get("/session-agents/s").status_code == 401
        headers = {
            "X-Eigent-Local-Capability": "test-capability",
            "X-AgentDeck-Account": "account-a",
        }
        result = client.post(
            "/session-agents/s", headers=headers, json=config().model_dump()
        )
        assert result.status_code == 200
        agent_id = result.json()["id"]
        updated = client.put(
            f"/session-agents/s/{agent_id}",
            headers=headers,
            json={
                **config().model_dump(),
                "expected_revision": 1,
                "role": "Reviewer",
                "instructions": "List risks first.",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["role"] == "Reviewer"
        assert updated.json()["instructions"] == "List risks first."
        assert (
            len(client.get("/session-agents/s", headers=headers).json()) == 1
        )
        headers["X-AgentDeck-Account"] = "account-b"
        assert client.get("/session-agents/s", headers=headers).json() == []
        assert (
            client.get(
                f"/session-agents/s/{result.json()['id']}/runs",
                headers=headers,
            ).status_code
            == 404
        )


@pytest.mark.asyncio
async def test_runner_restores_only_supplied_history_and_closes_model(
    monkeypatch,
):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from app.session_agents import runner
    from app.session_agents.models import ModelConnection

    model = SimpleNamespace(_async_client=SimpleNamespace(close=AsyncMock()))
    factory = MagicMock(return_value=lambda: model)
    agent = MagicMock()
    agent.astep = AsyncMock(
        return_value=SimpleNamespace(
            terminated=False, msgs=[SimpleNamespace(content="Answer")]
        )
    )
    monkeypatch.setattr(runner, "create_model_builder", factory)
    monkeypatch.setattr(runner, "ChatAgent", MagicMock(return_value=agent))
    node = {"id": "node-a", "name": "Research"}
    connection = ModelConnection(
        model_platform="openai",
        model_type="gpt-a",
        api_key="secret",
        model_config_dict={
            "tools": [{"type": "web_search"}],
            "temperature": 0.2,
            "conversation": "external-thread",
        },
        extra_params={
            "model_config_dict": {
                "extra_body": {
                    "tools": [{"type": "code_interpreter"}],
                    "keep": True,
                    "previous_response_id": "from-another-task",
                    "input": "external-history",
                }
            }
        },
    )
    result = await runner.run_text_agent(
        node,
        [("Prior question", "Prior answer")],
        "New question",
        connection,
        "test@example.com",
    )
    assert result == "Answer"
    options = factory.call_args.args[3]
    assert options.model_config_dict == {"temperature": 0.2}
    assert options.extra_params == {
        "model_config_dict": {"extra_body": {"keep": True}}
    }
    assert factory.call_args.args[3].model_type == "gpt-a"
    assert [
        call.args[0].content for call in agent.update_memory.call_args_list
    ] == ["Prior question", "Prior answer"]
    model._async_client.close.assert_awaited_once()


def test_role_edits_preserve_run_snapshot_and_other_nodes(tmp_path):
    path = tmp_path / "agents.db"
    store = AgentStore(path)
    original = AgentConfig(
        **{
            **config().model_dump(),
            "role": "Researcher",
            "instructions": "Cite sources.",
        }
    )
    a = store.create("owner", "s", original)
    b = store.create("owner", "s", config())
    run, _ = store.begin("owner", "s", a["id"], 1, "r1", "Hello")
    changed = original.model_copy(
        update={"role": "Reviewer", "instructions": "List risks."}
    )
    store.update("owner", "s", a["id"], 1, changed)
    store.finish(run["id"], "completed", output="Answer")
    restored = AgentStore(path)
    assert restored.get("owner", "s", a["id"])["role"] == "Reviewer"
    assert restored.get("owner", "s", a["id"])["instructions"] == "List risks."
    assert restored.get("owner", "s", b["id"])["instructions"] == ""
    saved = restored.runs("owner", "s", a["id"])[0]["agent"]
    assert (saved["role"], saved["instructions"]) == (
        "Researcher",
        "Cite sources.",
    )
    next_run, _ = restored.begin("owner", "s", a["id"], 2, "r2", "Next")
    assert next_run["agent"]["instructions"] == "List risks."


def test_legacy_configs_load_with_empty_role_without_rewriting_snapshots(
    tmp_path,
):
    import json

    store = AgentStore(tmp_path / "agents.db")
    a = store.create("owner", "s", config())
    legacy = {"name": a["name"], "model": a["model"]}
    with store.connect() as db:
        db.execute(
            "UPDATE agents SET config=? WHERE id=?",
            (json.dumps(legacy), a["id"]),
        )
    run, _ = store.begin("owner", "s", a["id"], 1, "r", "Hello")
    legacy_snapshot = {
        k: v
        for k, v in run["agent"].items()
        if k not in {"role", "instructions", "harness_id", "harness_version"}
    }
    assert run["agent"]["harness_id"] == "standard"
    assert run["agent"]["harness_version"] == "1.0.0"
    serialized = json.dumps(legacy_snapshot)
    with store.connect() as db:
        db.execute(
            "UPDATE agent_runs SET snapshot=? WHERE id=?",
            (serialized, run["id"]),
        )
    assert store.get("owner", "s", a["id"])["role"] == ""
    assert store.get("owner", "s", a["id"])["harness_id"] == "standard"
    assert (
        "harness_version" not in store.runs("owner", "s", a["id"])[0]["agent"]
    )
    assert store.runs("owner", "s", a["id"])[0]["agent"]["instructions"] == ""
    with store.connect() as db:
        assert (
            db.execute(
                "SELECT snapshot FROM agent_runs WHERE id=?", (run["id"],)
            ).fetchone()[0]
            == serialized
        )


@pytest.mark.asyncio
async def test_runner_uses_each_nodes_role_and_instructions(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from app.session_agents import runner
    from app.session_agents.models import ModelConnection

    model = SimpleNamespace(_async_client=SimpleNamespace(close=AsyncMock()))
    factory = MagicMock(return_value=lambda: model)
    agent = MagicMock()
    agent.astep = AsyncMock(
        return_value=SimpleNamespace(
            terminated=False, msgs=[SimpleNamespace(content="Done")]
        )
    )
    constructor = MagicMock(return_value=agent)
    monkeypatch.setattr(runner, "create_model_builder", factory)
    monkeypatch.setattr(runner, "ChatAgent", constructor)
    connection = ModelConnection(model_platform="openai", model_type="model-a")
    await runner.run_text_agent(
        {
            "id": "a",
            "name": "A",
            "role": "Researcher",
            "instructions": "Cite sources.\nUse Chinese.",
            "skill_material": "Use the audit checklist.",
        },
        [],
        "Hello",
        connection,
        "test@example.com",
    )
    system = constructor.call_args.kwargs["system_message"]
    assert "Researcher" in system and "Cite sources.\nUse Chinese." in system
    assert "Use the audit checklist." in system
    assert factory.call_args.args[2] == system
    await runner.run_text_agent(
        {"id": "b", "name": "B"}, [], "Hello", connection, "test@example.com"
    )
    default_system = constructor.call_args.kwargs["system_message"]
    assert (
        "Researcher" not in default_system
        and "Cite sources." not in default_system
    )
    assert "helpful assistant" in default_system


@pytest.mark.asyncio
async def test_runner_accumulates_stream_deltas_before_empty_final_chunk(
    monkeypatch,
):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from camel.agents.chat_agent import AsyncStreamingChatAgentResponse

    from app.session_agents import runner
    from app.session_agents.models import ModelConnection

    async def chunks():
        for text in ["Hello", " world", ""]:
            yield SimpleNamespace(
                terminated=False,
                msg=SimpleNamespace(content=text),
                msgs=[SimpleNamespace(content=text)],
            )

    model = SimpleNamespace(_async_client=SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr(
        runner, "create_model_builder", lambda *a, **k: lambda: model
    )
    agent = MagicMock()
    agent.astep = AsyncMock(
        return_value=AsyncStreamingChatAgentResponse(chunks())
    )
    monkeypatch.setattr(runner, "ChatAgent", MagicMock(return_value=agent))
    result = await runner.run_text_agent(
        {"id": "a", "name": "A"},
        [],
        "Hi",
        ModelConnection(model_platform="openai", model_type="model-a"),
        "test@example.com",
    )
    assert result == "Hello world"


@pytest.mark.asyncio
async def test_harness_dispatch_uses_recorded_version_and_existing_node_history(
    tmp_path,
):
    from pydantic import ValidationError

    from app.session_agents.models import RunRequest
    from app.session_agents.service import AgentService

    store = AgentStore(tmp_path / "agents.db")
    node = store.create("owner", "s", config())
    with pytest.raises(ValidationError):
        AgentConfig(**{**config().model_dump(), "harness_id": "unknown"})
    first, _ = store.begin(
        "owner", "s", node["id"], 1, "earlier", "Earlier question"
    )
    store.finish(first["id"], "completed", output="Earlier answer")
    captured = []

    async def execute(node_config, turn):
        captured.append((node_config.harness_id, turn.history, turn.prompt))
        return "Continued"

    service = AgentService(
        store, {"standard": Harness("next-version", execute)}
    )
    request = RunRequest(
        request_id="next",
        expected_revision=1,
        prompt="Continue",
        email="test@example.com",
        connection={
            "model_type": "gpt-a",
            "model_platform": "openai",
            "auth_source": "codex_subscription",
        },
    )
    service.start("owner", "s", node["id"], request)
    await asyncio.gather(*service.tasks.values())
    assert captured == [
        ("standard", [("Earlier question", "Earlier answer")], "Continue")
    ]
    runs = store.runs("owner", "s", node["id"])
    assert [(r["agent"]["harness_version"], r["output"]) for r in runs] == [
        ("1.0.0", "Earlier answer"),
        ("next-version", "Continued"),
    ]
    replay = AgentService(store, {}).start("owner", "s", node["id"], request)
    assert replay["agent"]["harness_version"] == "next-version"
    with pytest.raises(Conflict):
        AgentService(store, {}).start(
            "owner",
            "s",
            node["id"],
            request.model_copy(update={"request_id": "fresh"}),
        )
    assert len(store.runs("owner", "s", node["id"])) == 2
