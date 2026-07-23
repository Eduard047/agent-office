# Design QA

- Source visual truth: `/Users/eduard/Documents/Codex/2026-07-22-new-chat/design/selected-reference.png`
- Browser-rendered implementation: `/Users/eduard/Documents/Codex/2026-07-22-new-chat/design/implementation-final.png`
- Full-view comparison: `/Users/eduard/Documents/Codex/2026-07-22-new-chat/design/comparison-final-reset.png`
- Focused comparison: `/Users/eduard/Documents/Codex/2026-07-22-new-chat/design/comparison-details-final-wide.png`
- Mobile evidence: `/Users/eduard/Documents/Codex/2026-07-22-new-chat/design/implementation-mobile-clipped.png`
- Desktop viewport and state: 1672 × 941 CSS px, device scale factor 1, initial office overview with no agent detail open
- Source pixels: 1672 × 941
- Implementation pixels: 1672 × 941
- Density normalization: none required for the desktop source and implementation; both were compared at identical pixel dimensions
- Mobile viewport: 390 × 844 CSS px; measured page width and scroll width were both 390 px

## Full-view comparison evidence

The final implementation preserves the source composition: 83 px header, wide office canvas, 374 px task rail, four agent markers, warm light palette, glowing handoff path, three vertically stacked task cards, and the same initial information density. The office scale and marker placement align closely with the selected reference.

## Focused comparison evidence

The focused comparison checks the two important detail regions together:

- Agent markers retain the green/blue status coding, two-line name/role hierarchy, soft tinted surfaces, and placement relative to the four people.
- The task rail retains the title hierarchy, colored left borders, circular Phosphor icons, status chips, rounded card shape, spacing, and card order.

## Required fidelity surfaces

- Fonts and typography: Inter at 400–700 weights matches the neutral sans-serif character of the reference. Heading, label, card-title, and status-chip hierarchy are consistent, with no clipping or unintended wrapping at desktop.
- Spacing and layout rhythm: Header height, office/task split, task gaps, card padding, marker sizes, and radii match the reference closely. Mobile uses a deliberate horizontal task carousel and has no page-level horizontal overflow.
- Colors and visual tokens: Warm ivory, pale wood, sage, blue, and muted yellow map to the reference. Semantic agent/task colors remain consistent across markers, cards, focus, and progress.
- Image quality and asset fidelity: The office is a dedicated project raster asset generated from the selected reference, not CSS or placeholder art. It preserves the four-person layout, room perspective, light, furniture, rug, and glowing handoff path without visible UI baked into the image.
- Copy and content: Initial visible copy matches the reference (`My project`, `4 agents`, `12k tokens`, agent names/roles, task names, and task states). Additional copy appears only after interaction.
- Icons: Phosphor icons provide a consistent rounded stroke language close to the reference; no handcrafted SVG or text-glyph icons are used.
- Accessibility and behavior: Buttons have semantic names, visible keyboard focus, reduced-motion support, and the page has no desktop or mobile horizontal overflow.

## Browser verification

Primary interactions tested:

- Opened `Build feature` from the task rail and verified that Liam became selected.
- Opened the message composer, entered a note, sent it, and verified the success status.
- Paused Liam and verified that both the marker state and action changed to `Paused` / `Resume`.
- Opened the token budget and verified the explanation that visual office activity uses no tokens.
- Checked the 390 × 844 responsive layout.

Console errors checked: none.

## Comparison history

### Pass 1

- [P2] The office illustration was too small inside the left canvas, creating larger margins than the source.
- [P2] Maya's detail card was open by default, while the source shows the clean overview state.

Fixes: scaled the office asset to 112%, adjusted all four marker positions, and changed the initial selected-agent state to closed.

Post-fix evidence: `implementation-pass2.png` and `comparison-pass2.png`.

### Pass 2

- [P2] An extra notification button and bottom activity note were present but absent from the selected source.

Fixes: removed both extras and recaptured the clean initial state.

Post-fix evidence: `implementation-final.png`, `comparison-final-reset.png`, and `comparison-details-final-wide.png`.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- [P3] The generated office illustration has minor character and furniture differences from the source raster, while preserving the selected layout, mood, and interaction anchors.

final result: passed
