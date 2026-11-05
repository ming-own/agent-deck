import asyncio
from uuid import uuid4

import pytest

from app.session_agents import batches
from app.session_agents.harnesses import Harness
from app.session_agents.models import AgentConfig, BatchRequest
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rule,fail,expected",
    [
        ("all_success", False, "completed"),
        ("all_success", True, "blocked"),
        ("all_finished", True, "completed"),
    ],
)
async def test_parallel_review_barrier(tmp_path, rule, fail, expected):
    scope = ("owner", "session")
    store = AgentStore(tmp_path / "batches.db")
    agent = store.create(
        *scope,
        AgentConfig(
            name="Reviewer",
            model=dict(
                id="provider:1",
                name="Model",
                model_type="local",
                model_platform="openai",
            ),
        ),
    )["id"]
    started = [asyncio.Event(), asyncio.Event()]
    release = [asyncio.Event(), asyncio.Event()]
    prompts = []

    async def execute(config, turn):
        assert not turn.history
        prompts.append(turn.prompt)
        if turn.prompt.endswith(("review A", "review B")):
            i = int(turn.prompt.endswith("review B"))
            started[i].set()
            await release[i].wait()
            if fail and i:
                raise RuntimeError()
            return "answer " + str(i)
        return "summary"

    service = AgentService(store, {"standard": Harness("test", execute)})
    body = BatchRequest(
        event_id=uuid4(),
        message="Review both",
        join=rule,
        summary=dict(agent_id=agent, name="Summary"),
        branches=[
            dict(
                agent_id=agent, name=n, instructions="review " + n, contains=k
            )
            for n, k in [("A", "REVIEW"), ("B", ""), ("C", "missing")]
        ],
        settings={
            agent: dict(
                expected_revision=1,
                email="test@example.com",
                connection=dict(
                    model_platform="openai",
                    model_type="local",
                    api_key="never-persist",
                ),
            )
        },
    )
    batch = service.dispatch_batch(*scope, body)
    assert service.dispatch_batch(*scope, body) == batch
    assert batch["branches"][2] is None
    assert len({r["task_id"] for r in batch["branches"] if r}) == 2
    await asyncio.wait_for(asyncio.gather(*(e.wait() for e in started)), 2)
    a = service.tasks[batch["branches"][0]["id"]]
    release[0].set()
    await a
    assert batches.join(store, scope, body, service.harnesses) is None
    assert batches.batches(store, scope)[0]["summary"] is None
    release[1].set()
    await asyncio.gather(*service.joins)
    await asyncio.gather(*service.tasks.values())
    final = batches.batches(store, scope)[0]
    assert final["state"] == expected
    assert len(prompts) == (3 if expected == "completed" else 2)
    if final["summary"]:
        assert final["summary"]["created_at"] >= max(
            r["finished_at"] for r in final["branches"] if r
        )
        assert (
            "answer 0" in prompts[2]
            and ("model_request_failed" if fail else "answer 1") in prompts[2]
        )
    assert batches.join(store, scope, body, service.harnesses) is None
    assert (
        AgentService(AgentStore(store.path)).dispatch_batch(*scope, body)
        == final
    )
    with pytest.raises(Conflict):
        service.dispatch_batch(
            *scope, body.model_copy(update={"message": "reuse"})
        )
    assert not batches.batches(store, ("other", "session"))
    assert b"never-persist" not in store.path.read_bytes()
    await service.delete_session(*scope)


def test_no_match_and_atomic_rollback(tmp_path):
    scope = ("owner", "project")
    store = AgentStore(tmp_path / "conditional.db")
    config = AgentConfig(
        name="Review",
        model=dict(
            id="provider:1",
            name="Model",
            model_type="local",
            model_platform="openai",
        ),
    )
    first, second = [store.create(*scope, config)["id"] for _ in range(2)]
    body = BatchRequest(
        event_id=uuid4(),
        message="skip",
        summary=dict(agent_id=first, name="Summary"),
        branches=[
            dict(agent_id=a, name="Review", contains="go")
            for a in (first, second)
        ],
        settings={
            first: dict(
                expected_revision=1,
                email="review@example.com",
                connection=dict(model_type="local", model_platform="openai"),
            )
        },
    )
    service = AgentService(store)
    result = service.dispatch_batch(*scope, body)
    assert result["state"] == "unmatched" and result["branches"] == [
        None,
        None,
    ]
    with pytest.raises(Conflict):
        service.dispatch_batch(
            *scope,
            body.model_copy(update={"event_id": uuid4(), "message": "GO"}),
        )
    assert len(store.tasks(*scope, first)) == 1
    assert len(batches.batches(store, scope)) == 1
