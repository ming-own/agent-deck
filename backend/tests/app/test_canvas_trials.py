import asyncio
from uuid import uuid4

import pytest

from app.session_agents import canvas_trials, runner
from app.session_agents.models import (
    AgentConfig,
    CanvasTrialRequest,
    RunRequest,
)
from app.session_agents.service import AgentService
from app.session_agents.store import AgentStore, Conflict


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
async def test_canvas_execution(tmp_path, monkeypatch, fail):
    store = AgentStore(tmp_path / "session.db")
    service = AgentService(store)
    scope = ("me", "session")
    ids = [
        store.create(
            *scope,
            AgentConfig(
                name=name,
                model={
                    "id": "provider:1",
                    "name": "Model",
                    "model_platform": "openai",
                    "model_type": "model",
                },
            ),
        )["id"]
        for name in ["A", "B"]
    ]
    store.set_link(*scope, *ids, True)
    release = [asyncio.Event(), asyncio.Event()]
    entered = [asyncio.Event(), asyncio.Event()]
    calls = []

    async def infer(node, history, prompt, *args, **kwargs):
        i = ids.index(node["id"])
        calls.append((i, history, prompt))
        entered[i].set()
        await release[i].wait()
        if fail:
            raise ValueError("test failure")
        return ["specific upstream answer", "review completed"][i]

    monkeypatch.setattr(runner, "run_text_agent", infer)
    settings = dict(
        expected_revision=1,
        email="trial@example.com",
        connection={"model_platform": "openai", "model_type": "model"},
    )
    body = CanvasTrialRequest(
        id=uuid4(),
        prompt="review this",
        path=ids,
        settings=dict.fromkeys(ids, settings),
    )

    def latest():
        return canvas_trials.latest(store, scope)

    # Never execute a stale or truncated path.
    with pytest.raises(Conflict):
        canvas_trials.start(
            service,
            scope,
            CanvasTrialRequest(
                id=uuid4(),
                prompt="stale",
                path=ids[:1],
                settings={ids[0]: settings},
            ),
        )
    first = canvas_trials.start(service, scope, body)
    assert canvas_trials.start(service, scope, body) == first
    await asyncio.wait_for(entered[0].wait(), 2)
    assert [s["status"] for s in latest()["steps"]] == ["running", "waiting"]
    store.set_link(*scope, *ids, False)
    release[0].set()
    if not fail:
        await asyncio.wait_for(entered[1].wait(), 2)
        assert [s["status"] for s in latest()["steps"]] == [
            "completed",
            "running",
        ]
        release[1].set()
    await asyncio.gather(*service.joins)
    a, b = latest()["steps"]
    assert canvas_trials.latest(AgentStore(store.path), scope) == latest()
    assert canvas_trials.latest(store, ("someone_else", scope[1])) is None
    if fail:
        assert latest()["status"] == "failed"
        assert [a["status"], b["status"]] == ["failed", "skipped"] and len(
            calls
        ) == 1
        return
    assert latest()["status"] == "completed"
    assert a["task_id"] != b["task_id"] and b["output"] == "review completed"
    run = store.runs(*scope, ids[1], b["task_id"])[0]
    assert run["source_answer"]["id"] == a["run_id"]
    assert (
        run["source_answer"]["output"] == a["output"]
        and a["output"] in calls[1][2]
    )
    assert calls[0][1] == calls[1][1] == []
    store.set_link(*scope, *ids, True)
    manual = service.start(
        *scope,
        ids[0],
        RunRequest(**settings, request_id=str(uuid4()), prompt="manual"),
    )
    await service.tasks[manual["id"]]
    assert [c[0] for c in calls] == [0, 1, 0] and not store.runs(
        *scope, ids[1], "default"
    )
