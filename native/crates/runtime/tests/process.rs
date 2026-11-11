#![cfg(unix)]
use agentdeck_runtime::client::monitor_child;
use std::{process::Command, time::Duration};

#[test]
fn service_exit_is_reaped_without_blocking_its_client() {
    let child = Command::new("/bin/sh")
        .args(["-c", "sleep 0.05; exit 7"])
        .spawn()
        .unwrap();
    let pid = child.id() as libc::pid_t;
    let exit = monitor_child(child);
    let status = exit.recv_timeout(Duration::from_secs(3)).unwrap().unwrap();
    assert_eq!(status.code(), Some(7));
    // A successful wait has already removed the child from the process table.
    assert_eq!(
        unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) },
        -1
    );
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ECHILD)
    );
}
