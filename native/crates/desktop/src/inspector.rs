use crate::{
    canvas::Desktop,
    cards::{kind_name, port_name, session_title},
};
use agentdeck_canvas_core::{Edit, NodeKind, Point as WorldPoint, Port};
use agentdeck_desktop::interaction::output_port;
use gpui_kit::{base::Disableable, prelude::FluentBuilder};
use gpui_kit::{
    component::{
        ActiveTheme, Sizable, Theme, ThemeMode,
        button::{Button, ButtonVariants},
        form::Field,
        input::{Input, Textarea},
    },
    *,
};

pub fn toolbar(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    div()
        .h(px(48.0))
        .flex_none()
        .px_4()
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(
            div()
                .text_size(px(15.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child("AgentDeck"),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    Button::new("fit")
                        .small()
                        .rounded_full()
                        .label("适应画布")
                        .on_click(cx.listener(|this, _, _, cx| this.fit(None, cx))),
                )
                .child(
                    Button::new("zoom-out")
                        .small()
                        .rounded_full()
                        .label("缩小")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.zoom(
                                0.8,
                                WorldPoint {
                                    x: f32::from(this.bounds.size.width) / 2.0,
                                    y: f32::from(this.bounds.size.height) / 2.0,
                                },
                                cx,
                            )
                        })),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .child(format!("{:.0}%", this.state.viewport.zoom() * 100.0)),
                )
                .child(
                    Button::new("zoom-in")
                        .small()
                        .rounded_full()
                        .label("放大")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.zoom(
                                1.25,
                                WorldPoint {
                                    x: f32::from(this.bounds.size.width) / 2.0,
                                    y: f32::from(this.bounds.size.height) / 2.0,
                                },
                                cx,
                            )
                        })),
                )
                .child(
                    Button::new("theme")
                        .small()
                        .rounded_full()
                        .label(if cx.theme().is_dark() {
                            "浅色"
                        } else {
                            "深色"
                        })
                        .on_click(|_, window, cx| {
                            let dark = !cx.theme().is_dark();
                            Theme::change(
                                if dark {
                                    ThemeMode::Dark
                                } else {
                                    ThemeMode::Light
                                },
                                Some(window),
                                cx,
                            );
                            cx.set_window_appearance(Some(if dark {
                                WindowAppearance::Dark
                            } else {
                                WindowAppearance::Light
                            }));
                        }),
                )
                .child(
                    Button::new("save")
                        .small()
                        .rounded_full()
                        .primary()
                        .disabled(this.saving || this.storage_error)
                        .label(if this.saving {
                            "保存中…"
                        } else {
                            "保存"
                        })
                        .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                ),
        )
}

pub fn inspector(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    let mut panel = div()
        .id("inspector")
        .w(px(288.0))
        .flex_none()
        .h_full()
        .overflow_y_scroll()
        .p_4()
        .flex()
        .flex_col()
        .gap_4()
        .border_l_1()
        .border_color(cx.theme().border);
    let Some(node) = this
        .inspector_id
        .as_ref()
        .and_then(|id| this.state.editor.graph().node(id))
    else {
        return panel
            .child(div().text_size(px(18.0)).child("节点编辑"))
            .child(
                div()
                    .text_color(cx.theme().muted_foreground)
                    .child("选择画布上的节点，或从左侧列表打开。双击卡片可直接编辑名称。"),
            );
    };
    panel = panel
        .child(div().text_size(px(18.0)).child("节点编辑"))
        .child(div().text_color(cx.theme().muted_foreground).child(format!(
                "{} · {}",
                kind_name(node.kind),
                node.session
                    .as_deref()
                    .map(session_title)
                    .unwrap_or_else(|| "工作区资源".into())
            )))
        .child(
            Field::new()
                .flex_none()
                .label("名称")
                .child(Input::new(&this.title).aria_label("节点名称")),
        )
        .child(
            Field::new().flex_none().label("节点说明").child(
                Textarea::new(&this.description)
                    .h(px(112.0))
                    .aria_label("节点说明"),
            ),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child("修改保留在草稿中；点击顶部保存后写入本机布局。"),
        );
    let source = node.id.clone();
    let output = output_port(node.kind);
    panel = panel.child(
        Button::new("start-wire")
            .rounded_full()
            .label(format!("从{}输出连线", port_name(output)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.state.start_wire(&source, output);
                this.notice = "选择目标节点，再选择接入端口。".into();
                cx.notify();
            })),
    );
    if node.kind == NodeKind::Agent && this.state.wire.is_some() {
        for port in [Port::Message, Port::Context, Port::Memory, Port::Trigger] {
            let target = node.id.clone();
            panel = panel.child(
                Button::new(SharedString::from(format!("connect-{}", port_name(port))))
                    .rounded_full()
                    .label(format!("接入{}端口", port_name(port)))
                    .on_click(
                        cx.listener(move |this, _, _, cx| this.finish_wire(&target, port, cx)),
                    ),
            );
        }
    }
    let edges: Vec<_> = this
        .state
        .editor
        .graph()
        .connections()
        .iter()
        .filter(|e| e.source == node.id || e.target == node.id)
        .collect();
    if !edges.is_empty() {
        panel = panel.child(div().mt_2().font_weight(FontWeight::SEMIBOLD).child("连接"));
    }
    for edge in edges {
        let label = format!(
            "{} → {} · {}",
            this.state
                .editor
                .graph()
                .node(&edge.source)
                .map(|n| n.title.as_str())
                .unwrap_or(""),
            this.state
                .editor
                .graph()
                .node(&edge.target)
                .map(|n| n.title.as_str())
                .unwrap_or(""),
            port_name(edge.source_port)
        );
        let id = edge.id.clone();
        let remove_id = id.clone();
        panel = panel.child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(px(11.0)).child(label))
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(
                            Button::new(SharedString::from(format!("rewire-{id}")))
                                .small()
                                .rounded_full()
                                .label("重连")
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if this.state.start_rewire(&id).is_ok() {
                                        this.notice =
                                            "选择新的目标；取消或连接失败会保留原连线。".into();
                                    }
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new(SharedString::from(format!("remove-{remove_id}")))
                                .small()
                                .rounded_full()
                                .label("断开")
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let _ = this
                                        .state
                                        .editor
                                        .apply(Edit::RemoveConnection(remove_id.clone()));
                                    cx.notify();
                                })),
                        ),
                ),
        );
    }
    panel
}

pub fn status(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    div()
        .min_h(px(40.0))
        .flex_none()
        .px_4()
        .py_2()
        .flex()
        .items_center()
        .justify_between()
        .gap_3()
        .border_t_1()
        .border_color(cx.theme().border)
        .child(
            div()
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child(format!(
                    "{}{}",
                    if this.has_unsaved(cx) {
                        "未保存 · "
                    } else {
                        ""
                    },
                    this.notice
                )),
        )
        .when(this.closing, |el| {
            el.child(
                Button::new("discard-quit")
                    .small()
                    .rounded_full()
                    .disabled(this.saving)
                    .label("不保存退出")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.discard_on_exit = true;
                        cx.quit();
                    })),
            )
        })
}
