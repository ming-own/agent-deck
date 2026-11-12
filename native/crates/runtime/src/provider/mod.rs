//! Native, tool-free model HTTP adapters. Pass immutable task history into `stream`.
//! Delta callbacks receive only new text; a successful return is the authoritative
//! complete answer. A partial stream must remain failed/cancelled in task history.
mod credentials;
mod oauth;
mod sse;
use agentdeck_product::{Provider, ProviderKind};
pub use credentials::{
    AuthenticationStatus, Credential, CredentialStore, KeychainCredentialStore,
    MemoryCredentialStore, SecretString,
};
pub use oauth::{OAuthLogin, OAuthStatus, begin_codex_login};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fmt,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::watch;
use url::{Host, Url};

pub type Result<T> = std::result::Result<T, ProviderError>;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    MissingCredentials,
    Unauthorized,
    RateLimit,
    Cancelled,
    Transport,
    IncompleteStream,
    InvalidResponse,
    InvalidConfiguration,
    CredentialStore,
    Unsupported,
    OAuthState,
    OAuthExpired,
}
/// All diagnostics use a fixed allowlist; upstream errors, bodies and URLs are discarded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderError {
    pub code: ErrorCode,
}
impl ProviderError {
    pub(crate) fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}
impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.code {
            ErrorCode::MissingCredentials => "Set up this model connection before running.",
            ErrorCode::Unauthorized => {
                "Authentication expired or was rejected. Reconnect this provider."
            }
            ErrorCode::RateLimit => "The provider rate limit was reached. Try again later.",
            ErrorCode::Cancelled => "The request was cancelled.",
            ErrorCode::Transport => {
                "The provider could not be reached securely. Check the connection and try again."
            }
            ErrorCode::IncompleteStream => {
                "The provider did not finish a text answer. Retry explicitly."
            }
            ErrorCode::InvalidResponse => "The provider returned an invalid or oversized response.",
            ErrorCode::InvalidConfiguration => {
                "Check the provider address, ID, model and messages."
            }
            ErrorCode::CredentialStore => {
                "Private credential storage is unavailable. Unlock Keychain and reconnect."
            }
            ErrorCode::Unsupported => {
                "Secure credential storage is not supported on this platform."
            }
            ErrorCode::OAuthState => "The sign-in callback was rejected. Start sign-in again.",
            ErrorCode::OAuthExpired => "Sign-in expired. Start sign-in again.",
        })
    }
}
impl std::error::Error for ProviderError {}
#[derive(Clone, Debug)]
pub struct CancellationToken(watch::Sender<bool>);
impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}
impl CancellationToken {
    pub fn new() -> Self {
        Self(watch::channel(false).0)
    }
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    pub async fn cancelled(&self) {
        let mut rx = self.0.subscribe();
        if *rx.borrow_and_update() {
            return;
        }
        let _ = rx.changed().await;
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}
impl Message {
    pub fn new(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub display_name: String,
}
const MAX_BODY: usize = 4 * 1024 * 1024;
const MAX_ANSWER: usize = 4 * 1024 * 1024;
const MAX_WIRE: usize = 32 * 1024 * 1024;
/// Pinned wire compatibility version, not a claim to be the Codex CLI.
pub const CODEX_CLIENT_VERSION: &str = "0.77.0";
pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
/// HTTPS endpoints, or explicit local HTTP only. No URL-carried secrets.
pub fn validate_endpoint(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| ProviderError::new(ErrorCode::InvalidConfiguration))?;
    let loopback = match url.host() {
        Some(Host::Domain(name)) => name == "localhost",
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
    {
        return Err(ProviderError::new(ErrorCode::InvalidConfiguration));
    }
    Ok(url)
}
pub(crate) fn http_client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .no_proxy()
        .build()
        .map_err(|_| ProviderError::new(ErrorCode::Transport))
}
pub(crate) fn check_status(response: &Response) -> Result<()> {
    if response.status().is_success() {
        return Ok(());
    }
    Err(ProviderError::new(match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ErrorCode::Unauthorized,
        StatusCode::TOO_MANY_REQUESTS => ErrorCode::RateLimit,
        _ => ErrorCode::Transport,
    }))
}
pub(crate) async fn bounded_json(mut response: Response) -> Result<Value> {
    check_status(&response)?;
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(ProviderError::new(ErrorCode::InvalidResponse));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ProviderError::new(ErrorCode::Transport))?
    {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err(ProviderError::new(ErrorCode::InvalidResponse));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| ProviderError::new(ErrorCode::InvalidResponse))
}
/// Clones share the HTTP pool. Credentials are loaded on every request, never in metadata.
#[derive(Clone)]
pub struct ProviderClient {
    provider: Provider,
    base: Url,
    store: Arc<dyn CredentialStore>,
    http: Client,
    token_url: Url,
}
impl ProviderClient {
    pub fn new(provider: Provider, store: Arc<dyn CredentialStore>) -> Result<Self> {
        credentials::validate_id(&provider.id)?;
        let base = validate_endpoint(&provider.base_url)?;
        if provider.kind == ProviderKind::Codex
            && !(base.scheme() == "https"
                && base.host_str() == Some("chatgpt.com")
                && base.port_or_known_default() == Some(443)
                && base.path().trim_end_matches('/') == "/backend-api/codex")
        {
            return Err(ProviderError::new(ErrorCode::InvalidConfiguration));
        }
        Ok(Self {
            provider,
            base,
            store,
            http: http_client()?,
            token_url: Url::parse(oauth::TOKEN_URL).expect("constant URL"),
        })
    }
    fn endpoint(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(&format!(
            "{}/{}",
            self.base.path().trim_end_matches('/'),
            path
        ));
        url
    }
    async fn authorize(
        &self,
        builder: reqwest::RequestBuilder,
        cancel: &CancellationToken,
    ) -> Result<reqwest::RequestBuilder> {
        let credential = if self.provider.kind == ProviderKind::Codex {
            oauth::fresh_credential(
                &self.provider.id,
                &self.store,
                &self.http,
                &self.token_url,
                cancel,
            )
            .await?
        } else {
            self.store
                .load(&self.provider.id)?
                .ok_or_else(|| ProviderError::new(ErrorCode::MissingCredentials))?
        };
        match (self.provider.kind, credential) {
            (ProviderKind::OpenAiCompatible, Credential::ApiKey(key)) => {
                if key.expose().is_empty() {
                    Ok(builder)
                } else {
                    Ok(builder.bearer_auth(key.expose()))
                }
            }
            (
                ProviderKind::Codex,
                Credential::Codex {
                    access_token,
                    account_id,
                    ..
                },
            ) => Ok(builder
                .bearer_auth(access_token.expose())
                .header("ChatGPT-Account-ID", account_id)
                .header("originator", "codex_cli_rs")
                .header(
                    "User-Agent",
                    format!(
                        "AgentDeck/{} codex_cli_rs/{CODEX_CLIENT_VERSION}",
                        env!("CARGO_PKG_VERSION")
                    ),
                )),
            _ => Err(ProviderError::new(ErrorCode::MissingCredentials)),
        }
    }
    pub async fn discover_models(&self, cancel: &CancellationToken) -> Result<Vec<Model>> {
        tokio::select! { biased; _ = cancel.cancelled() => Err(ProviderError::new(ErrorCode::Cancelled)), result = self.discover_inner(cancel) => result }
    }
    async fn discover_inner(&self, cancel: &CancellationToken) -> Result<Vec<Model>> {
        let mut url = self.endpoint("models");
        if self.provider.kind == ProviderKind::Codex {
            url.query_pairs_mut()
                .append_pair("client_version", CODEX_CLIENT_VERSION);
        }
        let response = self
            .authorize(self.http.get(url), cancel)
            .await?
            .send()
            .await
            .map_err(|_| ProviderError::new(ErrorCode::Transport))?;
        let value = bounded_json(response).await?;
        let items = if self.provider.kind == ProviderKind::Codex {
            &value["models"]
        } else {
            &value["data"]
        };
        let items = items
            .as_array()
            .ok_or_else(|| ProviderError::new(ErrorCode::InvalidResponse))?;
        if items.len() > 10000 {
            return Err(ProviderError::new(ErrorCode::InvalidResponse));
        }
        items
            .iter()
            .map(|item| {
                let id = item["id"]
                    .as_str()
                    .or_else(|| item["slug"].as_str())
                    .filter(|id| !id.is_empty() && id.len() <= 512)
                    .ok_or_else(|| ProviderError::new(ErrorCode::InvalidResponse))?;
                let display_name = item["display_name"].as_str().unwrap_or(id);
                if display_name.len() > 1024 {
                    return Err(ProviderError::new(ErrorCode::InvalidResponse));
                }
                Ok(Model {
                    id: id.into(),
                    display_name: display_name.into(),
                })
            })
            .collect()
    }
    pub async fn complete(
        &self,
        model: &str,
        messages: &[Message],
        cancel: &CancellationToken,
    ) -> Result<String> {
        self.stream(model, messages, cancel, |_| {}).await
    }
    /// Callback is synchronous and receives deltas once; batch persistence/UI updates downstream.
    /// Cancellation drops the HTTP future/socket. Never automatically retries an uncertain call.
    pub async fn stream<F: FnMut(&str) + Send>(
        &self,
        model: &str,
        messages: &[Message],
        cancel: &CancellationToken,
        on_delta: F,
    ) -> Result<String> {
        tokio::select! { biased; _ = cancel.cancelled() => Err(ProviderError::new(ErrorCode::Cancelled)), result = self.stream_inner(model, messages, cancel, on_delta) => result }
    }
    async fn stream_inner<F: FnMut(&str) + Send>(
        &self,
        model: &str,
        messages: &[Message],
        cancel: &CancellationToken,
        mut on_delta: F,
    ) -> Result<String> {
        if model.trim().is_empty()
            || model.len() > 512
            || messages.is_empty()
            || messages.len() > 10000
            || messages.iter().map(|m| m.content.len()).sum::<usize>() > MAX_BODY
        {
            return Err(ProviderError::new(ErrorCode::InvalidConfiguration));
        }
        let codex = self.provider.kind == ProviderKind::Codex;
        let body = if codex {
            let instructions = messages
                .iter()
                .filter(|m| m.role == Role::System)
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            let input: Vec<_> = messages.iter().filter(|m| m.role != Role::System).map(|m| json!({"role": m.role, "content": [{"type": if m.role == Role::Assistant { "output_text" } else { "input_text" }, "text": m.content}]})).collect();
            json!({"model":model, "instructions":instructions, "input":input, "stream":true, "store":false})
        } else {
            json!({"model":model, "messages":messages, "stream":true})
        };
        let path = if codex {
            "responses"
        } else {
            "chat/completions"
        };
        let mut response = self
            .authorize(
                self.http
                    .post(self.endpoint(path))
                    .header("Accept", "text/event-stream")
                    .json(&body),
                cancel,
            )
            .await?
            .send()
            .await
            .map_err(|_| ProviderError::new(ErrorCode::Transport))?;
        check_status(&response)?;
        if !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("text/event-stream"))
            })
        {
            return Err(ProviderError::new(ErrorCode::InvalidResponse));
        }
        let mut decoder = sse::Decoder::default();
        let mut answer = String::new();
        let mut wire = 0;
        let mut stopped = false;
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(45), response.chunk())
            .await
            .map_err(|_| ProviderError::new(ErrorCode::IncompleteStream))?
            .map_err(|_| ProviderError::new(ErrorCode::IncompleteStream))?
        {
            wire += chunk.len();
            if wire > MAX_WIRE {
                return Err(ProviderError::new(ErrorCode::InvalidResponse));
            }
            for event in decoder.push(&chunk)? {
                if !codex && event.trim() == "[DONE]" {
                    if !stopped || answer.trim().is_empty() {
                        return Err(ProviderError::new(ErrorCode::IncompleteStream));
                    }
                    return Ok(answer);
                }
                let value: Value = serde_json::from_str(&event)
                    .map_err(|_| ProviderError::new(ErrorCode::InvalidResponse))?;
                if value.get("error").is_some() {
                    return Err(ProviderError::new(ErrorCode::InvalidResponse));
                }
                let delta = if codex {
                    match value["type"].as_str() {
                        Some("response.output_text.delta") => value["delta"]
                            .as_str()
                            .ok_or_else(|| ProviderError::new(ErrorCode::InvalidResponse))?,
                        Some("response.completed") => {
                            if value["response"]["status"] != "completed"
                                || answer.trim().is_empty()
                            {
                                return Err(ProviderError::new(ErrorCode::IncompleteStream));
                            }
                            return Ok(answer);
                        }
                        Some("response.failed" | "response.incomplete" | "error") => {
                            return Err(ProviderError::new(ErrorCode::IncompleteStream));
                        }
                        _ => "",
                    }
                } else {
                    let choices = value["choices"]
                        .as_array()
                        .ok_or_else(|| ProviderError::new(ErrorCode::InvalidResponse))?;
                    if choices.is_empty() {
                        continue;
                    }
                    if choices.len() != 1 {
                        return Err(ProviderError::new(ErrorCode::InvalidResponse));
                    }
                    let choice = &choices[0];
                    if let Some(reason) = choice["finish_reason"].as_str() {
                        if reason != "stop" {
                            return Err(ProviderError::new(ErrorCode::IncompleteStream));
                        }
                        stopped = true;
                    }
                    if choice["delta"].get("tool_calls").is_some()
                        || choice["delta"].get("function_call").is_some()
                    {
                        return Err(ProviderError::new(ErrorCode::IncompleteStream));
                    }
                    match choice["delta"].get("content") {
                        Some(Value::String(s)) => s.as_str(),
                        None | Some(Value::Null) => "",
                        _ => return Err(ProviderError::new(ErrorCode::InvalidResponse)),
                    }
                };
                if answer.len() + delta.len() > MAX_ANSWER {
                    return Err(ProviderError::new(ErrorCode::InvalidResponse));
                }
                if !delta.is_empty() {
                    answer.push_str(delta);
                    on_delta(delta);
                }
            }
        }
        Err(ProviderError::new(ErrorCode::IncompleteStream))
    }
}

#[cfg(test)]
mod tests;
