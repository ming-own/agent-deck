import asyncio
import hashlib

import pytest
from pydantic import ValidationError

from app.service import skill_config_service, skill_service
from app.session_agents.models import AgentConfig, RunRequest
from app.session_agents.service import AgentService
from app.session_agents.skills import (
    SkillUnavailable,
    available_skills,
    resolve_skills,
)
from app.session_agents.store import AgentStore


@pytest.fixture
def library(tmp_path, monkeypatch):
    root = tmp_path / "skills"
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", root)
    monkeypatch.setattr(skill_service, "get_example_skills_root", lambda: None)
    monkeypatch.setattr(
        skill_config_service, "EIGENT_ROOT", tmp_path / "accounts"
    )
    for folder, name in [("audit", "Reviewer"), ("writer", "Writer")]:
        directory = root / folder
        directory.mkdir(parents=True)
        (directory / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: Test skill\n---\nUse {folder} workflow."
        )
    return root


def agent_config(skills):
    return AgentConfig(
        name="Example",
        model={
            "id": "provider:1",
            "name": "Model",
            "model_platform": "openai",
            "model_type": "model-a",
        },
        skill_ids=skills,
    )


def test_catalog_and_execution_share_account_policy(library):
    skill_config_service.skill_config_update(1, "Reviewer", {"enabled": False})
    skill_config_service.skill_config_update(
        1,
        "Writer",
        {"scope": {"isGlobal": False, "selectedAgents": ["developer_agent"]}},
    )
    desktop = 'desktop:["local","id:1"]'
    assert available_skills(desktop) == []
    for package in ["audit", "writer"]:
        with pytest.raises(SkillUnavailable):
            resolve_skills(desktop, [package])
    assert {s["id"] for s in available_skills("brain:2")} == {
        "audit",
        "writer",
    }
    skill_config_service.skill_config_update(
        1,
        "Writer",
        {"scope": {"isGlobal": False, "selectedAgents": ["single_agent"]}},
    )
    assert available_skills(desktop) == [{"id": "writer", "name": "Writer"}]


@pytest.mark.asyncio
async def test_node_skills_are_applied_and_versioned_independently(
    library, tmp_path
):
    calls = []

    async def runner(node, history, prompt, connection, email):
        calls.append(node.get("skill_material", ""))
        return "Done"

    store = AgentStore(tmp_path / "nodes.db")
    service = AgentService(store, runner)
    owner = "brain:1"
    a = store.create(owner, "s", agent_config(["audit"]))
    b = store.create(owner, "s", agent_config([]))

    async def turn(node, request):
        service.start(
            owner,
            "s",
            node["id"],
            RunRequest(
                request_id=request,
                expected_revision=1,
                prompt="Hi",
                email="fixture@example.com",
                connection={
                    "model_type": "model-a",
                    "model_platform": "openai",
                },
            ),
        )
        await asyncio.gather(*service.tasks.values())

    await turn(a, "first")
    await turn(b, "second")
    raw = (library / "audit" / "SKILL.md").read_bytes()
    assert calls == [raw.decode(), ""]
    version = {
        "id": "audit",
        "name": "Reviewer",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    (library / "audit" / "SKILL.md").write_bytes(raw + b"\nNew rule.")
    await turn(a, "updated")
    runs = store.runs(owner, "s", a["id"])
    assert runs[0]["agent"]["skill_versions"] == [version]
    assert runs[1]["agent"]["skill_versions"][0]["sha256"] != version["sha256"]
    assert calls[-1].endswith("New rule.")
    skill_config_service.skill_config_update(1, "Reviewer", {"enabled": False})
    await turn(a, "revoked")
    assert store.runs(owner, "s", a["id"])[-1]["error"] == "skill_unavailable"
    assert len(calls) == 3
    assert store.get(owner, "s", a["id"])["skill_ids"] == ["audit"]


def test_untrusted_paths_and_missing_packages_never_supply_model_context(
    library, tmp_path
):
    for ids in [
        ["../outside"],
        ["/absolute"],
        ["dir/file"],
        ["audit", "audit"],
    ]:
        with pytest.raises(ValidationError):
            agent_config(ids)
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    path = library / "writer" / "SKILL.md"
    path.unlink()
    path.symlink_to(outside)
    for package in ["writer", "missing"]:
        with pytest.raises(SkillUnavailable):
            resolve_skills("brain:1", [package])
    policy = skill_config_service._config_path(1)
    policy.parent.mkdir(parents=True, exist_ok=True)
    policy.write_text("invalid JSON")
    with pytest.raises(SkillUnavailable):
        resolve_skills("brain:1", ["audit"])
