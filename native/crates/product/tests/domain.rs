use agentdeck_product::*;
use canvas_core::{Connection, Edit, Graph, Layout, Node, NodeKind, Point, Port, Viewport};

fn configured() -> (Space, String, String) {
    let mut space = Space::new("Workspace");
    let session = space.add_session("Session");
    space.providers.push(Provider {
        id: "provider".into(),
        name: "Local".into(),
        base_url: "http://localhost:9000/v1".into(),
        kind: ProviderKind::OpenAiCompatible,
    });
    let agent = space
        .add_agent(&session, "Writer", Point::default())
        .unwrap();
    let config = space.agents.get_mut(&agent).unwrap();
    config.provider_id = Some("provider".into());
    config.model = "custom-model:latest".into();
    (space, session, agent)
}
fn agent(space: &mut Space, session: &str, name: &str) -> String {
    let id = space.add_agent(session, name, Point::default()).unwrap();
    space.agents.get_mut(&id).unwrap().provider_id = Some("provider".into());
    space.agents.get_mut(&id).unwrap().model = "custom".into();
    id
}
fn edge(space: &mut Space, from: &str, to: &str) {
    space
        .apply_edit(Edit::Connect(Connection {
            id: new_id(),
            source: from.into(),
            source_port: Port::Result,
            target: to.into(),
            target_port: Port::Message,
        }))
        .unwrap();
}
fn success(task: &mut Task, answer: &str) -> String {
    let mut turn = Turn::queued("run", "question");
    turn.answer = Some(answer.into());
    turn.status = TurnStatus::Succeeded;
    let id = turn.id.clone();
    task.turns.push(turn);
    id
}

#[test]
fn sessions_tasks_and_appearance_are_independent() {
    let (mut space, s1, a1) = configured();
    let s2 = space.add_session("Second");
    let a2 = agent(&mut space, &s2, "Other");
    let mut t1 = Task::new(&space, &a1, "One").unwrap();
    let t2 = Task::new(&space, &a1, "Two").unwrap();
    let t3 = Task::new(&space, &a2, "Three").unwrap();
    success(&mut t1, "only first task");
    assert_ne!(t1.id, t2.id);
    assert!(t2.turns.is_empty());
    assert_eq!(t1.session_id, s1);
    assert_eq!(t3.session_id, s2);
    space.agents.get_mut(&a1).unwrap().role = "Editor".into();
    let config = space.agents[&a1].clone();
    space.appearances.get_mut(&a1).unwrap().material = CardMaterial::Jade;
    assert_eq!(space.agents[&a1], config);
    space.apply_edit(Edit::RemoveNode(a1.clone())).unwrap();
    assert!(!space.agents.contains_key(&a1));
    assert_eq!(t1.turns[0].answer.as_deref(), Some("only first task"));
    space.validate().unwrap();
}

#[test]
fn template_instances_are_deep_copies_with_fresh_identity() {
    let (mut space, session, original) = configured();
    let template = space.save_template(&original, "Reusable").unwrap();
    let first = space
        .instantiate_template(&template, &session, Point { x: 20.0, y: 30.0 })
        .unwrap();
    let second = space
        .instantiate_template(&template, &session, Point::default())
        .unwrap();
    assert_ne!(first, original);
    assert_ne!(first, second);
    space.agents.get_mut(&first).unwrap().model = "changed".into();
    space.templates[0].agent.as_mut().unwrap().role = "new template role".into();
    assert_eq!(space.agents[&second].model, "custom-model:latest");
    assert!(space.agents[&second].role.is_empty());
    assert_eq!(space.layout.graph.node(&first).unwrap().position.x, 20.0);
    space.validate().unwrap();
}

#[test]
fn run_resources_and_manual_transfer_freeze_content() {
    let (mut space, _, a) = configured();
    let resource = space
        .add_resource(
            ResourceKind::Context,
            "Brief",
            "version one",
            None,
            Point::default(),
        )
        .unwrap();
    space
        .apply_edit(Edit::Connect(Connection {
            id: new_id(),
            source: resource.clone(),
            source_port: Port::Context,
            target: a.clone(),
            target_port: Port::Context,
        }))
        .unwrap();
    let skill = space
        .add_resource(
            ResourceKind::Skill,
            "Style",
            "be clear",
            None,
            Point::default(),
        )
        .unwrap();
    space
        .agents
        .get_mut(&a)
        .unwrap()
        .skill_ids
        .push(skill.clone());
    let plan = compile_run(&space, &a).unwrap();
    space.resources.get_mut(&resource).unwrap().content = "new version".into();
    space.resources.get_mut(&skill).unwrap().content = "new skill".into();
    assert_eq!(
        plan.steps[0]
            .resources
            .iter()
            .map(|r| r.content.as_str())
            .collect::<Vec<_>>(),
        vec!["version one", "be clear"]
    );
    let mut source = Task::new(&space, &a, "Source").unwrap();
    let destination_session = space.add_session("Destination Session");
    let destination_agent = agent(&mut space, &destination_session, "Receiver");
    let destination = Task::new(&space, &destination_agent, "Destination").unwrap();
    let turn_id = success(&mut source, "frozen answer");
    let transfer = snapshot_transfer(&source, &turn_id, &destination).unwrap();
    assert_ne!(source.session_id, destination.session_id);
    assert_eq!(plan.steps[0].resources[0].revision, Some(1));
    source.turns[0].answer = Some("edited".into());
    assert_eq!(transfer.content, "frozen answer");
    assert_eq!(transfer.task_id.as_deref(), Some(source.id.as_str()));
    assert_eq!(
        transfer.destination_task_id.as_deref(),
        Some(destination.id.as_str())
    );
    assert!(destination.turns.is_empty());
    source.turns[0].status = TurnStatus::Failed;
    assert!(snapshot_transfer(&source, &turn_id, &destination).is_err());
}

#[test]
fn compiles_branch_join_and_rejects_missing_dependency() {
    let (mut space, session, a) = configured();
    let b = agent(&mut space, &session, "B");
    let c = agent(&mut space, &session, "C");
    let d = agent(&mut space, &session, "D");
    edge(&mut space, &a, &b);
    edge(&mut space, &a, &c);
    edge(&mut space, &b, &d);
    edge(&mut space, &c, &d);
    let plan = compile_run(&space, &a).unwrap();
    assert_eq!(plan.steps.first().unwrap().node_id, a);
    assert_eq!(plan.steps.last().unwrap().node_id, d);
    assert_eq!(plan.steps.last().unwrap().dependencies.len(), 2);
    let error = compile_run(&space, &b).unwrap_err().to_string();
    assert!(error.contains("dependency"), "{error}");
    assert!(error.contains(&a) || error.contains(&c));
    let original = space.clone();
    assert!(
        space
            .apply_edit(Edit::Connect(Connection {
                id: new_id(),
                source: d,
                source_port: Port::Result,
                target: a,
                target_port: Port::Message
            }))
            .is_err()
    );
    assert_eq!(space, original);
}

#[test]
fn preview_import_preserves_identity_geometry_and_creates_no_history() {
    let mut graph = Graph::default();
    graph
        .add_node(Node {
            id: "old-agent".into(),
            title: "Old".into(),
            description: "description".into(),
            kind: NodeKind::Agent,
            session: Some("old-session".into()),
            position: Point { x: 250.0, y: -70.0 },
        })
        .unwrap();
    let layout = Layout::new(graph, Viewport::default());
    let space = Space::from_layout("Imported", layout.clone()).unwrap();
    assert_eq!(space.layout, layout);
    assert_eq!(space.sessions[0].id, "old-session");
    assert_eq!(space.agents["old-agent"], AgentConfig::default());
    assert!(compile_run(&space, "old-agent").is_err());
    assert!(
        Task::new(&space, "old-agent", "New")
            .unwrap()
            .turns
            .is_empty()
    );
    let mut catalog = Catalog::new();
    catalog.active_space_id = space.id.clone();
    catalog.spaces.push(space);
    catalog.validate().unwrap();
    let json = serde_json::to_string(&catalog).unwrap();
    assert_eq!(serde_json::from_str::<Catalog>(&json).unwrap(), catalog);
}

#[test]
fn invalid_ownership_provider_resource_and_session_are_rejected() {
    let (mut space, session, a) = configured();
    space.agents.get_mut(&a).unwrap().provider_id = Some("missing".into());
    assert!(space.validate().is_err());
    space.agents.get_mut(&a).unwrap().provider_id = Some("provider".into());
    space.agents.get_mut(&a).unwrap().model = "  ".into();
    assert!(compile_run(&space, &a).is_err());
    space.agents.get_mut(&a).unwrap().model = "ok".into();
    space
        .agents
        .get_mut(&a)
        .unwrap()
        .skill_ids
        .push("missing".into());
    assert!(space.validate().is_err());
    space.agents.get_mut(&a).unwrap().skill_ids.clear();
    let s2 = space.add_session("Second");
    let b = agent(&mut space, &s2, "B");
    assert!(
        space
            .apply_edit(Edit::Connect(Connection {
                id: new_id(),
                source: a.clone(),
                source_port: Port::Result,
                target: b,
                target_port: Port::Message
            }))
            .is_err()
    );
    assert!(
        space
            .add_agent("missing-session", "Wrong", Point::default())
            .is_err()
    );
    space.sessions.retain(|s| s.id != session);
    assert!(space.validate().is_err());
}

#[test]
fn resource_template_uses_instance_id_and_no_aliasing() {
    let mut space = Space::new("Resources");
    let session = space.add_session("Session");
    let resource = space
        .add_resource(
            ResourceKind::Memory,
            "Memory",
            "original",
            None,
            Point::default(),
        )
        .unwrap();
    let template = space.save_template(&resource, "Memory template").unwrap();
    let instance = space
        .instantiate_template(&template, &session, Point::default())
        .unwrap();
    assert_eq!(space.resources[&instance].id, instance);
    space.resources.get_mut(&instance).unwrap().content = "changed".into();
    assert_eq!(space.resources[&resource].content, "original");
    assert_eq!(
        space.templates[0].resource.as_ref().unwrap().content,
        "original"
    );
    space.validate().unwrap();
}

#[test]
fn transfer_reference_cannot_be_attached_to_another_task() {
    let (space, _, a) = configured();
    let mut source = Task::new(&space, &a, "Source").unwrap();
    let intended = Task::new(&space, &a, "Intended").unwrap();
    let mut wrong = Task::new(&space, &a, "Wrong").unwrap();
    let id = success(&mut source, "answer");
    let snapshot = snapshot_transfer(&source, &id, &intended).unwrap();
    let mut turn = Turn::queued("run2", "question");
    turn.references.push(snapshot);
    wrong.turns.push(turn);
    assert!(wrong.validate().is_err());
}

#[test]
fn enabled_automation_requires_single_trigger_and_valid_interval() {
    let (mut space, session, a) = configured();
    let id = new_id();
    space
        .apply_edit(Edit::AddNode(Node {
            id: id.clone(),
            title: "Schedule".into(),
            description: String::new(),
            kind: NodeKind::Automation,
            session: Some(session),
            position: Point::default(),
        }))
        .unwrap();
    space.automations[0].enabled = true;
    space.automations[0].prompt = "Review".into();
    assert!(space.validate().is_err());
    space
        .layout
        .graph
        .connect(Connection {
            id: new_id(),
            source: id,
            source_port: Port::Trigger,
            target: a,
            target_port: Port::Trigger,
        })
        .unwrap();
    space.validate().unwrap();
    space.automations[0].interval_minutes = 0;
    assert!(space.validate().is_err());
}

#[test]
fn explicit_agent_task_run_ignores_message_edges_but_freezes_resources() {
    let (mut space, session, a) = configured();
    let b = agent(&mut space, &session, "B");
    edge(&mut space, &a, &b);
    let resource = space
        .add_resource(
            ResourceKind::Memory,
            "Notes",
            "remember this",
            Some(&session),
            Point::default(),
        )
        .unwrap();
    space
        .apply_edit(Edit::Connect(Connection {
            id: new_id(),
            source: resource,
            source_port: Port::Memory,
            target: b.clone(),
            target_port: Port::Memory,
        }))
        .unwrap();
    assert!(compile_run(&space, &b).is_err());
    let plan = compile_agent(&space, &b).unwrap();
    assert_eq!(plan.steps.len(), 1);
    assert_eq!(plan.steps[0].node_id, b);
    assert!(plan.steps[0].dependencies.is_empty());
    assert_eq!(plan.steps[0].resources[0].content, "remember this");
    assert_eq!(compile_agent(&space, &a).unwrap().steps.len(), 1);
}
