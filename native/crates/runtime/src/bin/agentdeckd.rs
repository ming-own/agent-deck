#[cfg(unix)]
fn main() {
    if let Err(e) = run() {
        eprintln!("agentdeckd: {e}");
        std::process::exit(1);
    }
}
#[cfg(unix)]
fn run() -> std::io::Result<()> {
    use agentdeck_runtime::{client, server};
    use std::{io, path::PathBuf, time::Duration};
    let mut socket = client::default_socket()?;
    let mut config = server::Config::default();
    let mut args = std::env::args().skip(1);
    while let Some(key) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| io::Error::other("Missing argument value"))?;
        match key.as_str() {
            "--socket" => socket = PathBuf::from(value),
            "--tick-ms" => {
                config.tick = Duration::from_millis(value.parse().map_err(io::Error::other)?)
            }
            "--idle-ms" => {
                config.idle_timeout =
                    Duration::from_millis(value.parse().map_err(io::Error::other)?)
            }
            _ => return Err(io::Error::other("Unknown argument")),
        }
    }
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?
        .block_on(server::serve(&socket, config))
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Native service IPC currently supports Unix only");
    std::process::exit(1);
}
