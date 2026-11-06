# Card Workshop Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner approved implementation; no additional approval checkpoint is needed.

**Goal:** Design a reusable card, save it, place an independent Agent instance into a chosen Session on the canvas, and edit appearance/configuration independently.

**Architecture:** Extend the existing immutable Workshop versions and idempotent installation mechanism. A validated `card_design` presentation object has its own optimistic revision on instances and is excluded from `AgentConfig`. Agent configuration writes preserve this object. Template snapshots carry both, never conversations or task history. Reuse the existing runtime, routes, links and task UI.

**Tech Stack:** React/TypeScript, shared design-system controls, Zustand, React Flow, FastAPI/Pydantic, existing AgentStore SQLite.

**Spec:** `.impeccable/briefs/card-workshop.md`; approved `02-workshop.png` and `03-card-designer.png` in `.impeccable/mocks/card-studio/`.

## Global Constraints

- Own fork only; preserve canonical account/space/project/agent/task IDs and attribution.
- Card appearances are presentation metadata; changing them cannot mutate models, roles, tools, skills, Harness, tasks, outputs or routes.
- Template changes create immutable versions; existing installed instances are not overwritten.
- Models may remain unselected in new template drafts; installation requires a configured model when the template needs one.
- Source images from existing project assets and user uploads. Review-only Yu-Gi-Oh images do not ship.
- Use semantic primitives/tokens; preserve keyboard connection ports and status/result actions.

## Review Focus

- Concurrent appearance/configuration edits preserve both domains, and stale appearance versions conflict.
- Double-click/retry cannot install a second instance; failed saves keep the draft.
- Account switches cannot expose or mutate another account's templates or uploaded artwork.
- Existing templates without appearance metadata load, install, and run unchanged.
- New instances have independent tasks; editing an instance does not change its template or neighboring nodes.

### Task 1: Independent appearance and immutable card templates

Files: `backend/app/session_agents/models.py`, `store.py`, `workshop.py`, `backend/app/controller/session_agent_controller.py`, `backend/tests/app/test_card_workshop.py`.

Interfaces: `CardDesign(title, summary, artwork, image_data, layout, material)`, `UpdateCardDesign(expected_revision, design)`; `workshop.update_card(store, scope, node_id, change)`; `workshop.detail(store, owner, family, version)`; `SaveTemplate.config` supports drafts, `appearance` and `base_family/base_version` support editing an immutable version.

- [x] Add focused tests for draft save/install, persistence, independent edits/revisions, version immutability, ownership and task/link retention. Observe failures.
- [x] Implement validated card data and endpoints; preserve appearance in existing Agent/Workforce update/capture/install paths.
- [x] Run focused new tests plus existing Workshop/canvas/task tests.

### Task 2: Shared card and design controls

Files: `src/service/cardDesign.ts`, `src/service/sessionAgentApi.ts`, `src/components/Session/Agents/CardFace.tsx`, `CardAppearanceFields.tsx`, `CardDesigner.tsx`, `cardStudio.css`; design-system category tokens if needed.

Interfaces: optional SessionAgent `card_design/card_revision`; Template detail exposes `config` and `appearance`; shared CardFace consumes presentation metadata and real behavior without owning execution state.

- [x] Build the approved full-frame preview, classic layout and gold/silver/ink materials using project artwork and bounded raster uploads.
- [x] Build independent appearance/capability tabs with live preview, real model/role/instruction/Skills/Harness controls and retryable saves.
- [x] Verify metadata fallback, upload validation and UI save isolation with focused tests.

### Task 3: Library and canvas integration

Files: `Workshop.tsx`, `WorkspaceGraph/index.tsx`, `GraphNodes.tsx`, `graphModel.ts`, locale chat files.

- [x] Replace the compact template picker with the approved card gallery and design desk; retain legacy node/route save functionality.
- [x] Add a workspace-level Workshop entry and explicit target Session selection; expand/focus the new instance after installation.
- [x] Use CardFace on canvas while retaining connection handles, task/result/try-run actions and stored positions. Add separate instance appearance edit entry.
- [x] Add translations, type checking, design-token checks, focused lint/tests and diff checks.

### Task 4: Product verification and review

- [x] In an isolated QA Session: create a card, configure it, save, install twice, edit one appearance and the other configuration, reload, and verify task isolation and retained links.
- [x] Capture library, designer, canvas in light/dark and narrow desktop; review one batch, correct material issues, confirm once.
- [x] Obtain fresh code/design review as required by the execution and Impeccable skills; document the implemented contract and any remaining limits.
- [x] Commit/push only to the owner's existing feature branch when verified.

## Execution record

First workflow implementation and focused acceptance completed on 2026-11-06. See `docs/verification/card-workshop-2026-11-06.md` for tests, live trial evidence, review rulings and the outstanding numeric Impeccable comp workflow. This checklist does not mark those open comp phases complete.
