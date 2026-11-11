use agentdeck_canvas_core::{
    Connection, Edit, Editor, Graph, Layout, Node, NodeKind, Point, Port, Viewport,
};

fn point(x: f32, y: f32) -> Point {
    Point { x, y }
}
fn node(id: &str, kind: NodeKind, session: Option<&str>) -> Node {
    Node {
        id: id.into(),
        title: id.into(),
        kind,
        session: session.map(str::to_owned),
        position: point(0.0, 0.0),
    }
}
fn edge(id: &str, source: &str, source_port: Port, target: &str, target_port: Port) -> Connection {
    Connection {
        id: id.into(),
        source: source.into(),
        source_port,
        target: target.into(),
        target_port,
    }
}
fn pair() -> Graph {
    let mut graph = Graph::default();
    graph
        .add_node(node("a", NodeKind::Agent, Some("s1")))
        .unwrap();
    graph
        .add_node(node("b", NodeKind::Agent, Some("s1")))
        .unwrap();
    graph
}
fn message(id: &str, source: &str, target: &str) -> Connection {
    edge(id, source, Port::Result, target, Port::Message)
}
fn close(a: Point, b: Point) {
    assert!(
        (a.x - b.x).abs() < 0.001 && (a.y - b.y).abs() < 0.001,
        "{a:?} != {b:?}"
    );
}

#[test]
fn translated_zoomed_viewport_uses_world_coordinates() {
    let view = Viewport::new(point(100.0, -50.0), 2.0).unwrap();
    assert_eq!(view.screen_to_world(point(80.0, 10.0)), point(-10.0, 30.0));
    assert_eq!(view.world_to_screen(point(-10.0, 30.0)), point(80.0, 10.0));
}

#[test]
fn zoom_keeps_the_point_under_the_pointer_fixed_even_at_limits() {
    let mut view = Viewport::new(point(-40.0, 70.0), 1.0).unwrap();
    let pointer = point(200.0, 90.0);
    for zoom in [2.0, 50.0, 0.001, 1.0] {
        let world = view.screen_to_world(pointer);
        view.zoom_at(pointer, zoom).unwrap();
        close(view.world_to_screen(world), pointer);
        assert!((0.15..=3.0).contains(&view.zoom()));
    }
}

#[test]
fn invalid_geometry_does_not_poison_the_viewport() {
    assert!(Viewport::new(point(f32::NAN, 0.0), 1.0).is_err());
    let mut view = Viewport::default();
    let before = view;
    for bad in [f32::NAN, f32::INFINITY, -1.0, 0.0] {
        assert!(view.zoom_at(point(0.0, 0.0), bad).is_err());
        assert_eq!(view, before);
    }
}

#[test]
fn message_edges_cannot_cross_sessions_or_use_resource_ports() {
    let mut graph = pair();
    graph
        .add_node(node("c", NodeKind::Agent, Some("s2")))
        .unwrap();
    assert!(graph.connect(message("bad", "a", "c")).is_err());
    assert!(
        graph
            .connect(edge("bad", "a", Port::Context, "b", Port::Context))
            .is_err()
    );
    assert!(graph.connections().is_empty());
    graph.connect(message("ab", "a", "b")).unwrap();
    assert_eq!(graph.connections().len(), 1);
}

#[test]
fn typed_resources_connect_without_becoming_message_edges() {
    let mut graph = pair();
    for (id, kind, port) in [
        ("context", NodeKind::Context, Port::Context),
        ("memory", NodeKind::Memory, Port::Memory),
        ("timer", NodeKind::Automation, Port::Trigger),
    ] {
        graph.add_node(node(id, kind, None)).unwrap();
        graph.connect(edge(id, id, port, "a", port)).unwrap();
    }
    graph
        .add_node(node("private", NodeKind::Context, Some("s2")))
        .unwrap();
    assert!(
        graph
            .connect(edge("bad", "private", Port::Context, "a", Port::Context))
            .is_err()
    );
    assert_eq!(graph.connections().len(), 3);
}

#[test]
fn duplicate_self_missing_target_and_unbounded_cycle_are_rejected() {
    let mut graph = pair();
    graph.connect(message("ab", "a", "b")).unwrap();
    for candidate in [
        message("dupe", "a", "b"),
        message("self", "a", "a"),
        message("missing", "a", "none"),
        message("cycle", "b", "a"),
    ] {
        assert!(graph.connect(candidate).is_err());
        assert_eq!(graph.connections().len(), 1);
    }
}

#[test]
fn invalid_reconnect_preserves_the_original_connection() {
    let mut graph = pair();
    graph.connect(message("ab", "a", "b")).unwrap();
    let before = graph.clone();
    assert!(
        graph
            .reconnect("ab", message("ab", "a", "missing"))
            .is_err()
    );
    assert_eq!(graph, before);
    graph
        .add_node(node("c", NodeKind::Agent, Some("s1")))
        .unwrap();
    graph.reconnect("ab", message("ab", "a", "c")).unwrap();
    assert_eq!(graph.connections()[0].target, "c");
}

#[test]
fn moving_a_selection_is_atomic_and_undo_preserves_session_identity() {
    let mut editor = Editor::new(pair());
    assert!(
        editor
            .apply(Edit::MoveNodes(vec![
                ("a".into(), point(2.0, 3.0)),
                ("missing".into(), point(8.0, 9.0))
            ]))
            .is_err()
    );
    assert_eq!(editor.graph().node("a").unwrap().position, point(0.0, 0.0));
    assert!(!editor.undo());
    editor
        .apply(Edit::MoveNodes(vec![
            ("a".into(), point(-120.0, 80.0)),
            ("b".into(), point(200.0, 100.0)),
        ]))
        .unwrap();
    assert_eq!(
        editor.graph().node("a").unwrap().session.as_deref(),
        Some("s1")
    );
    assert!(editor.undo());
    assert_eq!(editor.graph().node("b").unwrap().position, point(0.0, 0.0));
    assert!(editor.redo());
    assert_eq!(
        editor.graph().node("a").unwrap().position,
        point(-120.0, 80.0)
    );
}

#[test]
fn removing_a_node_and_incident_edges_is_one_undo_step() {
    let mut graph = pair();
    graph.connect(message("ab", "a", "b")).unwrap();
    let mut editor = Editor::new(graph.clone());
    editor.apply(Edit::RemoveNode("a".into())).unwrap();
    assert!(editor.graph().node("a").is_none());
    assert!(editor.graph().connections().is_empty());
    assert!(editor.undo());
    assert_eq!(editor.graph(), &graph);
}

#[test]
fn a_new_edit_after_undo_clears_redo() {
    let mut editor = Editor::new(pair());
    editor
        .apply(Edit::Connect(message("ab", "a", "b")))
        .unwrap();
    editor.undo();
    editor
        .apply(Edit::MoveNodes(vec![("a".into(), point(10.0, 20.0))]))
        .unwrap();
    assert!(!editor.redo());
    assert!(editor.graph().connections().is_empty());
}

#[test]
fn layout_round_trip_preserves_unicode_negative_coordinates_and_edges() {
    let mut graph = pair();
    let mut resource = node("上下文", NodeKind::Context, None);
    resource.title = "长期天气 · 上海杨浦".into();
    resource.position = point(-1200.0, 500.0);
    graph.add_node(resource).unwrap();
    graph.connect(message("ab", "a", "b")).unwrap();
    let layout = Layout::new(graph, Viewport::new(point(120.0, -50.0), 0.5).unwrap());
    let json = layout.to_json().unwrap();
    assert_eq!(Layout::from_json(&json).unwrap(), layout);
    let mut invalid: serde_json::Value = serde_json::from_str(&json).unwrap();
    invalid["version"] = 999.into();
    assert!(Layout::from_json(&invalid.to_string()).is_err());
}

#[test]
fn invalid_imported_edges_are_not_allowed_to_bypass_graph_validation() {
    let mut graph = pair();
    graph.connect(message("ab", "a", "b")).unwrap();
    let layout = Layout::new(graph, Viewport::default());
    let mut json: serde_json::Value = serde_json::from_str(&layout.to_json().unwrap()).unwrap();
    json["graph"]["connections"][0]["target"] = "missing".into();
    assert!(Layout::from_json(&json.to_string()).is_err());
}

#[test]
fn duplicate_node_keys_are_rejected_before_records_can_be_overwritten() {
    let a = serde_json::to_string(&node("a", NodeKind::Agent, Some("s1"))).unwrap();
    let json = format!(r#"{{"nodes":{{"a":{a},"a":{a}}},"connections":[]}}"#);
    assert!(serde_json::from_str::<Graph>(&json).is_err());
}

#[test]
fn deserializing_a_viewport_cannot_bypass_its_validated_constructor() {
    for zoom in [0.0, -1.0, 0.1, 4.0] {
        let json = format!(r#"{{"offset":{{"x":0,"y":0}},"zoom":{zoom}}}"#);
        assert!(serde_json::from_str::<Viewport>(&json).is_err());
    }
    let view = Viewport::new(point(-100.0, 50.0), 0.15).unwrap();
    assert_eq!(
        serde_json::from_str::<Viewport>(&serde_json::to_string(&view).unwrap()).unwrap(),
        view
    );
}

#[test]
fn saving_reports_when_pretty_format_would_exceed_the_read_limit() {
    let mut graph = pair();
    let mut large = node("large", NodeKind::Context, None);
    large.title.clear();
    graph.add_node(large.clone()).unwrap();
    let overhead = serde_json::to_string(&Layout::new(graph, Viewport::default()))
        .unwrap()
        .len();
    large.title = "x".repeat(16 * 1024 * 1024 - overhead);
    let mut graph = pair();
    graph.add_node(large).unwrap();
    let compact = serde_json::to_string(&Layout::new(graph, Viewport::default())).unwrap();
    assert_eq!(compact.len(), 16 * 1024 * 1024);
    let restored = Layout::from_json(&compact).unwrap();
    assert!(
        restored.to_json().is_err(),
        "must not report a successful save that cannot be reopened"
    );
}

#[test]
fn extreme_finite_geometry_cannot_enter_the_saved_canvas() {
    assert!(Viewport::new(point(f32::MAX, 0.0), 3.0).is_err());
    let mut graph = pair();
    let mut extreme = node("extreme", NodeKind::Context, None);
    extreme.position = point(f32::MAX, 0.0);
    assert!(graph.add_node(extreme).is_err());
    let mut editor = Editor::new(graph.clone());
    assert!(
        editor
            .apply(Edit::MoveNodes(vec![("a".into(), point(f32::MAX, 0.0))]))
            .is_err()
    );
    assert_eq!(editor.graph(), &graph);
}

#[test]
fn disconnect_is_undoable_without_removing_either_node_or_other_edges() {
    let mut graph = pair();
    graph
        .add_node(node("c", NodeKind::Agent, Some("s1")))
        .unwrap();
    graph.connect(message("ab", "a", "b")).unwrap();
    graph.connect(message("ac", "a", "c")).unwrap();
    let mut editor = Editor::new(graph.clone());
    assert!(
        editor
            .apply(Edit::RemoveConnection("missing".into()))
            .is_err()
    );
    assert!(!editor.undo());
    editor.apply(Edit::RemoveConnection("ab".into())).unwrap();
    assert_eq!(editor.graph().nodes().count(), 3);
    assert_eq!(editor.graph().connections(), &[message("ac", "a", "c")]);
    assert!(editor.undo());
    assert_eq!(editor.graph(), &graph);
    assert!(editor.redo());
    assert_eq!(editor.graph().connections(), &[message("ac", "a", "c")]);
}

#[test]
fn a_thousand_node_reverse_order_chain_loads_and_rejects_a_closing_cycle() {
    let mut graph = Graph::default();
    for i in 0..1000 {
        graph
            .add_node(node(&i.to_string(), NodeKind::Agent, Some("s1")))
            .unwrap();
    }
    let mut json = serde_json::to_value(Layout::new(graph, Viewport::default())).unwrap();
    let edges: Vec<_> = (1..1000)
        .rev()
        .map(|i| message(&format!("e{i}"), &(i - 1).to_string(), &i.to_string()))
        .collect();
    json["graph"]["connections"] = serde_json::to_value(edges).unwrap();
    let mut restored = Layout::from_json(&json.to_string()).unwrap();
    assert_eq!(restored.graph.connections().len(), 999);
    assert!(
        restored
            .graph
            .connect(message("cycle", "999", "0"))
            .is_err()
    );
}
