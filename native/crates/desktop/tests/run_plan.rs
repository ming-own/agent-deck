use agentdeck_canvas_core::{Connection, Edit, Port};
use agentdeck_desktop::{interaction::CanvasState, run_plan};
#[test]
fn demo_plan_follows_message_edges_and_ignores_resource_references() {
    let mut state = CanvasState::demo();
    state.start_wire("memory", Port::Memory);
    state.finish_wire("b", Port::Memory).unwrap();
    let plan = run_plan::compile(state.editor.graph(), "a").unwrap();
    assert_eq!(plan.session_id, "session-1");
    assert_eq!(plan.node_ids, vec!["a", "b"]);
    assert_eq!(
        run_plan::compile(state.editor.graph(), "b")
            .unwrap()
            .node_ids,
        vec!["b"]
    );
    assert!(run_plan::compile(state.editor.graph(), "memory").is_err());
}
#[test]
fn unsupported_branch_is_reported_instead_of_silently_choosing_a_path() {
    let mut state = CanvasState::demo();
    let id = state
        .add(
            agentdeck_canvas_core::NodeKind::Agent,
            "session-1",
            Default::default(),
        )
        .unwrap();
    state
        .editor
        .apply(Edit::Connect(Connection {
            id: "branch".into(),
            source: "a".into(),
            source_port: Port::Result,
            target: id,
            target_port: Port::Message,
        }))
        .unwrap();
    assert!(run_plan::compile(state.editor.graph(), "a").is_err());
}
