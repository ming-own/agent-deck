use crate::{Engine, protocol::*};
use std::{
    fs::{self, File, OpenOptions},
    io,
    os::{
        fd::AsRawFd,
        unix::{
            fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
            net::UnixListener as StdListener,
        },
    },
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::Semaphore,
};

pub struct Config {
    pub tick: Duration,
    pub idle_timeout: Duration,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            tick: Duration::from_secs(3),
            idle_timeout: Duration::from_secs(300),
        }
    }
}
struct SocketGuard {
    _lock: File,
    path: PathBuf,
    inode: u64,
}
impl Drop for SocketGuard {
    fn drop(&mut self) {
        if fs::symlink_metadata(&self.path)
            .is_ok_and(|m| m.ino() == self.inode && m.file_type().is_socket())
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}
fn bind(path: &Path) -> io::Result<(StdListener, SocketGuard)> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing socket directory"))?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    let meta = fs::symlink_metadata(dir)?;
    // The socket and lock live in a private directory owned by this OS user.
    let uid = unsafe { libc::geteuid() };
    if !meta.is_dir() || meta.uid() != uid || meta.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC directory must be owned by this user with mode 0700",
        ));
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(dir.join("service.lock"))?;
    let meta = lock.metadata()?;
    if !meta.is_file() || meta.uid() != uid || meta.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Unsafe service lock",
        ));
    }
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "Service already running",
        ));
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.file_type().is_socket() || meta.uid() != uid {
            return Err(io::Error::other("Refusing to replace a non-service path"));
        }
        match std::os::unix::net::UnixStream::connect(path) {
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    "Live service already owns the socket",
                ));
            }
            Err(e) if e.kind() == io::ErrorKind::ConnectionRefused => fs::remove_file(path)?,
            Err(e) => return Err(e),
        }
    }
    let listener = StdListener::bind(path)?;
    let guard = SocketGuard {
        _lock: lock,
        path: path.to_owned(),
        inode: fs::symlink_metadata(path)?.ino(),
    };
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    Ok((listener, guard))
}
async fn handle(mut stream: UnixStream, engine: Arc<Mutex<Engine>>) -> io::Result<()> {
    let len = stream.read_u32().await? as usize;
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(io::Error::other("Invalid frame size"));
    }
    let mut bytes = vec![0; len];
    stream.read_exact(&mut bytes).await?;
    let request: Request = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    let reply = engine
        .lock()
        .map_err(|_| io::Error::other("Executor unavailable"))?
        .handle(request);
    let bytes = serde_json::to_vec(&reply).map_err(io::Error::other)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(io::Error::other("Reply exceeds protocol limit"));
    }
    stream.write_u32(bytes.len() as u32).await?;
    stream.write_all(&bytes).await?;
    stream.shutdown().await
}
pub async fn serve(path: &Path, config: Config) -> io::Result<()> {
    if config.tick < Duration::from_millis(10) || config.idle_timeout < Duration::from_millis(50) {
        return Err(io::Error::other("Service timer is too short"));
    }
    let (listener, _guard) = bind(path)?;
    let listener = UnixListener::from_std(listener)?;
    let identity = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos()
    );
    let engine = Arc::new(Mutex::new(Engine::new(identity)));
    let permits = Arc::new(Semaphore::new(8));
    let mut tick = Instant::now();
    let mut last_client = Instant::now();
    loop {
        let (shutdown, running) = {
            let e = engine
                .lock()
                .map_err(|_| io::Error::other("Executor unavailable"))?;
            (e.shutting_down(), e.is_running())
        };
        if shutdown {
            if permits.available_permits() == 8 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
            continue;
        }
        if !running
            && permits.available_permits() == 8
            && last_client.elapsed() > config.idle_timeout
        {
            break;
        }
        if tick.elapsed() >= config.tick {
            engine
                .lock()
                .map_err(|_| io::Error::other("Executor unavailable"))?
                .advance();
            tick = Instant::now();
        }
        match tokio::time::timeout(Duration::from_millis(10), listener.accept()).await {
            Ok(Ok((stream, _))) => {
                last_client = Instant::now();
                if let Ok(permit) = permits.clone().try_acquire_owned() {
                    let engine = engine.clone();
                    tokio::spawn(async move {
                        let _permit = permit;
                        let _ =
                            tokio::time::timeout(Duration::from_secs(2), handle(stream, engine))
                                .await;
                    });
                }
            }
            Ok(Err(e)) => return Err(e),
            Err(_) => {}
        }
    }
    Ok(())
}
