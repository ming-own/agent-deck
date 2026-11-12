//! Bounded incremental SSE decoding; UTF8 is decoded only after complete lines arrive.
use super::{ErrorCode, ProviderError, Result};
pub(crate) const MAX_EVENT: usize = 256 * 1024;
#[derive(Default)]
pub(crate) struct Decoder {
    line: Vec<u8>,
    data: String,
    event_bytes: usize,
}
impl Decoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>> {
        let mut events = Vec::new();
        for byte in chunk {
            if *byte != b'\n' {
                if self.line.len() >= MAX_EVENT {
                    return Err(ProviderError::new(ErrorCode::InvalidResponse));
                }
                self.line.push(*byte);
                continue;
            }
            if self.line.last() == Some(&b'\r') {
                self.line.pop();
            }
            let line = std::str::from_utf8(&self.line)
                .map_err(|_| ProviderError::new(ErrorCode::InvalidResponse))?;
            if line.is_empty() {
                if !self.data.is_empty() {
                    self.data.pop();
                    events.push(std::mem::take(&mut self.data));
                }
                self.event_bytes = 0;
            } else {
                self.event_bytes += self.line.len();
                if self.event_bytes > MAX_EVENT {
                    return Err(ProviderError::new(ErrorCode::InvalidResponse));
                }
                if let Some(data) = line.strip_prefix("data:") {
                    self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                    self.data.push('\n');
                }
            }
            self.line.clear();
        }
        Ok(events)
    }
}
