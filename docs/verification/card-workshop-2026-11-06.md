# Card Workshop: first workflow verification

Date: 2026-11-06. Scope: design → save reusable card → install independent Agent/Workforce instance in a Session. Existing resource nodes, connection APIs, Tasks, routes and manual handoff remain in use.

## Delivered behavior

- Workshop library, shared card face and design desk; full/classic layouts, gold/silver/ink frames, preset artwork and bounded PNG/JPEG/WebP uploads.
- Appearance and capabilities edit independently. An instance has a separate optimistic appearance revision. Behavior saves preserve appearance; appearance saves preserve behavior, links and Tasks.
- Template creation does not create a hidden Agent. A draft can defer model selection until installation. New versions are immutable; previous instances retain their own configuration and appearance.
- Installation and new-Session retries retain stable IDs. Pending saves/uploads prevent accidental modal dismissal. Legacy template installation supports deferred model selection.
- Visible card titles are searchable and included in accessible names. Selecting an old version displays that version's face. Shared TabsContent associates configuration panels with their tabs.

## Local acceptance evidence

Session: `卡片工坊 · 验收 1106`, ID `project_a28042465e0e4ffab7882ffef246b759`.

1. Designed `卡片工坊 · 验收` with face title `星图核验员`, owl artwork, silver frame, role/instructions and plan/execute Harness. Saved without a model, then installed twice with GPT-6-Luna.
2. Independently changed an installed face title to `星图核验员 · 银翼`, edited Agent roles/instructions, and uploaded a local project raster to the other instance. The library version remained unchanged.
3. Dragged A's output port to B's input port. Confirmed the saved output relation.
4. Created an additional blank task on A. After explicit permission for one real model trial, ran A→B exactly once. Trial `14fff142-e823-4bf0-87f8-cd5461e447ff` completed: A returned `星图核验通过。`; B returned `已收到上游结果。`.
5. Reloaded the application. Both configurations, distinct appearances, uploaded image, link and completed outputs remained. Each Agent's output is attached to its own task ID; A's additional task remains empty. SQL confirmed card artwork is absent from both runtime snapshots.

## Checks

- Backend: 36 passed across `test_card_workshop.py`, `test_workshop.py`, `test_agent_canvas.py`, `test_agent_tasks.py`, `test_canvas_trials.py`, `test_session_agents.py`. Existing pytest fixture deprecation warnings remain.
- Frontend: 35 passed across CardWorkshop, Agents, CanvasTrial, graphModel, resourceConnections, ResourceEditors and GraphNodes tests.
- `npm run type-check`, focused ESLint, `npm run check:design-tokens`, `npm run check:i18n`, and `git diff --check` passed.
- Repository submission checks passed: lint-staged (including license headers), Ruff lint/format, Bandit, and file hygiene. Existing cached tools were used without changing the running backend environment.
- New review regressions were observed failing before their fixes: stable destination ID after lost response, pending-save Escape guard, deferred model in legacy installer, title search, historical preview and tab-panel semantics.
- One Impeccable detector pass returned an empty findings array.

## Design contract and review scope

Reused Button, Input, Textarea, Select, Tabs/TabsContent, Dialog, DsText, DsIcon and focus recipes. Colors use existing neutral/ink/hairline/category roles. Card aspect ratios and illustration framing use the registered `media-frames` exception; app-shell controls and theme sources are retained.

Verified the Electron desktop at 1600×1050 and the user's 886×811 size, with light/dark library views, designer and canvas. Loading/retry/error/disabled paths have focused tests. Keyboard tab-panel relationships and named connection ports remain accessible. This is not a comprehensive screen-reader, contrast or mobile certification.

Fresh code review found three important issues; all three have passing regression tests. Fresh visual review returned `fix` for four findings. After the fix batch and replacement captures, its verdict was `ship` **limited to F1–F4**, all resolved. It did not certify whole-surface accessibility or numeric fidelity.

**Outstanding Impeccable workflow:** the comp state remains at `spec`; region mapping and numeric comp-diff gates were not completed. `build-phase finish --disposition ship` refused because those phases are open. This is a locally verified functional increment, not a claim that the full comp-led workflow or pixel-level reproduction passed.

## Decisions and boundaries

- Reuse immutable Workshop versions and existing Agent/Task execution rather than create a parallel runtime. Cost: the legacy node/route save entry remains alongside the card designer.
- Ship existing repository illustrations and user-uploaded raster images. The approved mock's game artwork was reference-only; it is not distributed. Cost: built-in illustration motifs differ from the mock's references.
- Keep reference mocks, captures and incomplete build-state files local and ignored by Git. The application code and verification notes remain reviewable without distributing private captures or reference artwork.

No additional code-review minor findings were deferred. Resource/Automation card designs remain a later increment, as requested by the staged scope.
