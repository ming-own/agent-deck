//! Bounded, atomic JSON storage for a single runtime writer.
//!
//! Callers create the parent directory first. Unix paths must contain no symlinks
//! or `..`; the final directory must be owned by the current user and not writable
//! by others. Operations use directory-relative descriptors, so parent renames
//! cannot redirect a write. Existing unreadable/invalid documents are never replaced.
use crate::{Result, ValidatedDocument, fail};
use std::path::Path;

pub const MAX_DOCUMENT_BYTES: u64 = 32 * 1024 * 1024;

pub fn load<T: ValidatedDocument>(path: &Path) -> Result<T> {
    platform::load(path)
}
pub fn save<T: ValidatedDocument>(path: &Path, value: &T) -> Result<()> {
    value.validate()?;
    // Complete serialization before touching the destination or creating a temp file.
    let bytes = serde_json::to_vec_pretty(value)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return fail("Document exceeds storage size limit");
    }
    platform::save::<T>(path, &bytes)
}

#[cfg(unix)]
mod platform {
    use super::*;
    use crate::{ProductError, new_id};
    use std::{
        ffi::CString,
        fs::File,
        io::{Read, Write},
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{ffi::OsStrExt, fs::MetadataExt},
        },
        path::Component,
    };

    fn cstring(value: &[u8]) -> Result<CString> {
        CString::new(value).map_err(|_| ProductError("Storage path contains NUL".into()))
    }
    fn opened(fd: libc::c_int) -> Result<File> {
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        // SAFETY: successful open/openat returns a new owned descriptor.
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn directory(path: &Path) -> Result<(File, CString)> {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return fail("Storage paths must not contain '..'");
        }
        let name = path
            .file_name()
            .ok_or_else(|| ProductError("Storage path requires a file name".into()))?;
        let name = cstring(name.as_bytes())?;
        let root = cstring(b"/")?;
        // SAFETY: valid C string and flags; descriptor ownership moves into File.
        let mut directory = opened(unsafe {
            libc::open(
                root.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        })?;
        for component in path
            .parent()
            .ok_or_else(|| ProductError("Missing storage parent".into()))?
            .components()
        {
            if let Component::Normal(name) = component {
                let name = cstring(name.as_bytes())?;
                // SAFETY: live directory fd, valid C string, owned return descriptor.
                directory = opened(unsafe {
                    libc::openat(
                        directory.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                    )
                })?;
            }
        }
        let metadata = directory.metadata()?;
        // SAFETY: geteuid has no arguments or memory preconditions.
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0 {
            return fail(
                "Storage parent must be owned by the current user and not writable by others",
            );
        }
        Ok((directory, name))
    }
    fn read<T: ValidatedDocument>(directory: &File, name: &CString) -> Result<T> {
        // O_NONBLOCK prevents a hostile FIFO from blocking before fstat rejects it.
        // SAFETY: live fd and valid path, returning a new owned descriptor.
        let file = opened(unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            )
        })?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > MAX_DOCUMENT_BYTES {
            return fail("Storage requires one bounded regular file, without hard links");
        }
        let mut bytes = Vec::new();
        file.take(MAX_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return fail("Document exceeds storage size limit");
        }
        // Reject duplicate keys before typed deserialization can discard them.
        let unique: UniqueJson = serde_json::from_slice(&bytes)?;
        let value: T = serde_json::from_value(unique.0)?;
        value.validate()?;
        Ok(value)
    }
    pub(super) fn load<T: ValidatedDocument>(path: &Path) -> Result<T> {
        let (directory, name) = directory(path)?;
        read(&directory, &name)
    }
    pub(super) fn save<T: ValidatedDocument>(path: &Path, bytes: &[u8]) -> Result<()> {
        let (directory, name) = directory(path)?;
        // Inspect without following symlinks. Corruption/unknown schema stops a save.
        // SAFETY: valid fd/name and writable stat allocation; assumed initialized only on success.
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let exists = unsafe {
            libc::fstatat(
                directory.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if exists == 0 {
            let _: T = read(&directory, &name)?;
        } else {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(error.into());
            }
        }
        let temporary = cstring(format!(".agentdeck-{}.tmp", new_id()).as_bytes())?;
        // SAFETY: live directory fd/name and valid flags/mode. Exclusive creation never follows a link.
        let mut file = opened(unsafe {
            libc::openat(
                directory.as_raw_fd(),
                temporary.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        })?;
        let cleanup = Temporary {
            directory: &directory,
            name: &temporary,
        };
        file.write_all(bytes)?;
        file.sync_all()?;
        // renameat replaces the directory entry itself, never a symlink's referent.
        // SAFETY: both live directory fds and valid names.
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                temporary.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
            )
        } != 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        drop(cleanup);
        // Some platforms/filesystems reject directory fsync; other errors remain visible.
        if let Err(error) = directory.sync_all()
            && !matches!(error.raw_os_error(), Some(libc::EINVAL | libc::ENOTSUP))
        {
            return Err(error.into());
        }
        Ok(())
    }
    struct Temporary<'a> {
        directory: &'a File,
        name: &'a CString,
    }
    impl Drop for Temporary<'_> {
        fn drop(&mut self) {
            // SAFETY: directory/name outlive this guard; removing only our exclusive temp entry.
            unsafe {
                libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0);
            }
        }
    }
}

#[cfg(not(unix))]
mod platform {
    use super::*;
    pub(super) fn load<T: ValidatedDocument>(_: &Path) -> Result<T> {
        fail("Private atomic storage is currently supported on Unix only")
    }
    pub(super) fn save<T: ValidatedDocument>(_: &Path, _: &[u8]) -> Result<()> {
        fail("Private atomic storage is currently supported on Unix only")
    }
}

// A small JSON adapter that preserves serde_json's depth/number checks while
// detecting duplicate keys at every nesting level (including metadata maps).
#[cfg(unix)]
struct UniqueJson(serde_json::Value);
#[cfg(unix)]
impl<'de> serde::Deserialize<'de> for UniqueJson {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueJson;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON without duplicate object keys")
            }
            fn visit_bool<E: serde::de::Error>(
                self,
                v: bool,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueJson(n.into()))
                    .ok_or_else(|| E::custom("Nonfinite JSON number"))
            }
            fn visit_str<E: serde::de::Error>(
                self,
                v: &str,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(v.into()))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
                Ok(UniqueJson(serde_json::Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element::<UniqueJson>()? {
                    values.push(value.0);
                }
                Ok(UniqueJson(values.into()))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom(format!(
                            "Duplicate JSON key: {key}"
                        )));
                    }
                    values.insert(key, map.next_value::<UniqueJson>()?.0);
                }
                Ok(UniqueJson(values.into()))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}
