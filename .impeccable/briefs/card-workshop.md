# Canvas, cards and Workshop — approved implementation

Mode: Operate. The owner approved the three-image mock suite on 2026-11-06 and requested library → designer → save → canvas placement first. The current increment aligns the canvas, shared cards, library, and designer with that approved composition while retaining their existing functions.

## Direction

The owner's explicit full-frame Yu-Gi-Oh-inspired card direction takes precedence over seed 5fb1b159. The exploration script ran successfully via its public roll API. The approved medium is portrait fantasy artwork with stable category identity, serif lettering, and a readable rules panel. The existing neutral AgentDeck shell and semantic controls remain the surrounding system.

1. Canvas: a quiet working ground with full-frame Agent/Workforce cards inside Session regions; Context, Memory, and Automation remain working resource nodes rendered through the same illustrated face. Ports and reference/output connections remain usable.
2. Card design desk: a large live card preview with editable illustration, material, title, summary, and layout; role, instructions, model, Skills, and Harness remain independently editable capability configuration.
3. Workshop library: browse and search reusable cards, inspect versions and capability, create or edit a design, and choose a Session for an independent installed instance.

Gold is the default Agent/Workforce print material; silver and ink remain selectable. Context and Memory use jade, and Automation uses violet. Material and category never stand for run status. A Session is containment, not an executable character. The results strip opens the actual associated Task and displays its run status; it does not copy history into a template.

## Approval and artwork

The approved compositions are `.impeccable/mocks/01-canvas.png`, `02-workshop.png`, and `03-card-designer.png`. The initial native image generator failed twice, so those proposal images were rendered from a standalone, disconnected HTML composition. Their game illustrations are explicitly reference placeholders, not shipping assets or an approval of their licensing. Mock weather workflows are illustrative, not enabled automations or executed tasks.

Native generation later produced three original full-bleed illustrations for implementation: `dragon-amethyst`, `guardian-sapphire`, and `archive-jade`. No reference-game images were supplied to generation or included in the outputs. `src/assets/cards/provenance.json` records exact prompts, original PNG hashes, and 1024 × 1536 WebP delivery derivatives below 600,000 bytes each; prompt sidecars accompany the delivery files. Existing `dragon`, `crab`, and `oasis` preset identifiers now select those originals. The `owl`, `document`, and `custom` presets and user uploads remain supported; existing uploaded designs are not replaced.

## Implemented geometry and type

- Shared face: 244 / 352 aspect ratio. Gallery faces cap at 208px × about 300px, with a 282px details rail. The designer preview caps at 338px × about 488px, with a 350px properties rail.
- Gallery containers at or below 760px stack the gallery and rail. Designer containers from 600px through 760px retain a side-by-side preview and 300px rail; below 600px they stack. Header and Save stay reachable outside the scrolling body.
- Artwork titles use Songti SC, STSong, Noto Serif CJK SC, serif with `clamp(20px, 8.2cqw, 28px)` for Agents and `clamp(14px, 8.2cqw, 16px)` for compact resources. Summaries use `clamp(11px, 4.2cqw, 14px)` and two lines. These values are scoped to the registered artwork/media-frame exception.
- Fixed edge, frame, paper, and ink quartets live in `src/style/tokens/card.material.json` under `collectible-card-artwork`. Shared controls, focus, selection, app text, and surfaces still follow semantic theme recipes.
- Owner's subsequent bottom-panel refinement: full-art cards continue their illustration behind an 82–90% paper reading veil, without a separate box border. A 24px soft upper edge joins illustration and text. Square uploads retain the previous foreground framing and extend the same image softly underneath. Classic cards keep their opaque panel. This supersedes the approved mock's solid full-art rules box without changing card configuration, geometry, or saved data.
- Canvas ground mixes 55% Neutral subtle with 45% Neutral muted. The compact Space workforce/graph sidebar is 182px plus the existing 2px gap; other destinations retain 240px plus the gap. Agent configuration and run controls sit below the artwork.

## Functional boundaries and evidence

Appearance, capability configuration, template versions, and installed Task history remain separate. Appearance-only updates retain `card_revision` concurrency checks. IDs, account ownership, connections, positions, existing uploaded artwork, and saved history must survive visual work. Changing a title or summary does not change the Agent's role or instructions.

A proposal to replace prior QA artwork/positions was rejected by automatic review and was not executed. The current visual walkthrough used two new templates and a new Session through the UI, verified an A → B placement drag persisted, and did not execute a model task. These new records are visual evidence, not a reset of existing data.

The retained numeric comparisons at `.impeccable/review/diff/{canvas,library,designer}/report.json` recorded canvas 0.6635 (`drift`), library 0.7577 (`drift`), and designer 0.8215 (`match`). These scores use the final aligned captures after the title-minimum and canvas-ground corrections and F1/F2 review. Canvas data and camera position differ from the proposal; new original artwork also differs intentionally from the reference placeholders. The final aligned screenshots remain under `.impeccable/review`.

The strict build gate still compares new originals against the mock's reference-image identity. Build plates remain open and the recorded structure check is 28%; no forced pass or pixel-identical claim is made. Retain the reports and build state as evidence. Documentation refresh does not change that verdict.

## References inspected

- https://www.konami.com/yugioh/rushduel/products/kp25/ — official Full Over Rush Rare reference.
- https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf — official card categories.
- https://www.c-labo-online.jp/product/288962 — full-art Spell card image, inspected locally.
- https://www.cardrush.jp/product/106255 — full-art Monster card image, inspected locally.

## Direction contract

THESIS: A card is a reusable Agent design. Its appearance, capabilities, and installed Task history are distinct domains.

OWN-WORLD: Keep the existing neutral AgentDeck shell and semantic controls around full-frame original fantasy artwork. Fixed print materials and serif card lettering belong to the media, not app chrome.

STORY: Design a card, configure its capabilities, save a reusable version, choose a Session, and place an independent instance. Later edits can affect only that instance's appearance or capabilities.

FIRST VIEWPORT: The gallery owns the main area; its right rail exposes version, destination, model, and placement. The designer places a large preview beside appearance/capability configuration and adapts at the documented container widths.

FORM: The user's pinned full-frame medium and approved suite override the seed's alternate medium. Original project artwork, retained repository presets, and uploaded raster images ship; reference-only game artwork stays in local mock evidence.

FINISH: Preserve the finish verdict, measured differences, provenance, and current build-gate limitation alongside the implemented design. An open gate remains open until its actual criteria are satisfied.
