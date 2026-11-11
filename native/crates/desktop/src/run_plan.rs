use agentdeck_canvas_core::{Graph, NodeKind, Port};
pub struct Plan {
    pub session_id: String,
    pub node_ids: Vec<String>,
}
/// Stage-one smoke runs support a single message chain. Resource edges are not
/// execution dependencies. Branch/Join execution belongs to the full runtime.
pub fn compile(graph: &Graph, start: &str) -> Result<Plan, &'static str> {
    let node = graph
        .node(start)
        .filter(|n| n.kind == NodeKind::Agent)
        .ok_or("请选择一个 Agent 节点")?;
    let session_id = node.session.clone().ok_or("Agent 缺少所属会话")?;
    let mut plan = Plan {
        session_id,
        node_ids: vec![start.to_owned()],
    };
    loop {
        let current = plan.node_ids.last().unwrap();
        let edges: Vec<_> = graph
            .connections()
            .iter()
            .filter(|e| &e.source == current && e.source_port == Port::Result)
            .collect();
        if edges.len() > 1 {
            return Err("原生演示目前只支持单条节点链；分支执行将在后续阶段接入");
        }
        let Some(edge) = edges.first() else {
            break;
        };
        if plan.node_ids.contains(&edge.target) || plan.node_ids.len() >= 64 {
            return Err("演示节点链超出支持范围");
        }
        plan.node_ids.push(edge.target.clone());
    }
    Ok(plan)
}
