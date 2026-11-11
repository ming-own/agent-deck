#![cfg(unix)]
use agentdeck_runtime::{client, protocol::*};
use std::{
    fs,
    io::Write,
    os::unix::{
        fs::{DirBuilderExt, PermissionsExt},
        net::UnixStream,
    },
    path::PathBuf,
    process::{Child, Command as Process, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

struct Service {
    child: Child,
    dir: PathBuf,
    socket: PathBuf,
}
impl Service {
    fn start(idle_ms: u64) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "ad-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
        let socket = dir.join("s");
        let child = Process::new(env!("CARGO_BIN_EXE_agentdeckd"))
            .arg("--socket")
            .arg(&socket)
            .args(["--tick-ms", "20", "--idle-ms", &idle_ms.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut s = Self { child, dir, socket };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if s.poll(0).is_ok() {
                break;
            }
            assert!(
                s.child.try_wait().unwrap().is_none(),
                "service exited during startup"
            );
            assert!(Instant::now() < deadline, "service did not become ready");
            thread::sleep(Duration::from_millis(10));
        }
        s
    }
    fn poll(&self, after: u64) -> std::io::Result<Reply> {
        client::exchange(
            &self.socket,
            &req(
                "reader",
                "poll",
                None,
                Command::Poll {
                    after_sequence: after,
                },
            ),
        )
    }
    fn wait_for(&self, predicate: impl Fn(&Snapshot) -> bool) -> Reply {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let r = self.poll(0).unwrap();
            if predicate(&r.snapshot) {
                return r;
            }
            assert!(Instant::now() < deadline, "service did not advance");
            thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.dir);
    }
}
fn req(client: &str, id: &str, revision: Option<u64>, command: Command) -> Request {
    Request {
        version: VERSION,
        client_id: client.into(),
        request_id: id.into(),
        expected_server: None,
        expected_revision: revision,
        command,
    }
}
fn start(service: &Service) -> Request {
    let mut request = req(
        "writer",
        "start",
        Some(0),
        Command::Start {
            run_id: "run-ab".into(),
            session_id: "session-a".into(),
            node_ids: vec!["a".into(), "b".into()],
        },
    );
    request.expected_server = Some(service.poll(0).unwrap().snapshot.server_id);
    request
}

#[test]
fn independent_process_keeps_running_after_client_disconnect_and_reconnects_by_sequence() {
    let mut service = Service::start(3000);
    let request = start(&service);
    let reply = client::exchange(&service.socket, &request).unwrap();
    assert!(reply.error.is_none());
    let cursor = reply.snapshot.sequence;
    thread::sleep(Duration::from_millis(100));
    assert!(service.child.try_wait().unwrap().is_none());
    let reply = service.wait_for(|s| s.runs[0].status() == NodeState::Succeeded);
    assert_eq!(reply.snapshot.runs.len(), 1);
    let replay = service.poll(cursor).unwrap();
    assert_eq!(replay.events.len(), 3);
    assert_eq!(replay.snapshot.runs[0].nodes[1].node_id, "b");
    assert!(
        client::exchange(&service.socket, &request)
            .unwrap()
            .error
            .is_none()
    );
    assert_eq!(service.poll(cursor).unwrap().snapshot.runs.len(), 1);
    let mut quit = req(
        "reader",
        "quit",
        Some(reply.snapshot.revision),
        Command::Shutdown,
    );
    quit.expected_server = Some(reply.snapshot.server_id.clone());
    assert!(
        client::exchange(&service.socket, &quit)
            .unwrap()
            .error
            .is_none()
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    while service.child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    assert!(!service.socket.exists());
}
#[test]
fn malformed_oversized_and_slow_connections_do_not_block_other_clients() {
    let service = Service::start(3000);
    let mut oversized = UnixStream::connect(&service.socket).unwrap();
    oversized
        .write_all(&((MAX_FRAME_BYTES + 1) as u32).to_be_bytes())
        .unwrap();
    drop(oversized);
    let mut malformed = UnixStream::connect(&service.socket).unwrap();
    malformed.write_all(&3u32.to_be_bytes()).unwrap();
    malformed.write_all(b"bad").unwrap();
    drop(malformed);
    let mut slow = UnixStream::connect(&service.socket).unwrap();
    slow.write_all(&100u32.to_be_bytes()).unwrap();
    assert!(
        client::exchange(&service.socket, &start(&service))
            .unwrap()
            .error
            .is_none()
    );
    service.wait_for(|s| s.runs[0].status() == NodeState::Succeeded);
    assert_eq!(
        fs::metadata(&service.socket).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
#[test]
fn a_second_service_cannot_replace_a_live_socket() {
    let service = Service::start(3000);
    let id = service.poll(0).unwrap().snapshot.server_id;
    let exit = Process::new(env!("CARGO_BIN_EXE_agentdeckd"))
        .arg("--socket")
        .arg(&service.socket)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(!exit.success());
    assert_eq!(service.poll(0).unwrap().snapshot.server_id, id);
}
#[test]
fn idle_service_exits_without_leaving_a_socket() {
    let mut service = Service::start(100);
    let deadline = Instant::now() + Duration::from_secs(2);
    while service.child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(20));
    }
    assert!(!service.socket.exists());
}
