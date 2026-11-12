use super::{Credential, CredentialStore, MemoryCredentialStore, SecretString};

use crate::provider::{CancellationToken, ErrorCode, Message, ProviderClient, Role};
use agentdeck_product::{Provider, ProviderKind};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn fixture(
    status: &str,
    body: Vec<u8>,
    headers: &str,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
        body.len()
    );
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let n = socket.read(&mut chunk).await.unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..n]);
            if let Some(i) = request.windows(4).position(|x| x == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&request[..i]);
                let length = head
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= i + 4 + length {
                    break;
                }
            }
        }
        if socket.write_all(reply.as_bytes()).await.is_ok() {
            // Fragment every byte, including inside multibyte UTF8.
            for byte in body {
                if socket.write_all(&[byte]).await.is_err() {
                    break;
                }
            }
        }
        String::from_utf8(request).unwrap()
    });
    (format!("http://{address}/v1"), handle)
}
fn client(base: String, kind: ProviderKind) -> ProviderClient {
    let store = Arc::new(MemoryCredentialStore::default());
    store
        .save(
            "fixture",
            if kind == ProviderKind::Codex {
                Credential::Codex {
                    access_token: SecretString::new("fixture-access"),
                    refresh_token: SecretString::new("fixture-refresh"),
                    expires_at: u64::MAX,
                    account_id: "fixture-account".into(),
                }
            } else {
                Credential::ApiKey(SecretString::new("fixture-secret"))
            },
        )
        .unwrap();
    let codex = kind == ProviderKind::Codex;
    let metadata_base = if codex {
        "https://chatgpt.com/backend-api/codex".to_owned()
    } else {
        base.clone()
    };
    let mut client = ProviderClient::new(
        Provider {
            id: "fixture".into(),
            name: "Fixture".into(),
            base_url: metadata_base,
            kind,
        },
        store,
    )
    .unwrap();
    // Test-only private transport injection; production never exposes this override.
    client.base = url::Url::parse(&base).unwrap();
    client
}
fn history() -> Vec<Message> {
    vec![
        Message::new(Role::System, "be precise"),
        Message::new(Role::User, "first"),
        Message::new(Role::Assistant, "prior"),
        Message::new(Role::User, "next"),
    ]
}
#[tokio::test]
async fn openai_stream_preserves_history_model_auth_and_fragments() {
    let body = ": keepalive\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\r\n\r\ndata: {\"choices\":\ndata: [{\"delta\":{\"content\":\"好\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let (base, request) = fixture(
        "200 OK",
        body.as_bytes().to_vec(),
        "Content-Type: text/event-stream\r\n",
    )
    .await;
    let mut deltas = Vec::new();
    let answer = client(base, ProviderKind::OpenAiCompatible)
        .stream("custom/model", &history(), &CancellationToken::new(), |s| {
            deltas.push(s.to_owned())
        })
        .await
        .unwrap();
    assert_eq!(answer, "你好");
    assert_eq!(deltas.concat(), answer);
    let request = request.await.unwrap();
    assert!(request.starts_with("POST /v1/chat/completions "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer fixture-secret")
    );
    let json: serde_json::Value =
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(json["model"], "custom/model");
    assert_eq!(json["messages"][2]["role"], "assistant");
    assert_eq!(json["messages"][2]["content"], "prior");
    assert_eq!(json["messages"].as_array().unwrap().len(), 4);
}
#[tokio::test]
async fn stream_errors_never_claim_partial_success_or_expose_body() {
    for (status, body, code) in [
        (
            "401 Unauthorized",
            "fixture-secret",
            ErrorCode::Unauthorized,
        ),
        (
            "429 Too Many Requests",
            "fixture-secret",
            ErrorCode::RateLimit,
        ),
        (
            "200 OK",
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            "200 OK",
            "data: not json fixture-secret\n\n",
            ErrorCode::InvalidResponse,
        ),
        (
            "200 OK",
            "data: {\"error\":{\"message\":\"fixture-secret\"}}\n\n",
            ErrorCode::InvalidResponse,
        ),
        (
            "200 OK",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n",
            ErrorCode::IncompleteStream,
        ),
    ] {
        let (base, task) = fixture(
            status,
            body.as_bytes().to_vec(),
            "Content-Type: text/event-stream\r\n",
        )
        .await;
        let error = client(base, ProviderKind::OpenAiCompatible)
            .complete("model", &history(), &CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.code, code, "{error:?}");
        assert!(!format!("{error:?} {error}").contains("fixture-secret"));
        task.await.unwrap();
    }
}
#[tokio::test]
async fn codex_responses_and_catalogue_are_dynamic() {
    let body = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n";
    let (base, task) = fixture(
        "200 OK",
        body.as_bytes().to_vec(),
        "Content-Type: text/event-stream\r\n",
    )
    .await;
    assert_eq!(
        client(base, ProviderKind::Codex)
            .complete("codex-custom", &history(), &CancellationToken::new())
            .await
            .unwrap(),
        "answer"
    );
    let request = task.await.unwrap();
    assert!(request.starts_with("POST /v1/responses "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("chatgpt-account-id: fixture-account")
    );
    let json: serde_json::Value =
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(json["model"], "codex-custom");
    assert_eq!(json["instructions"], "be precise");
    assert_eq!(json["store"], false);
    assert_eq!(json["input"][1]["role"], "assistant");
    assert_eq!(json["input"][1]["content"][0]["type"], "output_text");
    let (base, task) = fixture(
        "200 OK",
        br#"{"models":[{"slug":"new-codex","display_name":"New Codex"}]}"#.to_vec(),
        "Content-Type: application/json\r\n",
    )
    .await;
    let models = client(base, ProviderKind::Codex)
        .discover_models(&CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(models[0].id, "new-codex");
    assert_eq!(models[0].display_name, "New Codex");
    assert!(
        task.await
            .unwrap()
            .starts_with("GET /v1/models?client_version=")
    );
}
#[tokio::test]
async fn redirects_are_not_followed_and_cancel_aborts_wait() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let headers = format!(
        "Location: http://{}/stolen\r\n",
        listener.local_addr().unwrap()
    );
    let (base, task) = fixture("307 Temporary Redirect", Vec::new(), &headers).await;
    assert_eq!(
        client(base, ProviderKind::OpenAiCompatible)
            .complete("model", &history(), &CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::Transport
    );
    task.await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
    let base = format!("http://{}", listener.local_addr().unwrap());
    let client = client(base, ProviderKind::OpenAiCompatible);
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let waiter = tokio::spawn(async move { client.complete("model", &history(), &cancel).await });
    let (mut socket, _) = listener.accept().await.unwrap();
    trigger.cancel();
    assert_eq!(
        waiter.await.unwrap().unwrap_err().code,
        ErrorCode::Cancelled
    );
    let mut bytes = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        socket.read_to_end(&mut bytes),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn connection_setup_catalogue_and_payload_boundaries() {
    let store = Arc::new(MemoryCredentialStore::default());
    let metadata = |kind, base: &str| Provider {
        id: "setup".into(),
        name: "Setup".into(),
        base_url: base.into(),
        kind,
    };
    for base in [
        "https://attacker.example/backend-api/codex",
        "https://chatgpt.com:444/backend-api/codex",
        "https://chatgpt.com/other",
        "http://localhost:1234",
    ] {
        assert!(ProviderClient::new(metadata(ProviderKind::Codex, base), store.clone()).is_err());
    }
    let client = ProviderClient::new(
        metadata(ProviderKind::OpenAiCompatible, "http://127.0.0.1:9/v1"),
        store.clone(),
    )
    .unwrap();
    assert_eq!(
        client
            .complete("model", &history(), &CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::MissingCredentials
    );
    assert_eq!(
        client
            .complete("", &history(), &CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidConfiguration
    );
    let (base, task) = fixture(
        "200 OK",
        br#"{"data":[{"id":"vendor/new-model"},{"id":"local-custom","display_name":"Local"}]}"#
            .to_vec(),
        "Content-Type: application/json\r\n",
    )
    .await;
    store
        .save("setup", Credential::ApiKey(SecretString::new("")))
        .unwrap();
    let client =
        ProviderClient::new(metadata(ProviderKind::OpenAiCompatible, &base), store).unwrap();
    let models = client
        .discover_models(&CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(models[0].display_name, "vendor/new-model");
    assert_eq!(models[1].id, "local-custom");
    assert!(
        !task
            .await
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization:")
    );
}
#[tokio::test]
async fn invalid_and_incomplete_protocols_are_rejected() {
    for (kind, body, code) in [
        (
            ProviderKind::Codex,
            "data: {\"type\":\"response.incomplete\"}\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            ProviderKind::Codex,
            "data: {\"type\":\"response.failed\"}\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            ProviderKind::Codex,
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"function_call\"}]}}\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            ProviderKind::OpenAiCompatible,
            "data: [DONE]\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            ProviderKind::OpenAiCompatible,
            "data: {\"choices\":[{\"delta\":{\"content\":\"truncated\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n",
            ErrorCode::IncompleteStream,
        ),
        (
            ProviderKind::OpenAiCompatible,
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
            ErrorCode::IncompleteStream,
        ),
    ] {
        let (base, task) = fixture(
            "200 OK",
            body.as_bytes().to_vec(),
            "Content-Type: text/event-stream\r\n",
        )
        .await;
        assert_eq!(
            client(base, kind)
                .complete("model", &history(), &CancellationToken::new())
                .await
                .unwrap_err()
                .code,
            code
        );
        task.await.unwrap();
    }
    let (base, task) = fixture(
        "200 OK",
        b"data: [DONE]\n\n".to_vec(),
        "Content-Type: application/json\r\n",
    )
    .await;
    assert_eq!(
        client(base, ProviderKind::OpenAiCompatible)
            .complete("model", &history(), &CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidResponse
    );
    task.await.unwrap();
}
#[tokio::test]
async fn cancellation_midstream_closes_socket_and_keeps_partial_answer_failed() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let socket_task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        let _ = socket.read(&mut request).await.unwrap();
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n").await.unwrap();
        let _ = ready_tx.send(());
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).await.unwrap();
    });
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let callback_cancel = cancel.clone();
    let (delta_tx, delta_rx) = tokio::sync::oneshot::channel();
    let mut delta_tx = Some(delta_tx);
    let task = tokio::spawn(async move {
        client(base, ProviderKind::OpenAiCompatible)
            .stream("model", &history(), &cancel, move |delta| {
                assert_eq!(delta, "partial");
                if let Some(tx) = delta_tx.take() {
                    let _ = tx.send(());
                }
                callback_cancel.cancel();
            })
            .await
    });
    ready_rx.await.unwrap();
    delta_rx.await.unwrap();
    trigger.cancel();
    assert_eq!(task.await.unwrap().unwrap_err().code, ErrorCode::Cancelled);
    tokio::time::timeout(std::time::Duration::from_secs(1), socket_task)
        .await
        .unwrap()
        .unwrap();
}
#[test]
fn sse_parser_rejects_oversize_and_invalid_utf8() {
    let mut parser = super::sse::Decoder::default();
    assert!(parser.push(&vec![b'x'; super::sse::MAX_EVENT + 1]).is_err());
    let mut parser = super::sse::Decoder::default();
    assert!(parser.push(b"data: \xff\n\n").is_err());
    let mut parser = super::sse::Decoder::default();
    assert_eq!(
        parser
            .push(b": ignored\r\ndata: hello\r\ndata: world\r\n\r\n")
            .unwrap(),
        vec!["hello\nworld"]
    );
}

#[test]
fn sse_parser_accepts_utf8_split_at_every_byte() {
    let mut parser = super::sse::Decoder::default();
    let mut events = Vec::new();
    for byte in "data: 你好\r\n\r\n".as_bytes() {
        events.extend(parser.push(&[*byte]).unwrap());
    }
    assert_eq!(events, vec!["你好"]);
}

async fn assert_cancellation_wins_buffered_completion(kind: ProviderKind, body: &str) {
    // A single small HTTP write contains every SSE event, so terminal markers
    // are buffered when the delta callback cancels without yielding to select.
    let body = body.to_owned();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        let _ = socket.read(&mut bytes).await.unwrap();
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(reply.as_bytes()).await.unwrap();
    });
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    let mut deltas = Vec::new();
    let result = client(base, kind)
        .stream("model", &history(), &cancel, |delta| {
            deltas.push(delta.to_owned());
            stop.cancel();
        })
        .await;
    task.await.unwrap();
    assert_eq!(deltas, vec!["provisional"]);
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
}
#[tokio::test]
async fn openai_cancellation_beats_terminal_events_in_one_http_batch() {
    assert_cancellation_wins_buffered_completion(ProviderKind::OpenAiCompatible,
        "data: {\"choices\":[{\"delta\":{\"content\":\"provisional\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").await;
}
#[tokio::test]
async fn codex_cancellation_beats_terminal_events_in_one_http_batch() {
    assert_cancellation_wins_buffered_completion(ProviderKind::Codex,
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"provisional\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n").await;
}

#[tokio::test]
async fn auth_drain_waits_for_rotated_token_after_model_cancellation_and_is_client_scoped() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let token_url =
        url::Url::parse(&format!("http://{}/token", listener.local_addr().unwrap())).unwrap();
    let (received_tx, received_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        let _ = socket.read(&mut request).await.unwrap();
        let _ = received_tx.send(());
        let _ = release_rx.await;
        let body = serde_json::json!({"access_token":"drain-rotated-access", "refresh_token":"drain-rotated-refresh", "expires_in":3600}).to_string();
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(reply.as_bytes()).await.unwrap();
    });
    let mut connection = client("http://127.0.0.1:9".into(), ProviderKind::Codex);
    connection.token_url = token_url;
    connection
        .store
        .save(
            "fixture",
            Credential::Codex {
                access_token: SecretString::new("drain-old-access"),
                refresh_token: SecretString::new("drain-old-refresh"),
                expires_at: 0,
                account_id: "drain-account".into(),
            },
        )
        .unwrap();
    let request_client = connection.clone();
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    let request =
        tokio::spawn(async move { request_client.complete("model", &history(), &cancel).await });
    received_rx.await.unwrap();
    stop.cancel();
    assert_eq!(
        request.await.unwrap().unwrap_err().code,
        ErrorCode::Cancelled
    );
    // Both original and clone see the same owned grant, while an unrelated
    // client's drain is independent even with this response deliberately paused.
    let observer = connection.clone();
    let mut drain = Box::pin(connection.wait_for_pending_auth());
    let mut clone_drain = Box::pin(observer.wait_for_pending_auth());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), drain.as_mut())
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), clone_drain.as_mut())
            .await
            .is_err()
    );
    let unrelated = client("http://127.0.0.1:9".into(), ProviderKind::Codex);
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        unrelated.wait_for_pending_auth(),
    )
    .await
    .unwrap();
    release_tx.send(()).unwrap();
    server.await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        tokio::join!(drain, clone_drain);
    })
    .await
    .unwrap();
    assert!(
        matches!(connection.store.load("fixture").unwrap(), Some(Credential::Codex { refresh_token, .. }) if refresh_token.expose() == "drain-rotated-refresh")
    );
}

#[tokio::test]
async fn auth_drain_finishes_after_failed_refresh_without_changing_credentials() {
    let (token_url, server) = fixture(
        "401 Unauthorized",
        b"private upstream error".to_vec(),
        "Content-Type: application/json\r\n",
    )
    .await;
    let mut connection = client("http://127.0.0.1:9".into(), ProviderKind::Codex);
    connection.token_url = url::Url::parse(&token_url).unwrap();
    let old = Credential::Codex {
        access_token: SecretString::new("old-access"),
        refresh_token: SecretString::new("old-refresh"),
        expires_at: 0,
        account_id: "failed-drain-account".into(),
    };
    connection.store.save("fixture", old.clone()).unwrap();
    assert_eq!(
        connection
            .complete("model", &history(), &CancellationToken::new())
            .await
            .unwrap_err()
            .code,
        ErrorCode::Unauthorized
    );
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        connection.wait_for_pending_auth(),
    )
    .await
    .unwrap();
    assert_eq!(connection.store.load("fixture").unwrap(), Some(old));
    server.await.unwrap();
}
