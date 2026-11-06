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
    backgroundColor: '{colors.neutral-subtle-default}'
    textColor: '{colors.ink-default-default}'
    rounded: '{rounded.field}'
---

# Design System: AgentDeck（智牌）

## Overview

**Creative North Star: "The operational card desk"**

AgentDeck is a calm, compact working environment. Warm Neutral surfaces, Ink hierarchy, restrained depth, and familiar semantic controls keep dense tasks readable. Illustrated Agent cards extend this established system: a recognizable portrait, a bounded frame, and a readable capability panel travel together between the library, designer, and canvas. The name above describes the approved direction; it does not establish a replacement identity.

This document records the implemented extension. [The active design guideline](docs/design-system/design.md) remains authoritative, including where its legacy heading says Eigent. `src/style/tokens`, generated outputs, and shared primitives remain the executable source of truth. [Product terminology](docs/product-terminology.md) governs visible Space → Session → Task wording; the existing Project identifiers remain technical contracts. Surface strategy and approval history stay in [the card Workshop brief](.impeccable/briefs/card-workshop.md).

The frontmatter is a machine-readable snapshot of reused roles, extracted from the actual theme engine (`eigent`, contrast 43) and generated dimension/type tokens. Unprefixed colors show the default light mode; `dark-` entries show the corresponding dark mode. They are documentation keys, never new application aliases. Product code consumes the same `--ds-*` semantic variables in both themes so user theme and contrast choices continue to work. Component entries show default light values; the sidecar snippets remain live-bound to semantic variables.

**Key Characteristics:**

- Compact operational controls with visible keyboard focus.
- Warm Neutral surfaces and Ink hierarchy, with Accent reserved for action and selection.
- Portrait cards with a stable frame, visible artwork, and readable capability text.
- One shared card face across reusable designs and installed instances.
- Appearance, capability configuration, and Task history remain distinct.

## Colors

The shell stays quiet; semantic action contrast and categorical card frames establish hierarchy without decorating every working region.

### Primary

- **Operational Accent** (`accent-strong-default`, `accent-strong-hover`): primary Save and Place actions. The paired `ink-inverse` foreground changes with the theme; it is not universally white.
- **Selection Accent** (`accent-default-default`): shared tab selection and other persistent selection recipes. Keyboard focus uses `ring-focus` independently of selection.

### Secondary

- **Amber gold** (`category-amber-*`): the default Agent card's frame, category label, and restrained rules-panel tint. It expresses identity, not warning or execution status.
- **Slate silver** (`category-slate-*`): the silver frame and the inner boundary of both silver and ink cards. The ink outer frame uses `ink-default-default`.

### Neutral

- **Warm surface** (`neutral-subtle-default`): library, card headings, readable card panels, and the Workshop shell.
- **Inset surface** (`neutral-muted-default`): the design stage and artwork backing.
- **Control surface** (`neutral-default-default`): established field and tag fills.
- **Ink** (`ink-default-default`, `ink-muted-default`): primary and supporting text, including card content. These roles invert with the theme.
- **Hairline** (`hairline-default-default`): dividers and structural boundaries; do not replace it with locally chosen grays.

**The Identity and State Rule.** Card materials remain stable when execution state changes. Status, validation, and destructive actions use their existing semantic feedback roles and explicit labels.

## Typography

**Display Font:** Inter with the system sans-serif fallbacks in the frontmatter.

**Body Font:** The same Inter stack; there is no separate trading-card display typeface.

**Label/Mono Font:** Labels use the text stack. Code uses the existing system monospace stack.

Use `DsText` roles from the frontmatter rather than raw local sizes. `page` carries the library heading, `title` carries card names and designer titles, `base` carries controls and descriptions, and `meta` carries card category, capability summary, model, Skills, and version. `display`, `section`, and `body-large` remain available established roles; the card extension does not require a new scale. Weight is independent of geometry: regular, medium, semibold, and bold are established choices.

Use sentence case and semantic headings. Card names truncate within their allotted width and retain the full `title`; summary text wraps anywhere and clamps to two lines with the full value available as a title. Configuration and details retain the underlying capability content. A card illustration is decorative beside semantic text and uses an empty image alternative.

**The Same Hierarchy Rule.** The gallery, preview, and canvas render the same card typography through `CardFace`; context may add controls without inventing a smaller card text system.

## Layout

Compose controls with semantic spacing: control gap and inline inset, panel inset, card inset, related stacks, and section stacks. The full spacing scale and canonical content headers remain defined by the active guideline. Standard controls retain shared size recipes; card or canvas geometry does not authorize new control sizes.

The card extension uses the registered `media-frames` exception for portrait proportions and image framing. `CardFace` has aspect ratio 244 / 352. The gallery uses an auto-fill grid with a 220px minimum track; the selected card's details occupy a 280px rail. The designer preview is bounded at 338px, beside a 340px property rail. These are pattern geometry, not new global sizing tokens.

At a Workshop container width of 760px or less, the body stacks vertically. The preview becomes 244px wide, the property/detail rail fills the available width, and its separator moves to the top. The header and Save action stay outside the scrolling body. Wide layouts give the gallery, preview stage, and property rail their own overflow regions; persistent overflow uses the shared `scrollbar-always-visible` recipe. Modal Workshop uses the existing `DialogContent` workbench variant; the embedded version occupies the owning canvas region.

Light and dark modes use the same layout and semantic roles. Narrow and short desktop windows, 200% zoom, long localized names, and missing data must preserve reachable controls and readable content. This desktop card pattern does not assert a separate mobile composition.

## Elevation & Depth

Depth explains interaction and ownership. The quiet shell relies on tonal layering and spacing. Primary buttons use the existing control, hover, and pressed elevation roles; overlays use popover or dialog elevation. Standard `Card` retains its existing shared recipe. The illustrated Agent card is frame-led and does not add a stock shadow, foil effect, or glow.

### Shadow Vocabulary

The exact current values are recorded in `.impeccable/design.json` from `semantic.elevation.json`. Reuse `control`, `control-hover`, `control-pressed`, `card`, `floating`, `popover`, `dialog`, and `drag` according to their existing ownership. Rows and inset regions default to `none`.

Library card hover moves the face upward by 2px; reduced motion removes that movement. Shared control feedback uses the existing 160ms ease-out recipe and restrained pressed scale. Do not add looping animation to a repeated card or communicate state only through motion.

**The Owned Depth Rule.** Shared primitives own their elevation. Feature code adds depth only when the hierarchy calls for it and uses an existing semantic elevation role.

## Shapes

Actions are pills or circles; fields, media, cards, panels, and dialogs keep bounded radii. The frontmatter records the reused semantic radii. The Agent face deliberately uses the field/media radius rather than the generic card radius, with a compact-control inner rim. This portrait media frame is the scoped `media-frames` exception already registered in `src/style/tokens/exception.registry.json`.

The outer card boundary uses the strong border role. Its inner rim, rules panel, and dividers use thin boundaries. Keep the face overflow visible so keyboard focus and canvas connection ports remain visible; artwork clips in its own rounded frame. Default keyboard focus is a 2px semantic ring with a 2px offset. Selection and validation must compose with that ring. Forced-color mode retains card and rules-panel boundaries through `CanvasText`.

## Components

### Buttons

Use `Button` with supported `variant`, `tone`, `emphasis`, `size`, and `buttonContent` axes. Primary is Accent with its paired foreground; secondary is Neutral; outline, ghost, and text remain restrained. Workshop header actions use `sm`; canvas footer actions use `xs`. One primary action belongs to each decision context. Hover, disabled, pressed, and focus behavior stay in the primitive. `DsIcon` owns glyph geometry: standard icons use `main`; dense `xs` buttons use `main-compact`.

### Chips

Shared `Tag` and `Badge` remain compact pills with `meta` typography. Workshop category filtering is a group of shared buttons, using secondary for the selected filter and ghost for the rest, with `aria-pressed`. The card's category label is semantic text on a quiet surface; it is not an execution-status badge.

### Cards / Containers

Use the existing `Card`, panel, menu, popover, and dialog recipes for operational containers. Their semantic spacing, radii, boundaries, and elevation remain owned by the primitive. The trading-card frame belongs only to the illustrated Agent pattern; do not spread that treatment to every settings panel or resource node.

### Inputs / Fields

Reuse `Input`, outlined `Textarea`, `Select`, `SelectContent fitTrigger`, and shared labels. Default fields are 40px high; `sm` fields are 32px; textareas use the existing minimum-height recipes. The designer uses separate appearance and capability tabs. Uploading and saving disable dependent actions; upload errors, save failures, and placement failures remain visible with live announcements or alerts. Empty results, loading, unavailable models, and retry states use readable product text.

### Navigation

Reuse `Tabs` with `appearance="border"` for appearance/capability sections, preserving its keyboard behavior, text hierarchy, focus, and active underline. Back actions use shared buttons. The existing app navigation, Session regions, and graph connection behavior remain owned by their current surfaces. A Session is containment; it is not an executable character card.

### Shared Agent card face

`CardFace` is used by the Workshop library, template designer, instance appearance editor, and workspace graph. It owns the title, Agent/Workforce category, illustration, capability summary, model, and Skills presentation. The graph supplies its footer and connection ports; the card does not own execution or history.

- **Gold:** amber outer and inner frame, with a rules panel mixing 94% Neutral subtle and 6% amber subtle background.
- **Silver:** slate outer and inner boundaries and a Neutral rules panel.
- **Ink:** Ink outer boundary, slate inner boundary, and a Neutral rules panel.
- **Full artwork:** the image fills its inner media area. Square or wider artwork (natural width at least 90% of natural height) uses 74% of that area's height, keeping the face above the lower capability panel. This is a bounded display field, not a new cropped asset.
- **Classic artwork:** the image window begins 24% from the top and ends 34% above the bottom, with the semantic control-inline inset. The illustration remains separate from the lower capability panel.

Title and summary are presentation fields. They do not change the Agent name, role, instructions, model, Skills, tool policy, or Harness. Template appearance and configuration are saved as distinct domains; installed instances remain independent. Instance appearance updates use the dedicated card-design operation with `card_revision` concurrency checks, independent of configuration revision. Preserve connections and Tasks when changing either presentation or capability. A template is not a copy of Task history.

### Artwork provenance

Built-in artwork reuses the repository's existing `src/assets/agent/dragon.png`, `owl.png`, `crab.png`, `oasis.png`, `document.png`, and `custom.png`. These are existing repository assets, not newly generated or newly licensed illustrations. Retain the repository's attribution and license notices; the sidecar records their source paths and Git provenance without claiming a new ownership grant.

User uploads accept PNG, JPEG, or WebP up to 8 MiB. `readCardArtwork` decodes the raster, scales the longest dimension to at most 1024px without enlargement, and stores a bounded WebP data URL at quality 0.85, limited to 1,400,000 characters. A validation failure retains the prior design and shows the upload error. The file chooser, upload pending state, and saved appearance use the existing controls.

Reference-only Yu-Gi-Oh images informed the approved composition; they must never become shipping assets. A reference, mockup, or character illustration does not prove a workflow ran or that an automation is enabled.

## Do's and Don'ts

### Do:

- **Do** read the active design and terminology contracts before extending a surface.
- **Do** consume semantic tokens and shared controls in both light and dark modes.
- **Do** reuse `CardFace` in every library, designer, and installed-card context.
- **Do** keep artwork faces clear of the capability panel with the established full/classic framing.
- **Do** preserve independent appearance, capability, template version, and Task-history boundaries.
- **Do** retain source provenance and repository notices for reused artwork.
- **Do** verify focus, selection, disabled, pending, error, empty, long-content, reduced-motion, and narrow-desktop behavior in the actual surface.

### Don't:

- **Don't** turn card material or category color into execution status or validation meaning.
- **Don't** introduce raw feature colors, arbitrary standard-control geometry, stock shadows, or local icon sizes.
- **Don't** reinterpret the media-frame exception as permission to restyle the app shell or shared controls.
- **Don't** ship reference-only Yu-Gi-Oh artwork or imply approval of its licensing.
- **Don't** imply that changing card text changes Agent capability or copies Task history.
- **Don't** claim numeric mockup fidelity from this documentation; the recorded comp workflow remains at specification stage without a numeric fidelity pass.
