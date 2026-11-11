# AgentDeck native preview

Rust / GPUI desktop prototype, currently supported on macOS. It provides Session
regions, editable Agent and resource nodes, typed connections, pan/zoom,
undo/redo, and local layout persistence. Model execution and migration of the
existing application's history are not connected yet.

## Development

Install the toolchain pinned in `rust-toolchain.toml` and Apple's Command Line
Tools. From this directory:

```sh
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

The preview stores only its layout in
`~/Library/Application Support/AgentDeck Native Preview/layout.json`. This is
separate from the existing application's data. Invalid layout files are reported
and never silently overwritten. Unsaved changes block window/application exit
until saved or explicitly discarded.

The UI reuses the repository's card artwork, material tokens, and semantic
palette. Process notes, benchmark fixtures, screenshots, and local test output
belong in ignored local directories, not in this workspace's committed sources.
