use crate::canvas::Desktop;
use agentdeck_desktop::run_plan;
use agentdeck_runtime::{client, protocol::*};
use gpui_kit::{
    base::Disableable,
    component::{
        ActiveTheme, Sizable,
        button::{Button, ButtonVariants},
    },
    prelude::FluentBuilder,
    *,
};
use std::{
    io,
    path::Path,
    process::{Command as Process, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn identity(prefix: &str) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{prefix}-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
pub struct ServiceView {
    pub snapshot: Option<Snapshot>,
    pub online: bool,
    pub busy: bool,
    pub selected_run: Option<String>,
    pub message: String,
    client_id: String,
    pending: Option<Request>,
    generation: u64,
    polling: bool,
}
impl Default for ServiceView {
    fn default() -> Self {
        Self {
            snapshot: None,
            online: false,
            busy: false,
            selected_run: None,
            message: "连接独立服务后，可演示节点链运行；不调用模型。".into(),
            client_id: identity("ui"),
            pending: None,
            generation: 0,
            polling: false,
        }
    }
}
impl ServiceView {
    fn request(&self, command: Command) -> Request {
        Request {
            version: VERSION,
            client_id: self.client_id.clone(),
            request_id: identity("req"),
            expected_server: self.snapshot.as_ref().map(|s| s.server_id.clone()),
            expected_revision: self.snapshot.as_ref().map(|s| s.revision),
            command,
        }
    }
    fn poll(&self) -> Request {
        self.request(Command::Poll {
            after_sequence: self.snapshot.as_ref().map_or(0, |s| s.sequence),
        })
    }
    pub fn run(&self) -> Option<&Run> {
        self.snapshot
            .as_ref()?
            .runs
            .iter()
            .find(|r| Some(&r.run_id) == self.selected_run.as_ref())
    }
    pub fn node(&self, id: &str) -> Option<&NodeExecution> {
        self.run()?.nodes.iter().find(|n| n.node_id == id)
    }
    pub fn edge_state(&self, source: &str, target: &str) -> Option<NodeState> {
        let run = self.run()?;
        run.nodes
            .windows(2)
            .find(|pair| pair[0].node_id == source && pair[1].node_id == target)
            .map(|pair| pair[1].state)
    }
    fn accept(&mut self, reply: Reply, fresh: bool) -> bool {
        if !fresh
            && self
                .snapshot
                .as_ref()
                .is_some_and(|s| s.server_id != reply.snapshot.server_id)
        {
            self.online = false;
            self.message = "服务身份已变化，请重新连接。".into();
            return false;
        }
        let newer = self.snapshot.as_ref().is_none_or(|s| {
            s.server_id != reply.snapshot.server_id
                || (reply.snapshot.revision >= s.revision && reply.snapshot.sequence >= s.sequence)
        });
        if newer {
            self.snapshot = Some(reply.snapshot);
        }
        self.online = true;
        if self.run().is_none() {
            self.selected_run = self
                .snapshot
                .as_ref()
                .and_then(|s| {
                    s.runs
                        .iter()
                        .rev()
                        .find(|r| r.status() == NodeState::Running)
                        .or_else(|| s.runs.last())
                })
                .map(|r| r.run_id.clone());
        }
        if let Some(error) = reply.error {
            self.message = match error {
                ErrorCode::Version => "服务协议不兼容，请使用同一版本的客户端与服务。",
                ErrorCode::ServerChanged => "服务已重启；旧请求没有重放，请重新发起演示。",
                ErrorCode::StaleRevision => "运行状态已更新，请重新操作。",
                ErrorCode::DuplicateRequest => "请求身份冲突，未重复启动运行。",
                ErrorCode::Capacity => {
                    "演示服务已达到 8 次运行上限；停止服务后重新启动可清空演示记录。"
                }
                ErrorCode::MissingRun => "指定的演示运行不存在。",
                ErrorCode::Busy => "服务仍有运行任务，请先停止任务。",
                ErrorCode::InvalidRequest => "演示请求无效，请检查节点链。",
            }
            .into();
            false
        } else {
            true
        }
    }
}
fn connect(path: &Path, request: &Request, launch: bool) -> io::Result<Reply> {
    match client::exchange(path, request) {
        Ok(reply) => return Ok(reply),
        Err(e)
            if launch
                && matches!(
                    e.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) => {}
        Err(e) => return Err(e),
    }
    let exe = std::env::current_exe()?;
    let daemon = exe
        .parent()
        .ok_or_else(|| io::Error::other("Missing application directory"))?
        .join("agentdeckd");
    let child = Process::new(daemon)
        .arg("--socket")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let exit = client::monitor_child(child);
    for _ in 0..40 {
        if let Ok(reply) = client::exchange(path, request) {
            return Ok(reply);
        }
        if let Ok(status) = exit.try_recv() {
            return Err(io::Error::other(format!("执行服务启动失败：{}", status?)));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "执行服务尚未就绪；请重新连接",
    ))
}
impl Desktop {
    pub fn connect_service(&mut self, launch: bool, cx: &mut Context<Self>) {
        if self.service.busy {
            return;
        }
        let request = self
            .service
            .pending
            .clone()
            .unwrap_or_else(|| self.service.poll());
        self.service_exchange(request, launch, true, cx);
    }
    fn service_exchange(
        &mut self,
        request: Request,
        launch: bool,
        fresh: bool,
        cx: &mut Context<Self>,
    ) {
        let Ok(path) = client::default_socket() else {
            self.service.message = "无法定位本机执行服务目录。".into();
            return;
        };
        let mutation = !matches!(request.command, Command::Poll { .. });
        let shutdown = matches!(request.command, Command::Shutdown);
        self.service.busy = true;
        self.service.generation += 1;
        let generation = self.service.generation;
        if mutation {
            self.service.pending = Some(request.clone());
        }
        let work = cx
            .background_executor()
            .spawn(async move { connect(&path, &request, launch) });
        cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |this, cx| {
                if this.service.generation != generation {
                    return;
                }
                this.service.busy = false;
                match result {
                    Ok(reply) => {
                        let accepted = reply.error.is_none();
                        if mutation {
                            this.service.pending = None;
                        }
                        if this.service.accept(reply, fresh) {
                            this.service.message =
                                "演示结果来自独立 Rust 服务；未调用模型。".into();
                        }
                        if shutdown && accepted {
                            this.service.online = false;
                            this.service.message =
                                "执行服务已停止；演示记录仅保留到本次服务退出。".into();
                        }
                        if this.service.online {
                            this.start_service_poll(cx);
                        }
                    }
                    Err(e) => {
                        this.service.online = false;
                        this.service.message = if mutation {
                            format!("请求结果尚未确认：{e}。重新连接会使用同一请求身份核对。")
                        } else if !launch
                            && matches!(
                                e.kind(),
                                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                            )
                        {
                            "执行服务尚未启动，点击「启动 / 连接服务」即可开始。".into()
                        } else {
                            format!("服务未连接：{e}")
                        };
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn start_service_poll(&mut self, cx: &mut Context<Self>) {
        if self.service.polling {
            return;
        }
        self.service.polling = true;
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            loop {
                executor.timer(Duration::from_millis(400)).await;
                let Ok(next) = this.update(cx, |this, _| {
                    if !this.service.online {
                        this.service.polling = false;
                        return None;
                    }
                    Some((
                        this.service.busy,
                        this.service.generation,
                        this.service.poll(),
                    ))
                }) else {
                    break;
                };
                let Some((busy, generation, request)) = next else {
                    break;
                };
                if busy {
                    continue;
                }
                let result = executor
                    .spawn(async move { client::exchange(&client::default_socket()?, &request) })
                    .await;
                if this
                    .update(cx, |this, cx| {
                        if generation != this.service.generation {
                            return;
                        }
                        let before = this
                            .service
                            .snapshot
                            .as_ref()
                            .map(|s| (s.server_id.clone(), s.revision, s.sequence));
                        let was_online = this.service.online;
                        match result {
                            Ok(reply) => {
                                this.service.accept(reply, false);
                            }
                            Err(_) => {
                                this.service.online = false;
                                this.service.message =
                                    "与服务的连接已断开；此处显示最后收到的状态。".into();
                            }
                        }
                        let after = this
                            .service
                            .snapshot
                            .as_ref()
                            .map(|s| (s.server_id.clone(), s.revision, s.sequence));
                        if before != after || was_online != this.service.online {
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }
    pub fn demo_run(&mut self, cx: &mut Context<Self>) {
        if !self.service.online || self.service.busy || self.service.pending.is_some() {
            return;
        }
        self.stash(cx);
        if self.state.editor.graph() != &self.saved.graph
            || self.drafts.is_dirty(self.state.editor.graph())
        {
            self.service.message = "请先保存节点和连线修改，再运行这条演示链。".into();
            cx.notify();
            return;
        }
        let Some(id) = self.inspector_id.as_deref() else {
            return;
        };
        let plan = match run_plan::compile(self.state.editor.graph(), id) {
            Ok(plan) => plan,
            Err(message) => {
                self.service.message = message.into();
                cx.notify();
                return;
            }
        };
        let run_id = identity("run");
        self.service.selected_run = Some(run_id.clone());
        let request = self.service.request(Command::Start {
            run_id,
            session_id: plan.session_id,
            node_ids: plan.node_ids,
        });
        self.service_exchange(request, false, false, cx);
    }
    pub fn stop_run(&mut self, cx: &mut Context<Self>) {
        if !self.service.online || self.service.busy || self.service.pending.is_some() {
            return;
        }
        if let Some(run) = self.service.run() {
            let request = self.service.request(Command::Stop {
                run_id: run.run_id.clone(),
            });
            self.service_exchange(request, false, false, cx);
        }
    }
    pub fn stop_service(&mut self, cx: &mut Context<Self>) {
        if !self.service.online || self.service.busy || self.service.pending.is_some() {
            return;
        }
        self.service_exchange(self.service.request(Command::Shutdown), false, false, cx);
    }
}
pub fn state_label(state: NodeState) -> &'static str {
    match state {
        NodeState::Queued => "等待中",
        NodeState::Running => "运行中",
        NodeState::Succeeded => "已完成",
        NodeState::Cancelled => "已停止",
    }
}
pub fn panel(this: &Desktop, cx: &mut Context<Desktop>) -> impl IntoElement + use<> {
    let run = this.service.run();
    let active = run.is_some_and(|r| r.status() == NodeState::Running);
    let target = this
        .inspector_id
        .as_ref()
        .and_then(|id| this.state.editor.graph().node(id))
        .filter(|n| n.kind == agentdeck_canvas_core::NodeKind::Agent);
    let text = run
        .map(|r| {
            format!(
                "{} · {} · {} 个节点",
                crate::cards::session_title(&r.session_id),
                state_label(r.status()),
                r.nodes.len()
            )
        })
        .unwrap_or_else(|| "尚无演示运行".into());
    let summary = format!(
        "执行服务 · {}   {text}",
        if this.service.online {
            "已连接"
        } else {
            "未连接"
        }
    );
    div()
        .flex_none()
        .px_4()
        .py_2()
        .border_t_1()
        .border_color(cx.theme().border)
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .id("service-status")
                        .role(Role::Status)
                        .aria_label(summary.clone())
                        .text_size(px(12.))
                        .child(summary),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(
                            Button::new("service-connect")
                                .small()
                                .rounded_full()
                                .disabled(this.service.busy)
                                .label(if this.service.online {
                                    "重新连接"
                                } else {
                                    "启动 / 连接服务"
                                })
                                .on_click(
                                    cx.listener(|this, _, _, cx| this.connect_service(true, cx)),
                                ),
                        )
                        .child(
                            Button::new("demo-run")
                                .small()
                                .rounded_full()
                                .primary()
                                .disabled(
                                    !this.service.online
                                        || this.service.busy
                                        || this.service.pending.is_some()
                                        || target.is_none(),
                                )
                                .label("演示运行")
                                .on_click(cx.listener(|this, _, _, cx| this.demo_run(cx))),
                        )
                        .child(
                            Button::new("stop-run")
                                .small()
                                .rounded_full()
                                .disabled(
                                    !this.service.online
                                        || this.service.busy
                                        || !active
                                        || this.service.pending.is_some(),
                                )
                                .label("停止运行")
                                .on_click(cx.listener(|this, _, _, cx| this.stop_run(cx))),
                        )
                        .child(
                            Button::new("stop-service")
                                .small()
                                .rounded_full()
                                .disabled(
                                    !this.service.online
                                        || this.service.busy
                                        || this.service.pending.is_some(),
                                )
                                .label("停止服务")
                                .on_click(cx.listener(|this, _, _, cx| this.stop_service(cx))),
                        ),
                ),
        )
        .child(
            div()
                .id("service-message")
                .role(Role::Status)
                .aria_label(this.service.message.clone())
                .text_size(px(11.))
                .text_color(cx.theme().muted_foreground)
                .child(format!(
                    "{} · {}",
                    target
                        .map(|n| format!("目标：{} 起始的节点链", n.title))
                        .unwrap_or_else(|| "请选择一个 Agent 作为起点".into()),
                    this.service.message
                )),
        )
        .when(run.is_some(), |el| {
            el.child(
                div()
                    .id("run-node-statuses")
                    .max_h(px(72.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(run.unwrap().nodes.iter().map(|node| {
                        let id = node.node_id.clone();
                        let label = this
                            .state
                            .editor
                            .graph()
                            .node(&id)
                            .map(|n| n.title.as_str())
                            .unwrap_or(&id);
                        Button::new(SharedString::from(format!("run-node-{id}")))
                            .small()
                            .ghost()
                            .label(format!("{label} · {}", state_label(node.state)))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.state.select(&id, false);
                                this.inspect(&id, window, cx);
                                cx.notify();
                            }))
                    })),
            )
        })
}
