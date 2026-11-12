use crate::{
    canvas::Desktop,
    cards::{kind_name, port_name, session_title},
};
use agentdeck_canvas_core::{Edit, NodeKind, Point as WorldPoint};
use agentdeck_desktop::interaction::{input_port, output_port};
use gpui_kit::{base::Disableable, prelude::FluentBuilder};
use gpui_kit::{
    component::{
        ActiveTheme, IconName, Sizable, Theme, ThemeMode,
        button::{Button, ButtonVariants},
        form::Field,
        input::{Input, Textarea},
        tab::{Tab, TabBar},
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
                .flex()
                .items_center()
                .gap_3()
                .text_size(px(15.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(
                    Button::new("toggle-directory")
                        .small()
                        .ghost()
                        .icon(IconName::PanelLeft)
                        .accessibility_label("切换工作区目录")
                        .tooltip("显示 / 隐藏工作区目录")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.show_directory = !this.show_directory;
                            cx.notify();
                        })),
                )
                .child("AgentDeck"),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    Button::new("toggle-inspector")
                        .small()
                        .ghost()
                        .icon(IconName::PanelRight)
                        .accessibility_label("切换节点详情")
                        .tooltip("显示 / 隐藏节点详情")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.show_inspector = !this.show_inspector;
                            cx.notify();
                        })),
                )
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InspectorTab {
    Edit,
    Connections,
    Result,
}

pub fn inspector(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    let panel = div()
        .id("inspector")
        .w(px(288.0))
        .flex_none()
        .h_full()
        .flex()
        .flex_col()
        .border_l_1()
        .border_color(cx.theme().border);
    let Some(node) = this
        .inspector_id
        .as_ref()
        .and_then(|id| this.state.editor.graph().node(id))
    else {
        return panel.child(
            div()
                .p_4()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("节点详情"),
                )
                .child(
                    div()
                        .text_color(cx.theme().muted_foreground)
                        .child("选择卡片，查看配置、连接与结果。双击卡片可编辑。"),
                ),
        );
    };
    let heading = div()
        .p_4()
        .pb_2()
        .flex_none()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .text_size(px(18.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_ellipsis()
                .child(node.title.clone()),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child(format!(
                    "{} · {}",
                    kind_name(node.kind),
                    node.session
                        .as_deref()
                        .map(session_title)
                        .unwrap_or_else(|| "工作区资源".into())
                )),
        );
    let tabs = TabBar::new("node-tabs")
        .underline()
        .small()
        .selected_index(match this.inspector_tab {
            InspectorTab::Edit => 0,
            InspectorTab::Connections => 1,
            InspectorTab::Result => 2,
        })
        .child(Tab::new().label("编辑"))
        .child(Tab::new().label("连接"))
        .child(Tab::new().label("结果"))
        .on_click(cx.listener(|this, index: &usize, _, cx| {
            this.inspector_tab = match index {
                1 => InspectorTab::Connections,
                2 => InspectorTab::Result,
                _ => InspectorTab::Edit,
            };
            cx.notify();
        }));
    let mut content = div()
        .id("inspector-content")
        .flex_1()
        .min_h_0()
        .overflow_y_scroll()
        .p_4()
        .flex()
        .flex_col()
        .gap_4();
    match this.inspector_tab {
        InspectorTab::Edit => {
            content = content
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
                        .child("切换节点会保留草稿。点击顶部保存，写入本机布局。"),
                );
        }
        InspectorTab::Connections => {
            let source = node.id.clone();
            let output = output_port(node.kind);
            content = content.child(
                Button::new("start-wire")
                    .rounded_full()
                    .icon(IconName::Plus)
                    .label(format!("从{}连线", port_name(output)))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.state.start_wire(&source, output);
                        this.focus.focus(window, cx);
                        this.notice = format!(
                            "{} → {}输入；选择目标卡片或从目录打开目标，Esc 取消。",
                            port_name(output),
                            port_name(input_port(output))
                        );
                        cx.notify();
                    })),
            );
            if let Some(wire) = &this.state.wire {
                if node.kind == NodeKind::Agent && wire.source != node.id {
                    let port = input_port(wire.port);
                    let target = node.id.clone();
                    content = content.child(
                        Button::new("connect-target")
                            .rounded_full()
                            .primary()
                            .label(format!("接入{}输入", port_name(port)))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.finish_wire(&target, port, cx);
                                this.focus.focus(window, cx);
                            })),
                    );
                }
                content = content.child(
                    div()
                        .text_size(px(11.0))
                        .text_color(cx.theme().muted_foreground)
                        .child("连线中 · 选择目标输入，或按 Esc 取消。"),
                );
            }
            let graph = this.state.editor.graph();
            let edges: Vec<_> = graph
                .connections()
                .iter()
                .filter(|e| e.source == node.id || e.target == node.id)
                .collect();
            if edges.is_empty() {
                content = content.child(
                    div()
                        .text_color(cx.theme().muted_foreground)
                        .child("尚无连接。从卡片输出端口拖到目标输入，也可以使用上方按钮。"),
                );
            }
            for edge in edges {
                let incoming = edge.target == node.id;
                let other = if incoming { &edge.source } else { &edge.target };
                let title = graph.node(other).map(|n| n.title.as_str()).unwrap_or(other);
                let label = format!(
                    "{} · {} → {}",
                    if incoming { "接收" } else { "发送" },
                    port_name(edge.source_port),
                    port_name(edge.target_port)
                );
                let id = edge.id.clone();
                let remove_id = id.clone();
                content = content.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .pb_3()
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(cx.theme().muted_foreground)
                                .child(label),
                        )
                        .child(div().text_ellipsis().child(title.to_owned()))
                        .child(
                            div()
                                .flex()
                                .gap_2()
                                .child(
                                    Button::new(SharedString::from(format!("rewire-{id}")))
                                        .small()
                                        .rounded_full()
                                        .label("重连")
                                        .accessibility_label(format!("重连与{title}的连接"))
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            if this.state.start_rewire(&id).is_ok() {
                                                this.focus.focus(window, cx);
                                                this.notice =
                                                    "选择新的目标；取消或连接失败会保留原连线。"
                                                        .into();
                                            }
                                            cx.notify();
                                        })),
                                )
                                .child(
                                    Button::new(SharedString::from(format!("remove-{remove_id}")))
                                        .small()
                                        .ghost()
                                        .rounded_full()
                                        .label("断开")
                                        .accessibility_label(format!("断开与{title}的连接"))
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            let _ = this
                                                .state
                                                .editor
                                                .apply(Edit::RemoveConnection(remove_id.clone()));
                                            this.focus.focus(window, cx);
                                            this.notice = "连接已断开 · ⌘Z 可撤销".into();
                                            cx.notify();
                                        })),
                                ),
                        ),
                );
            }
        }
        InspectorTab::Result => {
            content = content.child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("演示运行结果"),
            );
            if let Some(execution) = this.service.node(&node.id) {
                content =
                    content.child(div().text_color(cx.theme().muted_foreground).child(format!(
                        "{}{}",
                        crate::execution::state_label(execution.state),
                        if this.service.online {
                            ""
                        } else {
                            " · 服务离线，显示上次状态"
                        }
                    )));
                let result = execution
                    .result
                    .clone()
                    .unwrap_or_else(|| match execution.state {
                        agentdeck_runtime::protocol::NodeState::Queued => {
                            "等待上游节点完成。".into()
                        }
                        agentdeck_runtime::protocol::NodeState::Running => {
                            "正在处理，完成后结果会显示在这里。".into()
                        }
                        agentdeck_runtime::protocol::NodeState::Cancelled => {
                            "运行已停止，尚未生成结果。".into()
                        }
                        agentdeck_runtime::protocol::NodeState::Succeeded => {
                            "运行已完成，无文本结果。".into()
                        }
                    });
                content = content.child(
                    div()
                        .id("node-demo-result")
                        .role(Role::Group)
                        .aria_label(format!("演示结果：{result}"))
                        .p_3()
                        .rounded(px(12.0))
                        .bg(cx.theme().secondary)
                        .child(result),
                );
            } else {
                content = content.child(div().text_color(cx.theme().muted_foreground).child(
                    if node.kind == NodeKind::Agent {
                        "尚无结果。选择起始 Agent，在画布下方运行节点链。"
                    } else {
                        "这是工作区资源节点，不单独执行任务。"
                    },
                ));
            }
            content = content.child(
                div()
                    .text_size(px(11.0))
                    .text_color(cx.theme().muted_foreground)
                    .child("当前为本机流程演示，不调用模型。"),
            );
        }
    }
    panel.child(heading).child(tabs).child(content)
}

pub fn status(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    let message = format!(
        "{}{}",
        if this.has_unsaved(cx) {
            "未保存 · "
        } else {
            ""
        },
        this.notice
    );
    div()
        .min_h(px(28.0))
        .flex_none()
        .px_4()
        .py_1()
        .flex()
        .items_center()
        .justify_between()
        .gap_3()
        .border_t_1()
        .border_color(cx.theme().border)
        .child(
            div()
                .id("canvas-status")
                .role(Role::Status)
                .aria_label(message.clone())
                .text_size(px(11.0))
                .text_color(cx.theme().muted_foreground)
                .child(message),
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
