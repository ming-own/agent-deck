# Workspace graph Implementation Plan
> **For agentic workers:** Use superpowers:subagent-driven-development for bounded tasks, root integrates and verifies.
**Goal:** Connect the Space canvas to canonical sessions, tasks, automations, Context and memory, with reusable Agent cards.
**Architecture:** Adapt existing canonical stores/APIs into a typed graph. Persist only canvas metadata, new Context content and explicit resource/automation bindings in local scoped storage. Existing executor takes immutable reference snapshots.
**Tech Stack:** React, TypeScript, React Flow, FastAPI, SQLite.
**Spec:** docs/superpowers/specs/2026-11-06-workspace-graph.md

## Global Constraints
Preserve account and Space boundaries and canonical identifiers. No secrets in graph storage. No automatic weather schedule created. Existing handoff and trial features stay available. Follow AGENTS.md UI and terminology contracts.

## Review Focus
- Account/Space switches must fence stale async responses.
- Deleted referenced resources must never silently inject wrong data.
- Repeated trigger events create one run/session.
- Graph/list views use identical underlying object IDs.
- Old saved layouts/history remain readable after restart.

## Tasks
- [x] 1. Backend workspace graph resources and Agent reference snapshots; focused tests for isolation, missing refs, immutable versions.
- [x] 2. Workspace canvas/list entry, all node kinds, editable Context/memory, source navigation and persisted positions; Agent card identity.
- [x] 3. Bind existing automation to Agent/Workforce, route triggered executions through canonical Session lifecycle, preserve sources and existing automation behavior.
- [x] 4. Meaningful component/backend tests, UI verification in both themes; fresh review, documented capability boundaries, commit/push to own fork.

Validation and capability boundaries: see docs/agentdeck-canvas-audit.md and docs/agentdeck-roadmap.md (2026-11-06 workspace upgrade).
