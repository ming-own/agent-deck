//! Framework-independent workspaces, tasks, frozen run inputs, and private storage.
//! Credentials and execution state machines belong to the runtime, never this catalog.

mod compile;
mod space;
pub mod storage;

pub use canvas_core::{Layout, NodeKind};
pub use compile::{RunPlan, RunStep, compile_agent, compile_run, snapshot_transfer};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CATALOG_VERSION: u32 = 1;
pub type Result<T> = std::result::Result<T, ProductError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProductError(pub String);
impl std::fmt::Display for ProductError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ProductError {}
impl From<canvas_core::GraphError> for ProductError {
    fn from(error: canvas_core::GraphError) -> Self {
        Self(error.to_string())
    }
}
impl From<std::io::Error> for ProductError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}
impl From<serde_json::Error> for ProductError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}
pub(crate) fn fail<T>(message: impl Into<String>) -> Result<T> {
    Err(ProductError(message.into()))
}
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub(crate) fn identity(id: &str) -> Result<()> {
    if id.trim().is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
        return fail(
            "Invalid identity: IDs must be nonempty, at most 256 bytes, without control characters",
        );
    }
    Ok(())
}
pub(crate) fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for id in ids {
        identity(id)?;
        if !seen.insert(id) {
            return fail(format!("Duplicate identity: {id}"));
        }
    }
    Ok(())
}

/// A storage boundary must validate both schema version and semantic ownership.
/// Runtime aggregates may implement this trait and use the same atomic store.
pub trait ValidatedDocument: Serialize + serde::de::DeserializeOwned {
    fn validate(&self) -> Result<()>;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub version: u32,
    pub spaces: Vec<Space>,
    pub active_space_id: String,
}
impl Default for Catalog {
    fn default() -> Self {
        Self::new()
    }
}
impl Catalog {
    pub fn new() -> Self {
        Self {
            version: CATALOG_VERSION,
            spaces: vec![],
            active_space_id: String::new(),
        }
    }
    pub fn add_space(&mut self, name: impl Into<String>) -> String {
        let space = Space::new(name);
        let id = space.id.clone();
        self.spaces.push(space);
        self.active_space_id = id.clone();
        id
    }
    pub fn validate(&self) -> Result<()> {
        if self.version != CATALOG_VERSION {
            return fail("Unsupported catalog schema version");
        }
        unique(self.spaces.iter().map(|s| s.id.as_str()))?;
        if self.spaces.is_empty() {
            if !self.active_space_id.is_empty() {
                return fail("Active workspace does not exist");
            }
        } else if !self.spaces.iter().any(|s| s.id == self.active_space_id) {
            return fail("Active workspace does not exist");
        }
        for space in &self.spaces {
            space.validate()?;
        }
        Ok(())
    }
}
impl ValidatedDocument for Catalog {
    fn validate(&self) -> Result<()> {
        self.validate()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Space {
    pub id: String,
    pub name: String,
    #[serde(with = "layout_serde")]
    pub layout: Layout,
    pub sessions: Vec<Session>,
    pub agents: BTreeMap<String, AgentConfig>,
    pub resources: BTreeMap<String, Resource>,
    pub appearances: BTreeMap<String, CardDesign>,
    pub templates: Vec<CardTemplate>,
    pub providers: Vec<Provider>,
    pub automations: Vec<Automation>,
}
mod layout_serde {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        layout: &Layout,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        layout.serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Layout, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        Layout::from_json(&value.to_string()).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentConfig {
    pub provider_id: Option<String>,
    pub model: String,
    pub role: String,
    pub instructions: String,
    pub harness: Harness,
    pub skill_ids: Vec<String>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    #[default]
    Standard,
    PlanThenExecute,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub kind: ProviderKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenAiCompatible,
    Codex,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub id: String,
    pub title: String,
    pub content: String,
    pub kind: ResourceKind,
    pub revision: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Context,
    Memory,
    Skill,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardDesign {
    pub artwork: CardArtwork,
    pub material: CardMaterial,
    pub subtitle: String,
}
/// Original artwork bundled with the native client; values are stable asset keys.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardArtwork {
    #[default]
    Guardian,
    Archive,
    Dragon,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardMaterial {
    #[default]
    Gold,
    Jade,
    Violet,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardTemplate {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    pub design: CardDesign,
    pub agent: Option<AgentConfig>,
    pub resource: Option<Resource>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Automation {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub interval_minutes: u32,
    pub enabled: bool,
    pub prompt: String,
    pub next_due_at_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub space_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub name: String,
    pub turns: Vec<Turn>,
}
impl Task {
    /// Creates an empty, independent task; no implicit model call or fabricated answer.
    pub fn new(space: &Space, agent_id: &str, name: impl Into<String>) -> Result<Self> {
        space.validate()?;
        let node = space
            .layout
            .graph
            .node(agent_id)
            .ok_or_else(|| ProductError("Task agent does not exist".into()))?;
        if node.kind != NodeKind::Agent {
            return fail("Task owner must be an Agent");
        }
        Ok(Self {
            id: new_id(),
            space_id: space.id.clone(),
            session_id: node
                .session
                .clone()
                .ok_or_else(|| ProductError("Task agent has no Session".into()))?,
            agent_id: agent_id.into(),
            name: name.into(),
            turns: vec![],
        })
    }
    /// Historical tasks validate without requiring their graph node to remain present.
    pub fn validate(&self) -> Result<()> {
        for id in [&self.id, &self.space_id, &self.session_id, &self.agent_id] {
            identity(id)?;
        }
        unique(self.turns.iter().map(|t| t.id.as_str()))?;
        for turn in &self.turns {
            turn.validate()?;
            if turn.references.iter().any(|r| {
                r.destination_task_id
                    .as_ref()
                    .is_some_and(|id| id != &self.id)
            }) {
                return fail("Transferred answer belongs to a different destination Task");
            }
        }
        Ok(())
    }
    /// Runtime uses this for a new run, never to discard history after graph edits.
    pub fn validate_owner(&self, space: &Space) -> Result<()> {
        self.validate()?;
        space.validate()?;
        let node = space.layout.graph.node(&self.agent_id).ok_or_else(|| {
            ProductError("Task Agent was removed; choose an existing Agent".into())
        })?;
        if self.space_id != space.id
            || node.kind != NodeKind::Agent
            || node.session.as_deref() != Some(&self.session_id)
        {
            return fail("Task workspace/Session/Agent ownership does not match");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Turn {
    pub id: String,
    pub run_id: String,
    pub prompt: String,
    pub answer: Option<String>,
    pub plan: Option<String>,
    pub status: TurnStatus,
    pub error: Option<String>,
    pub references: Vec<ReferenceSnapshot>,
}
impl Turn {
    pub fn queued(run_id: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            id: new_id(),
            run_id: run_id.into(),
            prompt: prompt.into(),
            answer: None,
            plan: None,
            status: TurnStatus::Queued,
            error: None,
            references: vec![],
        }
    }
    pub fn validate(&self) -> Result<()> {
        identity(&self.id)?;
        identity(&self.run_id)?;
        if self.status == TurnStatus::Succeeded && self.answer.is_none() {
            return fail("Successful turn requires an answer");
        }
        for reference in &self.references {
            reference.validate()?;
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

/// Owned content, not a pointer into editable resources or historical answers.
/// Resource references use resource_id/revision; transfers use all origin IDs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReferenceSnapshot {
    pub space_id: String,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub task_id: Option<String>,
    pub turn_id: Option<String>,
    pub run_id: Option<String>,
    pub resource_id: Option<String>,
    pub resource_kind: Option<ResourceKind>,
    pub destination_task_id: Option<String>,
    pub title: String,
    pub revision: Option<u64>,
    pub content: String,
}
impl ReferenceSnapshot {
    pub fn validate(&self) -> Result<()> {
        identity(&self.space_id)?;
        for id in [
            &self.session_id,
            &self.agent_id,
            &self.task_id,
            &self.turn_id,
            &self.run_id,
            &self.resource_id,
            &self.destination_task_id,
        ]
        .into_iter()
        .flatten()
        {
            identity(id)?;
        }
        if self.resource_id.is_some() {
            if self.resource_kind.is_none()
                || self.revision.is_none_or(|r| r == 0)
                || self.task_id.is_some()
                || self.turn_id.is_some()
                || self.run_id.is_some()
                || self.agent_id.is_some()
                || self.destination_task_id.is_some()
            {
                return fail("Invalid resource snapshot origin");
            }
        } else if self.session_id.is_none()
            || self.agent_id.is_none()
            || self.task_id.is_none()
            || self.turn_id.is_none()
            || self.run_id.is_none()
            || self.destination_task_id.is_none()
            || self.resource_kind.is_some()
            || self.revision.is_some()
        {
            return fail("Transfer snapshot requires complete origin and destination identities");
        }
        Ok(())
    }
}
