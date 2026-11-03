"""Local-control-protected Session Agent instance API."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.session_agents.models import AgentConfig, RunRequest, UpdateAgent
from app.session_agents.service import AgentService
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
    from app.session_agents.runner import run_text_agent

    store = AgentStore(Path.home() / ".eigent" / "session-agents.sqlite3")
    store.interrupt_unfinished()
    return AgentService(store, run_text_agent)


def translate(exc):
    return HTTPException(404 if isinstance(exc, NotFound) else 409, str(exc))


@router.get("/{project_id}")
async def list_agents(
    project_id: str, account: Annotated[str, Depends(owner)]
):
    return service().store.list(account, project_id)


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
        return service().store.update(
            account,
            project_id,
            agent_id,
            body.expected_revision,
            AgentConfig(**body.model_dump(exclude={"expected_revision"})),
        )
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/{agent_id}/runs")
async def list_runs(
    project_id: str, agent_id: str, account: Annotated[str, Depends(owner)]
):
    try:
        return service().store.runs(account, project_id, agent_id)
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
):
    try:
        await service().cancel(account, project_id, agent_id, run_id)
        return {"ok": True}
    except NotFound as exc:
        raise translate(exc) from exc
