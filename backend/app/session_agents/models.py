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

import base64
import binascii
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


class CardDesign(BaseModel):
    """Presentation only. Never accepted as executable Agent configuration."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(default="", max_length=100)
    summary: str = Field(default="", max_length=400)
    artwork: Literal[
        "dragon", "owl", "crab", "oasis", "document", "custom"
    ] = "dragon"
    image_data: str | None = Field(default=None, max_length=1_400_000)
    layout: Literal["full", "classic"] = "full"
    material: Literal["gold", "silver", "ink"] = "gold"

    @field_validator("image_data")
    @classmethod
    def raster_only(cls, value):
        if value is None:
            return None
        try:
            header, encoded = value.split(",", 1)
            data = base64.b64decode(encoded, validate=True)
            valid = (
                header == "data:image/png;base64"
                and data.startswith(b"\x89PNG\r\n\x1a\n")
                or header == "data:image/jpeg;base64"
                and data.startswith(b"\xff\xd8\xff")
                or header == "data:image/webp;base64"
                and data[:4] == b"RIFF"
                and data[8:12] == b"WEBP"
            )
            if not valid:
                raise ValueError("Expected PNG, JPEG or WebP artwork")
        except (ValueError, binascii.Error) as exc:
            raise ValueError("Expected bounded raster image data") from exc
        return value


class UpdateCardDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    design: CardDesign


class DraftAgentConfig(AgentConfig):
    model: ModelReference | None = None


class UpdateAgent(AgentConfig):
    expected_revision: int = Field(ge=1)


class ModelConnection(BaseModel):
    """Ephemeral inference settings. Never written to the instance database."""

    model_config = ConfigDict(extra="forbid")
    members: dict[UUID, "RunSettings"] = Field(
        default_factory=dict, max_length=32, repr=False
    )
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


class CanvasTrialRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: UUID
    prompt: str = Field(min_length=1, max_length=32000)
    path: list[UUID] = Field(min_length=1, max_length=32)
    settings: dict[UUID, RunSettings] = Field(max_length=32)


class RunRequest(RunSettings):
    queue_if_busy: bool = False
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


class BranchTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    agent_id: UUID
    name: str = Field(min_length=1, max_length=100)
    instructions: str = Field(default="", max_length=4000)


class BranchRule(BranchTarget):
    # An empty keyword is unconditional; matching is literal and case-insensitive.
    contains: str = Field(default="", max_length=200)


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    event_id: UUID
    message: str = Field(min_length=1, max_length=16000)
    branches: list[BranchRule] = Field(min_length=1, max_length=8)
    summary: BranchTarget
    join: Literal["all_success", "all_finished"] = "all_success"
    settings: dict[UUID, RunSettings] = Field(max_length=9)

    branch_tools: list[list[ToolId]] | None = Field(default=None, max_length=8)

    @model_validator(mode="after")
    def check_branch_tools(self):
        if self.branch_tools is not None and len(self.branch_tools) != len(
            self.branches
        ):
            raise ValueError("Expected approvals for each branch")
        return self

    def spec(self):
        return self.model_dump(
            mode="json", exclude={"settings", "event_id", "branch_tools"}
        )


class RecoverBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_generation: int = Field(ge=0)
    request_id: UUID
    # Keys are the failed attempt IDs the user saw, never an Agent-wide grant.
    branches: dict[UUID, RunSettings] = Field(
        default_factory=dict, max_length=8
    )
    summary: RunSettings
    summary_attempt: UUID | None = None


class WorkshopRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branches: list[BranchRule] = Field(min_length=1, max_length=8)
    summary: BranchTarget
    join: Literal["all_success", "all_finished"] = "all_success"


class UpdateWorkforce(WorkshopRoute):
    name: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=1)


class SaveTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    request_id: UUID | None = None
    node_id: UUID | None = None
    route: WorkshopRoute | None = None
    new_version: bool = False
    config: DraftAgentConfig | None = None
    appearance: CardDesign | None = None
    base_family: str | None = Field(default=None, min_length=1, max_length=100)
    base_version: int | None = Field(default=None, ge=1)
    copy_base: bool = False

    @model_validator(mode="after")
    def one_source(self):
        if (
            sum(v is not None for v in (self.route, self.node_id, self.config))
            + int(self.copy_base)
            != 1
        ):
            raise ValueError("Choose one source")
        if (self.base_family is None) != (self.base_version is None):
            raise ValueError("Provide a complete base version")
        if self.copy_base and self.base_family is None:
            raise ValueError("Choose a template to copy")
        return self


class InstallTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instance_id: UUID
    family: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1)
    model: ModelReference | None = None


ModelConnection.model_rebuild()
