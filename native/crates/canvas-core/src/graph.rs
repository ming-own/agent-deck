use crate::{GraphError, Point};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Agent,
    Context,
    Memory,
    Automation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Port {
    Message,
    Result,
    Context,
    Memory,
    Trigger,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub title: String,
    pub kind: NodeKind,
    pub session: Option<String>,
    pub position: Point,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connection {
    pub id: String,
    pub source: String,
    pub source_port: Port,
    pub target: String,
    pub target_port: Port,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Graph {
    pub(crate) nodes: BTreeMap<String, Node>,
    pub(crate) connections: Vec<Connection>,
}

fn valid_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

impl Graph {
    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id)
    }
    pub fn nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values()
    }
    pub fn connections(&self) -> &[Connection] {
        &self.connections
    }

    pub fn add_node(&mut self, node: Node) -> Result<(), GraphError> {
        if !valid_id(&node.id)
            || node.session.as_ref().is_some_and(|s| !valid_id(s))
            || (node.kind == NodeKind::Agent && node.session.is_none())
        {
            return Err(GraphError::InvalidIdentity);
        }
        if !node.position.is_finite() {
            return Err(GraphError::InvalidGeometry);
        }
        if self.nodes.contains_key(&node.id) {
            return Err(GraphError::DuplicateNode);
        }
        self.nodes.insert(node.id.clone(), node);
        Ok(())
    }

    pub fn connect(&mut self, edge: Connection) -> Result<(), GraphError> {
        self.validate_connection(&edge)?;
        self.connections.push(edge);
        Ok(())
    }

    pub fn reconnect(&mut self, id: &str, replacement: Connection) -> Result<(), GraphError> {
        let index = self
            .connections
            .iter()
            .position(|edge| edge.id == id)
            .ok_or(GraphError::MissingConnection)?;
        if replacement.id != id {
            return Err(GraphError::InvalidIdentity);
        }
        // Validate a candidate transaction before changing the live graph.
        let mut candidate = self.clone();
        candidate.connections.remove(index);
        candidate.validate_connection(&replacement)?;
        self.connections[index] = replacement;
        Ok(())
    }

    fn validate_connection(&self, edge: &Connection) -> Result<(), GraphError> {
        if !valid_id(&edge.id) {
            return Err(GraphError::InvalidIdentity);
        }
        let source = self.node(&edge.source).ok_or(GraphError::MissingNode)?;
        let target = self.node(&edge.target).ok_or(GraphError::MissingNode)?;
        if source.id == target.id {
            return Err(GraphError::SelfConnection);
        }
        if self.connections.iter().any(|old| {
            old.id == edge.id
                || (old.source == edge.source
                    && old.source_port == edge.source_port
                    && old.target == edge.target
                    && old.target_port == edge.target_port)
        }) {
            return Err(GraphError::DuplicateConnection);
        }
        let ports = match source.kind {
            NodeKind::Agent => (Port::Result, Port::Message),
            NodeKind::Context => (Port::Context, Port::Context),
            NodeKind::Memory => (Port::Memory, Port::Memory),
            NodeKind::Automation => (Port::Trigger, Port::Trigger),
        };
        if target.kind != NodeKind::Agent || (edge.source_port, edge.target_port) != ports {
            return Err(GraphError::WrongPort);
        }
        // This is structural scope validation, not a grant of runtime permission.
        if source.session.is_some() && source.session != target.session {
            return Err(GraphError::SessionBoundary);
        }
        if source.kind == NodeKind::Agent && self.reaches(&target.id, &source.id) {
            return Err(GraphError::Cycle);
        }
        Ok(())
    }

    fn reaches(&self, start: &str, target: &str) -> bool {
        let mut pending = vec![start];
        let mut visited = BTreeSet::new();
        while let Some(node) = pending.pop() {
            if node == target {
                return true;
            }
            if visited.insert(node) {
                pending.extend(
                    self.connections
                        .iter()
                        .filter(|edge| edge.source == node && edge.source_port == Port::Result)
                        .map(|edge| edge.target.as_str()),
                );
            }
        }
        false
    }
}

impl<'de> Deserialize<'de> for Graph {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StoredGraph {
            nodes: BTreeMap<String, Node>,
            connections: Vec<Connection>,
        }
        let stored = StoredGraph::deserialize(deserializer)?;
        let mut graph = Self::default();
        for (key, node) in stored.nodes {
            if key != node.id {
                return Err(serde::de::Error::custom(GraphError::InvalidIdentity));
            }
            graph.add_node(node).map_err(serde::de::Error::custom)?;
        }
        for edge in stored.connections {
            graph.connect(edge).map_err(serde::de::Error::custom)?;
        }
        Ok(graph)
    }
}
