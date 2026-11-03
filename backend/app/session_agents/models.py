from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    model: ModelReference
    role: str = Field(default="", max_length=200)
    instructions: str = Field(default="", max_length=12000)


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


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=1)
    prompt: str = Field(min_length=1, max_length=32000)
    email: str = Field(min_length=1, max_length=320)
    connection: ModelConnection = Field(repr=False)
