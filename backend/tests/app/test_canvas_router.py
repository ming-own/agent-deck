from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from app.session_agents.harnesses import HARNESSES, Harness
from app.session_agents.models import AgentConfig, RouteRequest
from app.session_agents.routing import admit_message, inbox
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict, NotFound


def agent(store, scope, name):
    return store.create(
        *scope,
        AgentConfig(
            name=name,
            model={
                "name": "Model",
                "id": "provider:1",
                "model_platform": "openai",
                "model_type": "model",
            },
        ),
    )["id"]


def message(target, **fields):
    return RouteRequest(
        event_id=uuid4(),
        target_agent_id=target,
        expected_revision=1,
        message="remember A",
        email="test@example.com",
        connection={
            "model_platform": "openai",
            "model_type": "model",
            "api_key": "runtime-only",
        },
        **fields,
    )


def test_concurrent_duplicate_is_one_transaction(tmp_path):
    path = tmp_path / "router.db"
    store = AgentStore(path)
    scope = ("owner", "session")
    target = agent(store, scope, "worker")
    event = message(target, new_task_name="A")
    barrier = Barrier(2)

    def dispatch():
        barrier.wait()
        return admit_message(store, *scope, event, HARNESSES)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: dispatch(), range(2)))
    receipt = results[0][0]
    assert results[1][0] == receipt
    assert sum(run is not None for _, run in results) == 1
    assert len(store.tasks(*scope, target)) == 2
    assert len(store.runs(*scope, target, receipt["target_task_id"])) == 1
    reopened = AgentStore(path)
    assert admit_message(reopened, *scope, event, HARNESSES) == (receipt, None)
    with pytest.raises(Conflict):
        admit_message(
            store,
            *scope,
            event.model_copy(update={"message": "different"}),
            HARNESSES,
        )
    with pytest.raises(Conflict):
        admit_message(
            store,
            *scope,
            message(target, new_task_name="invalid").model_copy(
                update={"expected_revision": 22}
            ),
            HARNESSES,
        )
    assert len(store.tasks(*scope, target)) == 2
    with store.connect() as db:
        assert "runtime-only" not in repr(
            [tuple(r) for r in db.execute("SELECT * FROM route_messages")]
        )


@pytest.mark.asyncio
async def test_reply_returns_to_origin_and_only_continues_a(tmp_path):
    store = AgentStore(tmp_path / "router.db")
    scope = ("owner", "session")
    target = agent(store, scope, "worker")
    origin = agent(store, scope, "sender")
    common = {"origin_agent_id": origin, "origin_task_id": "default"}
    seen = []

    async def execute(config, turn):
        seen.append((turn.prompt, turn.history))
        return "answer " + turn.prompt

    service = AgentService(store, {"standard": Harness("test", execute)})

    async def dispatch(body):
        r = service.route(*scope, body)
        await service.tasks[r["run_id"]]
        return r

    a = await dispatch(message(target, new_task_name="A", **common))
    b = await dispatch(
        message(target, new_task_name="B", **common).model_copy(
            update={"message": "remember B"}
        )
    )
    follow = await dispatch(
        message(target, reply_to=a["event_id"], **common).model_copy(
            update={"message": "add to A"}
        )
    )
    assert (
        follow["target_task_id"] == a["target_task_id"] != b["target_task_id"]
    )
    assert seen == [
        ("remember A", []),
        ("remember B", []),
        ("add to A", [("remember A", "answer remember A")]),
    ]
    receipts = inbox(store, *scope, origin, "default")
    assert [r["output"] for r in receipts] == [
        "answer add to A",
        "answer remember B",
        "answer remember A",
    ]
    assert not inbox(store, *scope, target, "default")
    for wrong in [("owner", "other"), ("another", "session")]:
        assert not inbox(store, *wrong)
        with pytest.raises(NotFound):
            service.route(
                *wrong, message(target, reply_to=a["event_id"], **common)
            )
    with pytest.raises(NotFound):
        service.route(*scope, message(target, reply_to=a["event_id"]))
    direct = await dispatch(
        message(target, task_id=b["target_task_id"], **common)
    )
    assert direct["target_task_id"] == b["target_task_id"]
    assert len(store.tasks(*scope, target)) == 3
    origin_scope = (*scope, origin)
    receive, _ = store.begin(*origin_scope, 1, "question", "summarize")
    ids = [row["event_id"] for row in receive["returned_results"]]
    assert ids == [
        a["event_id"],
        b["event_id"],
        follow["event_id"],
        direct["event_id"],
    ]
    assert "answer add to A" in store.turn_prompt(receive)
    store.finish(receive["id"], "failed")
    retry, _ = store.begin(*origin_scope, 1, "retry", "summarize")
    assert retry["returned_results"] == receive["returned_results"]
    store.finish(retry["id"], "completed", "summary")
    later, _ = store.begin(*origin_scope, 1, "later", "continue")
    assert (
        not later["returned_results"]
        and "answer add to A" in store.history(*origin_scope)[0][0]
    )
    await service.delete_session(*scope)
    with store.connect() as db:
        assert not db.execute("SELECT 1 FROM route_messages").fetchone()
