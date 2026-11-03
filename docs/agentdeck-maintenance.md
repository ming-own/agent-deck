# AgentDeck maintenance

Product name: **AgentDeck（智牌）**  
Maintainer: **ming-own**  
Canonical repository: <https://github.com/ming-own/agent-deck>

## Ownership

All new commits, issues, pull requests, and releases belong in this repository.
Do not open upstream pull requests or add an upstream push remote unless the
maintainer explicitly requests it. Renaming this repository does not remove
GitHub's fork relationship or change ownership of the original source code.
Original copyright notices and LICENSE are retained.

## Initial branding changes

The initial rename updates desktop and browser titles, translated application
copy, package metadata, support links, the About wordmark, and release targets.
Existing icon artwork is inherited; a dedicated AgentDeck icon is future work.
The agent composition experience is also future work, not part of the rename.

`package.json` identifies the package as `agent-deck`; Electron packaging uses
`AgentDeck` and `com.mingown.agentdeck`. The package license metadata now matches
the existing root Apache-2.0 LICENSE instead of the inherited MIT declaration.

## Compatibility boundaries

Persisted keys, backend/API identifiers, translation keys, `.eigent` working
directories, and the `eigent://` authentication protocol remain unchanged.
They are compatibility contracts, not branding text. Changing any of these requires a separate, coordinated migration.

The model settings and session selectors list user-connected providers and
subscriptions only. The inherited Eigent hosted catalog, credit balance, and
account promotion are no longer exposed there. Cloud protocol types remain for
compatibility; this presentation change does not migrate stored model settings.

The new package identity changes Electron's default application data directory.
Existing app data is not migrated automatically. Some backend working paths
remain shared with the original application, so full side-by-side runtime
isolation has not been implemented.

## External services

The inherited development environment and runtime defaults still reference
Eigent authentication, cloud APIs, remote-control services, and other third-party
integrations. They are not AgentDeck-operated services. Prefer the documented
local backend for independent development. Do not replace service hostnames with
invented AgentDeck domains. Configure or replace each integration explicitly.

## Releases

`electron-builder.json` and `electron/main/update.ts` target only
`ming-own/agent-deck`. The updater uses GitHub release downloads rather than the
upstream binary CDN. Prerelease workflows no longer override the package target
with the upstream private repository.

No AgentDeck release is published by this rename. The existing build workflows
still require their platform dependencies, runner availability, and signing
configuration. In particular, inherited macOS jobs use self-hosted runners.
Review these before enabling release automation. Optional cloud upload steps
require repository-specific secrets; none are provisioned by this change.

## Codex account model discovery

Codex login connects an account, rather than creating one manually named model.
The main process fetches the connected account's visible model catalog through
the existing Codex subscription transport. Only model IDs and display names are
returned to the renderer; access and refresh tokens remain in encrypted local
storage and the main-process request boundary.

Settings and session pickers show one choice per catalog model. The existing
`codex_model_type` field remains the default/selected model ID, so stored Space
and Session contracts stay compatible. Discovery failures expose a retry state
instead of a fabricated fallback list. Refresh results reach all mounted model
surfaces. A model appearing in the catalog is not proof that a given inference
request will succeed; plan limits and service-side policy still apply.
