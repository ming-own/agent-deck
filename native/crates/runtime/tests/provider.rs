use agentdeck_runtime::provider::{
    Credential, CredentialStore, MemoryCredentialStore, SecretString, validate_endpoint,
};
#[test]
fn endpoints_and_secrets_have_safe_boundaries() {
    for value in [
        "http://example.org/v1",
        "https://key@example.org",
        "https://example.org/?key=secret",
        "https://example.org/#secret",
        "file:///tmp/token",
    ] {
        assert!(validate_endpoint(value).is_err(), "{value}");
    }
    for value in [
        "https://api.example.org/v1",
        "http://127.0.0.1:1234/v1",
        "http://[::1]:1234",
        "http://localhost:1234",
    ] {
        assert!(validate_endpoint(value).is_ok(), "{value}");
    }
    let store = MemoryCredentialStore::default();
    let credential = Credential::ApiKey(SecretString::new("never-print-me"));
    assert!(!format!("{credential:?}").contains("never-print-me"));
    assert!(store.save("../bad", credential.clone()).is_err());
    store.save("provider-1", credential).unwrap();
    assert!(store.load("provider-1").unwrap().is_some());
    store.delete("provider-1").unwrap();
    assert!(store.load("provider-1").unwrap().is_none());
}
