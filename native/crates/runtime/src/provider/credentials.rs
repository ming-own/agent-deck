//! Private credentials. These types deliberately do not implement Serialize.
use super::{ErrorCode, ProviderError, Result};
use std::{collections::BTreeMap, fmt, sync::Mutex};

#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);
impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Credential {
    /// Save an explicit empty key for a local server requiring no authentication.
    ApiKey(SecretString),
    /// expires_at is Unix seconds; account_id is routing metadata from OAuth claims.
    Codex {
        access_token: SecretString,
        refresh_token: SecretString,
        expires_at: u64,
        account_id: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuthenticationStatus {
    pub configured: bool,
    pub expires_at: Option<u64>,
}
/// Implementations must keep secrets outside product snapshots and sanitize errors.
pub trait CredentialStore: Send + Sync {
    fn load(&self, provider_id: &str) -> Result<Option<Credential>>;
    fn save(&self, provider_id: &str, credential: Credential) -> Result<()>;
    fn delete(&self, provider_id: &str) -> Result<()>;
    /// Atomically replace only an unchanged entry. Must serialize with save/delete.
    /// Refresh uses this to avoid restoring a disconnected or reconfigured account.
    fn replace_if_unchanged(
        &self,
        provider_id: &str,
        expected: &Credential,
        replacement: Credential,
    ) -> Result<bool>;
    fn status(&self, provider_id: &str) -> Result<AuthenticationStatus> {
        Ok(match self.load(provider_id)? {
            None => AuthenticationStatus {
                configured: false,
                expires_at: None,
            },
            Some(Credential::ApiKey(_)) => AuthenticationStatus {
                configured: true,
                expires_at: None,
            },
            Some(Credential::Codex { expires_at, .. }) => AuthenticationStatus {
                configured: true,
                expires_at: Some(expires_at),
            },
        })
    }
}
pub(crate) fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(ProviderError::new(ErrorCode::InvalidConfiguration));
    }
    Ok(())
}
/// Ephemeral store for fixture tests and explicitly ephemeral sessions; never a fallback.
#[derive(Default)]
pub struct MemoryCredentialStore(Mutex<BTreeMap<String, Credential>>);
impl CredentialStore for MemoryCredentialStore {
    fn load(&self, id: &str) -> Result<Option<Credential>> {
        validate_id(id)?;
        Ok(self
            .0
            .lock()
            .map_err(|_| ProviderError::new(ErrorCode::CredentialStore))?
            .get(id)
            .cloned())
    }
    fn save(&self, id: &str, credential: Credential) -> Result<()> {
        validate_id(id)?;
        self.0
            .lock()
            .map_err(|_| ProviderError::new(ErrorCode::CredentialStore))?
            .insert(id.into(), credential);
        Ok(())
    }
    fn replace_if_unchanged(
        &self,
        id: &str,
        expected: &Credential,
        replacement: Credential,
    ) -> Result<bool> {
        validate_id(id)?;
        let mut values = self
            .0
            .lock()
            .map_err(|_| ProviderError::new(ErrorCode::CredentialStore))?;
        if values.get(id) != Some(expected) {
            return Ok(false);
        }
        values.insert(id.into(), replacement);
        Ok(true)
    }
    fn delete(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        self.0
            .lock()
            .map_err(|_| ProviderError::new(ErrorCode::CredentialStore))?
            .remove(id);
        Ok(())
    }
}
/// OS Keychain generic-password item, namespaced by application + validated provider ID.
/// No file or environment fallback exists. Construction does not access Keychain.
#[derive(Default)]
pub struct KeychainCredentialStore;
#[cfg(target_os = "macos")]
mod keychain {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    const SERVICE: &str = "com.agentdeck.native.providers.v1";
    // The daemon is the single credential writer. All instances coordinate so
    // compare-and-replace is atomic against connection edits within the process.
    static ACCESS: Mutex<()> = Mutex::new(());
    fn error() -> ProviderError {
        ProviderError::new(ErrorCode::CredentialStore)
    }
    // Serialization is confined to the OS protected item; Credential itself is never serializable.
    fn encode(value: Credential) -> Vec<u8> {
        let value = match value {
            Credential::ApiKey(key) => serde_json::json!({"kind":"api_key", "key":key.expose()}),
            Credential::Codex {
                access_token,
                refresh_token,
                expires_at,
                account_id,
            } => {
                serde_json::json!({"kind":"codex", "access_token":access_token.expose(), "refresh_token":refresh_token.expose(), "expires_at":expires_at, "account_id":account_id})
            }
        };
        value.to_string().into_bytes()
    }
    fn decode(bytes: &[u8]) -> Result<Credential> {
        let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| error())?;
        let text = |key: &str| value[key].as_str().map(str::to_owned).ok_or_else(error);
        match value["kind"].as_str() {
            Some("api_key") => Ok(Credential::ApiKey(SecretString::new(text("key")?))),
            Some("codex") => Ok(Credential::Codex {
                access_token: SecretString::new(text("access_token")?),
                refresh_token: SecretString::new(text("refresh_token")?),
                expires_at: value["expires_at"].as_u64().ok_or_else(error)?,
                account_id: text("account_id")?,
            }),
            _ => Err(error()),
        }
    }
    fn load_item(id: &str) -> Result<Option<Credential>> {
        match get_generic_password(SERVICE, id) {
            Ok(bytes) => decode(&bytes).map(Some),
            Err(e) if e.code() == -25300 => Ok(None),
            Err(_) => Err(error()),
        }
    }
    impl CredentialStore for KeychainCredentialStore {
        fn load(&self, id: &str) -> Result<Option<Credential>> {
            validate_id(id)?;
            let _guard = ACCESS.lock().map_err(|_| error())?;
            load_item(id)
        }
        fn save(&self, id: &str, credential: Credential) -> Result<()> {
            validate_id(id)?;
            let _guard = ACCESS.lock().map_err(|_| error())?;
            set_generic_password(SERVICE, id, &encode(credential)).map_err(|_| error())
        }
        fn replace_if_unchanged(
            &self,
            id: &str,
            expected: &Credential,
            replacement: Credential,
        ) -> Result<bool> {
            validate_id(id)?;
            let _guard = ACCESS.lock().map_err(|_| error())?;
            if load_item(id)?.as_ref() != Some(expected) {
                return Ok(false);
            }
            set_generic_password(SERVICE, id, &encode(replacement)).map_err(|_| error())?;
            Ok(true)
        }
        fn delete(&self, id: &str) -> Result<()> {
            validate_id(id)?;
            let _guard = ACCESS.lock().map_err(|_| error())?;
            match delete_generic_password(SERVICE, id) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == -25300 => Ok(()),
                Err(_) => Err(error()),
            }
        }
    }
}
#[cfg(not(target_os = "macos"))]
impl CredentialStore for KeychainCredentialStore {
    fn replace_if_unchanged(&self, id: &str, _: &Credential, _: Credential) -> Result<bool> {
        validate_id(id)?;
        Err(ProviderError::new(ErrorCode::Unsupported))
    }
    fn load(&self, id: &str) -> Result<Option<Credential>> {
        validate_id(id)?;
        Err(ProviderError::new(ErrorCode::Unsupported))
    }
    fn save(&self, id: &str, _: Credential) -> Result<()> {
        validate_id(id)?;
        Err(ProviderError::new(ErrorCode::Unsupported))
    }
    fn delete(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        Err(ProviderError::new(ErrorCode::Unsupported))
    }
}
