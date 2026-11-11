use crate::{canvas::Desktop, theme};
use agentdeck_canvas_core::{Node, NodeKind, Point as WorldPoint, Port};
use agentdeck_desktop::interaction::{CARD_WIDTH, input_port, node_height, output_port};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::{component::ActiveTheme, *};
use std::collections::BTreeMap;

pub fn port_name(port: Port) -> &'static str {
    match port {
        Port::Message => "消息",
        Port::Result => "结果",
        Port::Context => "Context",
        Port::Memory => "记忆",
        Port::Trigger => "触发",
    }
}
pub fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Agent => "Agent",
        NodeKind::Context => "Context",
        NodeKind::Memory => "记忆",
        NodeKind::Automation => "自动化",
    }
}
fn port_y(port: Port) -> f32 {
    match port {
        Port::Message | Port::Result => 64.0,
        Port::Context => 100.0,
        Port::Memory => 136.0,
        Port::Trigger => 172.0,
    }
}
fn anchor(this: &Desktop, node: &Node, port: Port, output: bool) -> WorldPoint {
    let p = this.state.position(&node.id).unwrap_or(node.position);
    this.state.viewport.world_to_screen(WorldPoint {
        x: p.x + if output { CARD_WIDTH } else { 0.0 },
        y: p.y
            + if node.kind == NodeKind::Agent {
                port_y(port)
            } else {
                56.0
            },
    })
}

pub fn scene(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    let zoom = this.state.viewport.zoom();
    let mut regions: BTreeMap<String, (f32, f32, f32, f32)> = BTreeMap::new();
    for node in this.state.editor.graph().nodes() {
        if let Some(session) = &node.session {
            let p = this.state.position(&node.id).unwrap();
            let rect = regions.entry(session.clone()).or_insert((
                p.x,
                p.y,
                p.x + CARD_WIDTH,
                p.y + node_height(node.kind),
            ));
            rect.0 = rect.0.min(p.x);
            rect.1 = rect.1.min(p.y);
            rect.2 = rect.2.max(p.x + CARD_WIDTH);
            rect.3 = rect.3.max(p.y + node_height(node.kind));
        }
    }
    let mut layer = div().absolute().size_full();
    for (session, rect) in regions {
        let p = this.state.viewport.world_to_screen(WorldPoint {
            x: rect.0 - 32.0,
            y: rect.1 - 56.0,
        });
        layer = layer.child(
            div()
                .absolute()
                .left(px(p.x))
                .top(px(p.y))
                .w(px((rect.2 - rect.0 + 64.0) * zoom))
                .h(px((rect.3 - rect.1 + 88.0) * zoom))
                .rounded(px(16.0 * zoom))
                .border_1()
                .border_color(cx.theme().border)
                .bg(cx.theme().background.opacity(0.65))
                .child(
                    div()
                        .px(px(16.0 * zoom))
                        .py(px(10.0 * zoom))
                        .text_size(px(13.0 * zoom.max(0.8)))
                        .text_color(cx.theme().muted_foreground)
                        .child(session_title(&session)),
                ),
        );
    }
    let mut edges = Vec::new();
    for edge in this.state.editor.graph().connections() {
        if let (Some(source), Some(target)) = (
            this.state.editor.graph().node(&edge.source),
            this.state.editor.graph().node(&edge.target),
        ) {
            edges.push((
                anchor(this, source, edge.source_port, true),
                anchor(this, target, edge.target_port, false),
                if edge.source_port == Port::Result && edge.target_port == Port::Message {
                    this.service.edge_state(&edge.source, &edge.target)
                } else {
                    None
                },
            ));
        }
    }
    if let Some(wire) = &this.state.wire
        && let Some(source) = this.state.editor.graph().node(&wire.source)
    {
        edges.push((
            anchor(this, source, wire.port, true),
            this.pointer,
            Some(agentdeck_runtime::protocol::NodeState::Running),
        ));
    }
    let edge_color = cx.theme().foreground.opacity(0.65);
    let active_color = cx.theme().info_foreground;
    let completed_color = cx.theme().success_foreground;
    layer = layer.child(
        canvas(
            |_, _, _| (),
            move |bounds, _, window, _| {
                for (a, b, state) in edges {
                    let active =
                        matches!(state, Some(agentdeck_runtime::protocol::NodeState::Running));
                    let color = match state {
                        Some(agentdeck_runtime::protocol::NodeState::Running) => active_color,
                        Some(agentdeck_runtime::protocol::NodeState::Succeeded) => completed_color,
                        _ => edge_color,
                    };
                    let origin = bounds.origin;
                    let start = point(px(a.x), px(a.y)) + origin;
                    let end = point(px(b.x), px(b.y)) + origin;
                    let bend = px(((b.x - a.x).abs() * 0.45).clamp(48.0, 180.0));
                    let mut path = PathBuilder::stroke(px(if active { 2.5 } else { 1.75 }));
                    path.move_to(start);
                    path.cubic_bezier_to(
                        end,
                        start + point(bend, px(0.0)),
                        end - point(bend, px(0.0)),
                    );
                    if let Ok(path) = path.build() {
                        window.paint_path(path, color);
                    }
                    let tip = end - point(px(14.0), px(0.0));
                    let mut arrow = PathBuilder::stroke(px(1.75));
                    arrow.move_to(tip - point(px(6.0), px(4.0)));
                    arrow.line_to(tip);
                    arrow.line_to(tip - point(px(6.0), px(-4.0)));
                    if let Ok(path) = arrow.build() {
                        window.paint_path(path, color);
                    }
                }
            },
        )
        .absolute()
        .size_full(),
    );
    for node in this.state.editor.graph().nodes() {
        let p = this
            .state
            .viewport
            .world_to_screen(this.state.position(&node.id).unwrap());
        let size = this.bounds.size;
        if size.width > px(0.0)
            && (p.x + CARD_WIDTH * zoom < -24.0
                || p.y + node_height(node.kind) * zoom < -24.0
                || p.x > f32::from(size.width) + 24.0
                || p.y > f32::from(size.height) + 24.0)
        {
            continue;
        }
        layer = layer.child(card(this, node, p, cx));
    }
    layer
}

pub fn session_title(id: &str) -> String {
    format!("会话 {}", id.strip_prefix("session-").unwrap_or(id))
}

fn card(
    this: &Desktop,
    node: &Node,
    position: WorldPoint,
    cx: &mut Context<Desktop>,
) -> impl IntoElement + use<> {
    let zoom = this.state.viewport.zoom();
    let id = node.id.clone();
    let material = theme::material(node.kind);
    let selected = this.state.selected.contains(&node.id);
    let height = node_height(node.kind);
    let artwork = match node.kind {
        NodeKind::Agent => "cards/guardian.webp",
        NodeKind::Automation => "cards/dragon.webp",
        _ => "cards/archive.webp",
    };
    let image = div()
        .relative()
        .size_full()
        .rounded(px(12.0 * zoom))
        .overflow_hidden()
        .bg(material.paper)
        .child(img(artwork).size_full().object_fit(ObjectFit::Cover))
        .child(
            div()
                .absolute()
                .bottom_0()
                .w_full()
                .p(px(12.0 * zoom))
                .bg(material.paper.opacity(0.88))
                .text_color(material.ink)
                .child(
                    div()
                        .text_size(px(11.0 * zoom.max(0.8)))
                        .child(kind_name(node.kind)),
                )
                .child(
                    div()
                        .font_family("Songti SC")
                        .text_size(px(if node.kind == NodeKind::Agent {
                            20.0
                        } else {
                            16.0
                        } * zoom))
                        .text_ellipsis()
                        .child(node.title.clone()),
                )
                .when(zoom > 0.65, |el| {
                    el.child(div().text_size(px(11.0 * zoom)).text_ellipsis().child(
                        if node.description.is_empty() {
                            "双击编辑".into()
                        } else {
                            node.description.clone()
                        },
                    ))
                }),
        );
    let mut card = div()
        .id(SharedString::from(format!("node-{}", node.id)))
        .absolute()
        .left(px(position.x))
        .top(px(position.y))
        .w(px(CARD_WIDTH * zoom))
        .h(px(height * zoom))
        .rounded(px(16.0 * zoom))
        .p(px(3.0 * zoom))
        .border(px(if selected { 2.0 } else { 1.0 }))
        .border_color(if selected {
            cx.theme().primary
        } else {
            material.edge
        })
        .bg(material.edge)
        .cursor_pointer()
        .role(Role::Group)
        .aria_label(format!(
            "{}，{}{}",
            kind_name(node.kind),
            node.title,
            if selected { "，已选中" } else { "" }
        ))
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                this.focus.focus(window, cx);
                if this.space_down {
                    this.state.begin_pan(this.local(event.position));
                } else {
                    this.state.select(&id, event.modifiers.shift);
                    this.inspect(&id, window, cx);
                    this.state.begin_move(
                        this.state
                            .viewport
                            .screen_to_world(this.local(event.position)),
                    );
                    if event.click_count == 2 {
                        this.show_inspector = true;
                        this.inspector_tab = crate::inspector::InspectorTab::Edit;
                        this.title.update(cx, |state, cx| state.focus(window, cx));
                    }
                }
                cx.stop_propagation();
                cx.notify();
            }),
        )
        .child(image);
    if let Some(execution) = this.service.node(&node.id) {
        let (fill, ink) = crate::execution::state_colors(execution.state, cx);
        card = card.child(
            div()
                .absolute()
                .top(px(8.))
                .left(px(8.))
                .px_2()
                .py_1()
                .rounded_full()
                .text_size(px(11.))
                .bg(fill)
                .text_color(ink)
                .id(SharedString::from(format!("run-state-{}", node.id)))
                .role(Role::Status)
                .aria_label(format!(
                    "{}：{}",
                    node.title,
                    crate::execution::state_label(execution.state)
                ))
                .child(crate::execution::state_label(execution.state)),
        );
    }
    let output = output_port(node.kind);
    card = card.child(port(this, node, output, true, cx));
    if node.kind == NodeKind::Agent {
        for input in [Port::Message, Port::Context, Port::Memory, Port::Trigger] {
            if zoom >= 0.7
                || input == Port::Message
                || this
                    .state
                    .wire
                    .as_ref()
                    .is_some_and(|w| input_port(w.port) == input)
                || this
                    .state
                    .editor
                    .graph()
                    .connections()
                    .iter()
                    .any(|e| e.target == node.id && e.target_port == input)
            {
                card = card.child(port(this, node, input, false, cx));
            }
        }
    }
    card
}

fn port(
    this: &Desktop,
    node: &Node,
    port: Port,
    output: bool,
    cx: &mut Context<Desktop>,
) -> impl IntoElement + use<> {
    let zoom = this.state.viewport.zoom();
    let id = node.id.clone();
    let release_id = id.clone();
    let compatible = !output
        && this
            .state
            .wire
            .as_ref()
            .is_some_and(|wire| wire.source != node.id && input_port(wire.port) == port);
    let show_label = compatible || (zoom >= 0.7 && this.state.selected.contains(&id));
    let y = if node.kind == NodeKind::Agent {
        port_y(port)
    } else {
        56.0
    };
    div()
        .id(SharedString::from(format!(
            "{}-{}-{}",
            id,
            port_name(port),
            output
        )))
        .absolute()
        .top(px(y * zoom - 12.0))
        .left(px(if output {
            CARD_WIDTH * zoom - 12.0
        } else {
            -12.0
        }))
        .size(px(24.0))
        .flex()
        .items_center()
        .justify_center()
        .cursor_crosshair()
        .role(Role::Group)
        .aria_label(format!(
            "{} {}{}端口",
            node.title,
            port_name(port),
            if output { "输出" } else { "输入" }
        ))
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                this.focus.focus(window, cx);
                this.pointer = this.local(event.position);
                if output {
                    this.state.start_wire_at(&id, port, this.pointer);
                    this.notice = format!(
                        "{} → {}输入；点击或拖动连接，Esc 取消",
                        port_name(port),
                        port_name(input_port(port))
                    );
                } else if this.state.wire.is_some() {
                    this.finish_wire(&id, port, cx);
                } else {
                    this.state.select(&id, false);
                    this.inspect(&id, window, cx);
                    this.notice =
                        format!("{}输入：先从来源节点的输出端口开始连线", port_name(port));
                }
                cx.stop_propagation();
                cx.notify();
            }),
        )
        .on_mouse_up(
            MouseButton::Left,
            cx.listener(move |this, _, _, cx| {
                if !output && this.state.wire.is_some() {
                    this.finish_wire(&release_id, port, cx);
                    cx.stop_propagation();
                }
            }),
        )
        .child(
            div()
                .size(px(10.0))
                .rounded_full()
                .border_2()
                .border_color(cx.theme().primary)
                .bg(if compatible {
                    cx.theme().primary
                } else {
                    cx.theme().background
                }),
        )
        .when(show_label, |el| {
            el.child(
                div()
                    .absolute()
                    .when(output, |el| el.right(px(28.0)))
                    .when(!output, |el| el.left(px(28.0)))
                    .px_1()
                    .rounded(px(4.0))
                    .text_size(px(11.0))
                    .whitespace_nowrap()
                    .bg(cx.theme().background)
                    .text_color(cx.theme().foreground)
                    .child(port_name(port)),
            )
        })
}
