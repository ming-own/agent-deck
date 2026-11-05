"""Resolve a node's explicitly selected local skills for a single text turn."""

import hashlib
import json

from app.agent.toolkit.skill_toolkit import (
    _is_agent_allowed,
    _is_skill_enabled,
)
from app.service import skill_service
from app.service.skill_config_service import skill_config_for_execution


class SkillUnavailable(ValueError):
    pass


class SkillLimitExceeded(ValueError):
    pass


def _account_config(owner: str) -> dict:
    # Desktop partitions are JSON [environment, "id:<user_id>"]. Remote
    # control partitions already carry the authenticated Brain user id.
    kind, _, identity = owner.partition(":")
    if kind == "desktop":
        key = json.loads(identity)
        if (
            not isinstance(key, list)
            or len(key) != 2
            or not isinstance(key[1], str)
            or not key[1].startswith("id:")
        ):
            raise SkillUnavailable("Skill account unavailable")
        identity = key[1][3:]
    elif kind != "brain":
        raise SkillUnavailable("Skill account unavailable")
    if not identity:
        raise SkillUnavailable("Skill account unavailable")
    return skill_config_for_execution(identity)


def _allowed(name, config):
    return _is_skill_enabled(name, config) and _is_agent_allowed(
        name, "single_agent", config
    )


def available_skills(owner: str) -> list[dict]:
    config = _account_config(owner)
    return sorted(
        [
            {"id": item["skillDirName"], "name": item["name"]}
            for item in skill_service.skills_scan(
                sync_examples=not skill_service.SKILLS_ROOT.exists()
            )
            if _allowed(item["name"], config)
        ],
        key=lambda item: (item["name"].casefold(), item["id"]),
    )


def resolve_skills(owner: str, ids: list[str]) -> tuple[list[dict], str]:
    """Read only selected package instructions, hashing the same bytes used by the model."""
    versions = []
    sections = []
    remaining = 256 * 1024
    try:
        config = _account_config(owner)
        for skill_id in ids:
            if (skill_service.SKILLS_ROOT / skill_id).is_symlink():
                raise SkillUnavailable("Selected skill unavailable")
            path = skill_service.skill_file_path(skill_id, "SKILL.md")
            with path.open("rb") as file:
                raw = file.read(remaining + 1)
            if len(raw) > remaining:
                raise SkillLimitExceeded(
                    "Selected skill instructions are too large"
                )
            remaining -= len(raw)
            content = raw.decode("utf-8")
            meta = skill_service._parse_skill_frontmatter(content)
            if not meta or not _allowed(meta["name"], config):
                raise SkillUnavailable("Selected skill unavailable")
            versions.append(
                {
                    "id": skill_id,
                    "name": meta["name"],
                    "sha256": hashlib.sha256(raw).hexdigest(),
                }
            )
            sections.append(content)
    except SkillLimitExceeded:
        raise
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        raise SkillUnavailable("Selected skill unavailable") from exc
    return versions, "\n\n".join(sections)
