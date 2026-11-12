use crate::*;
use canvas_core::{NodeKind, Port};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunPlan {
    pub space_id: String,
    pub start_node_id: String,
    pub steps: Vec<RunStep>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStep {
    pub node_id: String,
    pub session_id: String,
    pub config: AgentConfig,
    pub provider: Provider,
    pub dependencies: Vec<String>,
    pub resources: Vec<ReferenceSnapshot>,
}
/// Compiles the reachable Agent DAG into deterministic topological order.
/// Every incoming Agent dependency must be reachable, including dependencies of the start node.
/// All configs/providers/resources are deep snapshots; appearance never affects execution.
pub fn compile_run(space: &Space, start_node_id: &str) -> Result<RunPlan> {
    space.validate()?;
    let graph = &space.layout.graph;
    if !graph
        .node(start_node_id)
        .is_some_and(|n| n.kind == NodeKind::Agent)
    {
        return fail("Run start must be an existing Agent");
    }
    let mut reachable = BTreeSet::new();
    let mut pending = vec![start_node_id.to_owned()];
    while let Some(id) = pending.pop() {
        if reachable.insert(id.clone()) {
            pending.extend(
                graph
                    .connections()
                    .iter()
                    .filter(|e| e.source == id && e.source_port == Port::Result)
                    .map(|e| e.target.clone()),
            );
        }
    }
    let mut dependencies: BTreeMap<String, Vec<String>> =
        reachable.iter().map(|id| (id.clone(), vec![])).collect();
    for edge in graph
        .connections()
        .iter()
        .filter(|e| e.source_port == Port::Result && reachable.contains(&e.target))
    {
        if !reachable.contains(&edge.source) {
            return fail(format!(
                "Agent {} requires dependency {} outside the selected run; start from a shared ancestor or explicitly transfer its answer",
                edge.target, edge.source
            ));
        }
        dependencies
            .get_mut(&edge.target)
            .expect("reachable target")
            .push(edge.source.clone());
    }
    for deps in dependencies.values_mut() {
        deps.sort();
    }
    let mut completed = BTreeSet::new();
    let mut steps = vec![];
    while completed.len() < reachable.len() {
        let next = reachable
            .iter()
            .find(|id| {
                !completed.contains(*id)
                    && dependencies[*id].iter().all(|dep| completed.contains(dep))
            })
            .cloned();
        let Some(id) = next else {
            return fail("Run contains a cycle; remove feedback connections");
        };
        steps.push(compile_step(space, &id, dependencies[&id].clone())?);
        completed.insert(id);
    }
    Ok(RunPlan {
        space_id: space.id.clone(),
        start_node_id: start_node_id.into(),
        steps,
    })
}
/// Compiles only the selected Agent's task, intentionally ignoring message edges.
/// Workflow execution should use compile_run instead. Resources/config snapshots match.
pub fn compile_agent(space: &Space, node_id: &str) -> Result<RunPlan> {
    space.validate()?;
    Ok(RunPlan {
        space_id: space.id.clone(),
        start_node_id: node_id.into(),
        steps: vec![compile_step(space, node_id, vec![])?],
    })
}
fn compile_step(space: &Space, id: &str, dependencies: Vec<String>) -> Result<RunStep> {
    let graph = &space.layout.graph;
    let node = graph
        .node(id)
        .filter(|n| n.kind == NodeKind::Agent)
        .ok_or_else(|| ProductError("Run start must be an existing Agent".into()))?;
    let config = &space.agents[id];
    if config.model.trim().is_empty() {
        return fail(format!("Agent {} needs a model ID", node.title));
    }
    let provider = config
        .provider_id
        .as_ref()
        .and_then(|id| space.providers.iter().find(|p| p.id == *id))
        .ok_or_else(|| ProductError(format!("Agent {} needs a model connection", node.title)))?;
    let mut resources = vec![];
    for edge in graph
        .connections()
        .iter()
        .filter(|e| e.target == id && matches!(e.source_port, Port::Context | Port::Memory))
    {
        resources.push(resource_snapshot(space, &edge.source));
    }
    for skill in &config.skill_ids {
        resources.push(resource_snapshot(space, skill));
    }
    Ok(RunStep {
        node_id: id.into(),
        session_id: node
            .session
            .clone()
            .ok_or_else(|| ProductError("Agent has no Session".into()))?,
        config: config.clone(),
        provider: provider.clone(),
        dependencies,
        resources,
    })
}
fn resource_snapshot(space: &Space, id: &str) -> ReferenceSnapshot {
    let r = &space.resources[id];
    ReferenceSnapshot {
        space_id: space.id.clone(),
        session_id: space.layout.graph.node(id).and_then(|n| n.session.clone()),
        agent_id: None,
        task_id: None,
        turn_id: None,
        run_id: None,
        resource_id: Some(id.into()),
        resource_kind: Some(r.kind),
        destination_task_id: None,
        title: r.title.clone(),
        revision: Some(r.revision),
        content: r.content.clone(),
    }
}
/// Prepares a manual transfer for a destination Task's next Turn.references.
/// Does not create a turn or execute a run; runtime explicitly queues that action.
pub fn snapshot_transfer(
    source: &Task,
    turn_id: &str,
    destination: &Task,
) -> Result<ReferenceSnapshot> {
    source.validate()?;
    destination.validate()?;
    let turn = source
        .turns
        .iter()
        .find(|t| t.id == turn_id)
        .ok_or_else(|| ProductError("Select an existing source answer".into()))?;
    if turn.status != TurnStatus::Succeeded {
        return fail("Only a successful answer can be transferred");
    }
    Ok(ReferenceSnapshot {
        space_id: source.space_id.clone(),
        session_id: Some(source.session_id.clone()),
        agent_id: Some(source.agent_id.clone()),
        task_id: Some(source.id.clone()),
        turn_id: Some(turn.id.clone()),
        run_id: Some(turn.run_id.clone()),
        resource_id: None,
        resource_kind: None,
        destination_task_id: Some(destination.id.clone()),
        title: source.name.clone(),
        revision: None,
        content: turn
            .answer
            .clone()
            .ok_or_else(|| ProductError("Successful answer is missing".into()))?,
    })
}
