use agentdeck_canvas_core::{Edit, Editor, Graph};
use std::collections::BTreeMap;

/// Only unsaved differences belong here. Entries for undoable deleted nodes
/// remain available, but do not block saving the visible graph.
#[derive(Default)]
pub struct Drafts(BTreeMap<String, (String, String)>);

impl Drafts {
    pub fn stash(&mut self, id: &str, title: String, description: String, graph: &Graph) {
        if graph
            .node(id)
            .is_some_and(|node| node.title == title && node.description == description)
        {
            self.0.remove(id);
        } else {
            self.0.insert(id.to_owned(), (title, description));
        }
    }
    pub fn get(&self, id: &str) -> Option<&(String, String)> {
        self.0.get(id)
    }
    pub fn is_dirty(&self, graph: &Graph) -> bool {
        self.0.iter().any(|(id, (title, description))| {
            graph
                .node(id)
                .is_some_and(|n| n.title != *title || n.description != *description)
        })
    }
    pub fn apply(&mut self, editor: &mut Editor) -> Result<(), &'static str> {
        if editor.graph().nodes().any(|node| {
            self.0
                .get(&node.id)
                .map(|(title, _)| title.as_str())
                .unwrap_or(&node.title)
                .trim()
                .is_empty()
        }) {
            return Err("节点名称不能为空；请补全名称后保存。");
        }
        self.overlay(editor);
        self.0.retain(|id, _| editor.graph().node(id).is_none());
        Ok(())
    }
    fn overlay(&self, editor: &mut Editor) {
        for (id, (title, description)) in &self.0 {
            if editor.graph().node(id).is_some() {
                editor
                    .apply(Edit::UpdateNode {
                        id: id.clone(),
                        title: title.clone(),
                        description: description.clone(),
                    })
                    .expect("existing node text update");
            }
        }
    }
}
