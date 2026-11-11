//! Framework-independent canvas editing. Business history belongs to the runtime.

mod graph;
mod history;
mod layout;
mod viewport;

pub use graph::{Connection, Graph, Node, NodeKind, Port};
pub use history::{Edit, Editor};
pub use layout::Layout;
pub use viewport::{Point, Viewport};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphError {
    InvalidGeometry,
    InvalidIdentity,
    MissingNode,
    DuplicateNode,
    MissingConnection,
    DuplicateConnection,
    WrongPort,
    SessionBoundary,
    SelfConnection,
    Cycle,
    InvalidLayout,
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidGeometry => "Position or zoom is invalid",
            Self::InvalidIdentity => "Node or connection identity is invalid",
            Self::MissingNode => "The node does not exist",
            Self::DuplicateNode => "The node already exists",
            Self::MissingConnection => "The connection does not exist",
            Self::DuplicateConnection => "The connection already exists",
            Self::WrongPort => "These ports are not compatible",
            Self::SessionBoundary => "Use an explicit handoff to cross Session boundaries",
            Self::SelfConnection => "A node cannot connect to itself",
            Self::Cycle => "A feedback loop requires an explicit bounded routing node",
            Self::InvalidLayout => "The layout is invalid or uses an unsupported version",
        })
    }
}

impl std::error::Error for GraphError {}
