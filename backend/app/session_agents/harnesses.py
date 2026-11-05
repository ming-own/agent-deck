"""Execution strategies for Session Agent nodes."""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
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
    record_plan: Callable[[str], None] = field(repr=False)


@dataclass(frozen=True)
class Harness:
    version: str
    execute: Callable[["AgentConfig", TurnContext], Awaitable[str]]


async def _run_stage(
    config: "AgentConfig", turn: TurnContext, instruction: str = ""
) -> str:
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
        runtime_node,
        turn.history,
        turn.prompt,
        turn.connection,
        turn.email,
        stage_instruction=instruction,
    )


async def run_standard(config: "AgentConfig", turn: TurnContext) -> str:
    return await _run_stage(config, turn)


class InvalidPlan(ValueError):
    pass


def _format_plan(response: str) -> str:
    raw = response.strip()
    if raw.startswith("```json\n") and raw.endswith("\n```"):
        raw = raw[8:-4].strip()
    if len(raw) > 8000:
        raise InvalidPlan("Plan exceeds size limit")
    try:
        document = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise InvalidPlan("Expected a structured action plan") from exc
    steps = document.get("steps") if isinstance(document, dict) else None
    if (
        not isinstance(steps, list)
        or not 1 <= len(steps) <= 6
        or any(
            not isinstance(step, str)
            or not step.strip()
            or len(step) > 500
            or "\n" in step.strip()
            for step in steps
        )
    ):
        raise InvalidPlan("Expected one to six short action steps")
    return "\n".join(
        f"{number}. {step.strip()}" for number, step in enumerate(steps, 1)
    )


async def run_plan_execute(config: "AgentConfig", turn: TurnContext) -> str:
    # Planning has no dispatchable tools. The original grants apply only to execution.
    tool_names = ", ".join(turn.granted_tools) or "none"
    planning_input = (
        "Prepare a plan for the task below. Use the language of the task. "
        'Return only a JSON object of the form {"steps":["action", "action"]}. '
        "Each step describes work for the next stage. Leave calculations, conclusions "
        "and the final output to that stage.\n\n"
        + json.dumps({"task": turn.prompt}, ensure_ascii=False)
    )
    response = await _run_stage(
        config,
        replace(turn, prompt=planning_input, granted_tools=()),
        "Planning stage: the deliverable for this stage is a public action checklist "
        "as JSON. Write one to six short steps, one action per string. "
        "Apply the task's requested answer format during execution only. "
        f"Tools available during execution: {tool_names}.",
    )
    plan = _format_plan(response)
    turn.record_plan(plan)
    # The generated plan is advisory task data, not a privileged instruction.
    prompt = f"Proposed plan:\n{plan}\n\nOriginal user task:\n{turn.prompt}"
    return await _run_stage(
        config,
        replace(turn, prompt=prompt),
        "Execution stage: complete the original user task using the proposed plan "
        "where appropriate. Correct any mistaken steps. Return the requested deliverable.",
    )


DEFAULT_HARNESS_ID = "standard"
HARNESSES = MappingProxyType(
    {
        DEFAULT_HARNESS_ID: Harness("1.0.0", run_standard),
        "plan_execute": Harness("1.1.0", run_plan_execute),
    }
)
