from uuid import uuid4

import pytest

from app.session_agents.models import AgentConfig, CreateTask, RunRequest
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound


def node(store):
    return store.create(
        "owner",
        "session",
        AgentConfig(
            name="Reviewer",
            model={
                "id": "provider:1",
                "name": "Model",
                "model_platform": "openai",
                "model_type": "model",
            },
        ),
    )["id"]


def test_pre_task_database_migrates_once_and_keeps_original_turn(tmp_path):
    path = tmp_path / "legacy.db"
    store = AgentStore(path)
    agent = node(store)
    scope = ("owner", "session", agent)
    run, _ = store.begin(*scope, 1, "old", "earlier question")
    store.finish(run["id"], "completed", "earlier answer")
    with store.connect() as db:
        db.executescript("""
            DROP INDEX agent_task_history;
            DROP INDEX agent_task_running;
            DROP TABLE agent_tasks;
            ALTER TABLE agent_runs DROP COLUMN task_id;
            CREATE UNIQUE INDEX agent_running ON agent_runs(agent_id) WHERE status='running';
        """)
    for _ in range(2):
        store = AgentStore(path)
        assert store.tasks(*scope) == [{"id": "default", "name": ""}]
        [record] = store.runs(*scope)
        assert record["id"] == run["id"] and record["task_id"] == "default"
        assert store.history(*scope) == [
            ("earlier question", "earlier answer")
        ]


@pytest.mark.asyncio
async def test_reopen_and_continue_two_tasks_with_disjoint_model_inputs(
    tmp_path, monkeypatch
):
    from app.session_agents import runner

    inputs = []

    async def capture(node, history, prompt, *args, **kwargs):
        inputs.append((prompt, history.copy()))
        return f"answer {prompt}"

    monkeypatch.setattr(runner, "run_text_agent", capture)
    path = tmp_path / "tasks.db"
    service = AgentService(AgentStore(path))
    scope = ("owner", "session", node(service.store))
    task_ids = []
    for name in ("A", "B"):
        body = CreateTask(id=uuid4(), name=name)
        task = service.store.create_task(*scope, body)
        assert service.store.create_task(*scope, body) == task
        task_ids.append(task["id"])

    def start(task_id, prompt):
        return service.start(
            *scope,
            RunRequest(
                request_id=str(uuid4()),
                expected_revision=1,
                task_id=task_id,
                prompt=prompt,
                email="test@example.com",
                connection={"model_platform": "openai", "model_type": "model"},
            ),
        )

    first = [
        start(task_id, name) for task_id, name in zip(task_ids, ("A1", "B1"))
    ]
    with pytest.raises(NotFound):
        await service.cancel(*scope, first[0]["id"], task_ids[1])
    with pytest.raises(Conflict):
        start(task_ids[0], "concurrent")
    for run in first:
        future = service.tasks.get(run["id"])
        if future:
            await future

    service = AgentService(AgentStore(path))
    for task_id, label in zip(reversed(task_ids), ("B", "A")):
        run = start(task_id, label + "2")
        await service.tasks[run["id"]]
        assert [r["prompt"] for r in service.store.runs(*scope, task_id)] == [
            label + "1",
            label + "2",
        ]
    assert inputs == [
        ("A1", []),
        ("B1", []),
        ("B2", [("B1", "answer B1")]),
        ("A2", [("A1", "answer A1")]),
    ]
    assert service.store.runs(*scope) == []
    other = node(service.store)
    for wrong in [
        ("another", scope[1], scope[2]),
        (scope[0], "other", scope[2]),
        (*scope[:2], other),
    ]:
        with pytest.raises(NotFound):
            service.store.runs(*wrong, task_ids[0])
        with pytest.raises(NotFound):
            service.store.begin(
                *wrong, 1, "wrong", "wrong", task_id=task_ids[0]
            )
    await service.delete_session(*scope[:2])
    with service.store.connect() as db:
        assert (
            db.execute("SELECT COUNT(*) FROM agent_tasks").fetchone()[0] == 0
        )
