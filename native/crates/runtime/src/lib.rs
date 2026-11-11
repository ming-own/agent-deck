//! Standalone, bounded native execution-service prototype.
mod engine;
pub mod protocol;
pub use engine::Engine;
#[cfg(unix)]
pub mod client;
#[cfg(unix)]
pub mod server;
