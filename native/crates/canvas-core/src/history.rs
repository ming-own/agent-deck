use crate::{Connection, Graph, GraphError, Node, Point};
use std::collections::VecDeque;

pub enum Edit {
    AddNode(Node),
    UpdateNode {
        id: String,
        title: String,
        description: String,
    },
    MoveNodes(Vec<(String, Point)>),
    Connect(Connection),
    Reconnect {
        id: String,
        replacement: Connection,
    },
    RemoveConnection(String),
    RemoveNode(String),
}

pub struct Editor {
    graph: Graph,
    undo: VecDeque<Graph>,
    redo: Vec<Graph>,
}

impl Editor {
    pub fn new(graph: Graph) -> Self {
        Self {
            graph,
            undo: VecDeque::new(),
            redo: Vec::new(),
        }
    }
    pub fn graph(&self) -> &Graph {
        &self.graph
    }

    pub fn apply(&mut self, edit: Edit) -> Result<(), GraphError> {
        let mut candidate = self.graph.clone();
        match edit {
            Edit::AddNode(node) => candidate.add_node(node)?,
            Edit::UpdateNode {
                id,
                title,
                description,
            } => {
                let node = candidate
                    .nodes
                    .get_mut(&id)
                    .ok_or(GraphError::MissingNode)?;
                node.title = title;
                node.description = description;
            }
            Edit::Connect(edge) => candidate.connect(edge)?,
            Edit::Reconnect { id, replacement } => candidate.reconnect(&id, replacement)?,
            Edit::RemoveConnection(id) => {
                let index = candidate
                    .connections
                    .iter()
                    .position(|edge| edge.id == id)
                    .ok_or(GraphError::MissingConnection)?;
                candidate.connections.remove(index);
            }
            Edit::MoveNodes(positions) => {
                for (id, position) in positions {
                    if !position.is_valid() {
                        return Err(GraphError::InvalidGeometry);
                    }
                    candidate
                        .nodes
                        .get_mut(&id)
                        .ok_or(GraphError::MissingNode)?
                        .position = position;
                }
            }
            Edit::RemoveNode(id) => {
                candidate.nodes.remove(&id).ok_or(GraphError::MissingNode)?;
                candidate
                    .connections
                    .retain(|edge| edge.source != id && edge.target != id);
            }
        }
        if candidate != self.graph {
            self.undo
                .push_back(std::mem::replace(&mut self.graph, candidate));
            if self.undo.len() > 64 {
                self.undo.pop_front();
            }
            self.redo.clear();
        }
        Ok(())
    }

    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo.pop_back() else {
            return false;
        };
        self.redo.push(std::mem::replace(&mut self.graph, previous));
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        self.undo
            .push_back(std::mem::replace(&mut self.graph, next));
        true
    }
}
