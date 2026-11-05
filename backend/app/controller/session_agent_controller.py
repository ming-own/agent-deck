"""Local-control-protected Session Agent instance API."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.session_agents.batches import batches
from app.session_agents.models import (
    AgentConfig,
    BatchRequest,
    CreateTask,
    PositionUpdate,
    RouteRequest,
    RunRequest,
    UpdateAgent,
)
from app.session_agents.routing import inbox
from app.session_agents.service import AgentService
from app.session_agents.skills import available_skills
from app.session_agents.store import AgentStore, Conflict, NotFound

router = APIRouter(prefix="/session-agents")


def owner(
    request: Request,
    principal: Annotated[
        LocalControlPrincipal, Depends(require_local_control_principal)
    ],
):
    # Only the capability-authenticated desktop renderer may choose its active
    # local account partition. Remote users always use authenticated identity.
    if principal.kind != "desktop_renderer":
        return f"brain:{principal.user_id}"
    key = request.headers.get("X-AgentDeck-Account", "").strip()
    if not key or len(key) > 2000:
        raise HTTPException(400, "Account scope is required")
    return f"desktop:{key}"


@lru_cache(maxsize=1)
def service():
    store = AgentStore(Path.home() / ".eigent" / "session-agents.sqlite3")
    store.interrupt_unfinished()
    return AgentService(store)


def translate(exc):
    return HTTPException(404 if isinstance(exc, NotFound) else 409, str(exc))


@router.get("/{project_id}")
async def list_agents(
    project_id: str, account: Annotated[str, Depends(owner)]
):
    return service().store.list(account, project_id)


@router.get("/{project_id}/skill-catalog")
def skill_catalog(project_id: str, account: Annotated[str, Depends(owner)]):
    try:
        return available_skills(account)
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(503, "Skill catalog unavailable") from exc


@router.post("/{project_id}")
async def create_agent(
    project_id: str, body: AgentConfig, account: Annotated[str, Depends(owner)]
):
    try:
        return service().store.create(account, project_id, body)
    except NotFound as exc:
        raise translate(exc) from exc


@router.delete("/{project_id}")
async def delete_session(
    project_id: str, account: Annotated[str, Depends(owner)]
):
    await service().delete_session(account, project_id)
    return {"ok": True}


@router.put("/{project_id}/{agent_id}")
async def update_agent(
    project_id: str,
    agent_id: str,
    body: UpdateAgent,
    account: Annotated[str, Depends(owner)],
):
    try:
        config = body.model_dump(exclude={"expected_revision"})
        missing = {
            "skill_ids",
            "tool_policy",
            "harness_id",
        } - body.model_fields_set
        if missing:
            current = service().store.get(account, project_id, agent_id)
            config.update({key: current[key] for key in missing})
        return service().store.update(
            account,
            project_id,
            agent_id,
            body.expected_revision,
            AgentConfig(**config),
        )
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.put("/{project_id}/{agent_id}/position")
def move_agent(
    project_id: str,
    agent_id: str,
    body: PositionUpdate,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().store.move(account, project_id, agent_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/{agent_id}/tasks")
def list_tasks(
    project_id: str, agent_id: str, account: Annotated[str, Depends(owner)]
):
    try:
        return service().store.tasks(account, project_id, agent_id)
    except NotFound as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/{agent_id}/tasks")
def create_task(
    project_id: str,
    agent_id: str,
    body: CreateTask,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().store.create_task(account, project_id, agent_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/{agent_id}/runs")
async def list_runs(
    project_id: str,
    agent_id: str,
    account: Annotated[str, Depends(owner)],
    task_id: str = "default",
):
    try:
        return service().store.runs(account, project_id, agent_id, task_id)
    except NotFound as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/{agent_id}/runs")
async def start_run(
    project_id: str,
    agent_id: str,
    body: RunRequest,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().start(account, project_id, agent_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/{agent_id}/runs/{run_id}/cancel")
async def cancel_run(
    project_id: str,
    agent_id: str,
    run_id: str,
    account: Annotated[str, Depends(owner)],
    task_id: str = "default",
):
    try:
        await service().cancel(account, project_id, agent_id, run_id, task_id)
        return {"ok": True}
    except NotFound as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/router/messages")
def route_inbox(
    project_id: str,
    account: Annotated[str, Depends(owner)],
    origin_agent_id: str | None = None,
    origin_task_id: str | None = None,
):
    if (origin_agent_id is None) != (origin_task_id is None):
        raise HTTPException(422, "Incomplete origin")
    try:
        return inbox(
            service().store,
            account,
            project_id,
            origin_agent_id,
            origin_task_id,
        )
    except NotFound as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/router/messages")
async def route_message(
    project_id: str,
    body: RouteRequest,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().route(account, project_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/router/batches")
def batch_history(project_id: str, account: Annotated[str, Depends(owner)]):
    try:
        return batches(service().store, (account, project_id))
    except NotFound as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/router/batches")
async def dispatch_batch(
    project_id: str,
    body: BatchRequest,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().dispatch_batch(account, project_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc
