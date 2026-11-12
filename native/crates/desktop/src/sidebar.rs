use crate::{
    canvas::Desktop,
    cards::{kind_name, session_title},
};
use agentdeck_canvas_core::{Graph, NodeKind};
use gpui_kit::{
    base::Selectable,
    component::{
        ActiveTheme, Icon, IconName, Sizable,
        button::{Button, ButtonVariants},
    },
    prelude::FluentBuilder,
    *,
};
use std::collections::BTreeSet;

#[derive(PartialEq, Eq)]
pub struct SidebarNode {
    id: String,
    title: String,
    session: Option<String>,
    kind: NodeKind,
}

/// A read-only directory projection. Canvas motion does not rebuild its controls.
pub struct Sidebar {
    owner: WeakEntity<Desktop>,
    pub nodes: Vec<SidebarNode>,
    pub selected: Option<String>,
}

impl Sidebar {
    pub fn new(owner: WeakEntity<Desktop>) -> Self {
        Self {
            owner,
            nodes: Vec::new(),
            selected: None,
        }
    }
    pub fn project(graph: &Graph) -> Vec<SidebarNode> {
        graph
            .nodes()
            .map(|node| SidebarNode {
                id: node.id.clone(),
                title: node.title.clone(),
                session: node.session.clone(),
                kind: node.kind,
            })
            .collect()
    }
    fn handle<F>(&self, f: F) -> impl Fn(&ClickEvent, &mut Window, &mut App) + use<F>
    where
        F: Fn(&mut Desktop, &ClickEvent, &mut Window, &mut Context<Desktop>) + 'static,
    {
        let owner = self.owner.clone();
        move |event, window, cx| {
            let _ = owner.update(cx, |this, cx| f(this, event, window, cx));
        }
    }
}
fn icon(kind: NodeKind) -> IconName {
    match kind {
        NodeKind::Agent => IconName::Bot,
        NodeKind::Context => IconName::FileText,
        NodeKind::Memory => IconName::MemoryStick,
        NodeKind::Automation => IconName::Calendar,
    }
}

impl Sidebar {
    fn node_row(&self, node: &SidebarNode) -> Button {
        let id = node.id.clone();
        let selected = self.selected.as_ref() == Some(&id);
        Button::new(SharedString::from(format!("select-{id}")))
            .ghost()
            .w_full()
            .rounded_full()
            .selected(selected)
            .icon(icon(node.kind))
            .accessibility_label(format!(
                "{}，{}{}",
                kind_name(node.kind),
                node.title,
                if selected { "，已选中" } else { "" }
            ))
            .tooltip(node.title.clone())
            .child(
                div()
                    .w_full()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_ellipsis()
                            .child(node.title.clone()),
                    )
                    .when(selected, |el| el.child(Icon::new(IconName::Check).small())),
            )
            .on_click(self.handle(move |this, _, window, cx| {
                this.state.selected.clear();
                this.state.select(&id, false);
                this.show_inspector = true;
                this.inspect(&id, window, cx);
                this.focus.focus(window, cx);
                cx.notify();
            }))
    }
}
impl Render for Sidebar {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sessions: BTreeSet<_> = self
            .nodes
            .iter()
            .filter_map(|n| n.session.clone())
            .collect();
        let mut list = div()
            .id("objects")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px_2()
            .pb_3()
            .flex()
            .flex_col()
            .gap_1();
        for session in sessions {
            let target = session.clone();
            let count = self
                .nodes
                .iter()
                .filter(|n| n.session.as_ref() == Some(&session))
                .count();
            list = list.child(
                Button::new(SharedString::from(format!("session-{session}")))
                    .small()
                    .ghost()
                    .w_full()
                    .mt_3()
                    .icon(IconName::Folder)
                    .accessibility_label(format!("定位{}，{count} 个节点", session_title(&session)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .w_full()
                            .gap_2()
                            .child(
                                div()
                                    .min_w_0()
                                    .text_ellipsis()
                                    .child(session_title(&session)),
                            )
                            .child(
                                div()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(count.to_string()),
                            ),
                    )
                    .on_click(self.handle(move |this, _, _, cx| this.fit(Some(&target), cx))),
            );
            for node in self
                .nodes
                .iter()
                .filter(|n| n.session.as_ref() == Some(&session))
            {
                list = list.child(self.node_row(node));
            }
        }
        list = list.child(
            div()
                .mt_4()
                .mb_1()
                .px_2()
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child("工作区资源"),
        );
        for node in self.nodes.iter().filter(|n| n.session.is_none()) {
            list = list.child(self.node_row(node));
        }
        let mut add = div()
            .p_3()
            .flex()
            .flex_col()
            .gap_2()
            .border_t_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(cx.theme().muted_foreground)
                    .child("添加节点"),
            );
        for pair in [
            [NodeKind::Agent, NodeKind::Context],
            [NodeKind::Memory, NodeKind::Automation],
        ] {
            let mut row = div().flex().gap_1();
            for kind in pair {
                row = row.child(
                    Button::new(SharedString::from(format!("add-{}", kind_name(kind))))
                        .small()
                        .ghost()
                        .rounded_full()
                        .flex_1()
                        .label(kind_name(kind))
                        .accessibility_label(format!("添加{}节点", kind_name(kind)))
                        .on_click(self.handle(move |this, _, window, cx| {
                            this.show_inspector = true;
                            this.inspector_tab = crate::inspector::InspectorTab::Edit;
                            this.add(kind, window, cx);
                        })),
                );
            }
            add = add.child(row);
        }
        div()
            .w(px(182.0))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .border_r_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .px_4()
                    .pt_4()
                    .pb_1()
                    .text_size(px(15.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("工作区"),
            )
            .child(list)
            .child(add)
    }
}
