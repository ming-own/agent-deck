from uuid import uuid4

import pytest

from app.session_agents.models import AgentConfig, CreateTask, RunRequest
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound


def node(store, owner="owner", project="session"):
    return store.create(
        owner,
        project,
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
            ALTER TABLE agent_runs DROP COLUMN source_answer;
            CREATE UNIQUE INDEX agent_running ON agent_runs(agent_id) WHERE status='running';
        """)
    for _ in range(2):
        store = AgentStore(path)
        [task] = store.tasks(*scope)
        assert task["id"] == "default" and task["name"] == ""
        assert task["last_run"]["id"] == run["id"]
        assert task["last_run"]["status"] == "completed"
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


def test_forward_keeps_the_exact_source_turn_and_target_context(tmp_path):
    path = tmp_path / "answers.db"
    store = AgentStore(path)
    scope = ("owner", "session")
    source, target = node(store), node(store)
    task = store.create_task(
        *scope, target, CreateTask(id=uuid4(), name="cost")
    )["id"]
    first, _ = store.begin(*scope, source, 1, "request", "report")
    store.finish(first["id"], "completed", "cost 120; time 7")
    args = (*scope, target, 1, "forward-once", "only cost")
    routed, created = store.begin(
        *args, task_id=task, source_run_id=first["id"]
    )
    assert created and routed["source_answer"]["id"] == first["id"]
    assert store.begin(*args, task_id=task, source_run_id=first["id"]) == (
        routed,
        False,
    )
    store.finish(routed["id"], "completed", "120")
    later, _ = store.begin(*scope, source, 1, "again", "report")
    with pytest.raises(Conflict):
        store.begin(
            *scope, target, 1, "pending", "", source_run_id=later["id"]
        )
    store.finish(later["id"], "completed", "cost 195; time 9")
    with pytest.raises(Conflict):
        store.begin(*args, task_id=task, source_run_id=later["id"])
    with pytest.raises(Conflict):
        store.begin(*scope, source, 1, "self", "", source_run_id=first["id"])
    for other_scope in [("other", "session"), ("owner", "other")]:
        other_id = node(store, *other_scope)
        with pytest.raises(NotFound):
            store.begin(
                *other_scope,
                other_id,
                1,
                "outside",
                "",
                source_run_id=first["id"],
            )
    restored = AgentStore(path)
    [saved] = restored.runs(*scope, target, task)
    assert saved["source_answer"] == routed["source_answer"]
    assert saved["source_answer"]["output"] == "cost 120; time 7"
    prompt = restored.turn_prompt(saved)
    assert (
        "cost 120" in prompt and "only cost" in prompt and "195" not in prompt
    )
    assert restored.history(*scope, target, task) == [(prompt, "120")]
    assert restored.history(*scope, target) == []


def test_tasks_include_latest_scoped_run_summary_with_bounded_queries(
    tmp_path, monkeypatch
):
    from contextlib import contextmanager

    store = AgentStore(tmp_path / "tasks.db")
    agent = node(store)
    scope = ("owner", "session", agent)
    empty = store.create_task(*scope, CreateTask(id=uuid4(), name="Empty"))
    failed = store.create_task(*scope, CreateTask(id=uuid4(), name="Failed"))
    for index in range(20):
        store.create_task(
            *scope, CreateTask(id=uuid4(), name=f"Pending {index}")
        )
    earlier, _ = store.begin(*scope, 1, "earlier", "Private earlier prompt")
    store.finish(earlier["id"], "completed", "Private earlier output")
    latest, _ = store.begin(*scope, 1, "latest", "Private current prompt")
    failure, _ = store.begin(
        *scope, 1, "failure", "Private failed prompt", task_id=failed["id"]
    )
    store.finish(failure["id"], "failed", error="provider_failed")
    other = node(store)
    store.begin("owner", "session", other, 1, "unrelated", "Unrelated prompt")
    queries = []
    original_connect = store.connect

    @contextmanager
    def trace_connect():
        with original_connect() as db:
            db.set_trace_callback(queries.append)
            yield db

    monkeypatch.setattr(store, "connect", trace_connect)
    tasks = {task["id"]: task for task in store.tasks(*scope)}
    assert tasks["default"]["last_run"] == {
        "id": latest["id"],
        "status": "running",
        "created_at": latest["created_at"],
        "finished_at": None,
    }
    assert tasks[failed["id"]]["last_run"]["id"] == failure["id"]
    assert tasks[failed["id"]]["last_run"]["status"] == "failed"
    assert tasks[failed["id"]]["last_run"]["finished_at"] is not None
    assert tasks[empty["id"]] == empty
    assert "Private" not in str(tasks) and "provider_failed" not in str(tasks)
    assert (
        len(
            [
                q
                for q in queries
                if q.lstrip().upper().startswith(("SELECT", "WITH"))
            ]
        )
        <= 2
    )
    with pytest.raises(NotFound):
        store.tasks("another", "session", agent)
    with pytest.raises(NotFound):
        store.tasks("owner", "other-session", agent)
