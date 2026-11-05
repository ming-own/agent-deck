from typing import Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from .harnesses import DEFAULT_HARNESS_ID, HARNESSES


class ModelReference(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(
        pattern=r"^(provider:[0-9]+|codex:[A-Za-z0-9._:-]+)$", max_length=200
    )
    name: str = Field(min_length=1, max_length=200)
    model_platform: str = Field(min_length=1, max_length=100)
    model_type: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def codex_identity(self):
        if self.id.startswith("codex:") and (
            self.model_platform != "openai"
            or self.id != f"codex:{self.model_type}"
        ):
            raise ValueError("Invalid Codex model reference")
        return self


ToolId = Literal["calculate", "utc_time", "read_skill_reference"]
ToolMode = Literal["turn", "allow"]


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    model: ModelReference
    role: str = Field(default="", max_length=200)
    instructions: str = Field(default="", max_length=12000)
    tool_policy: dict[ToolId, ToolMode] = Field(default_factory=dict)
    skill_ids: list[str] = Field(default_factory=list, max_length=32)
    harness_id: str = DEFAULT_HARNESS_ID

    @field_validator("harness_id")
    @classmethod
    def registered_harness(cls, value: str) -> str:
        if value not in HARNESSES:
            raise ValueError("Unknown Harness")
        return value

    @field_validator("skill_ids")
    @classmethod
    def package_ids(cls, ids: list[str]) -> list[str]:
        if len(set(ids)) != len(ids) or any(
            not value
            or len(value) > 255
            or value.startswith(".")
            or any(c in value for c in ("/", "\\", "\x00"))
            for value in ids
        ):
            raise ValueError("Expected unique skill package names")
        return ids


class PositionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=24, le=1000000)
    y: float = Field(ge=64, le=1000000)
    expected_revision: int = Field(ge=0)


class UpdateAgent(AgentConfig):
    expected_revision: int = Field(ge=1)


class ModelConnection(BaseModel):
    """Ephemeral inference settings. Never written to the instance database."""

    model_config = ConfigDict(extra="forbid")
    model_platform: str
    model_type: str
    api_key: str = Field(default="", repr=False)
    api_url: str | None = None
    auth_source: Literal["codex_subscription"] | None = None
    model_config_dict: dict[str, Any] | None = Field(default=None, repr=False)
    extra_params: dict[str, Any] | None = Field(default=None, repr=False)


class CreateTask(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: UUID
    name: str = Field(min_length=1, max_length=100)


class RunSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    approved_tools: list[ToolId] = Field(default_factory=list, max_length=3)
    expected_revision: int = Field(ge=1)
    email: str = Field(min_length=1, max_length=320)
    connection: ModelConnection = Field(repr=False)


class RunRequest(RunSettings):
    task_id: str = Field(default="default", min_length=1, max_length=100)
    request_id: str = Field(min_length=1, max_length=100)
    source_run_id: UUID | None = None
    prompt: str = Field(max_length=32000)

    @model_validator(mode="after")
    def require_input(self):
        if not self.prompt and self.source_run_id is None:
            raise ValueError("Message or source answer required")
        return self


class RouteRequest(RunSettings):
    event_id: UUID
    target_agent_id: UUID
    origin_agent_id: UUID | None = None
    origin_task_id: str | None = Field(
        default=None, min_length=1, max_length=100
    )
    task_id: str | None = Field(default=None, min_length=1, max_length=100)
    new_task_name: str | None = Field(
        default=None, min_length=1, max_length=100
    )
    reply_to: UUID | None = None
    message: str = Field(min_length=1, max_length=32000)

    @model_validator(mode="after")
    def validate_addresses(self):
        if (self.origin_agent_id is None) != (self.origin_task_id is None):
            raise ValueError("Origin requires both Agent and task")
        if (
            sum(
                v is not None
                for v in (self.task_id, self.new_task_name, self.reply_to)
            )
            != 1
        ):
            raise ValueError(
                "Choose a new task, existing task, or prior message"
            )
        return self
