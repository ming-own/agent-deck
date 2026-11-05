import sqlite3

import pytest
from pydantic import ValidationError

from app.session_agents.models import AgentConfig, PositionUpdate
from app.session_agents.store import AgentStore, Conflict, NotFound


def config():
    return AgentConfig(
        name="Canvas agent",
        model={
            "id": "provider:1",
            "model_type": "model",
            "model_platform": "openai",
            "name": "Model",
        },
    )


def test_canvas_moves_are_scoped_and_independent_from_runs(tmp_path):
    path = tmp_path / "canvas.db"
    store = AgentStore(path)
    a = store.create("a", "one", config())
    b = store.create("a", "two", config())
    move = PositionUpdate(x=80, y=130, expected_revision=0)
    for owner, project in [("a", "two"), ("another", "one")]:
        with pytest.raises(NotFound):
            store.move(owner, project, a["id"], move)
    pos = store.move("a", "one", a["id"], move)
    assert pos == store.move("a", "one", a["id"], move)
    with pytest.raises(Conflict):
        store.move(
            "a",
            "one",
            a["id"],
            PositionUpdate(x=90, y=64, expected_revision=0),
        )
    restored = AgentStore(path)
    assert restored.list("a", "one")[0]["position"] == {
        "x": 80,
        "y": 130,
        "revision": 1,
    }
    other = restored.list("a", "two")[0]
    assert other["id"] == b["id"] and other["position"]["revision"] == 0
    run, _ = store.begin("a", "one", a["id"], 1, "once", "Hi")
    assert "position" not in run["agent"]
    store.close_session("a", "one")
    store.delete_session("a", "one")
    with store.connect() as db:
        assert (
            db.execute("SELECT agent_id FROM agent_positions").fetchone()[0]
            == b["id"]
        )


def test_old_nodes_receive_stable_positions_and_new_nodes_avoid_moved_cards(
    tmp_path,
):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE agents(id TEXT PRIMARY KEY, owner TEXT,project TEXT,config TEXT,revision INTEGER, created_at TEXT,updated_at TEXT)"
        )
        for id in ["a", "b"]:
            db.execute(
                "INSERT INTO agents VALUES(?,?,?,?,1,'t','t')",
                (id, "owner", "s", config().model_dump_json()),
            )
    store = AgentStore(path)
    a, b = store.list("owner", "s")
    assert a["position"] != b["position"]
    store.move(
        "owner", "s", "a", PositionUpdate(x=24, y=204, expected_revision=0)
    )
    c = store.create("owner", "s", config())
    nodes = AgentStore(path).list("owner", "s")
    assert nodes[1]["position"] == b["position"]
    assert nodes[2]["id"] == c["id"] and nodes[2]["position"] != {
        "x": 24,
        "y": 204,
        "revision": 0,
    }
    with pytest.raises(ValidationError):
        PositionUpdate(x=0, y=0, expected_revision=0)


def test_canvas_connections_persist_without_sharing_tasks(tmp_path):
    path = tmp_path / "canvas-links.db"
    store = AgentStore(path)
    source, target, third = [
        store.create("a", "one", config())["id"] for _ in range(3)
    ]
    foreign = store.create("a", "two", config())["id"]
    for end in [target, target, third]:
        store.set_link("a", "one", source, end, True)
    with pytest.raises(NotFound):
        store.set_link("a", "one", source, foreign, True)
    with pytest.raises(NotFound):
        store.set_link("b", "one", source, target, False)
    with pytest.raises(Conflict):
        store.set_link("a", "one", source, source, True)
    restored = AgentStore(path)
    a, b, c = restored.list("a", "one")
    assert (
        set(a["outputs"]) == {target, third}
        and not b["outputs"]
        and not c["outputs"]
    )
    assert not restored.runs("a", "one", target)
    restored.set_link("a", "one", source, target, False)
    assert restored.list("a", "one")[0]["outputs"] == [third]
