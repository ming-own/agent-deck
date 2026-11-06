# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Local-control-protected Session Agent instance API."""

from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.session_agents import batches, canvas_trials, workshop
from app.session_agents.models import (
    AgentConfig,
    BatchRequest,
    CanvasTrialRequest,
    CreateTask,
    InstallTemplate,
    PositionUpdate,
    RecoverBatch,
    RouteRequest,
    RunRequest,
    RunSettings,
    SaveTemplate,
    UpdateAgent,
    UpdateCardDesign,
    UpdateWorkforce,
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


_service_lock = Lock()


def service():
    # Sync read handlers and async write handlers can hit first startup together.
    with _service_lock:
        return _runtime()


@lru_cache(maxsize=1)
def _runtime():
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


@router.post("/{project_id}/canvas/trials")
async def start_canvas_trial(
    project_id: str,
    body: CanvasTrialRequest,
    account: Annotated[str, Depends(owner)],
):
    try:
        return canvas_trials.start(service(), (account, project_id), body)
    except (Conflict, NotFound) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/canvas/trials/latest")
def latest_canvas_trial(
    project_id: str, account: Annotated[str, Depends(owner)]
):
    try:
        return canvas_trials.latest(service().store, (account, project_id))
    except NotFound as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/canvas/trials/{trial_id}")
def get_canvas_trial(
    project_id: str,
    trial_id: str,
    account: Annotated[str, Depends(owner)],
):
    try:
        return canvas_trials.get(
            service().store, (account, project_id), trial_id
        )
    except NotFound as exc:
        raise translate(exc) from exc


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


@router.put("/{project_id}/{agent_id}/links/{target_id}")
def set_canvas_link(
    project_id: str,
    agent_id: str,
    target_id: str,
    enabled: bool,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().store.set_link(
            account, project_id, agent_id, target_id, enabled
        )
    except (Conflict, NotFound) as exc:
        raise translate(exc) from exc


@router.put("/{project_id}/{agent_id}/workforce")
def edit_workforce(
    project_id: str,
    agent_id: str,
    body: UpdateWorkforce,
    account: Annotated[str, Depends(owner)],
):
    try:
        return workshop.update_instance(
            service().store, (account, project_id), agent_id, body
        )
    except (Conflict, NotFound) as exc:
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
        return batches.batches(service().store, (account, project_id))
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


@router.post("/{project_id}/router/batches/{event_id}/recover")
async def recover_batch(
    project_id: str,
    event_id: str,
    body: RecoverBatch,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().recover_batch((account, project_id), event_id, body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/router/batches/{event_id}/stop")
async def stop_batch(
    project_id: str,
    event_id: str,
    generation: int,
    account: Annotated[str, Depends(owner)],
):
    try:
        await service().stop_batch((account, project_id), event_id, generation)
        return {"ok": True}
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/{agent_id}/runs/{run_id}/confirm")
async def confirm_queued(
    project_id: str,
    agent_id: str,
    run_id: str,
    task_id: str,
    body: RunSettings,
    account: Annotated[str, Depends(owner)],
):
    try:
        return service().confirm(
            (account, project_id), agent_id, task_id, run_id, body
        )
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.get("/{project_id}/workshop/runs/{run_id}")
def workforce_trace(
    project_id: str, run_id: str, account: Annotated[str, Depends(owner)]
):
    return batches.workforce_trace(
        service().store, (account, project_id), run_id
    )


@router.get("/{project_id}/workshop/templates")
def list_templates(project_id: str, account: Annotated[str, Depends(owner)]):
    return workshop.catalog(service().store, account)


@router.get("/{project_id}/workshop/templates/{family}/{version}")
def template_detail(
    project_id: str,
    family: str,
    version: int,
    account: Annotated[str, Depends(owner)],
):
    try:
        return workshop.detail(service().store, account, family, version)
    except NotFound as exc:
        raise translate(exc) from exc


@router.put("/{project_id}/{agent_id}/card-design")
def update_card_design(
    project_id: str,
    agent_id: str,
    body: UpdateCardDesign,
    account: Annotated[str, Depends(owner)],
):
    try:
        return workshop.update_card(
            service().store, (account, project_id), agent_id, body
        )
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/workshop/templates")
def save_template(
    project_id: str,
    body: SaveTemplate,
    account: Annotated[str, Depends(owner)],
):
    try:
        return workshop.save(service().store, (account, project_id), body)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc


@router.post("/{project_id}/workshop/instances")
def install_template(
    project_id: str,
    body: InstallTemplate,
    account: Annotated[str, Depends(owner)],
):
    try:
        root = workshop.install(service().store, (account, project_id), body)
        return service().store.get(account, project_id, root)
    except (NotFound, Conflict) as exc:
        raise translate(exc) from exc
