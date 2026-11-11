# AgentDeck native preview

Rust / GPUI desktop prototype, currently supported on macOS. It provides Session
regions, editable Agent and resource nodes, typed connections, pan/zoom,
undo/redo, and local layout persistence. A separate Rust service demonstrates
execution events and reconnection. Model execution and migration of the
existing application's history are not connected yet.

## Development

Install the toolchain pinned in `rust-toolchain.toml` and Apple's Command Line
Tools. From this directory:

```sh
cargo build --workspace --locked
cargo run -p agentdeck-desktop --locked
cargo test --workspace --locked
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

The preview pins GPUI Kit and its GPUI snapshot. Its development build uses
runtime Metal shader compilation. Distribution signing, notarization, and the
release shader pipeline are separate release requirements.

## Editing and storage

- Double-click a card to edit its name in the inspector. Switching nodes keeps
  unsaved drafts. Use **Save** or **Command-S** to persist them.
- Drag nodes to move them. Scroll to pan; Command-scroll to zoom around the
  pointer. Space-drag or middle-button drag also pans.
- Connect typed output/input ports by dragging or clicking. The inspector also
  provides connection buttons. Escape cancels; a rejected reconnection preserves
  the previous edge.
- Shift-click adds to the selection. With the canvas focused, Command-Z undoes,
  Command-Shift-Z redoes, and Backspace deletes a single selected node. Text
  fields retain their own editing shortcuts.

## Independent service

Select a saved Agent node, then use **启动 / 连接服务** and **演示运行**. The
preview follows one message chain from that node. Resource references do not
execute, and branching is explicitly rejected in this technical preview.
Node and edge status, results, and cancellation come from `agentdeckd` through
a versioned private Unix socket. There are no model calls or external tools.

The `agentdeckd` executable must sit beside `agentdeck-desktop`, including when
putting them in a local `.app` bundle. Closing the desktop leaves the service
running. Reopening reconnects to the same service; **停止运行** cancels the
selected run, while **停止服务** exits the service only after active runs stop.

This is an in-memory service prototype, not a durable task scheduler. It retains
at most 8 demo runs of 64 nodes each and the latest 256 events. Reconnection uses
an authoritative snapshot when the event cursor is too old. An idle service
exits after five minutes with no clients and no active runs; restarting it clears
demo results. Its instance identity prevents requests from the previous service
being replayed after restart. Layouts remain on disk independently.

IPC integration tests start real child processes in private temporary
directories. They require permission to bind local Unix sockets; environments
that forbid local IPC cannot run those tests.

The preview stores only its layout in
`~/Library/Application Support/AgentDeck Native Preview/layout.json`. This is
separate from the existing application's data. Invalid layout files are reported
and never silently overwritten. Unsaved changes block window/application exit
until saved or explicitly discarded.

The UI reuses the repository's card artwork, material tokens, and semantic
palette. Process notes, benchmark fixtures, screenshots, and local test output
belong in ignored local directories, not in this workspace's committed sources.
