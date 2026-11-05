import asyncio
import logging
import traceback
from types import MappingProxyType

from . import batches
from .harnesses import HARNESSES, InvalidPlan, TurnContext
from .models import AgentConfig, RunRequest
from .routing import admit_message
from .skills import SkillLimitExceeded, SkillUnavailable, resolve_skills
from .store import AgentStore, Conflict, NotFound, now


class AgentService:
    def __init__(self, store: AgentStore, harnesses=HARNESSES):
        self.store = store
        self.harnesses = MappingProxyType(dict(harnesses))
        self.queued_settings = {}
        self.joins: set[asyncio.Task] = set()
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
            queue_if_busy=body.queue_if_busy,
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

    def dispatch_batch(self, owner, project, body):
        scope = (owner, project)
        event, jobs = batches.admit(self.store, scope, body, self.harnesses)
        if jobs:
            self.watch_batch(scope, body, jobs, event["generation"])
        return event

    def watch_batch(self, scope, body, jobs, generation):
        tasks = [
            self.schedule(*scope, run, settings) for run, settings in jobs
        ]
        if body is not None:
            waiter = asyncio.create_task(
                self.collect_batch(scope, body, tasks, generation)
            )
            self.joins.add(waiter)
            waiter.add_done_callback(self.joins.discard)

    def recover_batch(self, scope, event_id, action):
        record, jobs, body = batches.recover(
            self.store, scope, event_id, action, self.harnesses
        )
        if body or jobs:
            self.watch_batch(scope, body, jobs, record["generation"])
        return record

    async def stop_batch(self, scope, event_id, generation):
        targets = batches.stop(self.store, scope, event_id, generation)
        await asyncio.gather(
            *(
                self.cancel(*scope, r["agent_id"], r["id"], r["task_id"])
                for r in targets
            )
        )

    async def collect_batch(self, scope, body, tasks, generation):
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            run = batches.join(
                self.store, scope, body, self.harnesses, generation
            )
            if run:
                self.schedule(
                    *scope, run, body.settings[body.summary.agent_id]
                )
        except (Conflict, NotFound):
            with self.store.connect() as db:
                db.execute(
                    "UPDATE route_batches SET state='blocked' WHERE owner=? AND project=? AND event_id=? AND state='waiting' AND generation=?",
                    (*scope, str(body.event_id), generation),
                )

    def schedule(self, owner, project, run, body):
        if run["status"] == "queued":
            self.queued_settings[run["id"]] = body.model_copy(deep=True)
            return
        history = self.store.history(
            owner, project, run["agent_id"], run["task_id"]
        )
        self.tasks[run["id"]] = asyncio.create_task(
            self.execute(owner, run, history, body.model_copy(deep=True))
        )

        self.tasks[run["id"]].add_done_callback(
            lambda _: self.after_turn((owner, project), run)
        )
        return self.tasks[run["id"]]

    def after_turn(self, scope, run):
        with self.store.connect() as db:
            saved = db.execute(
                "SELECT status FROM agent_runs WHERE id=?", (run["id"],)
            ).fetchone()
        if saved and saved["status"] == "completed":
            self.advance(scope, run["agent_id"], run["task_id"])
        else:
            self.pause_queue(scope, run["agent_id"], run["task_id"])

    def advance(self, scope, agent, task):
        with self.store.connect() as db:
            head = self.store.queue_head(db, *scope, agent, task)
        if not head or head["status"] != "queued":
            return
        run_id = head["id"]
        settings = self.queued_settings.pop(run_id, None)
        if settings:
            try:
                run = self.store.promote(
                    scope,
                    agent,
                    task,
                    run_id,
                    settings,
                    self.harnesses,
                    "queued",
                )
                self.schedule(*scope, run, settings)
                return
            except (Conflict, NotFound):
                pass
        with self.store.connect() as db:
            self.store.require_confirmation(db, run_id)

    def confirm(self, scope, agent, task, run_id, settings):
        run = self.store.promote(
            scope,
            agent,
            task,
            run_id,
            settings,
            self.harnesses,
            "confirmation",
        )
        self.schedule(*scope, run, settings)
        return run

    def pause_queue(self, scope, agent, task):
        with self.store.connect() as db:
            for row in db.execute(
                "SELECT id FROM agent_runs WHERE owner=? AND project=? AND agent_id=? AND task_id=? AND status='queued'",
                (*scope, agent, task),
            ).fetchall():
                self.queued_settings.pop(row["id"], None)
                self.store.require_confirmation(db, row["id"])

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
            # User-initiated stops already wrote "cancelled" before task.cancel().
            # Event loop shutdown can cancel us before the next startup sweep.
            self.store.finish(
                run["id"], "interrupted", error="runtime_restarted"
            )
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
        with self.store.connect() as db:
            cancelled = db.execute(
                "UPDATE agent_runs SET status='interrupted',error='cancelled',finished_at=? WHERE id=? AND status IN ('queued','confirmation')",
                (now(), run_id),
            ).rowcount
        if cancelled:
            self.queued_settings.pop(run_id, None)
            self.advance((owner, project), agent_id, task_id)
            return
        task = self.tasks.get(run_id)
        if task:
            self.pause_queue((owner, project), agent_id, task_id)
            self.store.finish(run_id, "interrupted", error="cancelled")
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            # Cancellation may happen before execute() enters its try block.
            self.tasks.pop(run_id, None)
            self.store.finish(run_id, "interrupted", error="cancelled")

    async def delete_session(self, owner, project):
        self.store.close_session(owner, project)
        with self.store.connect() as db:
            for row in db.execute(
                "SELECT id FROM agent_runs WHERE owner=? AND project=? AND status='queued'",
                (owner, project),
            ):
                self.queued_settings.pop(row["id"], None)
        for run in self.store.running_in_session(owner, project):
            await self.cancel(
                owner, project, run["agent_id"], run["id"], run["task_id"]
            )
        self.store.delete_session(owner, project)
