use crate::protocol::{MAX_FRAME_BYTES, Reply, Request, VERSION};
use std::{
    io::{self, Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

/// Reap an independently running service when it exits. Dropping the receiver
/// neither terminates the service nor prevents cleanup by this waiter.
pub fn monitor_child(mut child: Child) -> Receiver<io::Result<ExitStatus>> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(child.wait());
    });
    receiver
}

pub fn default_socket() -> io::Result<PathBuf> {
    Ok(PathBuf::from(
        std::env::var_os("HOME").ok_or_else(|| io::Error::other("Home directory unavailable"))?,
    )
    .join("Library/Application Support/AgentDeck Native Preview/ipc/s"))
}
pub fn exchange(path: &Path, request: &Request) -> io::Result<Reply> {
    let bytes = serde_json::to_vec(request).map_err(io::Error::other)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(io::Error::other("Request exceeds protocol limit"));
    }
    let mut stream = UnixStream::connect(path)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
    stream.write_all(&bytes)?;
    let mut len = [0; 4];
    stream.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(io::Error::other("Reply exceeds protocol limit"));
    }
    let mut bytes = vec![0; len];
    stream.read_exact(&mut bytes)?;
    let reply: Reply = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
    if reply.version != VERSION || reply.request_id != request.request_id {
        return Err(io::Error::other(
            "Reply version or request identity mismatch",
        ));
    }
    Ok(reply)
}
