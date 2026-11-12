use crate::*;
use canvas_core::{Edit, Editor, Graph, Node, Point, Viewport};
use std::collections::BTreeSet;

impl Space {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: new_id(),
            name: name.into(),
            layout: Layout::new(Graph::default(), Viewport::default()),
            sessions: vec![],
            agents: BTreeMap::new(),
            resources: BTreeMap::new(),
            appearances: BTreeMap::new(),
            templates: vec![],
            providers: vec![],
            automations: vec![],
        }
    }
    /// Imports only the native preview layout, preserving all graph IDs and geometry.
    /// Missing configs stay unconfigured; resources start with the node description.
    pub fn from_layout(name: impl Into<String>, layout: Layout) -> Result<Self> {
        let mut space = Self::new(name);
        space.layout = layout;
        space.ensure_metadata()?;
        space.validate()?;
        Ok(space)
    }
    pub fn add_session(&mut self, name: impl Into<String>) -> String {
        let id = new_id();
        self.sessions.push(Session {
            id: id.clone(),
            name: name.into(),
        });
        id
    }
    pub fn add_agent(
        &mut self,
        session_id: &str,
        title: impl Into<String>,
        position: Point,
    ) -> Result<String> {
        if !self.sessions.iter().any(|s| s.id == session_id) {
            return fail("Choose an existing Session for the Agent");
        }
        let id = new_id();
        self.apply_edit(Edit::AddNode(Node {
            id: id.clone(),
            title: title.into(),
            description: String::new(),
            kind: NodeKind::Agent,
            session: Some(session_id.into()),
            position,
        }))?;
        Ok(id)
    }
    pub fn add_resource(
        &mut self,
        kind: ResourceKind,
        title: impl Into<String>,
        content: impl Into<String>,
        session_id: Option<&str>,
        position: Point,
    ) -> Result<String> {
        let id = new_id();
        let resource = Resource {
            id: id.clone(),
            title: title.into(),
            content: content.into(),
            kind,
            revision: 1,
        };
        let mut candidate = self.clone();
        if kind != ResourceKind::Skill {
            candidate.layout.graph.add_node(Node {
                id: id.clone(),
                title: resource.title.clone(),
                description: String::new(),
                kind: if kind == ResourceKind::Context {
                    NodeKind::Context
                } else {
                    NodeKind::Memory
                },
                session: session_id.map(str::to_owned),
                position,
            })?;
            candidate
                .appearances
                .insert(id.clone(), CardDesign::default());
        } else if session_id.is_some() {
            return fail(
                "Skills are workspace resources; use a Context or Memory for Session-scoped content",
            );
        }
        candidate.resources.insert(id.clone(), resource);
        candidate.validate()?;
        *self = candidate;
        Ok(id)
    }
    /// Transactional canvas editing and metadata reconciliation. History is external.
    /// Deleting an assigned Skill must be explicit; deleting graph nodes removes their definitions.
    pub fn apply_edit(&mut self, edit: Edit) -> Result<()> {
        let mut candidate = self.clone();
        let mut editor = Editor::new(candidate.layout.graph.clone());
        editor.apply(edit)?;
        candidate.layout.graph = editor.graph().clone();
        candidate.agents.retain(|id, _| {
            candidate
                .layout
                .graph
                .node(id)
                .is_some_and(|n| n.kind == NodeKind::Agent)
        });
        candidate.resources.retain(|id, r| {
            r.kind == ResourceKind::Skill || candidate.layout.graph.node(id).is_some()
        });
        candidate
            .appearances
            .retain(|id, _| candidate.layout.graph.node(id).is_some());
        candidate
            .automations
            .retain(|a| candidate.layout.graph.node(&a.node_id).is_some());
        candidate.ensure_metadata()?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }
    /// Fills metadata for imported/new graph nodes without changing their identity or layout.
    pub fn ensure_metadata(&mut self) -> Result<()> {
        // Validate layout itself even when supplied through public fields.
        Layout::from_json(&self.layout.to_json()?)?;
        for node in self.layout.graph.nodes() {
            if let Some(session) = &node.session
                && !self.sessions.iter().any(|s| s.id == *session)
            {
                self.sessions.push(Session {
                    id: session.clone(),
                    name: session.clone(),
                });
            }
            self.appearances.entry(node.id.clone()).or_default();
            match node.kind {
                NodeKind::Agent => {
                    self.agents.entry(node.id.clone()).or_default();
                }
                NodeKind::Context | NodeKind::Memory => {
                    self.resources
                        .entry(node.id.clone())
                        .or_insert_with(|| Resource {
                            id: node.id.clone(),
                            title: node.title.clone(),
                            content: node.description.clone(),
                            kind: if node.kind == NodeKind::Context {
                                ResourceKind::Context
                            } else {
                                ResourceKind::Memory
                            },
                            revision: 1,
                        });
                }
                NodeKind::Automation => {
                    if !self.automations.iter().any(|a| a.node_id == node.id) {
                        self.automations.push(Automation {
                            id: new_id(),
                            node_id: node.id.clone(),
                            name: node.title.clone(),
                            interval_minutes: 60,
                            enabled: false,
                            prompt: String::new(),
                            next_due_at_ms: None,
                        });
                    }
                }
            }
        }
        Ok(())
    }
    pub fn save_template(&mut self, node_id: &str, name: impl Into<String>) -> Result<String> {
        self.validate()?;
        let node = self
            .layout
            .graph
            .node(node_id)
            .ok_or_else(|| ProductError("Template source node does not exist".into()))?;
        let template = CardTemplate {
            id: new_id(),
            name: name.into(),
            kind: node.kind,
            design: self.appearances[node_id].clone(),
            agent: self.agents.get(node_id).cloned(),
            resource: self.resources.get(node_id).cloned(),
        };
        let id = template.id.clone();
        self.templates.push(template);
        Ok(id)
    }
    pub fn instantiate_template(
        &mut self,
        template_id: &str,
        session_id: &str,
        position: Point,
    ) -> Result<String> {
        self.validate()?;
        if !self.sessions.iter().any(|s| s.id == session_id) {
            return fail("Choose an existing Session for the template instance");
        }
        let template = self
            .templates
            .iter()
            .find(|t| t.id == template_id)
            .ok_or_else(|| ProductError("Card template does not exist".into()))?
            .clone();
        let mut candidate = self.clone();
        let id = new_id();
        candidate.layout.graph.add_node(Node {
            id: id.clone(),
            title: template.name,
            description: String::new(),
            kind: template.kind,
            session: Some(session_id.into()),
            position,
        })?;
        candidate.appearances.insert(id.clone(), template.design);
        if let Some(agent) = template.agent {
            candidate.agents.insert(id.clone(), agent);
        }
        if let Some(mut resource) = template.resource {
            resource.id = id.clone();
            candidate.resources.insert(id.clone(), resource);
        }
        candidate.ensure_metadata()?;
        candidate.validate()?;
        *self = candidate;
        Ok(id)
    }
    pub fn validate(&self) -> Result<()> {
        identity(&self.id)?;
        Layout::from_json(&self.layout.to_json()?)?;
        unique(self.sessions.iter().map(|s| s.id.as_str()))?;
        unique(self.providers.iter().map(|p| p.id.as_str()))?;
        unique(self.templates.iter().map(|t| t.id.as_str()))?;
        unique(self.automations.iter().map(|a| a.id.as_str()))?;
        unique(self.automations.iter().map(|a| a.node_id.as_str()))?;
        let sessions: BTreeSet<_> = self.sessions.iter().map(|s| s.id.as_str()).collect();
        for node in self.layout.graph.nodes() {
            if node
                .session
                .as_ref()
                .is_some_and(|s| !sessions.contains(s.as_str()))
            {
                return fail(format!("Node {} refers to a missing Session", node.id));
            }
            if !self.appearances.contains_key(&node.id) {
                return fail(format!("Node {} has no card design", node.id));
            }
            match node.kind {
                NodeKind::Agent if !self.agents.contains_key(&node.id) => {
                    return fail(format!("Agent {} has no configuration", node.id));
                }
                NodeKind::Context | NodeKind::Memory if !self.resources.contains_key(&node.id) => {
                    return fail(format!("Resource {} has no content", node.id));
                }
                NodeKind::Automation if !self.automations.iter().any(|a| a.node_id == node.id) => {
                    return fail(format!("Automation {} has no definition", node.id));
                }
                _ => {}
            }
        }
        for (id, config) in &self.agents {
            if !self
                .layout
                .graph
                .node(id)
                .is_some_and(|n| n.kind == NodeKind::Agent)
            {
                return fail(format!("Configuration {id} has no Agent node"));
            }
            self.validate_config(config)?;
        }
        for (id, resource) in &self.resources {
            identity(id)?;
            identity(&resource.id)?;
            if id != &resource.id || resource.revision == 0 {
                return fail(format!("Resource {id} has invalid identity/revision"));
            }
            let expected_kind = match resource.kind {
                ResourceKind::Context => Some(NodeKind::Context),
                ResourceKind::Memory => Some(NodeKind::Memory),
                ResourceKind::Skill => None,
            };
            if let Some(kind) = expected_kind {
                if !self.layout.graph.node(id).is_some_and(|n| n.kind == kind) {
                    return fail(format!("Resource {id} has no matching graph node"));
                }
            } else if self.layout.graph.node(id).is_some() {
                return fail("Skills must be off-canvas resources");
            }
        }
        for id in self.appearances.keys() {
            if self.layout.graph.node(id).is_none() {
                return fail(format!("Card design {id} has no graph node"));
            }
        }
        for template in &self.templates {
            match template.kind {
                NodeKind::Agent if template.agent.is_some() && template.resource.is_none() => {
                    self.validate_config(template.agent.as_ref().expect("checked"))?
                }
                NodeKind::Context | NodeKind::Memory
                    if template.agent.is_none()
                        && template.resource.as_ref().is_some_and(|r| {
                            r.revision > 0
                                && ((r.kind == ResourceKind::Context
                                    && template.kind == NodeKind::Context)
                                    || (r.kind == ResourceKind::Memory
                                        && template.kind == NodeKind::Memory))
                        }) =>
                {
                    identity(&template.resource.as_ref().expect("checked").id)?
                }
                NodeKind::Automation if template.agent.is_none() && template.resource.is_none() => {
                }
                _ => {
                    return fail(format!(
                        "Template {} does not match its node kind",
                        template.id
                    ));
                }
            }
        }
        for automation in &self.automations {
            if !self
                .layout
                .graph
                .node(&automation.node_id)
                .is_some_and(|n| n.kind == NodeKind::Automation)
            {
                return fail("Automation definition has no Trigger node");
            }
            if !(1..=525_600).contains(&automation.interval_minutes) {
                return fail("Automation interval must be between 1 minute and 1 year");
            }
            if automation.enabled
                && (automation.prompt.trim().is_empty()
                    || self
                        .layout
                        .graph
                        .connections()
                        .iter()
                        .filter(|e| e.source == automation.node_id)
                        .count()
                        != 1)
            {
                return fail(
                    "Enabled automation needs a prompt and exactly one Trigger connection to an Agent",
                );
            }
        }
        Ok(())
    }
    fn validate_config(&self, config: &AgentConfig) -> Result<()> {
        if let Some(provider) = &config.provider_id
            && !self.providers.iter().any(|p| p.id == *provider)
        {
            return fail(format!(
                "Missing model connection {provider}; choose an existing provider"
            ));
        }
        unique(config.skill_ids.iter().map(String::as_str))?;
        for skill in &config.skill_ids {
            if !self
                .resources
                .get(skill)
                .is_some_and(|r| r.kind == ResourceKind::Skill)
            {
                return fail(format!(
                    "Missing Skill {skill}; assign an existing Skill resource"
                ));
            }
        }
        Ok(())
    }
}
