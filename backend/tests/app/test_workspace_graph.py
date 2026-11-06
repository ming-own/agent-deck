"""All persistence in this module is isolated under pytest's temporary path."""

import asyncio
import json
from uuid import uuid4

import pytest

from app.lightweight_memory.service import LightweightMemoryService
from app.run_journal import SQLiteRunJournal
from app.session_agents.harnesses import Harness
from app.session_agents.models import (
    AgentConfig,
    CreateTask,
    ModelConnection,
    ModelReference,
    RunRequest,
)
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound


def config(name="Research"):
    return AgentConfig(
        name=name,
        model=ModelReference(
            id="codex:gpt-a",
            name="Model A",
            model_platform="openai",
            model_type="gpt-a",
        ),
    )


@pytest.fixture
def setup(tmp_path):
    store = AgentStore(tmp_path / "agents.db")
    with SQLiteRunJournal(tmp_path / "journal.db") as journal:
        memory = LightweightMemoryService(journal)
        graph = store.workspace_graph
        graph.memory_service = lambda: memory
        agent = store.create("owner", "session", config())
        graph.register_sessions("owner", "space", ["session"])
        yield store, graph, memory, agent


def add_memory(memory, content="Selected memory", space="space"):
    return memory.create_entry(
        scope_type="space",
        scope_id=space,
        kind="fact",
        content=content,
        actor_type="user",
        reason="fixture",
        source_trust="user_confirmed",
    ).entry


def test_graph_membership_is_additive_durable_and_cannot_be_stolen(setup):
    store, graph, _, _ = setup
    graph.register_sessions("owner", "space", ["second"])
    graph.register_sessions("owner", "other-space", ["third"])
    with pytest.raises(Conflict):
        graph.register_sessions("owner", "other-space", ["session", "fourth"])
    with pytest.raises(Conflict):
        graph.register_sessions("another", "space", ["session"])
    restored = AgentStore(store.path).workspace_graph
    assert restored.get("owner", "space")["session_ids"] == [
        "second",
        "session",
    ]
    assert restored.get("owner", "other-space")["session_ids"] == ["third"]
    assert restored.get("another", "space")["session_ids"] == []


def test_context_crud_scoping_and_optimistic_conflicts(setup):
    _, graph, _, _ = setup
    doc = graph.create_context("owner", "space", "Guide", "v1", True)
    assert graph.get("another", "space")["contexts"] == []
    assert graph.get("owner", "other-space")["contexts"] == []
    updated = graph.update_context(
        "owner", "space", doc["id"], 1, "Guide", "v2", True
    )
    assert updated["revision"] == 2
    with pytest.raises(Conflict):
        graph.update_context(
            "owner", "space", doc["id"], 1, "Guide", "stale", True
        )
    with pytest.raises(NotFound):
        graph.delete_context("owner", "other-space", doc["id"], 2)
    with pytest.raises(Conflict):
        graph.delete_context("owner", "space", doc["id"], 1)
    graph.delete_context("owner", "space", doc["id"], 2)
    assert graph.get("owner", "space")["contexts"] == []


def test_positions_are_typed_and_stale_writes_fail(setup):
    _, graph, _, _ = setup
    first = graph.move("owner", "space", "session", "same", 12, 25, 0)
    graph.move("owner", "space", "task", "same", 80, 99, 0)
    graph.move("owner", "space", "task", "history:project:task", 120, 140, 0)
    with pytest.raises(Conflict):
        graph.move("owner", "space", "session", "same", 0, 0, 0)
    assert first["revision"] == 1
    positions = graph.get("owner", "space")["positions"]
    assert len(positions) == 3
    assert positions[-1]["object_id"] == "history:project:task"
    assert graph.get("another", "space")["positions"] == []


def test_binding_rejects_cross_space_agent_context_memory_and_disabled(setup):
    store, graph, memory, agent = setup
    outside = store.create("owner", "outside", config())
    graph.register_sessions("owner", "other-space", ["outside"])
    doc = graph.create_context(
        "owner", "other-space", "Private", "private", True
    )
    bad_memory = add_memory(memory, space="other-space")
    for project, agent_id, contexts, memories in [
        ("outside", outside["id"], [], []),
        ("session", agent["id"], [doc["id"]], []),
        ("session", agent["id"], [], [bad_memory.memory_id]),
    ]:
        with pytest.raises((Conflict, NotFound)):
            graph.set_references(
                "owner", "space", project, agent_id, contexts, memories, 0
            )
    selected = graph.create_context(
        "owner", "space", "Selected", "material", True
    )
    graph.set_references(
        "owner", "space", "session", agent["id"], [selected["id"]], [], 0
    )
    with pytest.raises(Conflict):
        graph.set_references(
            "owner", "space", "session", agent["id"], [], [], 0
        )
    graph.update_context(
        "owner", "space", selected["id"], 1, "Selected", "material", False
    )
    with pytest.raises(Conflict, match="disabled"):
        store.begin("owner", "session", agent["id"], 1, "disabled", "Question")
    graph.delete_context("owner", "space", selected["id"], 2)
    with pytest.raises(NotFound, match="Context"):
        store.begin("owner", "session", agent["id"], 1, "missing", "Question")
    assert store.runs("owner", "session", agent["id"]) == []


def test_run_reference_snapshot_is_immutable_and_idempotent(setup):
    store, graph, memory, agent = setup
    doc = graph.create_context(
        "owner", "space", "Guide", "original content", True
    )
    selected = add_memory(memory)
    graph.set_references(
        "owner",
        "space",
        "session",
        agent["id"],
        [doc["id"]],
        [selected.memory_id],
        0,
    )
    run, created = store.begin(
        "owner", "session", agent["id"], 1, "request", "Question"
    )
    assert created
    refs = run["agent"]["resource_references"]
    assert [
        (r["kind"], r["name"], r["version"], r["content"]) for r in refs
    ] == [
        ("context", "Guide", 1, "original content"),
        ("memory", "fact", 1, "Selected memory"),
    ]
    graph.update_context(
        "owner", "space", doc["id"], 1, "Renamed", "new content", True
    )
    memory.update_entry(
        memory_id=selected.memory_id,
        expected_version=1,
        content="edited memory",
        kind="fact",
        actor_type="user",
        reason="fixture update",
        request_id="update-memory",
    )
    graph.set_references("owner", "space", "session", agent["id"], [], [], 1)
    retry, created = store.begin(
        "owner", "session", agent["id"], 1, "request", "Question"
    )
    assert not created and retry == run
    stored = AgentStore(store.path).runs("owner", "session", agent["id"])[0]
    assert stored["agent"]["resource_references"] == refs
    assert "original content" in store.turn_prompt(stored)
    assert "new content" not in store.turn_prompt(stored)
    assert "edited memory" not in store.turn_prompt(stored)


@pytest.mark.asyncio
async def test_executor_receives_only_selected_resources_at_user_priority(
    setup,
):
    store, graph, memory, agent = setup
    doc = graph.create_context(
        "owner", "space", "Guide", "selected context", True
    )
    graph.create_context(
        "owner", "space", "Unselected", "unrelated context", True
    )
    selected = add_memory(memory)
    add_memory(memory, "unrelated memory")
    graph.set_references(
        "owner",
        "space",
        "session",
        agent["id"],
        [doc["id"]],
        [selected.memory_id],
        0,
    )
    other = store.create_task(
        "owner", "session", agent["id"], CreateTask(id=uuid4(), name="Other")
    )
    earlier, _ = store.begin(
        "owner",
        "session",
        agent["id"],
        1,
        "old",
        "unrelated task prompt",
        task_id=other["id"],
    )
    store.finish(earlier["id"], "completed", "unrelated task output")
    received = []

    async def runner(node, context):
        received.append((node, context.history, context.prompt))
        return "answer"

    service = AgentService(store, {"standard": Harness("test", runner)})
    result = service.start(
        "owner",
        "session",
        agent["id"],
        RunRequest(
            request_id="live",
            expected_revision=1,
            email="fixture@example.test",
            prompt="User question",
            connection=ModelConnection(
                model_platform="openai",
                model_type="gpt-a",
                auth_source="codex_subscription",
                api_key="ephemeral-test-key",
            ),
        ),
    )
    await asyncio.gather(*service.tasks.values())
    assert (
        store.runs("owner", "session", agent["id"])[0]["status"] == "completed"
    )
    node, history, prompt = received[0]
    assert history == []
    assert node.instructions == ""
    parsed = json.loads(prompt.split("\n", 1)[1])
    assert parsed["user_instructions"] == "User question"
    assert [r["content"] for r in parsed["resource_references"]] == [
        "selected context",
        "Selected memory",
    ]
    assert "unrelated" not in prompt
    assert "ephemeral-test-key" not in store.path.read_bytes().decode(
        "utf-8", errors="ignore"
    )
    assert result["agent"]["instructions"] == ""


def test_automation_clone_is_atomic_idempotent_and_has_no_history(setup):
    store, graph, _, agent = setup
    doc = graph.create_context("owner", "space", "Guide", "reference", True)
    graph.set_references(
        "owner", "space", "session", agent["id"], [doc["id"]], [], 0
    )
    graph.bind_automation(
        "owner", "space", "trigger", "session", agent["id"], 0
    )
    run, _ = store.begin(
        "owner", "session", agent["id"], 1, "history", "private history"
    )
    store.finish(run["id"], "completed", "private answer")
    result = graph.instantiate(
        "owner", "space", "trigger", "execution", "destination"
    )
    assert result["created"] and result["agent"]["id"] != agent["id"]
    assert store.history("owner", "destination", result["agent"]["id"]) == []
    clone_run, _ = store.begin(
        "owner", "destination", result["agent"]["id"], 1, "new", "Question"
    )
    assert (
        clone_run["agent"]["resource_references"][0]["content"] == "reference"
    )
    store.update("owner", "session", agent["id"], 1, config("Edited source"))
    graph.unbind_automation("owner", "space", "trigger", 1)
    retry = graph.instantiate(
        "owner", "space", "trigger", "execution", "ignored-destination"
    )
    assert not retry["created"] and retry["project_id"] == "destination"
    assert retry["agent"]["name"] == "Research"
    assert store.list("owner", "ignored-destination") == []


def test_disabled_or_deleted_memory_rejects_new_turns(setup):
    store, graph, memory, agent = setup
    selected = add_memory(memory)
    graph.set_references(
        "owner", "space", "session", agent["id"], [], [selected.memory_id], 0
    )
    memory.journal.update_memory_scope_settings(
        "space",
        "space",
        expected_revision=memory.scope("space", "space").revision,
        use_enabled=False,
    )
    with pytest.raises(Conflict, match="disabled"):
        store.begin("owner", "session", agent["id"], 1, "disabled", "Question")
    memory.journal.update_memory_scope_settings(
        "space",
        "space",
        expected_revision=memory.scope("space", "space").revision,
        use_enabled=True,
    )
    memory.transition_entry(
        memory_id=selected.memory_id,
        expected_version=1,
        operation="remove",
        actor_type="user",
        reason="remove fixture",
        request_id="remove",
    )
    with pytest.raises(NotFound, match="Memory"):
        store.begin("owner", "session", agent["id"], 1, "deleted", "Question")


def test_controller_authentication_registration_boundary_and_revision(
    setup, monkeypatch
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.auth import (
        LocalControlPrincipal,
        local_control,
        require_local_control_principal,
    )
    from app.controller import (
        session_agent_controller,
        workspace_graph_controller,
    )

    store, _, _, _ = setup
    monkeypatch.setattr(
        local_control, "_process_local_control_capability", "test-capability"
    )
    monkeypatch.setattr(
        session_agent_controller, "service", lambda: AgentService(store)
    )
    app = FastAPI()
    app.include_router(workspace_graph_controller.router)
    headers = {
        "X-Eigent-Local-Capability": "test-capability",
        "X-AgentDeck-Account": "a",
    }
    with TestClient(app, client=("127.0.0.1", 123)) as client:
        assert client.get("/workspace-graph/new-space").status_code == 401
        assert (
            client.post(
                "/workspace-graph/new-space/sessions",
                json={"session_ids": ["new-session"]},
                headers=headers,
            ).status_code
            == 200
        )
        doc = client.post(
            "/workspace-graph/new-space/contexts",
            json={"name": "Guide", "content": "data"},
            headers=headers,
        ).json()
        body = {
            "name": "Guide",
            "content": "updated",
            "enabled": True,
            "expected_revision": 1,
        }
        assert (
            client.put(
                f"/workspace-graph/new-space/contexts/{doc['id']}",
                json=body,
                headers=headers,
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/workspace-graph/new-space/contexts/{doc['id']}",
                json=body,
                headers=headers,
            ).status_code
            == 409
        )
        other = {**headers, "X-AgentDeck-Account": "b"}
        assert (
            client.get("/workspace-graph/new-space", headers=other).json()[
                "contexts"
            ]
            == []
        )
        assert (
            client.post(
                "/workspace-graph/new-space/contexts",
                json={
                    "name": "Guide",
                    "content": "data",
                    "api_key": "do not persist",
                },
                headers=headers,
            ).status_code
            == 422
        )
        app.dependency_overrides[require_local_control_principal] = (
            lambda: LocalControlPrincipal(kind="brain_user", user_id="remote")
        )
        assert (
            client.post(
                "/workspace-graph/remote/sessions",
                json={"session_ids": ["remote-session"]},
                headers=headers,
            ).status_code
            == 403
        )
        assert (
            client.get("/workspace-graph/new-space", headers=headers).json()[
                "contexts"
            ]
            == []
        )


def test_queued_run_keeps_admission_resource_snapshot(setup):
    from app.session_agents.harnesses import HARNESSES
    from app.session_agents.models import RunSettings

    store, graph, _, agent = setup
    doc = graph.create_context("owner", "space", "Guide", "original", True)
    graph.set_references(
        "owner", "space", "session", agent["id"], [doc["id"]], [], 0
    )
    first, _ = store.begin(
        "owner", "session", agent["id"], 1, "first", "first"
    )
    queued, _ = store.begin(
        "owner",
        "session",
        agent["id"],
        1,
        "queued",
        "next",
        queue_if_busy=True,
    )
    graph.delete_context("owner", "space", doc["id"], 1)
    store.finish(first["id"], "completed", "answer")
    settings = RunSettings(
        expected_revision=1,
        email="test@example.test",
        connection=ModelConnection(
            model_platform="openai",
            model_type="gpt-a",
            auth_source="codex_subscription",
        ),
    )
    promoted = store.promote(
        ("owner", "session"),
        agent["id"],
        "default",
        queued["id"],
        settings,
        HARNESSES,
        "queued",
    )
    assert (
        promoted["agent"]["resource_references"]
        == queued["agent"]["resource_references"]
    )
    assert "original" in store.turn_prompt(promoted)


def test_workforce_clone_remaps_all_members_and_copies_selected_references(
    setup,
):
    from app.session_agents import workshop
    from app.session_agents.models import InstallTemplate

    store, graph, _, _ = setup
    root = workshop.install(
        store,
        ("owner", "session"),
        InstallTemplate(
            family="builtin-team",
            version=1,
            instance_id=uuid4(),
            model=config().model,
        ),
    )
    original = store.get("owner", "session", root)
    worker_id = original["workforce"]["branches"][0]["agent_id"]
    doc = graph.create_context(
        "owner", "space", "Worker guide", "worker material", True
    )
    graph.set_references(
        "owner", "space", "session", worker_id, [doc["id"]], [], 0
    )
    graph.bind_automation("owner", "space", "team-trigger", "session", root, 0)
    result = graph.instantiate(
        "owner", "space", "team-trigger", "team-event", "team-destination"
    )
    clone = result["agent"]
    members = store.list("owner", "team-destination")
    assert len(members) == 3
    route = clone["workforce"]
    ids = {n["id"] for n in members}
    assert route["summary"]["agent_id"] in ids
    assert route["branches"][0]["agent_id"] in ids
    assert ids.isdisjoint(n["id"] for n in store.list("owner", "session"))
    new_worker = route["branches"][0]["agent_id"]
    run, _ = store.begin(
        "owner", "team-destination", new_worker, 1, "run", "Question"
    )
    assert (
        run["agent"]["resource_references"][0]["content"] == "worker material"
    )
    graph.delete_context("owner", "space", doc["id"], 1)
    with pytest.raises(NotFound):
        graph.instantiate(
            "owner", "space", "team-trigger", "bad-event", "rolled-back"
        )
    assert store.list("owner", "rolled-back") == []
    assert "rolled-back" not in graph.get("owner", "space")["session_ids"]
    assert (
        graph.execution("owner", "space", "team-trigger", "bad-event") is None
    )


def test_automation_binding_revision_fences_rebind_during_session_creation(
    setup,
):
    store, graph, _, agent = setup
    graph.bind_automation(
        "owner", "space", "trigger", "session", agent["id"], 0
    )
    other = store.create("owner", "session", config("Replacement"))
    graph.bind_automation(
        "owner", "space", "trigger", "session", other["id"], 1
    )
    with pytest.raises(Conflict):
        graph.instantiate(
            "owner",
            "space",
            "trigger",
            "event",
            "destination",
            expected_binding_revision=1,
        )
    assert store.list("owner", "destination") == []
    assert "destination" not in graph.get("owner", "space")["session_ids"]
    result = graph.instantiate(
        "owner",
        "space",
        "trigger",
        "event",
        "destination",
        expected_binding_revision=2,
    )
    assert result["agent"]["name"] == "Replacement"
    retry = graph.instantiate(
        "owner",
        "space",
        "trigger",
        "event",
        "destination",
        expected_binding_revision=1,
    )
    assert (
        not retry["created"] and retry["agent"]["id"] == result["agent"]["id"]
    )


def test_automation_clones_linear_canvas_path_and_rejects_forks_and_cycles(
    setup,
):
    store, graph, _, first = setup
    second = store.create("owner", "session", config("Second"))
    third = store.create("owner", "session", config("Third"))
    store.set_link("owner", "session", first["id"], second["id"], True)
    graph.bind_automation(
        "owner", "space", "trigger", "session", first["id"], 0
    )
    cloned = graph.instantiate(
        "owner", "space", "trigger", "linear", "linear-destination"
    )
    nodes = store.list("owner", "linear-destination")
    assert [n["name"] for n in nodes] == ["Research", "Second"]
    assert nodes[0]["outputs"] == [nodes[1]["id"]]
    assert cloned["execution_path"] == [n["id"] for n in nodes]
    store.set_link("owner", "session", first["id"], third["id"], True)
    with pytest.raises(Conflict, match="linear"):
        graph.instantiate(
            "owner", "space", "trigger", "fork", "fork-destination"
        )
    assert "fork-destination" not in graph.get("owner", "space")["session_ids"]
    store.set_link("owner", "session", first["id"], third["id"], False)
    store.set_link("owner", "session", second["id"], first["id"], True)
    with pytest.raises(Conflict, match="linear"):
        graph.instantiate(
            "owner", "space", "trigger", "cycle", "cycle-destination"
        )
    assert (
        "cycle-destination" not in graph.get("owner", "space")["session_ids"]
    )


@pytest.mark.asyncio
async def test_exact_trial_lookup_preserves_automated_path_receipt_after_later_trial(
    setup,
):
    from app.session_agents import canvas_trials
    from app.session_agents.models import CanvasTrialRequest

    store, graph, _, first = setup
    second = store.create("owner", "session", config("Second"))
    store.set_link("owner", "session", first["id"], second["id"], True)
    graph.bind_automation(
        "owner", "space", "trigger", "session", first["id"], 0
    )
    copied = graph.instantiate(
        "owner", "space", "trigger", "event", "destination"
    )
    observed = []

    async def runner(node, context):
        observed.append((node.name, context.prompt, context.history))
        return f"{node.name} answer"

    service = AgentService(store, {"standard": Harness("test", runner)})
    path = copied["execution_path"]
    settings = {
        identity: dict(
            expected_revision=1,
            email="test@example.test",
            connection=dict(
                model_platform="openai",
                model_type="gpt-a",
                auth_source="codex_subscription",
            ),
        )
        for identity in path
    }
    body = CanvasTrialRequest(
        id=uuid4(), path=path, prompt="Automated question", settings=settings
    )
    canvas_trials.start(service, ("owner", "destination"), body)
    await asyncio.gather(*service.joins)
    later = body.model_copy(update={"id": uuid4(), "prompt": "Later question"})
    canvas_trials.start(service, ("owner", "destination"), later)
    await asyncio.gather(*service.joins)
    result = canvas_trials.get(store, ("owner", "destination"), str(body.id))
    assert result["status"] == "completed"
    assert result["prompt"] == "Automated question"
    assert result["steps"][-1]["output"] == "Second answer"
    assert (
        canvas_trials.get(store, ("another", "destination"), str(body.id))
        is None
    )
    assert observed[0] == ("Research", "Automated question", [])
    assert "Research answer" in observed[1][1]
    assert observed[1][2] == []
