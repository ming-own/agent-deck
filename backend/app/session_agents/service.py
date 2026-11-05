import asyncio
import logging
import traceback
from types import MappingProxyType

from .harnesses import HARNESSES, InvalidPlan, TurnContext
from .models import AgentConfig, RunRequest
from .routing import admit_message
from .skills import SkillLimitExceeded, SkillUnavailable, resolve_skills
from .store import AgentStore, NotFound


class AgentService:
    def __init__(self, store: AgentStore, harnesses=HARNESSES):
        self.store = store
        self.harnesses = MappingProxyType(dict(harnesses))
        self.tasks: dict[str, asyncio.Task] = {}

    def start(self, owner, project, agent_id, body: RunRequest):
        run, created = self.store.begin(
            owner,
            project,
            agent_id,
            body.expected_revision,
            body.request_id,
            body.prompt,
            body.approved_tools,
            task_id=body.task_id,
            source_run_id=str(body.source_run_id)
            if body.source_run_id
            else None,
            harnesses=self.harnesses,
            connection=body.connection,
        )
        if created:
            self.schedule(owner, project, run, body)
        return run

    def route(self, owner, project, body):
        event, run = admit_message(
            self.store, owner, project, body, self.harnesses
        )
        if run is not None:
            self.schedule(owner, project, run, body)
        return event

    def schedule(self, owner, project, run, body):
        history = self.store.history(
            owner, project, run["agent_id"], run["task_id"]
        )
        self.tasks[run["id"]] = asyncio.create_task(
            self.execute(owner, run, history, body.model_copy(deep=True))
        )

    async def execute(self, owner, run, history, body):
        try:
            async with asyncio.timeout(300):
                agent = run["agent"]
                material = ""
                if agent["skill_ids"]:
                    versions, material = await asyncio.to_thread(
                        resolve_skills, owner, agent["skill_ids"]
                    )
                    self.store.record_skill_versions(run["id"], versions)
                config = AgentConfig(
                    **{key: agent[key] for key in AgentConfig.model_fields}
                )
                context = TurnContext(
                    node_id=agent["id"],
                    history=history,
                    prompt=self.store.turn_prompt(run),
                    connection=body.connection,
                    email=body.email,
                    skill_material=material,
                    granted_tools=tuple(agent["granted_tools"]),
                    owner=owner,
                    record_plan=lambda plan: self.store.record_plan(
                        run["id"], plan
                    ),
                    admit_tool=lambda tool: self.store.admit_tool_call(
                        run["id"], tool
                    ),
                )
                harness = self.harnesses[config.harness_id]
                output = await harness.execute(config, context)
            if not output.strip():
                raise ValueError("empty_response")
            self.store.finish(run["id"], "completed", output=output)
        except asyncio.CancelledError:
            self.store.finish(run["id"], "interrupted", error="cancelled")
        except InvalidPlan:
            self.store.finish(run["id"], "failed", error="invalid_plan")
        except SkillUnavailable:
            self.store.finish(run["id"], "failed", error="skill_unavailable")
        except SkillLimitExceeded:
            self.store.finish(run["id"], "failed", error="skill_limit")
        except TimeoutError:
            self.store.finish(run["id"], "failed", error="model_timeout")
        except Exception as exc:
            # Provider exceptions may contain tokens, URLs or response bodies.
            logging.getLogger(__name__).error(
                "Session Agent inference failed: %s at %s",
                type(exc).__name__,
                " > ".join(
                    f"{frame.name}:{frame.lineno}"
                    for frame in traceback.extract_tb(exc.__traceback__)
                ),
            )
            self.store.finish(
                run["id"], "failed", error="model_request_failed"
            )
        finally:
            self.tasks.pop(run["id"], None)

    async def cancel(
        self, owner, project, agent_id, run_id, task_id="default"
    ):
        runs = self.store.runs(owner, project, agent_id, task_id)
        if not any(run["id"] == run_id for run in runs):
            raise NotFound("Run not found")
        task = self.tasks.get(run_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            # Cancellation may happen before execute() enters its try block.
            self.tasks.pop(run_id, None)
            self.store.finish(run_id, "interrupted", error="cancelled")

    async def delete_session(self, owner, project):
        self.store.close_session(owner, project)
        for run in self.store.running_in_session(owner, project):
            await self.cancel(
                owner, project, run["agent_id"], run["id"], run["task_id"]
            )
        self.store.delete_session(owner, project)
