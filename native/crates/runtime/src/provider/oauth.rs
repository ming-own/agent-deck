// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Protocol constants retained from electron/main/subscriptionAuth/codexOAuth.ts;
// native PKCE, listener, token lifecycle and validation are implemented here.
//! Native OAuth: no resolver process, CLI execution, plaintext token file or env override.
use super::*;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, Weak},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex as AsyncMutex,
};
pub(crate) const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT: &str = "http://localhost:1455/auth/callback";
const EXPIRY: Duration = Duration::from_secs(600);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OAuthStatus {
    Pending,
    Connected,
    Cancelled,
    Failed(ErrorCode),
}
/// Owns a single callback listener. Cancelling/dropping signals its task to close.
/// Poll `status()` for metadata; tokens never cross the authentication API.
///
/// Cancel/drop synchronizes with final credential publication and can wait for
/// an already-started synchronous private-store write. After it returns, this
/// login cannot publish again. To disconnect or replace credentials, first
/// cancel/drop this handle, then delete/save the credential. Do not reverse
/// that order. Publication that already won the guard may complete before
/// cancellation; cancellation alone does not delete a connected credential.
pub struct OAuthLogin {
    pub authorization_url: String,
    status: Arc<Mutex<OAuthStatus>>,
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}
impl OAuthLogin {
    /// Nonblocking metadata poll. A guarded private-store publication is Pending
    /// until its synchronous write has finished; polling never waits on Keychain.
    pub fn status(&self) -> OAuthStatus {
        match self.status.try_lock() {
            Ok(status) => status.clone(),
            Err(std::sync::TryLockError::WouldBlock) => OAuthStatus::Pending,
            Err(std::sync::TryLockError::Poisoned(_)) => {
                OAuthStatus::Failed(ErrorCode::CredentialStore)
            }
        }
    }
    /// Synchronous publication barrier, also used by Drop. May wait for a private
    /// store write in progress; no auth credential can be saved after return.
    pub fn cancel(&self) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.cancel.cancel();
        self.task.abort();
        if *status == OAuthStatus::Pending {
            *status = OAuthStatus::Cancelled;
        }
    }
}
impl Drop for OAuthLogin {
    fn drop(&mut self) {
        self.cancel();
    }
}
/// Binds IPv4 loopback port 1455; UI opens the returned URL in the system browser.
/// Port conflicts are reported as a sanitized transport failure, never stolen.
pub async fn begin_codex_login(
    provider_id: &str,
    store: Arc<dyn CredentialStore>,
) -> Result<OAuthLogin> {
    credentials::validate_id(provider_id)?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 1455))
        .await
        .map_err(|_| ProviderError::new(ErrorCode::Transport))?;
    begin_with_listener(
        provider_id.to_owned(),
        store,
        listener,
        Url::parse(TOKEN_URL).expect("constant URL"),
        REDIRECT.to_owned(),
        EXPIRY,
    )
    .await
}
struct Pkce {
    state: String,
    verifier: SecretString,
    expires: tokio::time::Instant,
}
impl Pkce {
    fn new(ttl: Duration) -> Self {
        Self {
            state: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            verifier: SecretString::new(format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            )),
            expires: tokio::time::Instant::now() + ttl.min(EXPIRY),
        }
    }
    fn auth_url(&self, redirect: &str) -> String {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.expose().as_bytes()));
        let mut url = Url::parse(AUTH_URL).expect("constant URL");
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect),
            ("scope", "openid profile email offline_access"),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("state", &self.state),
            ("originator", "codex_cli_rs"),
            ("id_token_add_organizations", "true"),
            ("codex_cli_simplified_flow", "true"),
        ]);
        url.into()
    }
    fn code(&self, target: &str) -> Result<String> {
        if tokio::time::Instant::now() >= self.expires {
            return Err(ProviderError::new(ErrorCode::OAuthExpired));
        }
        if !target.starts_with("/auth/callback?") {
            return Err(ProviderError::new(ErrorCode::OAuthState));
        }
        let url = Url::parse(&format!("http://localhost{target}"))
            .map_err(|_| ProviderError::new(ErrorCode::OAuthState))?;
        if url.path() != "/auth/callback" || url.fragment().is_some() {
            return Err(ProviderError::new(ErrorCode::OAuthState));
        }
        let mut params = HashMap::new();
        for (key, value) in url.query_pairs() {
            if params.insert(key.to_string(), value.to_string()).is_some() {
                return Err(ProviderError::new(ErrorCode::OAuthState));
            }
        }
        if params.get("state") != Some(&self.state) || params.contains_key("error") {
            return Err(ProviderError::new(ErrorCode::OAuthState));
        }
        params
            .remove("code")
            .filter(|s| !s.is_empty() && s.len() <= 4096)
            .ok_or_else(|| ProviderError::new(ErrorCode::OAuthState))
    }
}
async fn begin_with_listener(
    id: String,
    store: Arc<dyn CredentialStore>,
    listener: TcpListener,
    token_url: Url,
    redirect: String,
    ttl: Duration,
) -> Result<OAuthLogin> {
    let pkce = Pkce::new(ttl);
    let authorization_url = pkce.auth_url(&redirect);
    let deadline = pkce.expires;
    let status = Arc::new(Mutex::new(OAuthStatus::Pending));
    let update = status.clone();
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    let http = http_client()?;
    let task = tokio::spawn(async move {
        let result = tokio::select! { biased; _ = stop.cancelled() => Err(ProviderError::new(ErrorCode::Cancelled)), _ = tokio::time::sleep_until(deadline) => Err(ProviderError::new(ErrorCode::OAuthExpired)), result = callback(listener, &pkce, &http, &token_url, &redirect) => result };
        // Private stores are synchronous and may wait on OS authentication UI.
        // Keep that wait off Tokio workers so callback timers and other model
        // tasks remain responsive while the publication guard is held.
        let _ = tokio::task::spawn_blocking(move || {
            // This guard linearizes publication with cancel/Drop. A token check
            // followed by an unlocked save would still allow a late credential to
            // restore a connection after the caller cancels and deletes it.
            if let Ok(mut status) = update.lock()
                && *status == OAuthStatus::Pending
            {
                *status = if stop.is_cancelled() {
                    OAuthStatus::Cancelled
                } else {
                    match result.and_then(|credential| store.save(&id, credential)) {
                        Ok(()) => OAuthStatus::Connected,
                        Err(e) if e.code == ErrorCode::Cancelled => OAuthStatus::Cancelled,
                        Err(e) => OAuthStatus::Failed(e.code),
                    }
                };
            }
        })
        .await;
    });
    Ok(OAuthLogin {
        authorization_url,
        status,
        cancel,
        task,
    })
}
async fn callback(
    listener: TcpListener,
    pkce: &Pkce,
    http: &Client,
    token_url: &Url,
    redirect: &str,
) -> Result<Credential> {
    let expected_host = Url::parse(redirect)
        .expect("internal redirect")
        .authority()
        .to_owned();
    // Invalid unsolicited paths/hosts do not consume the sign-in. State failures
    // on the exact callback terminate it so UI can show an actionable failure.
    loop {
        let (mut socket, peer) = listener
            .accept()
            .await
            .map_err(|_| ProviderError::new(ErrorCode::Transport))?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let mut bytes = Vec::new();
        let parsed = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let mut chunk = [0; 1024];
                let n = socket
                    .read(&mut chunk)
                    .await
                    .map_err(|_| ProviderError::new(ErrorCode::OAuthState))?;
                if n == 0 || bytes.len() + n > 8192 {
                    return Err(ProviderError::new(ErrorCode::OAuthState));
                }
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| ProviderError::new(ErrorCode::OAuthState))?;
            let mut lines = text.split("\r\n");
            let mut first = lines.next().unwrap_or("").split(' ');
            if first.next() != Some("GET") {
                return Ok(None);
            }
            let target = first.next().unwrap_or("");
            if first.next() != Some("HTTP/1.1") || first.next().is_some() {
                return Ok(None);
            }
            let hosts: Vec<_> = lines
                .filter_map(|line| line.split_once(':'))
                .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
                .map(|(_, v)| v.trim())
                .collect();
            if hosts != [expected_host.as_str()] || !target.starts_with("/auth/callback?") {
                return Ok(None);
            }
            pkce.code(target).map(Some)
        })
        .await;
        let code = match parsed {
            Ok(Ok(Some(code))) => code,
            Ok(Err(e)) => {
                let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 16\r\nConnection: close\r\n\r\nSign-in rejected").await;
                return Err(e);
            }
            _ => {
                let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad request").await;
                continue;
            }
        };
        let result = exchange(
            http,
            token_url,
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", redirect),
                ("client_id", CLIENT_ID),
                ("code_verifier", pkce.verifier.expose()),
            ],
            None,
        )
        .await;
        // Fixed browser response never includes state, code, tokens or upstream text.
        let reply = if result.is_ok() {
            b"Sign-in received".as_slice()
        } else {
            b"Sign-in rejected".as_slice()
        };
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n",
            reply.len()
        );
        let _ = socket.write_all(head.as_bytes()).await;
        let _ = socket.write_all(reply).await;
        return result;
    }
}
fn account_claim(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value["https://api.openai.com/auth"]["chatgpt_account_id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn decode_token(value: Value, previous: Option<&Credential>) -> Result<Credential> {
    let invalid = || ProviderError::new(ErrorCode::InvalidResponse);
    let access = value["access_token"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 65536)
        .ok_or_else(invalid)?;
    let (old_refresh, old_account) = match previous {
        Some(Credential::Codex {
            refresh_token,
            account_id,
            ..
        }) => (Some(refresh_token.expose()), Some(account_id.as_str())),
        _ => (None, None),
    };
    let refresh = value["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or(old_refresh)
        .ok_or_else(invalid)?;
    if refresh.len() > 65536 {
        return Err(invalid());
    }
    let account = value["id_token"]
        .as_str()
        .and_then(account_claim)
        .or_else(|| account_claim(access))
        .or_else(|| old_account.map(str::to_owned))
        .ok_or_else(invalid)?;
    if old_account.is_some_and(|old| old != account) {
        return Err(ProviderError::new(ErrorCode::Unauthorized));
    }
    let expires = value["expires_in"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 31_536_000)
        .ok_or_else(invalid)?;
    Ok(Credential::Codex {
        access_token: SecretString::new(access),
        refresh_token: SecretString::new(refresh),
        account_id: account,
        expires_at: now().saturating_add(expires),
    })
}
async fn exchange(
    http: &Client,
    token_url: &Url,
    form: &[(&str, &str)],
    previous: Option<&Credential>,
) -> Result<Credential> {
    let response = http
        .post(token_url.clone())
        .form(form)
        .send()
        .await
        .map_err(|_| ProviderError::new(ErrorCode::Transport))?;
    if response.status() == StatusCode::BAD_REQUEST {
        return Err(ProviderError::new(ErrorCode::Unauthorized));
    }
    let value = bounded_json(response).await?;
    decode_token(value, previous)
}
// Account locks coordinate different ProviderClient instances. Weak entries don't
// retain credentials and are pruned; provider lock also serializes initial load.
fn refresh_lock(key: String) -> Arc<AsyncMutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Weak<AsyncMutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, value| value.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(AsyncMutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}
pub(crate) async fn fresh_credential(
    id: &str,
    store: &Arc<dyn CredentialStore>,
    http: &Client,
    token_url: &Url,
    cancel: &CancellationToken,
) -> Result<Credential> {
    let (id, store, http, token_url, stop) = (
        id.to_owned(),
        store.clone(),
        http.clone(),
        token_url.clone(),
        cancel.clone(),
    );
    // A rotating token grant is a credential transaction. Once sent, finish and
    // persist it even if its caller cancels/drops the model request. The detached
    // task owns the locks until completion; no second grant can race it.
    let task =
        tokio::spawn(
            async move { refresh_transaction(&id, &store, &http, &token_url, &stop).await },
        );
    tokio::select! { biased;
        _ = cancel.cancelled() => Err(ProviderError::new(ErrorCode::Cancelled)),
        result = task => result.map_err(|_| ProviderError::new(ErrorCode::Transport))?,
    }
}
async fn refresh_transaction(
    id: &str,
    store: &Arc<dyn CredentialStore>,
    http: &Client,
    token_url: &Url,
    cancel: &CancellationToken,
) -> Result<Credential> {
    let provider_lock = refresh_lock(format!("provider:{id}"));
    let _provider_guard = tokio::select! { biased; _ = cancel.cancelled() => return Err(ProviderError::new(ErrorCode::Cancelled)), guard = provider_lock.lock() => guard };
    let value = store
        .load(id)?
        .ok_or_else(|| ProviderError::new(ErrorCode::MissingCredentials))?;
    let Credential::Codex { account_id, .. } = &value else {
        return Err(ProviderError::new(ErrorCode::MissingCredentials));
    };
    let lock = refresh_lock(format!("account:{account_id}"));
    let _guard = tokio::select! { biased; _ = cancel.cancelled() => return Err(ProviderError::new(ErrorCode::Cancelled)), guard = lock.lock() => guard };
    let value = store
        .load(id)?
        .ok_or_else(|| ProviderError::new(ErrorCode::MissingCredentials))?;
    let Credential::Codex {
        expires_at,
        refresh_token,
        ..
    } = &value
    else {
        return Err(ProviderError::new(ErrorCode::MissingCredentials));
    };
    if *expires_at > now().saturating_add(60) {
        return Ok(value);
    }
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.expose()),
        ("client_id", CLIENT_ID),
    ];
    if cancel.is_cancelled() {
        return Err(ProviderError::new(ErrorCode::Cancelled));
    }
    let refreshed = exchange(http, token_url, &form, Some(&value)).await?;
    if !store.replace_if_unchanged(id, &value, refreshed.clone())? {
        return Err(ProviderError::new(ErrorCode::Cancelled));
    }
    Ok(refreshed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn jwt(account: &str) -> String {
        format!(
            "header.{}.signature",
            URL_SAFE_NO_PAD.encode(
                json!({"https://api.openai.com/auth":{"chatgpt_account_id":account}}).to_string()
            )
        )
    }
    fn token(access: &str) -> Value {
        json!({"access_token":access,"refresh_token":"new-private-refresh","expires_in":3600,"id_token":jwt("account")})
    }
    #[tokio::test]
    async fn pkce_validates_state_code_duplicates_and_expiry() {
        let mut pkce = Pkce::new(EXPIRY);
        let url = Url::parse(&pkce.auth_url(REDIRECT)).unwrap();
        let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(params["code_challenge_method"], "S256");
        assert_eq!(
            params["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(pkce.verifier.expose().as_bytes()))
        );
        assert_eq!(
            pkce.code(&format!("/auth/callback?state={}&code=ok", pkce.state))
                .unwrap(),
            "ok"
        );
        for target in [
            "/auth/callback?state=wrong&code=private-code".to_owned(),
            format!("/auth/callback?state={}", pkce.state),
            format!("/auth/callback?state={}&code=x&code=y", pkce.state),
            format!("/elsewhere?state={}&code=x", pkce.state),
        ] {
            let error = pkce.code(&target).unwrap_err();
            assert_eq!(error.code, ErrorCode::OAuthState);
            assert!(!format!("{error:?}").contains("private-code"));
        }
        pkce.expires = tokio::time::Instant::now();
        assert_eq!(
            pkce.code("/auth/callback?code=x").unwrap_err().code,
            ErrorCode::OAuthExpired
        );
    }
    #[test]
    fn token_claims_and_missing_or_changed_accounts_are_checked() {
        let value = decode_token(token("private-access"), None).unwrap();
        assert!(!format!("{value:?}").contains("private-access"));
        assert!(matches!(&value,Credential::Codex{account_id,..} if account_id=="account"));
        assert!(decode_token(json!({"access_token":"private-access","refresh_token":"private-refresh","expires_in":3600,"id_token":"broken"}),None).is_err());
        let mut changed = token("private-access");
        changed["id_token"] = json!(jwt("different"));
        assert_eq!(
            decode_token(changed, Some(&value)).unwrap_err().code,
            ErrorCode::Unauthorized
        );
        let without_rotation = json!({"access_token":"new-access","expires_in":3600});
        assert!(decode_token(without_rotation, Some(&value)).is_ok());
    }
    async fn token_fixture(status: &str, body: Value) -> (Url, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_string();
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut bytes = [0; 1024];
                let n = socket.read(&mut bytes).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&bytes[..n]);
                if let Some(i) = request.windows(4).position(|s| s == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..i]);
                    let len = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= i + 4 + len {
                        break;
                    }
                }
            }
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(body.as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });
        (
            Url::parse(&format!("http://{address}/oauth/token")).unwrap(),
            task,
        )
    }
    fn expired() -> Credential {
        Credential::Codex {
            access_token: SecretString::new("old-private-access"),
            refresh_token: SecretString::new("old-private-refresh"),
            expires_at: 0,
            account_id: "account".into(),
        }
    }
    #[tokio::test]
    async fn refresh_is_serialized_persisted_and_uses_refresh_grant() {
        let (url, task) = token_fixture("200 OK", token("new-private-access")).await;
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        store.save("refresh", expired()).unwrap();
        let http = http_client().unwrap();
        let cancel = CancellationToken::new();
        let (a, b) = tokio::join!(
            fresh_credential("refresh", &store, &http, &url, &cancel),
            fresh_credential("refresh", &store, &http, &url, &cancel)
        );
        assert_eq!(a.unwrap(), b.unwrap());
        assert!(
            matches!(store.load("refresh").unwrap(),Some(Credential::Codex{access_token,..}) if access_token.expose()=="new-private-access")
        );
        let request = task.await.unwrap();
        assert!(request.contains("grant_type=refresh_token"));
        assert!(request.contains("refresh_token=old-private-refresh"));
        assert!(!request.contains("old-private-access"));
    }
    #[tokio::test]
    async fn rejected_refresh_preserves_credential_and_redacts_server_error() {
        let (url, task) = token_fixture(
            "400 Bad Request",
            json!({"error":"invalid_grant","error_description":"old-private-refresh"}),
        )
        .await;
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        store.save("failed-refresh", expired()).unwrap();
        let error = fresh_credential(
            "failed-refresh",
            &store,
            &http_client().unwrap(),
            &url,
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Unauthorized);
        assert!(!format!("{error:?} {error}").contains("old-private-refresh"));
        assert_eq!(store.load("failed-refresh").unwrap(), Some(expired()));
        task.await.unwrap();
    }
    async fn wait_status(login: &OAuthLogin) -> OAuthStatus {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let status = login.status();
                if status != OAuthStatus::Pending {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn oauth_callback_exchanges_code_and_only_exposes_metadata() {
        let (url, task) = token_fixture("200 OK", token("private-access")).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let redirect = format!("http://localhost:{}/auth/callback", address.port());
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        let login = begin_with_listener(
            "login".into(),
            store.clone(),
            listener,
            url,
            redirect.clone(),
            EXPIRY,
        )
        .await
        .unwrap();
        let auth = Url::parse(&login.authorization_url).unwrap();
        let state = auth
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        // Wrong host/path rejected without consuming the listener.
        for request in [
            format!(
                "GET /auth/callback?state={state}&code=private-code HTTP/1.1\r\nHost: attacker.example\r\n\r\n"
            ),
            format!(
                "GET /wrong HTTP/1.1\r\nHost: localhost:{}\r\n\r\n",
                address.port()
            ),
        ] {
            let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
            socket.write_all(request.as_bytes()).await.unwrap();
            let mut bytes = Vec::new();
            socket.read_to_end(&mut bytes).await.unwrap();
            assert!(bytes.starts_with(b"HTTP/1.1 400"));
            assert_eq!(login.status(), OAuthStatus::Pending);
        }
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("GET /auth/callback?state={state}&code=private-code HTTP/1.1\r\nHost: localhost:{}\r\n\r\n",address.port()).as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).await.unwrap();
        let browser = String::from_utf8(bytes).unwrap();
        assert!(!browser.contains("private"));
        assert_eq!(wait_status(&login).await, OAuthStatus::Connected);
        assert!(store.status("login").unwrap().configured);
        let request = task.await.unwrap();
        assert!(request.contains("grant_type=authorization_code"));
        assert!(request.contains("code_verifier="));
        assert!(request.contains("code=private-code"));
        assert!(TcpListener::bind(address).await.is_ok());
        login.cancel();
        assert_eq!(login.status(), OAuthStatus::Connected);
    }
    #[tokio::test]
    async fn oauth_expiry_and_cancellation_close_owned_listeners() {
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let login = begin_with_listener(
            "expiry".into(),
            store.clone(),
            listener,
            Url::parse(TOKEN_URL).unwrap(),
            REDIRECT.into(),
            Duration::ZERO,
        )
        .await
        .unwrap();
        assert_eq!(
            wait_status(&login).await,
            OAuthStatus::Failed(ErrorCode::OAuthExpired)
        );
        assert!(TcpListener::bind(address).await.is_ok());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let login = begin_with_listener(
            "cancel".into(),
            store,
            listener,
            Url::parse(TOKEN_URL).unwrap(),
            REDIRECT.into(),
            EXPIRY,
        )
        .await
        .unwrap();
        login.cancel();
        assert_eq!(login.status(), OAuthStatus::Cancelled);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if TcpListener::bind(address).await.is_ok() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
    struct PublicationBarrierStore {
        inner: MemoryCredentialStore,
        gate: (Mutex<(bool, bool)>, std::sync::Condvar),
        entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        published: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    }
    impl PublicationBarrierStore {
        fn release(&self) {
            self.gate.0.lock().unwrap().1 = true;
            self.gate.1.notify_all();
        }
    }
    impl CredentialStore for PublicationBarrierStore {
        fn load(&self, id: &str) -> Result<Option<Credential>> {
            self.inner.load(id)
        }
        fn delete(&self, id: &str) -> Result<()> {
            self.inner.delete(id)
        }
        fn replace_if_unchanged(
            &self,
            id: &str,
            expected: &Credential,
            replacement: Credential,
        ) -> Result<bool> {
            self.inner.replace_if_unchanged(id, expected, replacement)
        }
        fn save(&self, id: &str, credential: Credential) -> Result<()> {
            let first = {
                let mut gate = self.gate.0.lock().unwrap();
                let first = !gate.0;
                gate.0 = true;
                first
            };
            if first {
                let _ = self.entered.lock().unwrap().take().unwrap().send(());
                let mut gate = self.gate.0.lock().unwrap();
                while !gate.1 {
                    gate = self.gate.1.wait(gate).unwrap();
                }
            }
            self.inner.save(id, credential)?;
            if first {
                let _ = self.published.lock().unwrap().take().unwrap().send(());
            }
            Ok(())
        }
    }
    struct ReleasePublicationOnDrop(Arc<PublicationBarrierStore>);
    impl Drop for ReleasePublicationOnDrop {
        fn drop(&mut self) {
            self.0.release();
        }
    }
    async fn assert_publication_linearizes_before_connection_change(
        replacement: bool,
        poll_status: bool,
    ) {
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (published_tx, published_rx) = tokio::sync::oneshot::channel();
        let store = Arc::new(PublicationBarrierStore {
            inner: MemoryCredentialStore::default(),
            gate: (Mutex::new((false, false)), std::sync::Condvar::new()),
            entered: Mutex::new(Some(entered_tx)),
            published: Mutex::new(Some(published_tx)),
        });
        // A real Tokio timeout cannot bound a regression that starves the
        // scheduler itself. The OS-thread watchdog releases only the artificial
        // store gate and fails the test instead of hanging the entire suite.
        let (watch_tx, watch_rx) = std::sync::mpsc::channel();
        let watch_store = store.clone();
        let watchdog = std::thread::spawn(move || {
            if watch_rx.recv_timeout(Duration::from_secs(2)).is_err() {
                watch_store.release();
                true
            } else {
                false
            }
        });
        let (url, token_task) = token_fixture("200 OK", token("private-access")).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let login = begin_with_listener(
            "publication".into(),
            store.clone(),
            listener,
            url,
            format!("http://localhost:{}/auth/callback", address.port()),
            EXPIRY,
        )
        .await
        .unwrap();
        let _release_on_panic = ReleasePublicationOnDrop(store.clone());
        let auth = Url::parse(&login.authorization_url).unwrap();
        let state = auth
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("GET /auth/callback?state={state}&code=private-code HTTP/1.1\r\nHost: localhost:{}\r\n\r\n", address.port()).as_bytes()).await.unwrap();
        entered_rx.await.unwrap();
        token_task.await.unwrap();
        // The auth worker is now inside save but paused before mutating its store.
        if poll_status {
            assert_eq!(
                login.status(),
                OAuthStatus::Pending,
                "status polling must not wait for private-store publication"
            );
        }
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finished_tx, mut finished_rx) = tokio::sync::oneshot::channel();
        let disconnect_store = store.clone();
        let disconnect = std::thread::spawn(move || {
            let _ = started_tx.send(());
            if replacement {
                drop(login);
                disconnect_store
                    .save(
                        "publication",
                        Credential::ApiKey(SecretString::new("replacement")),
                    )
                    .unwrap();
            } else {
                login.cancel();
                disconnect_store.delete("publication").unwrap();
            }
            let _ = finished_tx.send(());
        });
        started_rx.await.unwrap();
        let completed_before_publication =
            tokio::time::timeout(Duration::from_millis(50), &mut finished_rx)
                .await
                .is_ok();
        store.release();
        published_rx.await.unwrap();
        disconnect.join().unwrap();
        let _ = watch_tx.send(());
        let watchdog_released_gate = watchdog.join().unwrap();
        if !completed_before_publication {
            finished_rx.await.unwrap();
        }
        assert!(
            !watchdog_released_gate,
            "blocking OAuth publication starved the runtime timer"
        );
        let expected = replacement.then(|| Credential::ApiKey(SecretString::new("replacement")));
        assert_eq!(
            store.load("publication").unwrap(),
            expected,
            "late OAuth publication overwrote disconnect/replacement"
        );
        assert!(
            !completed_before_publication,
            "cancel/drop returned before an active credential publication completed"
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn polling_login_status_does_not_wait_for_store_publication() {
        assert_publication_linearizes_before_connection_change(false, true).await;
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cancelling_login_linearizes_before_disconnect() {
        assert_publication_linearizes_before_connection_change(false, false).await;
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn dropping_login_linearizes_before_replacement() {
        assert_publication_linearizes_before_connection_change(true, false).await;
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    #[tokio::test]
    async fn cancelling_request_during_refresh_does_not_discard_rotated_token() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("http://{}/token", listener.local_addr().unwrap())).unwrap();
        let (received_tx, received_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            let _ = received_tx.send(());
            let _ = release_rx.await;
            let body=json!({"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600}).to_string();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(reply.as_bytes()).await;
        });
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        store
            .save(
                "refresh-cancel",
                Credential::Codex {
                    access_token: SecretString::new("old"),
                    refresh_token: SecretString::new("old-refresh"),
                    account_id: "account".into(),
                    expires_at: 0,
                },
            )
            .unwrap();
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        let owned = store.clone();
        let request = tokio::spawn(async move {
            fresh_credential(
                "refresh-cancel",
                &owned,
                &http_client().unwrap(),
                &url,
                &cancel,
            )
            .await
        });
        received_rx.await.unwrap();
        trigger.cancel();
        assert_eq!(
            request.await.unwrap().unwrap_err().code,
            ErrorCode::Cancelled
        );
        release_tx.send(()).unwrap();
        server.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if matches!(store.load("refresh-cancel").unwrap(),Some(Credential::Codex{refresh_token,..}) if refresh_token.expose()=="rotated-refresh") { break; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
    }
}

#[cfg(test)]
mod disconnect_tests {
    use super::*;
    #[tokio::test]
    async fn in_flight_refresh_cannot_restore_deleted_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("http://{}/token", listener.local_addr().unwrap())).unwrap();
        let (received_tx, received_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            let _ = socket.read(&mut bytes).await.unwrap();
            let _ = received_tx.send(());
            let _ = release_rx.await;
            let body=json!({"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600}).to_string();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(reply.as_bytes()).await;
        });
        let store: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        store
            .save(
                "disconnect",
                Credential::Codex {
                    access_token: SecretString::new("old"),
                    refresh_token: SecretString::new("old-refresh"),
                    expires_at: 0,
                    account_id: "account".into(),
                },
            )
            .unwrap();
        let owned = store.clone();
        let request = tokio::spawn(async move {
            fresh_credential(
                "disconnect",
                &owned,
                &http_client().unwrap(),
                &url,
                &CancellationToken::new(),
            )
            .await
        });
        received_rx.await.unwrap();
        store.delete("disconnect").unwrap();
        release_tx.send(()).unwrap();
        let error = request.await.unwrap().unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        server.await.unwrap();
        assert!(store.load("disconnect").unwrap().is_none());
    }
}
