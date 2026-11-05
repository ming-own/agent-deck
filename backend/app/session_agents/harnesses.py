"""Execution strategies for Session Agent nodes."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import AgentConfig, ModelConnection


@dataclass(frozen=True)
class TurnContext:
    node_id: str
    history: list[tuple[str, str]]
    prompt: str
    connection: "ModelConnection" = field(repr=False)
    email: str = field(repr=False)
    skill_material: str = field(repr=False)
    granted_tools: tuple[str, ...]
    owner: str = field(repr=False)
    admit_tool: Callable[[str], None] = field(repr=False)


@dataclass(frozen=True)
class Harness:
    version: str
    execute: Callable[["AgentConfig", TurnContext], Awaitable[str]]


async def run_standard(config: "AgentConfig", turn: TurnContext) -> str:
    from .runner import run_text_agent

    runtime_node = {
        **config.model_dump(),
        "id": turn.node_id,
        "skill_material": turn.skill_material,
        "granted_tools": turn.granted_tools,
        "tool_owner": turn.owner,
        "admit_tool": turn.admit_tool,
    }
    return await run_text_agent(
        runtime_node, turn.history, turn.prompt, turn.connection, turn.email
    )


DEFAULT_HARNESS_ID = "standard"
HARNESSES = MappingProxyType(
    {DEFAULT_HARNESS_ID: Harness("1.0.0", run_standard)}
)
