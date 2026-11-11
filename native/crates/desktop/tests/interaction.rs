use agentdeck_canvas_core::{Edit, Layout, NodeKind, Point, Port};
use agentdeck_desktop::editing::Drafts;
use agentdeck_desktop::{interaction::CanvasState, persistence};

#[test]
fn deleted_node_drafts_return_on_undo_but_clean_fields_do_not_redo_a_rename() {
    let mut state = CanvasState::demo();
    let mut drafts = Drafts::default();
    drafts.stash(
        "a",
        "尚未保存".into(),
        "原草稿".into(),
        state.editor.graph(),
    );
    state.editor.apply(Edit::RemoveNode("a".into())).unwrap();
    drafts.apply(&mut state.editor).unwrap();
    state.editor.undo();
    assert_eq!(drafts.get("a").unwrap().1, "原草稿");
    drafts.apply(&mut state.editor).unwrap();
    drafts.stash(
        "a",
        "尚未保存".into(),
        "原草稿".into(),
        state.editor.graph(),
    );
    assert!(state.editor.undo());
    drafts.apply(&mut state.editor).unwrap();
    assert_eq!(state.editor.graph().node("a").unwrap().title, "资料核验员");
}

#[test]
fn undoing_creation_does_not_reuse_a_draft_identity_or_block_unrelated_saves() {
    let mut state = CanvasState::demo();
    let id = state
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    let mut drafts = Drafts::default();
    drafts.stash(&id, "".into(), "旧草稿".into(), state.editor.graph());
    state.editor.undo();
    drafts.apply(&mut state.editor).unwrap();
    let next = state
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    assert_ne!(id, next);
    assert!(drafts.get(&next).is_none());
}

#[test]
fn clicking_outside_canvas_does_not_cancel_click_mode_wiring() {
    let mut state = CanvasState::demo();
    state.start_wire("context", Port::Context);
    state.release_pointer(true);
    assert!(state.wire.is_some());
    state.finish_wire("a", Port::Context).unwrap();
    state.start_wire_at("memory", Port::Memory, point(10.0, 10.0));
    state.wire_move(point(40.0, 80.0));
    state.release_pointer(true);
    assert!(state.wire.is_none());
}

fn point(x: f32, y: f32) -> Point {
    Point { x, y }
}

#[test]
fn panning_stops_after_outside_release_or_a_missed_mouse_up() {
    let mut state = CanvasState::demo();
    state.begin_pan(point(10.0, 20.0));
    assert!(state.pan_to(point(30.0, 40.0), true));
    let released = state.viewport;
    state.release_pointer(true);
    assert!(!state.pan_to(point(100.0, 200.0), false));
    assert_eq!(state.viewport, released);
    state.begin_pan(point(30.0, 40.0));
    assert!(!state.pan_to(point(100.0, 200.0), false));
    assert_eq!(state.viewport, released);
    assert!(!state.pan_to(point(120.0, 220.0), true));
    assert_eq!(state.viewport, released);
}

#[test]
fn drag_is_a_preview_until_release_and_cancel_keeps_the_original() {
    let mut state = CanvasState::demo();
    let original = state.editor.graph().clone();
    state.select("a", false);
    state.select("b", true);
    state.begin_move(point(10.0, 20.0));
    state.move_to(point(50.0, 80.0));
    assert_eq!(state.editor.graph(), &original);
    assert_eq!(
        state.position("a").unwrap().x,
        original.node("a").unwrap().position.x + 40.0
    );
    state.cancel();
    assert_eq!(
        state.position("a").unwrap(),
        original.node("a").unwrap().position
    );
    state.begin_move(point(0.0, 0.0));
    state.move_to(point(-30.0, 60.0));
    state.finish_move().unwrap();
    assert_eq!(
        state.editor.graph().node("b").unwrap().position.y,
        original.node("b").unwrap().position.y + 60.0
    );
    assert!(state.editor.undo());
    assert_eq!(state.editor.graph(), &original);
}

#[test]
fn cancelling_or_rejecting_a_rewire_preserves_the_original_edge() {
    let mut state = CanvasState::demo();
    let original = state.editor.graph().clone();
    state.start_rewire("ab").unwrap();
    state.cancel();
    assert_eq!(state.editor.graph(), &original);
    state.start_rewire("ab").unwrap();
    assert!(state.finish_wire("c", Port::Message).is_err());
    assert_eq!(state.editor.graph(), &original);
    assert!(state.wire.is_none());
}

#[test]
fn resource_connections_keep_their_typed_ports_and_session_isolation() {
    let mut state = CanvasState::demo();
    state.start_wire("context", Port::Context);
    assert!(state.finish_wire("a", Port::Message).is_err());
    state.start_wire("context", Port::Context);
    state.finish_wire("a", Port::Context).unwrap();
    assert!(
        state
            .editor
            .graph()
            .connections()
            .iter()
            .any(|e| e.source == "context" && e.target_port == Port::Context)
    );
    let original = state.editor.graph().clone();
    state.start_wire("a", Port::Result);
    assert!(state.finish_wire("c", Port::Message).is_err());
    assert_eq!(state.editor.graph(), &original);
}

#[test]
fn new_nodes_are_unique_after_layout_reload() {
    let mut state = CanvasState::demo();
    let first = state
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    let layout = Layout::from_json(&state.layout().to_json().unwrap()).unwrap();
    let mut state = CanvasState::from_layout(layout);
    state.editor.apply(Edit::RemoveNode(first.clone())).unwrap();
    let second = state
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    assert_ne!(first, second);
    assert!(state.editor.graph().node(&first).is_none());
    assert!(state.editor.graph().node(&second).is_some());
}

#[test]
fn deleted_identity_is_not_reused_after_saving_and_reopening() {
    let mut state = CanvasState::demo();
    let id = state
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    state.editor.apply(Edit::RemoveNode(id.clone())).unwrap();
    let saved = state.layout().to_json().unwrap();
    let mut reopened = CanvasState::from_layout(Layout::from_json(&saved).unwrap());
    let replacement = reopened
        .add(NodeKind::Agent, "session-1", point(0.0, 0.0))
        .unwrap();
    assert_ne!(
        id, replacement,
        "surviving service runs must not attach to a new node"
    );
}

#[test]
fn layout_store_round_trips_and_invalid_data_is_not_silently_reset() {
    let dir = std::env::temp_dir().join(format!("agentdeck-layout-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("layout.json");
    let mut state = CanvasState::demo();
    state
        .editor
        .apply(Edit::UpdateNode {
            id: "a".into(),
            title: "你好".into(),
            description: "独立说明".into(),
        })
        .unwrap();
    persistence::save(&path, &state.layout()).unwrap();
    assert_eq!(persistence::load(&path).unwrap().unwrap(), state.layout());
    std::fs::write(&path, b"incomplete data").unwrap();
    assert!(persistence::load(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"incomplete data");
    std::fs::remove_dir_all(dir).unwrap();
}
