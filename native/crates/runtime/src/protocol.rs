use serde::{Deserialize, Serialize};

pub const VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u16,
    pub client_id: String,
    pub request_id: String,
    pub expected_server: Option<String>,
    pub expected_revision: Option<u64>,
    pub command: Command,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Poll {
        after_sequence: u64,
    },
    Start {
        run_id: String,
        session_id: String,
        node_ids: Vec<String>,
    },
    Stop {
        run_id: String,
    },
    Shutdown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Version,
    ServerChanged,
    InvalidRequest,
    StaleRevision,
    DuplicateRequest,
    Capacity,
    MissingRun,
    Busy,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Queued,
    Running,
    Succeeded,
    Cancelled,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeExecution {
    pub node_id: String,
    pub state: NodeState,
    pub result: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub run_id: String,
    pub session_id: String,
    pub nodes: Vec<NodeExecution>,
}
impl Run {
    pub fn status(&self) -> NodeState {
        if self.nodes.iter().any(|n| n.state == NodeState::Running) {
            NodeState::Running
        } else if self.nodes.iter().any(|n| n.state == NodeState::Queued) {
            NodeState::Queued
        } else if self.nodes.iter().any(|n| n.state == NodeState::Cancelled) {
            NodeState::Cancelled
        } else {
            NodeState::Succeeded
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub sequence: u64,
    pub run_id: String,
    pub node_id: String,
    pub state: NodeState,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub server_id: String,
    pub revision: u64,
    pub sequence: u64,
    pub runs: Vec<Run>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub version: u16,
    pub request_id: String,
    pub error: Option<ErrorCode>,
    pub snapshot: Snapshot,
    pub events: Vec<Event>,
    pub resync: bool,
}
