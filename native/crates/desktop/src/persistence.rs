use agentdeck_canvas_core::Layout;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 16 * 1024 * 1024;

pub fn default_path() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| io::Error::other("Cannot find the home directory"))?;
    Ok(
        PathBuf::from(home)
            .join("Library/Application Support/AgentDeck Native Preview/layout.json"),
    )
}

pub fn load(path: &Path) -> io::Result<Option<Layout>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("Layout exceeds 16 MiB"));
    }
    let json = String::from_utf8(bytes).map_err(io::Error::other)?;
    Layout::from_json(&json).map(Some).map_err(io::Error::other)
}

pub fn save(path: &Path, layout: &Layout) -> io::Result<()> {
    let json = layout.to_json().map_err(io::Error::other)?;
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing layout directory"))?;
    fs::create_dir_all(parent)?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Never replace the last valid document until serialization and writing finish.
    let mut file = options.open(&temp)?;
    let result = (|| {
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
