use agentdeck_canvas_core::{Edit, Layout, NodeKind, Point as WorldPoint, Port, Viewport};
use agentdeck_desktop::{
    editing::Drafts,
    interaction::{CARD_WIDTH, CanvasState, node_height},
    persistence,
};
use gpui_kit::{
    component::{
        ActiveTheme,
        input::{InputState, TextareaState},
    },
    *,
};
use std::path::PathBuf;

actions!(canvas, [Undo, Redo, Save, Cancel, Delete, Fit, Quit]);

pub struct Desktop {
    pub state: CanvasState,
    pub service: crate::execution::ServiceView,
    pub focus: FocusHandle,
    sidebar: Entity<crate::sidebar::Sidebar>,
    pub bounds: Bounds<Pixels>,
    pub pointer: WorldPoint,
    pub space_down: bool,
    pub inspector_id: Option<String>,
    pub show_directory: bool,
    pub show_inspector: bool,
    pub inspector_tab: crate::inspector::InspectorTab,
    pub show_run_details: bool,
    pub title: Entity<InputState>,
    pub description: Entity<TextareaState>,
    pub drafts: Drafts,
    pub discard_on_exit: bool,
    pub notice: String,
    pub saving: bool,
    pub closing: bool,
    pub saved: Layout,
    pub storage_error: bool,
    path: Option<PathBuf>,
}

impl Desktop {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let path = persistence::default_path();
        let loaded = path
            .as_ref()
            .map_err(|e| e.to_string())
            .and_then(|p| persistence::load(p).map_err(|e| e.to_string()));
        let (state, notice, storage_error) = match loaded {
            Ok(Some(layout)) => (CanvasState::from_layout(layout), "布局已恢复".into(), false),
            Ok(None) => (
                CanvasState::demo(),
                "原生画布预览 · 布局保存在本机".into(),
                false,
            ),
            Err(e) => (
                CanvasState::demo(),
                format!("布局读取失败，已禁止覆盖原文件：{e}"),
                true,
            ),
        };
        let saved = state.layout();
        let termination_entity = cx.weak_entity();
        let mut termination_app = cx.to_async();
        crate::termination::install(move || {
            termination_entity
                .update(&mut termination_app, |this, cx| {
                    this.discard_on_exit || this.may_close(cx)
                })
                .unwrap_or(true)
        })
        .expect("Install native unsaved-change protection");
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |_, cx| {
            weak.update(cx, |this, cx| this.may_close(cx))
                .unwrap_or(true)
        });
        let focus = cx.focus_handle().tab_stop(true);
        focus.focus(window, cx);
        let owner = cx.weak_entity();
        let sidebar = cx.new(|_| crate::sidebar::Sidebar::new(owner));
        let service_owner = cx.weak_entity();
        cx.defer(move |cx| {
            let _ = service_owner.update(cx, |this, cx| this.connect_service(false, cx));
        });
        Self {
            service: crate::execution::ServiceView::default(),
            sidebar,
            saved,
            state,
            focus,
            bounds: Bounds::default(),
            pointer: WorldPoint::default(),
            space_down: false,
            inspector_id: None,
            show_directory: true,
            show_inspector: true,
            inspector_tab: crate::inspector::InspectorTab::Edit,
            show_run_details: false,
            title: cx.new(|cx| InputState::new(window, cx)),
            description: cx.new(|cx| TextareaState::new(window, cx)),
            drafts: Drafts::default(),
            discard_on_exit: false,
            notice,
            saving: false,
            closing: false,
            storage_error,
            path: path.ok(),
        }
    }

    pub fn local(&self, p: Point<Pixels>) -> WorldPoint {
        WorldPoint {
            x: f32::from(p.x - self.bounds.origin.x),
            y: f32::from(p.y - self.bounds.origin.y),
        }
    }

    pub fn stash(&mut self, cx: &App) {
        if let Some(id) = &self.inspector_id {
            self.drafts.stash(
                id,
                self.title.read(cx).value().to_string(),
                self.description.read(cx).value().to_string(),
                self.state.editor.graph(),
            );
        }
    }

    pub fn inspect(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.inspector_id.as_deref() == Some(id) {
            return;
        }
        self.stash(cx);
        let Some(node) = self.state.editor.graph().node(id) else {
            return;
        };
        let (title, description) = self
            .drafts
            .get(id)
            .cloned()
            .unwrap_or_else(|| (node.title.clone(), node.description.clone()));
        self.title
            .update(cx, |state, cx| state.set_value(title, window, cx));
        self.description
            .update(cx, |state, cx| state.set_value(description, window, cx));
        self.inspector_id = Some(id.to_owned());
    }

    pub fn has_unsaved(&self, cx: &App) -> bool {
        self.state.editor.graph() != &self.saved.graph
            || self.state.viewport != self.saved.viewport
            || self.drafts.is_dirty(self.state.editor.graph())
            || self
                .inspector_id
                .as_ref()
                .and_then(|id| self.state.editor.graph().node(id))
                .is_some_and(|n| {
                    n.title != self.title.read(cx).value().as_ref()
                        || n.description != self.description.read(cx).value().as_ref()
                })
    }

    pub fn may_close(&mut self, cx: &mut Context<Self>) -> bool {
        if self.saving || self.has_unsaved(cx) {
            self.closing = true;
            self.notice = "有未保存修改，请先保存，或选择不保存退出。".into();
            cx.notify();
            false
        } else {
            true
        }
    }

    pub fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.saving || self.storage_error {
            return;
        }
        self.stash(cx);
        if let Err(message) = self.drafts.apply(&mut self.state.editor) {
            self.notice = message.into();
            cx.notify();
            return;
        }
        let Some(path) = self.path.clone() else {
            return;
        };
        let layout = self.state.layout();
        let snapshot = layout.clone();
        self.saving = true;
        self.notice = "正在保存…".into();
        let task = cx
            .background_executor()
            .spawn(async move { persistence::save(&path, &layout) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                this.saving = false;
                match result {
                    Ok(()) => {
                        this.saved = snapshot;
                        this.notice = "布局和节点修改已保存".into();
                        this.closing = false;
                    }
                    Err(e) => this.notice = format!("保存失败：{e}；修改仍保留在窗口中。"),
                }
                cx.notify();
            });
        })
        .detach();
        let _ = window;
        cx.notify();
    }

    pub fn add(&mut self, kind: NodeKind, window: &mut Window, cx: &mut Context<Self>) {
        let session = self
            .inspector_id
            .as_ref()
            .and_then(|id| self.state.editor.graph().node(id))
            .and_then(|n| n.session.clone())
            .unwrap_or_else(|| "session-1".into());
        let point = self.state.viewport.screen_to_world(WorldPoint {
            x: f32::from(self.bounds.size.width) / 2.0 - CARD_WIDTH / 2.0,
            y: f32::from(self.bounds.size.height) / 2.0 - 80.0,
        });
        match self.state.add(kind, &session, point) {
            Ok(id) => self.inspect(&id, window, cx),
            Err(e) => self.notice = e.to_string(),
        }
        cx.notify();
    }

    pub fn fit(&mut self, only: Option<&str>, cx: &mut Context<Self>) {
        let nodes: Vec<_> = self
            .state
            .editor
            .graph()
            .nodes()
            .filter(|n| only.is_none_or(|session| n.session.as_deref() == Some(session)))
            .collect();
        if nodes.is_empty() {
            return;
        }
        let min_x = nodes
            .iter()
            .map(|n| n.position.x)
            .fold(f32::INFINITY, f32::min)
            - 40.0;
        let min_y = nodes
            .iter()
            .map(|n| n.position.y)
            .fold(f32::INFINITY, f32::min)
            - 64.0;
        let max_x = nodes
            .iter()
            .map(|n| n.position.x + CARD_WIDTH)
            .fold(f32::NEG_INFINITY, f32::max)
            + 40.0;
        let max_y = nodes
            .iter()
            .map(|n| n.position.y + node_height(n.kind))
            .fold(f32::NEG_INFINITY, f32::max)
            + 40.0;
        let zoom = (f32::from(self.bounds.size.width) / (max_x - min_x))
            .min(f32::from(self.bounds.size.height) / (max_y - min_y))
            .clamp(0.15, 1.0);
        if let Ok(viewport) = Viewport::new(
            WorldPoint {
                x: -min_x * zoom,
                y: -min_y * zoom,
            },
            zoom,
        ) {
            self.state.viewport = viewport;
        }
        cx.notify();
    }

    pub fn zoom(&mut self, factor: f32, at: WorldPoint, cx: &mut Context<Self>) {
        let _ = self
            .state
            .viewport
            .zoom_at(at, self.state.viewport.zoom() * factor);
        cx.notify();
    }

    pub fn finish_wire(&mut self, id: &str, port: Port, cx: &mut Context<Self>) {
        self.notice = match self.state.finish_wire(id, port) {
            Ok(()) => "连线已建立 · 保存后重新打开可恢复".into(),
            Err(e) => match e {
                agentdeck_canvas_core::GraphError::SessionBoundary => {
                    "不能直接跨会话连线；跨会话转交将在后续迁移。".into()
                }
                agentdeck_canvas_core::GraphError::WrongPort => {
                    "端口不匹配：结果接入消息；Context、记忆和触发接入同名端口。".into()
                }
                _ => format!("无法连接：{e}"),
            },
        };
        cx.notify();
    }

    fn undo(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.stash(cx);
        self.state.cancel();
        if redo {
            self.state.editor.redo();
        } else {
            self.state.editor.undo();
        }
        if let Some(id) = self.inspector_id.take() {
            self.inspect(&id, window, cx);
        }
        cx.notify();
    }

    pub fn surface(&mut self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let handle = cx.entity();
        let graph_layer = crate::cards::scene(self, cx);
        div()
            .id("canvas")
            .relative()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(cx.theme().background.blend(cx.theme().muted.opacity(0.45)))
            .track_focus(&self.focus)
            .border_2()
            .border_color(cx.theme().transparent)
            .focus_visible(|style| style.border_color(cx.theme().ring))
            .role(Role::Group)
            .aria_label("画布，滚动平移，Command 加滚动缩放；选择节点后可删除或撤销")
            .key_context("Canvas")
            .on_action(cx.listener(|this, _: &Undo, window, cx| this.undo(false, window, cx)))
            .on_action(cx.listener(|this, _: &Redo, window, cx| this.undo(true, window, cx)))
            .on_action(cx.listener(|this, _: &Cancel, _, cx| {
                this.state.cancel();
                this.space_down = false;
                this.notice = "已取消当前操作".into();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &Fit, _, cx| this.fit(None, cx)))
            .on_action(cx.listener(|this, _: &Delete, _, cx| {
                if this.state.selected.len() == 1 {
                    let id = this.state.selected.first().cloned().unwrap();
                    this.stash(cx);
                    let _ = this.state.editor.apply(Edit::RemoveNode(id.clone()));
                    this.state.selected.clear();
                    // Drafts remain attached to the undoable identity.
                    this.inspector_id = None;
                } else {
                    this.notice = "请先选择一个节点再删除。".into();
                }
                cx.notify();
            }))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, _| {
                if event.keystroke.key == "space" {
                    this.space_down = true;
                }
            }))
            .on_key_up(cx.listener(|this, event: &KeyUpEvent, _, _| {
                if event.keystroke.key == "space" {
                    this.space_down = false;
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    this.focus.focus(window, cx);
                    if this.space_down {
                        this.state.begin_pan(this.local(event.position));
                    } else {
                        this.state.selected.clear();
                        this.state.cancel();
                    }
                    cx.notify();
                }),
            )
            .on_mouse_down(
                MouseButton::Middle,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    this.focus.focus(window, cx);
                    this.state.begin_pan(this.local(event.position));
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                this.pointer = this.local(event.position);
                if event.dragging() {
                    this.state.wire_move(this.pointer);
                }
                let panning = this
                    .state
                    .pan_to(this.pointer, event.pressed_button.is_some());
                if !panning && event.dragging() {
                    this.state
                        .move_to(this.state.viewport.screen_to_world(this.pointer));
                }
                if event.pressed_button.is_some() || this.state.wire.is_some() {
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if let Err(e) = this.state.finish_move() {
                        this.notice = e.to_string();
                    }
                    this.state.release_pointer(false);
                    cx.notify();
                }),
            )
            .on_mouse_up(
                MouseButton::Middle,
                cx.listener(|this, _, _, _| this.state.release_pointer(false)),
            )
            .on_mouse_up_out(
                MouseButton::Middle,
                cx.listener(|this, _, _, cx| {
                    this.state.release_pointer(true);
                    cx.notify();
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    this.state.release_pointer(true);
                    cx.notify();
                }),
            )
            .on_scroll(cx.listener(|this, event: &ScrollEvent, _, cx| {
                let delta = event.delta.pixel_delta(px(20.0));
                if event.modifiers.platform || event.modifiers.control {
                    this.zoom(
                        (f32::from(delta.y) * 0.005).exp(),
                        this.local(event.position),
                        cx,
                    );
                } else {
                    let p = this.state.viewport.offset();
                    if let Ok(view) = Viewport::new(
                        WorldPoint {
                            x: p.x + f32::from(delta.x),
                            y: p.y + f32::from(delta.y),
                        },
                        this.state.viewport.zoom(),
                    ) {
                        this.state.viewport = view;
                    }
                }
                cx.stop_propagation();
                cx.notify();
            }))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        handle.update(cx, |this, cx| {
                            if this.bounds != bounds {
                                this.bounds = bounds;
                                cx.notify();
                            }
                        })
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(graph_layer)
    }
}

impl Render for Desktop {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let nodes = crate::sidebar::Sidebar::project(self.state.editor.graph());
        if self.sidebar.read(cx).nodes != nodes
            || self.sidebar.read(cx).selected != self.inspector_id
        {
            self.sidebar.update(cx, |sidebar, cx| {
                sidebar.nodes = nodes;
                sidebar.selected = self.inspector_id.clone();
                cx.notify();
            });
        }
        // The pinned GPUI cache replays painting but not accessibility nodes.
        // Keep the same view identity while rebuilding AX when it is requested.
        let sidebar = if window.is_a11y_active() {
            self.sidebar.clone().into_any_element()
        } else {
            self.sidebar
                .clone()
                .cached(StyleRefinement::default().w(px(182.0)).h_full().flex_none())
                .into_any_element()
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .on_action(cx.listener(|this, _: &Save, window, cx| this.save(window, cx)))
            .on_action(cx.listener(|this, _: &Quit, _, cx| {
                let _ = this;
                cx.quit();
            }))
            .child(crate::inspector::toolbar(self, cx))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .children(self.show_directory.then_some(sidebar))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .child(self.surface(cx))
                            .child(crate::execution::panel(self, cx)),
                    )
                    .children(
                        self.show_inspector
                            .then(|| crate::inspector::inspector(self, cx)),
                    ),
            )
            .child(crate::inspector::status(self, cx))
    }
}
