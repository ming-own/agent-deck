"""Authenticated workspace metadata; canonical execution remains Session Agents."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.controller import session_agent_controller
from app.session_agents.store import Conflict, NotFound

router = APIRouter(prefix="/workspace-graph")
Account = Annotated[str, Depends(session_agent_controller.owner)]
Principal = Annotated[
    LocalControlPrincipal, Depends(require_local_control_principal)
]
Identifier = Annotated[str, Field(min_length=1, max_length=200)]
Revision = Annotated[int, Query(ge=1)]


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RegisterSessions(StrictBody):
    session_ids: list[Identifier] = Field(max_length=1000)


class ContextBody(StrictBody):
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(max_length=64000)
    enabled: bool = True


class UpdateContext(ContextBody):
    expected_revision: int = Field(ge=1)


class PositionBody(StrictBody):
    kind: Literal[
        "session",
        "agent",
        "task",
        "automation",
        "context",
        "memory",
        "settings",
    ]
    object_id: Identifier
    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)
    expected_revision: int = Field(ge=0)


class ReferencesBody(StrictBody):
    context_ids: list[Identifier] = Field(max_length=32)
    memory_ids: list[Identifier] = Field(max_length=32)
    expected_revision: int = Field(ge=0)


class AutomationBody(StrictBody):
    project_id: Identifier
    agent_id: Identifier
    expected_revision: int = Field(ge=0)


class InstantiateBody(StrictBody):
    execution_id: Identifier
    project_id: Identifier
    expected_binding_revision: int | None = Field(default=None, ge=1)


def graph_call(method, *args, **kwargs):
    graph = session_agent_controller.service().store.workspace_graph
    try:
        return getattr(graph, method)(*args, **kwargs)
    except (Conflict, NotFound) as exc:
        raise session_agent_controller.translate(exc) from exc


def require_renderer(principal):
    if principal.kind != "desktop_renderer":
        raise HTTPException(
            403, "Workspace membership requires the trusted desktop renderer"
        )


@router.get("/{space_id}")
def get_graph(space_id: str, account: Account):
    return graph_call("get", account, space_id)


@router.post("/{space_id}/sessions")
def register_sessions(
    space_id: str,
    body: RegisterSessions,
    account: Account,
    principal: Principal,
):
    require_renderer(principal)
    return graph_call("register_sessions", account, space_id, body.session_ids)


@router.post("/{space_id}/contexts")
def create_context(space_id: str, body: ContextBody, account: Account):
    return graph_call("create_context", account, space_id, **body.model_dump())


@router.put("/{space_id}/contexts/{context_id}")
def update_context(
    space_id: str, context_id: str, body: UpdateContext, account: Account
):
    return graph_call(
        "update_context", account, space_id, context_id, **body.model_dump()
    )


@router.delete("/{space_id}/contexts/{context_id}")
def delete_context(
    space_id: str,
    context_id: str,
    expected_revision: Revision,
    account: Account,
):
    return graph_call(
        "delete_context", account, space_id, context_id, expected_revision
    )


@router.put("/{space_id}/positions")
def move_node(space_id: str, body: PositionBody, account: Account):
    return graph_call("move", account, space_id, **body.model_dump())


@router.put("/{space_id}/agents/{project_id}/{agent_id}/references")
def set_references(
    space_id: str,
    project_id: str,
    agent_id: str,
    body: ReferencesBody,
    account: Account,
):
    return graph_call(
        "set_references",
        account,
        space_id,
        project_id,
        agent_id,
        **body.model_dump(),
    )


@router.put("/{space_id}/automations/{trigger_id}")
def bind_automation(
    space_id: str, trigger_id: str, body: AutomationBody, account: Account
):
    return graph_call(
        "bind_automation",
        account,
        space_id,
        trigger_id,
        body.project_id,
        body.agent_id,
        body.expected_revision,
    )


@router.delete("/{space_id}/automations/{trigger_id}")
def unbind_automation(
    space_id: str,
    trigger_id: str,
    expected_revision: Revision,
    account: Account,
):
    return graph_call(
        "unbind_automation", account, space_id, trigger_id, expected_revision
    )


@router.get("/{space_id}/automations/{trigger_id}/executions/{execution_id}")
def automation_execution(
    space_id: str, trigger_id: str, execution_id: str, account: Account
):
    return graph_call("execution", account, space_id, trigger_id, execution_id)


@router.post("/{space_id}/automations/{trigger_id}/instantiate")
def instantiate_automation(
    space_id: str,
    trigger_id: str,
    body: InstantiateBody,
    account: Account,
    principal: Principal,
):
    require_renderer(principal)
    return graph_call(
        "instantiate",
        account,
        space_id,
        trigger_id,
        body.execution_id,
        body.project_id,
        body.expected_binding_revision,
    )
