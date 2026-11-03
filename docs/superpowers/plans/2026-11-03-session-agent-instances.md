# Session Agent instances implementation plan

> Implement inline with superpowers:executing-plans. Scope is the first accepted milestone, not the entire canvas roadmap.

**Goal:** A Session contains independently named Agent instances, each with an explicit model reference and isolated, durable conversation records.

**Architecture:** Add a local, account-and-project-scoped Agent repository and bounded text-turn runner. Reuse the existing model factory and Codex credential resolver; never persist provider credentials in instances or runs. Keep legacy chat execution unchanged. A Session Agent surface provides instance selection, model editing and conversation; later canvas, Skill and Harness work reuse these instance identities.

**Spec:** The accepted conversation: models are global resources, nodes own configuration, Session isolates records. First milestone supports independently configured text Agents; tools/Skills, Harness selection and canvas follow separately.

**Constraints:** Preserve Project/API identifiers and legacy histories. Follow design.md and product-terminology.md. Only owned GitHub remote. No changes to running or completed turns when an instance is edited. No fallback to global/default models. No automatic replay of interrupted inference.

**Review focus:** Account/session ownership; stale model revisions; deleted model/provider; duplicate sends and simultaneous calls; navigation/restart during a turn; credentials in persisted state/errors; old Sessions unchanged.

- [x] Repository tests first: create/update/reload, scope isolation, optimistic revisions, immutable run snapshots, duplicate request IDs and running-turn exclusion, restart reconciliation.
- [x] Implement `backend/app/session_agents/models.py`, `store.py`, `service.py` and local-control-protected `controller/session_agent_controller.py`. Add router registration. Each run records exact node revision/model reference. Pollable run status and explicit cancellation.
- [x] Extract reusable model-builder entry point in `agent/agent_model.py`, retaining the existing factory behavior. Implement `session_agents/runner.py`: fresh model per run, only same-instance completed history, no tools, timeout/cleanup, safe failure codes. Validate with existing factory and new runner tests.
- [x] Implement typed `src/service/sessionAgentApi.ts` and model-reference resolution. Test unavailable model, provider and Codex selection, no credential persistence and account-change fences.
- [x] Implement `Session/Agents` using shared controls and semantic tokens; integrate into Session header/new Session creation. Persist Session marker through existing metadata. Localize all copy. Test create, edit, send, disabled/error states and stale async responses.
- [x] Run backend/frontend focused tests, type-check, lint, locale/design checks and diff checks. Inspect live UI, obtain whole-change review, address material findings, commit and push only to ming-own/agent-deck.

## Execution notes

- Working on `codex/session-agent-instances` in the existing clean checkout so the user's development app can reload the feature. No unrelated files were modified at start.
- Each node runs plain text in milestone one. Legacy tool-capable chat remains available as the Conversation tab. Model changes affect subsequent turns; existing same-node text history is retained and passed to the newly selected model.

## Verification and handoff

- Focused frontend suite: 107 tests across eight files; backend suite: 44 tests, with six existing pytest-asyncio fixture deprecation warnings.
- Ruff lint/format and Bandit on changed production Python files passed (no security findings).
- TypeScript type-check, focused ESLint, locale parity/source usage, semantic token/theme checks (60 variants), icon usage, retired axes and CSS writing checks passed.
- Live desktop acceptance: two independent Agents completed real Codex model calls with GPT-6.1-Sol and GPT-6-Luna. Editing the first Agent to GPT-6-Sol and reloading preserved the new node setting while its earlier completed run retained GPT-6.1-Sol. The test node was then restored to GPT-6.1-Sol.
- Reviewed light/dark, 900px viewport and 200% zoom; verified keyboard focus reaches Send. Forced-colors and reduced-motion were not manually inspected. No new animation was introduced.
- Shared primitives: Button, Input, Select, Textarea and DsText. Existing neutral/ink, gap and panel/card semantic roles; no new tokens or registered exceptions. States cover loading, empty, unavailable model, creation/edit, sending, completion, failure and cancellation.
- Independent review findings on legacy hydration, deletion lifecycle and stale selection were fixed; final reviewer confirmed all findings resolved.
- Instances and runs are local, account/Session-scoped SQLite records at `~/.eigent/session-agents.sqlite3`; provider credentials are transient and not saved in these records. This first milestone does not synchronize Agent records between devices.
- Text-only execution is intentional for this milestone. Node roles/Skills/tools, Harness selection, canvas, connections and reusable teams remain subsequent milestones. Existing tool-capable Conversation remains accessible.

### Reproduction commands

```sh
npm run type-check
npm run check:i18n
npm run check:design-tokens
npx vitest run src/components/Session/Agents/Agents.test.tsx src/service/sessionAgentModels.test.ts test/unit/lib/sessionFileCleanup.test.ts test/unit/components/SidebarSessionDeletion.test.tsx test/unit/components/HomeSessionDeletion.test.tsx test/unit/components/Session/SessionResize.test.tsx test/unit/components/Session/SessionSplitView.test.tsx test/unit/components/Session/HeaderBox.test.tsx
# From backend, using an environment with project dependencies and pytest:
python -m pytest tests/app/test_session_agents.py tests/app/test_session_agent_smoke.py tests/app/agent/test_agent_model.py tests/app/model/test_codex_subscription_runtime.py -q
```
