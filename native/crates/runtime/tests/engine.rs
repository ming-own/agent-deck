use agentdeck_runtime::{Engine, protocol::*};

fn request(id: &str, revision: Option<u64>, command: Command) -> Request {
    Request {
        version: VERSION,
        client_id: "client-a".into(),
        request_id: id.into(),
        expected_server: Some("server-a".into()),
        expected_revision: revision,
        command,
    }
}
fn start(id: &str, revision: u64, run: &str, nodes: &[&str]) -> Request {
    request(
        id,
        Some(revision),
        Command::Start {
            run_id: run.into(),
            session_id: "session-a".into(),
            node_ids: nodes.iter().map(|s| s.to_string()).collect(),
        },
    )
}
#[test]
fn protocol_mismatch_and_stale_revision_never_start_work() {
    let mut engine = Engine::new("server-a".into());
    let mut bad = start("old", 0, "run-a", &["a", "b"]);
    bad.version = 0;
    assert_eq!(engine.handle(bad).error, Some(ErrorCode::Version));
    assert_eq!(
        engine.handle(start("stale", 10, "run-a", &["a"])).error,
        Some(ErrorCode::StaleRevision)
    );
    assert!(engine.snapshot().runs.is_empty());
}
#[test]
fn duplicate_requests_do_not_start_twice_or_accept_a_different_payload() {
    let mut engine = Engine::new("server-a".into());
    let req = start("once", 0, "run-a", &["a", "b"]);
    assert!(engine.handle(req.clone()).error.is_none());
    engine.advance();
    let seq = engine.snapshot().sequence;
    assert!(engine.handle(req).error.is_none());
    assert_eq!(engine.snapshot().sequence, seq);
    assert_eq!(engine.snapshot().runs.len(), 1);
    assert_eq!(
        engine.handle(start("once", 0, "run-b", &["c"])).error,
        Some(ErrorCode::DuplicateRequest)
    );
}
#[test]
fn reconnect_replays_only_new_events_and_final_results_retain_node_identity() {
    let mut engine = Engine::new("server-a".into());
    let reply = engine.handle(start("start", 0, "run-a", &["a", "b"]));
    let cursor = reply.snapshot.sequence;
    engine.advance();
    engine.advance();
    let reply = engine.handle(request(
        "poll",
        None,
        Command::Poll {
            after_sequence: cursor,
        },
    ));
    assert!(!reply.resync);
    assert_eq!(reply.events.len(), 3);
    assert!(
        reply
            .events
            .iter()
            .all(|e| e.sequence > cursor && e.run_id == "run-a")
    );
    let run = &reply.snapshot.runs[0];
    assert_eq!(run.status(), NodeState::Succeeded);
    assert_eq!(run.nodes[0].node_id, "a");
    assert_eq!(run.nodes[1].node_id, "b");
    assert!(
        run.nodes
            .iter()
            .all(|n| n.result.as_ref().is_some_and(|r| r.contains(&n.node_id)))
    );
}
#[test]
fn stopping_cancels_only_the_named_run_and_late_ticks_cannot_complete_it() {
    let mut engine = Engine::new("server-a".into());
    engine.handle(start("one", 0, "run-a", &["a", "b"]));
    engine.handle(start("two", engine.snapshot().revision, "run-b", &["c"]));
    let reply = engine.handle(request(
        "stop",
        Some(engine.snapshot().revision),
        Command::Stop {
            run_id: "run-a".into(),
        },
    ));
    assert!(reply.error.is_none());
    engine.advance();
    let snapshot = engine.snapshot();
    assert_eq!(snapshot.runs[0].status(), NodeState::Cancelled);
    assert!(snapshot.runs[0].nodes.iter().all(|n| n.result.is_none()));
    assert_eq!(snapshot.runs[1].status(), NodeState::Succeeded);
}
#[test]
fn bounded_event_retention_requires_a_snapshot_when_the_cursor_is_too_old() {
    let mut engine = Engine::new("server-a".into());
    for run in 0..5 {
        let nodes: Vec<String> = (0..64).map(|i| format!("node-{i}")).collect();
        let req = request(
            &format!("r{run}"),
            Some(engine.snapshot().revision),
            Command::Start {
                run_id: format!("run-{run}"),
                session_id: "session-a".into(),
                node_ids: nodes,
            },
        );
        assert!(engine.handle(req).error.is_none());
        for _ in 0..64 {
            engine.advance();
        }
    }
    let reply = engine.handle(request(
        "reconnect",
        None,
        Command::Poll { after_sequence: 0 },
    ));
    assert!(reply.resync);
    assert!(reply.events.len() <= 256);
    assert_eq!(reply.snapshot.runs.len(), 5);
    assert!(
        reply
            .snapshot
            .runs
            .iter()
            .all(|r| r.status() == NodeState::Succeeded)
    );
}
#[test]
fn invalid_and_oversized_plans_are_rejected_before_any_event() {
    for nodes in [vec![], vec!["a", "a"], vec![""], vec!["a"; 65]] {
        let mut e = Engine::new("server-a".into());
        assert_eq!(
            e.handle(start("bad", 0, "run-a", &nodes)).error,
            Some(ErrorCode::InvalidRequest)
        );
        assert_eq!(e.snapshot().sequence, 0);
    }
}
#[test]
fn service_shutdown_is_explicit_and_rejected_while_a_run_is_active() {
    let mut engine = Engine::new("server-a".into());
    engine.handle(start("start", 0, "run-a", &["a"]));
    assert_eq!(
        engine
            .handle(request(
                "quit",
                Some(engine.snapshot().revision),
                Command::Shutdown
            ))
            .error,
        Some(ErrorCode::Busy)
    );
    assert!(!engine.shutting_down());
    engine.advance();
    assert!(
        engine
            .handle(request(
                "quit-done",
                Some(engine.snapshot().revision),
                Command::Shutdown
            ))
            .error
            .is_none()
    );
    assert!(engine.shutting_down());
}

#[test]
fn a_restarted_server_rejects_old_commands_even_when_revision_matches() {
    let mut engine = Engine::new("server-b".into());
    assert_eq!(
        engine.handle(start("old", 0, "run-a", &["a"])).error,
        Some(ErrorCode::ServerChanged)
    );
    assert!(engine.snapshot().runs.is_empty());
}
#[test]
fn shutdown_does_not_accept_a_racing_start() {
    let mut engine = Engine::new("server-a".into());
    engine.handle(request("quit", Some(0), Command::Shutdown));
    assert_eq!(
        engine.handle(start("late", 1, "run-a", &["a"])).error,
        Some(ErrorCode::Busy)
    );
}
