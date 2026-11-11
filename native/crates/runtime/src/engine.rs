use crate::protocol::*;
use std::collections::{BTreeSet, VecDeque};

const MAX_RUNS: usize = 8;
const MAX_NODES: usize = 64;
const MAX_EVENTS: usize = 256;
const MAX_RECEIPTS: usize = 128;

/// Deterministic demonstration executor. No models, tools, credentials or old
/// databases are used. The service owns this state; clients only receive copies.
pub struct Engine {
    snapshot: Snapshot,
    events: VecDeque<Event>,
    receipts: VecDeque<Request>,
    shutdown: bool,
}
fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 64 && !value.chars().any(char::is_control)
}
impl Engine {
    pub fn new(server_id: String) -> Self {
        Self {
            snapshot: Snapshot {
                server_id,
                revision: 0,
                sequence: 0,
                runs: Vec::new(),
            },
            events: VecDeque::new(),
            receipts: VecDeque::new(),
            shutdown: false,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }
    pub fn shutting_down(&self) -> bool {
        self.shutdown
    }
    pub fn is_running(&self) -> bool {
        self.snapshot
            .runs
            .iter()
            .any(|r| r.status() == NodeState::Running)
    }
    pub fn handle(&mut self, request: Request) -> Reply {
        let after = match &request.command {
            Command::Poll { after_sequence } => *after_sequence,
            _ => self.snapshot.sequence,
        };
        let result = self.apply(&request);
        let resync = after > self.snapshot.sequence
            || self
                .events
                .front()
                .is_some_and(|e| after < e.sequence.saturating_sub(1));
        Reply {
            version: VERSION,
            request_id: request.request_id,
            error: result.err(),
            snapshot: self.snapshot(),
            events: self
                .events
                .iter()
                .filter(|e| e.sequence > after)
                .cloned()
                .collect(),
            resync,
        }
    }
    fn apply(&mut self, request: &Request) -> Result<(), ErrorCode> {
        if request.version != VERSION {
            return Err(ErrorCode::Version);
        }
        if !valid_id(&request.client_id) || !valid_id(&request.request_id) {
            return Err(ErrorCode::InvalidRequest);
        }
        if matches!(request.command, Command::Poll { .. }) {
            return Ok(());
        }
        if request.expected_server.as_deref() != Some(&self.snapshot.server_id) {
            return Err(ErrorCode::ServerChanged);
        }
        if self.shutdown {
            return Err(ErrorCode::Busy);
        }
        if let Some(previous) = self
            .receipts
            .iter()
            .find(|r| r.client_id == request.client_id && r.request_id == request.request_id)
        {
            return if previous == request {
                Ok(())
            } else {
                Err(ErrorCode::DuplicateRequest)
            };
        }
        if request.expected_revision != Some(self.snapshot.revision) {
            return Err(ErrorCode::StaleRevision);
        }
        match &request.command {
            Command::Start {
                run_id,
                session_id,
                node_ids,
            } => {
                if !valid_id(run_id)
                    || !valid_id(session_id)
                    || node_ids.is_empty()
                    || node_ids.len() > MAX_NODES
                    || node_ids.iter().any(|n| !valid_id(n))
                    || node_ids.iter().collect::<BTreeSet<_>>().len() != node_ids.len()
                {
                    return Err(ErrorCode::InvalidRequest);
                }
                if self.snapshot.runs.iter().any(|r| &r.run_id == run_id) {
                    return Err(ErrorCode::DuplicateRequest);
                }
                if self.snapshot.runs.len() >= MAX_RUNS {
                    return Err(ErrorCode::Capacity);
                }
                let nodes = node_ids
                    .iter()
                    .enumerate()
                    .map(|(i, id)| NodeExecution {
                        node_id: id.clone(),
                        state: if i == 0 {
                            NodeState::Running
                        } else {
                            NodeState::Queued
                        },
                        result: None,
                    })
                    .collect();
                self.snapshot.runs.push(Run {
                    run_id: run_id.clone(),
                    session_id: session_id.clone(),
                    nodes,
                });
                self.emit(run_id.clone(), node_ids[0].clone(), NodeState::Running);
            }
            Command::Stop { run_id } => {
                let run = self
                    .snapshot
                    .runs
                    .iter_mut()
                    .find(|r| &r.run_id == run_id)
                    .ok_or(ErrorCode::MissingRun)?;
                let mut changed = Vec::new();
                for node in &mut run.nodes {
                    if matches!(node.state, NodeState::Running | NodeState::Queued) {
                        node.state = NodeState::Cancelled;
                        changed.push(node.node_id.clone());
                    }
                }
                for id in changed {
                    self.emit(run_id.clone(), id, NodeState::Cancelled);
                }
            }
            Command::Shutdown => {
                if self.is_running() {
                    return Err(ErrorCode::Busy);
                }
                self.shutdown = true;
            }
            Command::Poll { .. } => unreachable!(),
        }
        self.snapshot.revision += 1;
        self.receipts.push_back(request.clone());
        if self.receipts.len() > MAX_RECEIPTS {
            self.receipts.pop_front();
        }
        Ok(())
    }
    fn emit(&mut self, run_id: String, node_id: String, state: NodeState) {
        self.snapshot.sequence += 1;
        self.events.push_back(Event {
            sequence: self.snapshot.sequence,
            run_id,
            node_id,
            state,
        });
        if self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }
    pub fn advance(&mut self) {
        let mut events = Vec::new();
        for run in &mut self.snapshot.runs {
            if let Some(index) = run.nodes.iter().position(|n| n.state == NodeState::Running) {
                let node = &mut run.nodes[index];
                node.state = NodeState::Succeeded;
                node.result = Some(format!("原生演示完成：{}（未调用模型）", node.node_id));
                events.push((
                    run.run_id.clone(),
                    node.node_id.clone(),
                    NodeState::Succeeded,
                ));
                if let Some(next) = run.nodes.get_mut(index + 1) {
                    next.state = NodeState::Running;
                    events.push((run.run_id.clone(), next.node_id.clone(), NodeState::Running));
                }
            }
        }
        if !events.is_empty() {
            self.snapshot.revision += 1;
        }
        for (run, node, state) in events {
            self.emit(run, node, state);
        }
    }
}
