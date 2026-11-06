# Full-art card reading area refinement

The owner accepted the card style and requested that the lower rectangular
information area feel integrated, with the full-frame illustration continuing
behind it.

## Implementation

- Reused `CardFace`, `DsText`, and the existing card material tokens. Full layouts
  now align the reading area with the inner artwork rim, remove its separate
  border, and fade into an 82–90% paper veil. Model and Skills metadata remain.
- The full-art metadata divider uses the same material ink at 24% opacity.
- Portrait illustrations continue underneath. Square images retain the existing
  74%-height foreground and use a blurred copy of the same image behind it; their
  original files and saved data are unchanged.
- Classic layouts retain the opaque printed panel. Forced colors use
  `Canvas`/`CanvasText`, an explicit top boundary, and no translucent fade.
- This uses the existing `collectible-card-artwork` / `media-frames` exceptions.
  No new application colors, control geometry, animations, or dependencies.

## Verification

- Actual Electron walkthrough: workspace canvas, card library, and designer;
  light/dark themes; 1600 × 1050 and 886 × 811 viewports; portrait and square
  artwork; full/classic switching; forced colors and reduced motion.
- At the least opaque text backing, all five material pairs exceed 4.5:1 even
  over black artwork: gold 6.05, silver 5.98, ink 6.07, jade 5.40, violet 4.86.
- The square-image preview retained its foreground ratio (349px foreground /
  472px artwork area), with a 472px extension. Classic had no extension and kept
  its opaque background and 1px panel border. Forced colors resolved to white
  background, black text, a 1px top boundary, and no fade.
- `npm run type-check` passed.
- `npx vitest run src/components/Session/Agents/CardWorkshop.test.tsx
src/components/Workspace/WorkspaceGraph/GraphNodes.test.tsx` passed: 15 tests.
- `npx eslint src/components/Session/Agents/CardFace.tsx` passed.
- `npm run check:design-tokens` passed, including 60 theme/contrast variants.
- `git diff --check` passed.
- Impeccable detector ran once; its only advisory was the pre-existing 2px
  classic print-panel corner, covered by the registered artwork exception.

Visual evidence is in the ignored `.impeccable/review/card-rules-*.png` files.
The final confirmation includes `card-rules-square-light-886.png`,
`card-rules-classic-dark-886.png`, and `card-rules-designer-dark-1600.png`.
Prior mock pixel-comparison scores are historical; this owner-requested
refinement intentionally supersedes the mock's opaque full-art rules panel.

No saved card designs, connections, task histories, model configuration, or
node positions were changed during this refinement. Visual switching used an
unsaved designer draft, which was discarded. No paid model run was performed.
