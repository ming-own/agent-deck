"""First node executor: isolated text conversation using shared model adapters."""

import asyncio
import inspect
from uuid import uuid4

from camel.agents import ChatAgent
from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.messages import BaseMessage
from camel.types import OpenAIBackendRole

from app.agent.agent_model import create_model_builder
from app.model.chat import Chat
from app.session_agents.tools import build_node_tools


async def close_model(model):
    # Provider SDKs own connection pools. Each node turn owns its fresh model.
    seen = set()
    for name in ("_async_client", "_client"):
        client = getattr(model, name, None)
        if client is None or id(client) in seen:
            continue
        seen.add(id(client))
        close = getattr(client, "close", None)
        if callable(close):
            try:
                result = close()
                if inspect.isawaitable(result):
                    await result
            except Exception:
                pass


# These request options can advertise or force provider-hosted tools outside
# the node's grant list. Preserve unrelated provider settings and JSON schemas.
_TOOL_OPTIONS = frozenset(
    {
        "tools",
        "tool_choice",
        "functions",
        "function_call",
        "web_search_options",
        "plugins",
        "mcp_servers",
        "tool_resources",
        "tool_config",
        "toolConfig",
        "parallel_tool_calls",
    }
)


def _node_model_settings(settings):
    if not isinstance(settings, dict):
        return settings
    return {
        key: _node_model_settings(value)
        if key in {"extra_body", "model_config_dict"}
        else value
        for key, value in settings.items()
        if key not in _TOOL_OPTIONS
    }


async def run_text_agent(
    node, history, prompt, connection, email, *, stage_instruction=""
):
    # Keep history bounded explicitly instead of silently dropping earlier turns.
    if (
        sum(len(question) + len(answer) for question, answer in history)
        + len(prompt)
        > 200000
    ):
        raise ValueError("history_limit")
    settings = connection.model_dump()
    for key in ("extra_params", "model_config_dict"):
        settings[key] = _node_model_settings(settings.get(key))
    options = Chat(
        task_id=str(uuid4()),
        project_id=node["id"],
        question=prompt,
        email=email,
        session_mode="single-agent",
        **settings,
    )
    tools = build_node_tools(node)
    system = "You are a helpful assistant."
    if tools:
        system += " Use the provided tools when needed. Only report tool results that were returned."
        if node.get("skill_ids"):
            system += "\nSelected skill package IDs: " + ", ".join(
                node["skill_ids"]
            )
    else:
        system += " This Agent supports text conversation only. No tools are available."
    if node.get("role"):
        system += f"\n\nYour role:\n{node['role']}"
    if node.get("instructions"):
        system += f"\n\nInstructions:\n{node['instructions']}"
    if node.get("skill_material"):
        system += "\n\nSelected skill instructions:\n" + node["skill_material"]
    if stage_instruction:
        system += "\n\n" + stage_instruction
    build = create_model_builder(
        node["name"], node["id"], system, options, tools=tools
    )
    # Token resolution may do bounded synchronous local I/O. Join construction
    # on cancellation so a late SDK client is never leaked.
    building = asyncio.create_task(asyncio.to_thread(build))
    try:
        model = await asyncio.shield(building)
    except asyncio.CancelledError:
        try:
            model = await building
            await close_model(model)
        finally:
            raise
    try:
        agent = ChatAgent(
            system_message=system,
            model=model,
            tools=tools,
            max_iteration=6 if tools else 1,
            stream_accumulate=False,
        )
        for question, answer in history:
            agent.update_memory(
                BaseMessage.make_user_message(
                    role_name="User", content=question
                ),
                OpenAIBackendRole.USER,
            )
            agent.update_memory(
                BaseMessage.make_assistant_message(
                    role_name="Assistant", content=answer
                ),
                OpenAIBackendRole.ASSISTANT,
            )
        response = await agent.astep(prompt)
        if isinstance(response, AsyncStreamingChatAgentResponse):
            parts = []
            async for chunk in response:
                if chunk.terminated:
                    raise RuntimeError("incomplete_response")
                if chunk.msg and chunk.msg.content:
                    parts.append(chunk.msg.content)
            return "".join(parts)
        if response.terminated:
            raise RuntimeError("incomplete_response")
        return "\n".join(
            message.content for message in response.msgs if message.content
        )
    finally:
        await close_model(model)
