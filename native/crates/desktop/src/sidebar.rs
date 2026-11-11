use crate::{
    canvas::Desktop,
    cards::{kind_name, session_title},
};
use agentdeck_canvas_core::{Graph, NodeKind};
use gpui_kit::{
    component::{
        ActiveTheme,
        button::{Button, ButtonVariants},
    },
    *,
};
use std::collections::BTreeSet;

#[derive(PartialEq, Eq)]
pub struct SidebarNode {
    id: String,
    title: String,
    session: Option<String>,
}

/// A read-only directory projection. Canvas motion does not rebuild its controls.
pub struct Sidebar {
    owner: WeakEntity<Desktop>,
    pub nodes: Vec<SidebarNode>,
}

impl Sidebar {
    pub fn new(owner: WeakEntity<Desktop>) -> Self {
        Self {
            owner,
            nodes: Vec::new(),
        }
    }
    pub fn project(graph: &Graph) -> Vec<SidebarNode> {
        graph
            .nodes()
            .map(|node| SidebarNode {
                id: node.id.clone(),
                title: node.title.clone(),
                session: node.session.clone(),
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
impl Render for Sidebar {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let this = self;
        let sessions: BTreeSet<_> = this
            .nodes
            .iter()
            .filter_map(|n| n.session.clone())
            .collect();
        let mut list = div()
            .id("objects")
            .w(px(182.0))
            .flex_none()
            .h_full()
            .overflow_y_scroll()
            .p_3()
            .flex()
            .flex_col()
            .gap_2()
            .border_r_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_size(px(15.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .mb_2()
                    .child("工作区"),
            );
        for session in sessions {
            let target = session.clone();
            list = list.child(
                Button::new(SharedString::from(format!("session-{session}")))
                    .ghost()
                    .justify_start()
                    .w_full()
                    .label(session_title(&session))
                    .on_click(this.handle(move |this, _, _, cx| this.fit(Some(&target), cx))),
            );
            for node in this
                .nodes
                .iter()
                .filter(|n| n.session.as_ref() == Some(&session))
            {
                let id = node.id.clone();
                list = list.child(
                    Button::new(SharedString::from(format!("select-{id}")))
                        .ghost()
                        .justify_start()
                        .w_full()
                        .label(node.title.clone())
                        .on_click(this.handle(move |this, _, window, cx| {
                            this.state.selected.clear();
                            this.state.select(&id, false);
                            this.inspect(&id, window, cx);
                            cx.notify();
                        })),
                );
            }
        }
        list = list.child(
            div()
                .mt_4()
                .text_color(cx.theme().muted_foreground)
                .child("工作区资源"),
        );
        for node in this.nodes.iter().filter(|n| n.session.is_none()) {
            let id = node.id.clone();
            list = list.child(
                Button::new(SharedString::from(format!("select-{id}")))
                    .ghost()
                    .justify_start()
                    .w_full()
                    .label(node.title.clone())
                    .on_click(this.handle(move |this, _, window, cx| {
                        this.state.selected.clear();
                        this.state.select(&id, false);
                        this.inspect(&id, window, cx);
                        cx.notify();
                    })),
            );
        }
        list = list.child(
            div()
                .mt_4()
                .mb_2()
                .text_color(cx.theme().muted_foreground)
                .child("添加节点"),
        );
        for kind in [
            NodeKind::Agent,
            NodeKind::Context,
            NodeKind::Memory,
            NodeKind::Automation,
        ] {
            list = list.child(
                Button::new(SharedString::from(format!("add-{}", kind_name(kind))))
                    .ghost()
                    .justify_start()
                    .w_full()
                    .label(kind_name(kind))
                    .on_click(this.handle(move |this, _, window, cx| this.add(kind, window, cx))),
            );
        }
        list.child(
            div()
                .mt_4()
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child("滚动平移 · ⌘滚动缩放\n空格拖动画布\n⇧点击多选 · Esc 取消"),
        )
    }
}
