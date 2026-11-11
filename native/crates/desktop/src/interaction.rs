use agentdeck_canvas_core::{
    Connection, Edit, Editor, Graph, GraphError, Layout, Node, NodeKind, Point, Port, Viewport,
};
use std::collections::BTreeSet;

pub const CARD_WIDTH: f32 = 208.0;
pub const AGENT_HEIGHT: f32 = 320.0;
pub const RESOURCE_HEIGHT: f32 = 144.0;

pub fn node_height(kind: NodeKind) -> f32 {
    if kind == NodeKind::Agent {
        AGENT_HEIGHT
    } else {
        RESOURCE_HEIGHT
    }
}

pub fn output_port(kind: NodeKind) -> Port {
    match kind {
        NodeKind::Agent => Port::Result,
        NodeKind::Context => Port::Context,
        NodeKind::Memory => Port::Memory,
        NodeKind::Automation => Port::Trigger,
    }
}

#[derive(Clone)]
pub struct Wire {
    pub source: String,
    pub port: Port,
    pub replacing: Option<String>,
}

struct Move {
    start: Point,
    delta: Point,
    positions: Vec<(String, Point)>,
}

pub struct CanvasState {
    pub editor: Editor,
    pub viewport: Viewport,
    pub selected: BTreeSet<String>,
    pub wire: Option<Wire>,
    moving: Option<Move>,
    wire_start: Option<Point>,
    wire_dragged: bool,
    next_id: u64,
    reserved_ids: BTreeSet<String>,
}

impl CanvasState {
    pub fn from_layout(layout: Layout) -> Self {
        let reserved_ids = layout
            .graph
            .nodes()
            .map(|n| n.id.clone())
            .chain(layout.graph.connections().iter().map(|e| e.id.clone()))
            .collect();
        Self {
            editor: Editor::new(layout.graph),
            viewport: layout.viewport,
            selected: BTreeSet::new(),
            wire: None,
            moving: None,
            wire_start: None,
            wire_dragged: false,
            next_id: 1,
            reserved_ids,
        }
    }

    pub fn demo() -> Self {
        let mut graph = Graph::default();
        for (id, title, kind, session, x, y) in [
            (
                "a",
                "资料核验员",
                NodeKind::Agent,
                Some("session-1"),
                350.0,
                100.0,
            ),
            (
                "b",
                "结果审查员",
                NodeKind::Agent,
                Some("session-1"),
                670.0,
                100.0,
            ),
            (
                "c",
                "独立会话 Agent",
                NodeKind::Agent,
                Some("session-2"),
                350.0,
                570.0,
            ),
            ("context", "项目资料", NodeKind::Context, None, 30.0, 100.0),
            ("memory", "共享记忆", NodeKind::Memory, None, 30.0, 300.0),
            ("timer", "自动化", NodeKind::Automation, None, 30.0, 500.0),
        ] {
            graph
                .add_node(Node {
                    id: id.into(),
                    title: title.into(),
                    description: String::new(),
                    kind,
                    session: session.map(str::to_owned),
                    position: Point { x, y },
                })
                .expect("valid demonstration node");
        }
        graph
            .connect(Connection {
                id: "ab".into(),
                source: "a".into(),
                source_port: Port::Result,
                target: "b".into(),
                target_port: Port::Message,
            })
            .expect("valid demonstration connection");
        Self::from_layout(Layout::new(
            graph,
            Viewport::new(Point { x: 16.0, y: 16.0 }, 0.85).unwrap(),
        ))
    }

    pub fn layout(&self) -> Layout {
        Layout::new(self.editor.graph().clone(), self.viewport)
    }

    pub fn select(&mut self, id: &str, extend: bool) {
        if !self.editor.graph().nodes().any(|n| n.id == id) {
            return;
        }
        if extend && self.selected.remove(id) {
            return;
        }
        if !extend && !self.selected.contains(id) {
            self.selected.clear();
        }
        self.selected.insert(id.to_owned());
    }

    pub fn begin_move(&mut self, world: Point) {
        self.moving = Some(Move {
            start: world,
            delta: Point::default(),
            positions: self
                .selected
                .iter()
                .filter_map(|id| {
                    self.editor
                        .graph()
                        .node(id)
                        .map(|n| (id.clone(), n.position))
                })
                .collect(),
        });
    }

    pub fn move_to(&mut self, world: Point) {
        if let Some(moving) = &mut self.moving {
            moving.delta = Point {
                x: world.x - moving.start.x,
                y: world.y - moving.start.y,
            };
        }
    }

    pub fn position(&self, id: &str) -> Option<Point> {
        if let Some(moving) = &self.moving
            && let Some((_, p)) = moving.positions.iter().find(|(key, _)| key == id)
        {
            return Some(Point {
                x: p.x + moving.delta.x,
                y: p.y + moving.delta.y,
            });
        }
        self.editor.graph().node(id).map(|n| n.position)
    }

    pub fn finish_move(&mut self) -> Result<(), GraphError> {
        if let Some(moving) = self.moving.take() {
            self.editor.apply(Edit::MoveNodes(
                moving
                    .positions
                    .into_iter()
                    .map(|(id, p)| {
                        (
                            id,
                            Point {
                                x: p.x + moving.delta.x,
                                y: p.y + moving.delta.y,
                            },
                        )
                    })
                    .collect(),
            ))?;
        }
        Ok(())
    }

    pub fn cancel(&mut self) {
        self.moving = None;
        self.wire = None;
        self.wire_start = None;
        self.wire_dragged = false;
    }

    pub fn start_wire(&mut self, id: &str, port: Port) {
        self.wire_start = None;
        self.wire_dragged = false;
        self.wire = Some(Wire {
            source: id.to_owned(),
            port,
            replacing: None,
        });
    }

    pub fn start_wire_at(&mut self, id: &str, port: Port, pointer: Point) {
        self.start_wire(id, port);
        self.wire_start = Some(pointer);
    }

    pub fn wire_move(&mut self, pointer: Point) {
        if let Some(start) = self.wire_start {
            self.wire_dragged |= (pointer.x - start.x).hypot(pointer.y - start.y) > 4.0;
        }
    }

    pub fn release_pointer(&mut self, outside: bool) {
        if outside {
            self.moving = None;
        }
        if self.wire_dragged {
            self.wire = None;
        }
        self.wire_start = None;
        self.wire_dragged = false;
    }

    pub fn start_rewire(&mut self, id: &str) -> Result<(), GraphError> {
        self.wire_start = None;
        self.wire_dragged = false;
        let edge = self
            .editor
            .graph()
            .connections()
            .iter()
            .find(|e| e.id == id)
            .ok_or(GraphError::MissingConnection)?;
        self.wire = Some(Wire {
            source: edge.source.clone(),
            port: edge.source_port,
            replacing: Some(edge.id.clone()),
        });
        Ok(())
    }

    pub fn finish_wire(&mut self, target: &str, port: Port) -> Result<(), GraphError> {
        self.wire_start = None;
        self.wire_dragged = false;
        let wire = self.wire.take().ok_or(GraphError::MissingConnection)?;
        let id = wire
            .replacing
            .clone()
            .unwrap_or_else(|| self.unique_id("edge"));
        let edge = Connection {
            id: id.clone(),
            source: wire.source,
            source_port: wire.port,
            target: target.to_owned(),
            target_port: port,
        };
        self.editor.apply(if wire.replacing.is_some() {
            Edit::Reconnect {
                id,
                replacement: edge,
            }
        } else {
            Edit::Connect(edge)
        })
    }

    pub fn unique_id(&mut self, prefix: &str) -> String {
        loop {
            let index = self.next_id;
            self.next_id += 1;
            let id = format!("{prefix}-{index}");
            if self.reserved_ids.insert(id.clone()) {
                return id;
            }
        }
    }

    pub fn add(
        &mut self,
        kind: NodeKind,
        session: &str,
        position: Point,
    ) -> Result<String, GraphError> {
        let id = self.unique_id("node");
        let title = match kind {
            NodeKind::Agent => "新 Agent",
            NodeKind::Context => "新 Context",
            NodeKind::Memory => "新记忆",
            NodeKind::Automation => "新自动化",
        };
        self.editor.apply(Edit::AddNode(Node {
            id: id.clone(),
            title: title.into(),
            description: String::new(),
            kind,
            session: (kind == NodeKind::Agent).then(|| session.to_owned()),
            position,
        }))?;
        self.selected.clear();
        self.selected.insert(id.clone());
        Ok(id)
    }
}
