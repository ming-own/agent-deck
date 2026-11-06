---
name: AgentDeck（智牌）
description: A compact operational workspace with reusable illustrated Agent cards.
colors:
  accent-strong-default: '#0b0b0b'
  accent-strong-hover: '#020202'
  accent-default-default: '#1d1d1d'
  ink-inverse: '#ffffff'
  neutral-subtle-default: '#faf7f6'
  neutral-muted-default: '#e7e4e3'
  neutral-default-default: '#f0edec'
  ink-default-default: '#1d1d1d'
  ink-muted-default: '#535352'
  hairline-default-default: 'rgba(29, 29, 29, 0.149)'
  ring-focus: 'rgba(15, 13, 8, 0.620)'
  category-amber-text-default: '#926200'
  category-amber-text-strong: '#5e3d00'
  category-amber-border-default: '#ffd192'
  category-amber-background-subtle: '#fff9f1'
  category-slate-text-default: '#5d646e'
  category-slate-border-default: '#ccd1d9'
  dark-accent-strong-default: '#dec4b6'
  dark-accent-strong-hover: '#cdac9b'
  dark-accent-default-default: '#ede1db'
  dark-ink-inverse: '#555555'
  dark-neutral-subtle-default: '#1f1f1f'
  dark-neutral-muted-default: '#313130'
  dark-neutral-default-default: '#292828'
  dark-ink-default-default: '#f2ece8'
  dark-ink-muted-default: '#bebab7'
  dark-hairline-default-default: 'rgba(242, 236, 232, 0.149)'
  dark-ring-focus: 'rgba(255, 216, 196, 0.620)'
  dark-category-amber-text-default: '#fff4e7'
  dark-category-amber-text-strong: '#fffcf7'
  dark-category-amber-border-default: '#ffbb54'
  dark-category-amber-background-subtle: '#5e3d00'
  dark-category-slate-text-default: '#f0f2f4'
  dark-category-slate-border-default: '#bbc2cc'
  card-gold-edge: '#a48045'
  card-gold-frame: '#b79b68'
  card-gold-paper: '#faf3e6'
  card-gold-ink: '#513e27'
  card-silver-edge: '#788591'
  card-silver-frame: '#b8c4ce'
  card-silver-paper: '#f0f4f7'
  card-silver-ink: '#35444f'
  card-ink-edge: '#48505b'
  card-ink-frame: '#89929d'
  card-ink-paper: '#e9ebef'
  card-ink-ink: '#353d48'
  card-jade-edge: '#447e70'
  card-jade-frame: '#91b8a9'
  card-jade-paper: '#edf5ed'
  card-jade-ink: '#2b4f42'
  card-violet-edge: '#85659e'
  card-violet-frame: '#b09bbf'
  card-violet-paper: '#f4eef7'
  card-violet-ink: '#594667'
  card-art-ground: '#22262e'
  card-art-text: '#ffffff'
  card-art-shade: '#08111e'
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '2.75rem'
    lineHeight: '3.25rem'
  page:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '1.75rem'
    lineHeight: '2.25rem'
  section:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '1.25rem'
    lineHeight: '1.75rem'
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '1.125rem'
    lineHeight: '1.5rem'
  body-large:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '0.9375rem'
    lineHeight: '1.375rem'
  base:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '0.8125rem'
    lineHeight: '1.25rem'
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: '0.6875rem'
    lineHeight: '1rem'
  code-base:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: '0.8125rem'
    lineHeight: '1.25rem'
  card-art-title:
    fontFamily: '"Songti SC", "STSong", "Noto Serif CJK SC", serif'
    fontSize: 'clamp(20px, 8.2cqw, 28px)'
    fontWeight: 700
    lineHeight: 1.3
  resource-card-title:
    fontFamily: '"Songti SC", "STSong", "Noto Serif CJK SC", serif'
    fontSize: 'clamp(14px, 8.2cqw, 16px)'
    fontWeight: 700
    lineHeight: 1.3
  card-summary:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 'clamp(11px, 4.2cqw, 14px)'
    lineHeight: 1.7
rounded:
  primary-action: '9999px'
  compact-control: '0.5rem'
  field: '0.75rem'
  card: '1rem'
  panel: '1rem'
  dialog: '1.5rem'
spacing:
  control-gap: '0.5rem'
  control-inline: '0.75rem'
  card-inset: '1.5rem'
  panel-inset: '1rem'
  stack-related: '0.5rem'
  stack-section: '2rem'
  page-gutter: '3rem'
components:
  button-primary:
    backgroundColor: '{colors.accent-strong-default}'
    textColor: '{colors.ink-inverse}'
    typography: '{typography.base}'
    rounded: '{rounded.primary-action}'
    padding: '0 0.625rem'
    height: '2rem'
  button-primary-hover:
    backgroundColor: '{colors.accent-strong-hover}'
  button-secondary:
    backgroundColor: '{colors.neutral-muted-default}'
    textColor: '{colors.ink-default-default}'
    typography: '{typography.base}'
    rounded: '{rounded.primary-action}'
    padding: '0 0.625rem'
    height: '2rem'
  button-outline:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-default-default}'
    typography: '{typography.base}'
    rounded: '{rounded.primary-action}'
    padding: '0 0.625rem'
    height: '2rem'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-default-default}'
    typography: '{typography.base}'
    rounded: '{rounded.primary-action}'
    padding: '0 0.625rem'
    height: '2rem'
  button-text:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted-default}'
    typography: '{typography.base}'
    rounded: '{rounded.primary-action}'
    padding: '0 0.625rem'
    height: '2rem'
  field:
    backgroundColor: '{colors.neutral-default-default}'
    textColor: '{colors.ink-default-default}'
    typography: '{typography.base}'
    rounded: '{rounded.field}'
    padding: '0 0.75rem'
    height: '2.5rem'
  tabs-border:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted-default}'
    typography: '{typography.base}'
    rounded: '{rounded.compact-control}'
    padding: '0 0.5rem'
    height: '2rem'
  tag:
    backgroundColor: '{colors.neutral-default-default}'
    textColor: '{colors.ink-default-default}'
    typography: '{typography.meta}'
    rounded: '{rounded.primary-action}'
    padding: '0.25rem 0.5rem'
  card:
    backgroundColor: '{colors.neutral-subtle-default}'
    textColor: '{colors.ink-default-default}'
    rounded: '{rounded.card}'
    padding: '{spacing.card-inset}'
  agent-card-face:
    backgroundColor: '{colors.card-art-ground}'
    textColor: '{colors.card-art-text}'
    rounded: '{rounded.field}'
  agent-card-rules:
    backgroundColor: 'Full artwork: 82–90% card-paper reading veil; classic: opaque card-paper'
    textColor: '{colors.card-gold-ink}'
    padding: '4%'
  workspace-card-canvas:
    backgroundColor: 'color-mix(in srgb, var(--ds-neutral-subtle-default) 55%, var(--ds-neutral-muted-default))'
---

# Design System: AgentDeck（智牌）

## Overview

**Creative North Star: "The operational card desk"**

AgentDeck is a calm, compact working environment. Warm Neutral surfaces, Ink hierarchy, restrained depth, and familiar semantic controls keep dense tasks readable. Illustrated Agent cards extend this established system: a recognizable portrait, a bounded frame, and a readable capability panel travel together between the library, designer, and canvas. The name above describes the approved direction; it does not establish a replacement identity.

This document records the implemented extension. [The active design guideline](docs/design-system/design.md) remains authoritative, including where its legacy heading says Eigent. `src/style/tokens`, generated outputs, and shared primitives remain the executable source of truth. [Product terminology](docs/product-terminology.md) governs visible Space → Session → Task wording; the existing Project identifiers remain technical contracts. Surface strategy and approval history stay in [the card Workshop brief](.impeccable/briefs/card-workshop.md).

The frontmatter records reused roles from the actual theme engine (`eigent`, contrast 43), generated dimension/type tokens, and the approved fixed print materials in `src/style/tokens/card.material.json`. Theme colors without a prefix show default light mode; `dark-` entries show dark mode. The `card-*` material colors remain fixed in both modes inside the registered `collectible-card-artwork` exception. These are documentation keys, not new application aliases. App controls and canvas surfaces continue to consume semantic `--ds-*` variables; the sidecar snippets retain those live bindings.

**Key Characteristics:**

- Compact operational controls with visible keyboard focus.
- Warm Neutral surfaces and Ink hierarchy, with Accent reserved for action and selection.
- Portrait cards with fixed print materials, serif titles over original artwork, and readable capability text.
- One shared card face across reusable designs and installed instances.
- Appearance, capability configuration, and Task history remain distinct.

## Colors

The shell stays quiet; semantic action contrast and categorical card frames establish hierarchy without decorating every working region.

### Primary

- **Operational Accent** (`accent-strong-default`, `accent-strong-hover`): primary Save and Place actions. The paired `ink-inverse` foreground changes with the theme; it is not universally white.
- **Selection Accent** (`accent-default-default`): shared tab selection and other persistent selection recipes. Keyboard focus uses `ring-focus` independently of selection.

### Secondary

- **Gold, silver, and ink print materials** (`card-gold-*`, `card-silver-*`, `card-ink-*`): selectable Agent and Workforce frames with coordinated edge, inner frame, paper, and text. They remain fixed across app themes.
- **Jade and violet print materials** (`card-jade-*`, `card-violet-*`): Context/Memory and Automation card identities respectively.
- **Artwork contrast** (`card-art-ground`, `card-art-text`, `card-art-shade`): a dark image backing, pale title/category lettering, and an upper image scrim keep the full-frame art readable.
- Established `category-amber-*` and `category-slate-*` semantic roles remain available to other product patterns; they no longer supply the illustrated card material palette.

### Neutral

- **Warm surface** (`neutral-subtle-default`): the library and Workshop shell.
- **Inset surface** (`neutral-muted-default`): mixed with Warm surface for quiet working regions. The canvas mixes 55% Warm surface with 45% Inset surface, the designer stage uses 60% / 40%, and the library details rail uses 80% / 20%.
- **Control surface** (`neutral-default-default`): established field and tag fills.
- **Ink** (`ink-default-default`, `ink-muted-default`): primary and supporting app text. These roles change with the theme; card artwork and rules text use their fixed material pairs.
- **Hairline** (`hairline-default-default`): dividers and structural boundaries; do not replace it with locally chosen grays.

**The Identity and State Rule.** Card materials remain stable when execution state changes. Status, validation, and destructive actions use their existing semantic feedback roles and explicit labels.

## Typography

**Display Font:** Inter with the system sans-serif fallbacks in the frontmatter.

**Body Font:** The same Inter stack for application controls, details, and card rules.

**Card Artwork Font:** Songti SC, STSong, Noto Serif CJK SC, serif, from `card.material.json`. This approved lettering is confined to illustrated card titles.

**Label/Mono Font:** Labels use the text stack. Code uses the existing system monospace stack.

Use existing `DsText` roles for application UI: `page` for the library heading, `title` for designer and details headings, `base` for controls and descriptions, and `meta` for category labels, capability labels, model, Skills, and version. Within the registered collectible artwork/media-frame exception, Agent titles use the `card-art-title` container-relative clamp with a 20px minimum; resource titles use `resource-card-title`, and two-line summaries use `card-summary`. These pattern-specific roles do not replace the product type scale. Weight remains independent of standard-control geometry.

Use sentence case and semantic headings. Card names truncate within their allotted width and retain the full `title`; summary text wraps anywhere and clamps to two lines with the full value available as a title. Configuration and details retain the underlying capability content. A card illustration is decorative beside semantic text and uses an empty image alternative.

**The Same Hierarchy Rule.** The gallery, preview, and canvas share `CardFace` and its container-relative type hierarchy. Only the compact resource-card title uses its documented smaller range; app controls retain the standard text roles.

## Layout

Compose controls with semantic spacing: control gap and inline inset, panel inset, card inset, related stacks, and section stacks. The full spacing scale and canonical content headers remain defined by the active guideline. Standard controls retain shared size recipes; card or canvas geometry does not authorize new control sizes.

The card extension uses the registered `media-frames` exception for portrait proportions and image framing. `CardFace` has aspect ratio 244 / 352. The gallery uses an auto-fill grid with a 208px minimum track and a face capped at 208px wide (about 300px tall); the selected card details occupy a 282px rail. The designer preview is bounded at 338px (about 488px tall), beside a 350px property rail. These values belong to this pattern, not the global sizing scale.

At a Workshop container width of 760px or less, the gallery stacks above its details rail and uses 176px minimum grid tracks. The designer stays side by side from 600px through 760px, with a preview bounded at 244px and a 300px properties rail; below 600px it stacks. In stacked layouts the rail fills the available width and its separator moves to the top. The header and Save action remain outside the scrolling body. Wide layouts give the gallery, preview stage, and properties rail their own overflow regions with the shared `scrollbar-always-visible` recipe. Modal Workshop uses the existing `DialogContent` workbench variant; the embedded version occupies the owning canvas region.

The Space workforce/graph surface uses the approved compact sidebar width of 182px plus the existing 2px column gap. Other app destinations retain the existing 240px sidebar plus that gap. Sidebar motion still uses the same measured shell pattern. Expanded Sessions are containment regions over the canvas; Agent actions sit below the artwork, and a Session results strip links to the actual Task and run status.

Light and dark modes use the same layout and semantic roles. Narrow and short desktop windows, 200% zoom, long localized names, and missing data must preserve reachable controls and readable content. This desktop card pattern does not assert a separate mobile composition.

## Elevation & Depth

Depth explains interaction and ownership. The quiet shell relies on tonal layering and spacing. Primary buttons use the existing control, hover, and pressed elevation roles; overlays use popover or dialog elevation. Standard `Card` retains its existing shared recipe. The illustrated Agent card is frame-led and does not add a stock box shadow, foil effect, or glow. Its title shadow and upper-art scrim are scoped artwork contrast treatments, not application elevation.

### Shadow Vocabulary

The exact current values are recorded in `.impeccable/design.json` from `semantic.elevation.json`. Reuse `control`, `control-hover`, `control-pressed`, `card`, `floating`, `popover`, `dialog`, and `drag` according to their existing ownership. Rows and inset regions default to `none`.

Library card hover moves the face upward by 2px; reduced motion removes that movement. Shared control feedback uses the existing 160ms ease-out recipe and restrained pressed scale. Do not add looping animation to a repeated card or communicate state only through motion.

**The Owned Depth Rule.** Shared primitives own their elevation. Feature code adds depth only when the hierarchy calls for it and uses an existing semantic elevation role.

## Shapes

Actions are pills or circles; fields, media, cards, panels, and dialogs keep bounded radii. The frontmatter records the reused semantic radii. The illustrated face deliberately uses the field/media radius rather than the generic card radius, with a compact-control inner rim. Classic layouts keep a separate paper rules panel with a 2px print corner. Full layouts use a translucent reading veil joined to the inner artwork rim, with no separate box border and a soft upper edge. These media proportions, print details, fixed palette, and serif lettering remain scoped to the registered `media-frames` and `collectible-card-artwork` exceptions in `src/style/tokens/exception.registry.json`.

The outer card boundary uses the strong border role. Its inner rim, classic rules panel, and dividers use thin boundaries. Full-art metadata uses a subdued ink divider. Keep the face overflow visible so keyboard focus and canvas connection ports remain visible; artwork clips in its own rounded frame. Default keyboard focus is a 2px semantic ring with a 2px offset. Selection and validation must compose with that ring. Forced-color mode uses `Canvas` and `CanvasText` for the reading area and retains an explicit top boundary.

## Components

### Buttons

Use `Button` with supported `variant`, `tone`, `emphasis`, `size`, and `buttonContent` axes. Primary is Accent with its paired foreground; secondary is Neutral; outline, ghost, and text remain restrained. Workshop header actions use `sm`; canvas footer actions use `xs`. One primary action belongs to each decision context. Hover, disabled, pressed, and focus behavior stay in the primitive. `DsIcon` owns glyph geometry: standard icons use `main`; dense `xs` buttons use `main-compact`.

### Chips

Shared `Tag` and `Badge` remain compact pills with `meta` typography. Workshop category filtering is a group of shared buttons, using secondary for the selected filter and ghost for the rest, with `aria-pressed`. The card category is semantic text over the shaded artwork; it is not an execution-status badge.

### Cards / Containers

Use the existing `Card`, panel, menu, popover, and dialog recipes for operational containers. Their semantic spacing, radii, boundaries, and elevation remain owned by the primitive. The collectible frame belongs to the shared illustrated Agent, Workforce, Context, Memory, and Automation card pattern. Settings panels, Session regions, and other operational containers retain their existing recipes.

### Inputs / Fields

Reuse `Input`, outlined `Textarea`, `Select`, `SelectContent fitTrigger`, and shared labels. Default fields are 40px high; `sm` fields are 32px; textareas use the existing minimum-height recipes. The designer uses separate appearance and capability tabs. Uploading and saving disable dependent actions; upload errors, save failures, and placement failures remain visible with live announcements or alerts. Empty results, loading, unavailable models, and retry states use readable product text.

### Navigation

Reuse `Tabs` with `appearance="border"` for appearance/capability sections, preserving its keyboard behavior, text hierarchy, focus, and active underline. Back actions use shared buttons. The existing app navigation, Session regions, and graph connection behavior remain owned by their current surfaces. A Session is containment; it is not an executable character card.

### Shared Agent card face

`CardFace` is used by the Workshop library, template designer, instance appearance editor, and workspace graph. It owns the title, category, illustration, summary, and Agent/Workforce or resource metadata. The graph supplies connection ports and keeps Agent configuration/run controls below the artwork; the card does not own execution or history.

- **Gold, silver, and ink:** each uses its fixed edge, frame, paper, and ink quartet from `card.material.json`, independent of app theme.
- **Context and Memory:** jade materials override the selectable Agent materials.
- **Automation:** violet materials override the selectable Agent materials.
- **Readable artwork:** the image uses centered horizontal framing at 30% vertically, with an upper dark scrim, a serif title, and a circular category seal. Both rules treatments retain a 31% minimum height and existing semantic text roles.
- **Full artwork:** following the owner's bottom-panel refinement, illustration continues behind the capability text and model metadata. The reading veil aligns with the inner artwork's 6px side/bottom insets, uses 82–90% of the existing paper color, and fades in over 24px above its text region. Its minimum body-text contrast across all five materials is 4.86:1 even over black artwork. Square or wider artwork keeps its 74%-height foreground framing; a blurred copy of the same image fills the backdrop, while the foreground's bottom edge fades. This preserves the subject without leaving an empty lower field or modifying uploaded assets.
- **Classic artwork:** the image window begins 24% from the top and ends 36% above the bottom, with the semantic control-inline inset. The illustration remains separate from the opaque lower capability panel, which sits 3% above the bottom with 4% side insets.

Title and summary are presentation fields. They do not change the Agent name, role, instructions, model, Skills, tool policy, or Harness. Template appearance and configuration are saved as distinct domains; installed instances remain independent. Instance appearance updates use the dedicated card-design operation with `card_revision` concurrency checks, independent of configuration revision. Preserve connections and Tasks when changing either presentation or capability. A template is not a copy of Task history.

### Artwork provenance

Three original illustrations were generated through the native image generator for this implementation: `src/assets/cards/dragon-amethyst.webp`, `guardian-sapphire.webp`, and `archive-jade.webp`. They map to the existing `dragon`, `crab`, and `oasis` preset keys so persisted identifiers stay unchanged. Each delivered image is 1024 × 1536 and below 600,000 bytes (about 0.5 MB). Original PNGs, exact prompts, hashes, and WebP derivative settings are retained in `src/assets/cards/provenance.json` and adjacent prompt sidecars; delivery conversion did not resize or crop the artwork.

The existing `owl`, `document`, and `custom` presets still use repository artwork from `src/assets/agent`; uploaded designs retain priority over presets. Preserve repository attribution and license notices. The original new artwork uses no reference-game pixels, branding, or card lettering.

User uploads accept PNG, JPEG, or WebP up to 8 MiB. `readCardArtwork` decodes the raster, scales the longest dimension to at most 1024px without enlargement, and stores a bounded WebP data URL at quality 0.85, limited to 1,400,000 characters. A validation failure retains the prior design and shows the upload error. The file chooser, upload pending state, and saved appearance use the existing controls.

Reference-only Yu-Gi-Oh images informed the approved composition; they must never become shipping assets. A reference, mockup, or character illustration does not prove a workflow ran or that an automation is enabled.

## Do's and Don'ts

### Do:

- **Do** read the active design and terminology contracts before extending a surface.
- **Do** consume semantic tokens and shared controls in both light and dark modes.
- **Do** reuse `CardFace` in every library, designer, and installed-card context.
- **Do** keep artwork faces clear of the capability panel with the established full/classic framing.
- **Do** preserve independent appearance, capability, template version, and Task-history boundaries.
- **Do** retain generation prompts, derivative provenance, and repository notices for the corresponding artwork.
- **Do** verify focus, selection, disabled, pending, error, empty, long-content, reduced-motion, and narrow-desktop behavior in the actual surface.

### Don't:

- **Don't** turn card material or category color into execution status or validation meaning.
- **Don't** introduce raw feature colors, arbitrary standard-control geometry, stock shadows, or local icon sizes.
- **Don't** extend fixed print materials or serif card lettering to shared controls or unrelated app surfaces.
- **Don't** ship reference-only Yu-Gi-Oh artwork or imply approval of its licensing.
- **Don't** imply that changing card text changes Agent capability or copies Task history.
- **Don't** claim pixel-identical mock fidelity or completed build gates from this documentation. Numeric comparisons and their remaining image-identity limitation are recorded in the surface brief.
