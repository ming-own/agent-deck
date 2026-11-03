import tempfile
import unittest
from pathlib import Path


class SessionAgentPersistenceTest(unittest.TestCase):
    def test_model_builder_works_without_a_session_task_lock(self):
        import importlib
        from unittest.mock import MagicMock, patch

        module = importlib.import_module("app.agent.agent_model")
        from app.model.chat import Chat

        options = Chat(
            task_id="turn",
            project_id="node",
            question="Hello",
            email="fixture@example.com",
            model_platform="openai",
            model_type="gpt-4o-mini",
            api_key="fixture",
        )
        with (
            patch.object(module, "ModelFactory") as factory,
            patch.object(
                module,
                "instrument_model_backend",
                side_effect=lambda model, **kw: model,
            ),
        ):
            factory.create.return_value = MagicMock()
            build = module.create_model_builder(
                "node", "node-id", "Assistant", options
            )
            build()
            self.assertEqual(
                factory.create.call_args.kwargs["model_type"], "gpt-4o-mini"
            )

    def test_instance_model_survives_reload(self):
        from app.session_agents.models import AgentConfig, ModelReference
        from app.session_agents.store import AgentStore

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nodes.db"
            config = AgentConfig(
                name="Writer",
                model=ModelReference(
                    id="provider:1",
                    name="Model A",
                    model_platform="openai",
                    model_type="model-a",
                ),
            )
            node = AgentStore(path).create("account", "session", config)
            self.assertEqual(
                AgentStore(path).get("account", "session", node["id"])[
                    "model"
                ]["id"],
                "provider:1",
            )
