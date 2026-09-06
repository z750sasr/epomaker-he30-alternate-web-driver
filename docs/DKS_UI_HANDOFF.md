# HE30 DKS: analysis and implementation handoff

Prepared 2026-09-05 from the current working tree, not only committed HEAD. The user requests improvements to HE30's DKS UI. This is an implementation brief for the AI working in this repository; no implementation was changed by this analysis.

## Executive conclusion

Fix round-trip correctness before adding visual polish. The current seven-cell timeline offers independent states that its conversion to HE30 status fields cannot preserve. This is demonstrably a client-side conversion problem, not evidence that firmware folds the user's choices.

An in-memory test of the actual functions in `js/app/editors.js` enumerated all 128 masks. There are only 17 distinct output status tuples, and 112 masks change after `mask -> fields -> mask`. These counts describe this adapter, NOT the keyboard's total capabilities.

`node smoke-test.cjs` passed on the initially analyzed tree, but its old DKS assertions did not cover these behavioral failures. Post-audit correction: `epomaker.keybord.net.cn.har` is now present at the repository root. Its captured original-driver bundle confirms the four native fields, their drag constraints, defaults `[10,30,30,10]`, and the `raw / 10` millimetre display scale described below. No hardware write or physical DKS timing test was performed during this audit.

## Implementation boundaries

- Preserve the existing dirty working tree, including cloud/server work. Do not reset, broadly format, commit, push, or deploy for this request.
- Read `docs/ARCHITECTURE.md`; this is an ordered classic-script application, not a bundled framework app.
- Both `index.html` and `json_editor/index.html` must keep working. Register any new script in both and the smoke-test asset inventory.
- Keep DKS edits staged. Preserve Apply/Revert and existing verified device-write behavior.
- Do not copy AE64's protocol, travel limits, output restrictions, or firmware-version gates into HE30.

## Current data flow and protocol contract

`advancedFormHtml -> dksActionEditor/dksHiddenInputs -> bindAdvancedForm -> syncDksMatrix -> setDksMask -> saveAdvanced -> compileAdvanced -> encodeDksBank -> verified write`.

Primary source locations (line numbers are approximate; use symbol names):

| Location | Responsibility |
| --- | --- |
| `js/app/editors.js:289–368` | Point metadata, field-to-mask adapter, timeline markup |
| `js/app/editors.js:369` | DKS modal fields and default thresholds |
| `js/app/editors.js:530–720` | Mask conversion, presets, painting, event binding |
| `js/app/editors.js:727` | Four-row collection, validation, staging |
| `js/protocol/codecs.js:105–192` | Native packed status conversion and DKS bank codec |
| `js/protocol/core.js:317,437` | Wooting distance and DKS import conversion |
| `styles/components.css:82–133` | DKS layout and timeline styling |
| `js/app/hall.js:67` | Shared editable distance input bindings |
| `smoke-test.cjs` | Existing codec and static-surface checks |

The implemented HE30 format has 32 DKS slots per profile. Each record occupies 24 bytes: four threshold bytes followed by four five-byte output records. Each output consists of a three-byte mapping and a little-endian packed status word. The bank buffer is 1024 bytes; the 32 records use 768 bytes. Read/write commands are 0xA2/0xA3; profile bank offset is 1024 times the profile index. Host mappings use type 144 and a slot index. Keep this allocation model unless new evidence contradicts it.

The UI calls its four fields P1, P2, R2, R1. It currently displays raw thresholds divided by ten, with a raw 1–30 range (0.1–3.0 mm). The codec permits raw values through 255. This difference does not establish that 25.5 mm is supported; do not expand physical limits based on storage width.

Each row's canonical fields are `downStart`, `downEnd`, `upStart`, `upEnd`. These are encoded through thermometer-like status bits, including special coupling/normalization for value 3 and `downStart=4`; they are not a native seven-bit bitmap. Decode reads three down-start bits, three down-end bits, two meaningful up-start bits, and one up-end bit. The encoder's special cases must be studied alongside its decoder before deciding which editing states are valid.

## Confirmed defects and reproduction cases

### P0: independently selectable spans disappear

`dksMaskToFields` uses only event bits 1, 4, 16, 64, except for the special all-on mask 127. It ignores span bits 2, 8, 32 in general. Conversely, `dksTimelineMaskFromEntry` invents connecting spans when adjacent events are present.

Examples using the actual functions:

| Selected mask | Mask after fields round-trip | Consequence |
| --- | --- | --- |
| 2 | 0 | First span alone disappears |
| 8 | 0 | Bottom span alone disappears |
| 3 | 1 | P1 plus first span loses the span |
| 5 | 7 | P1 and P2 acquire an unselected span |
| 6 | 4 | First span plus P2 loses the span |
| 20 | 28 | P2 and R2 acquire the bottom span |

Do not retain a freely paintable seven-bit representation as the authoritative model without a proven, lossless adapter. Remove/rewrite the callout blaming firmware for folding complex paths: conversion has already lost intent before a packet is sent. Successful byte verification only verifies those already-converted bytes.

### P0: opening and saving can alter an untouched row

`bindAdvancedForm` calls `syncDksMatrix`, which calls `setDksMask`, which overwrites the hidden canonical fields. This occurs while binding the form, not only after user interaction.

Examples (all unlisted fields zero):

- `downStart:3` projects to mask 6, then rewrites to `downStart:2`.
- `downEnd:3` projects to mask 12, then rewrites to `downStart:2, downEnd:0`.

These are client-side draft mutations; opening alone does not write hardware, but saving can stage the altered values. Rendering, opening a picker, binding listeners, or changing an unrelated row must never rewrite another row's status fields.

### P1: incomplete imported actions can break the editor

The importer may produce fewer than four `dksKeys`. Rendering uses that array as-is, while save unconditionally reads controls for all four indices. Normalize the draft to four rows without changing the existing rows; use canonical unassigned mappings for missing rows. Support empty imported arrays too.

### P1: imported distances have inconsistent units and destructive clamping

`convertWootingDks` uses `wootingDistanceToHundredths`, whose output is in hundredths of a millimeter, and places those values directly in `dksPoint`. The current DKS editor interprets that array as tenths and clamps it to raw 30 during rendering. A nominal 1.00 mm value represented as 100 therefore becomes raw 30 in the current UI instead of the expected raw 10 under its tenths interpretation.

This is a confirmed disagreement between code paths. The captured HE30 original-driver bundle establishes that DKS thresholds use tenths of a millimetre (`raw / 10`), with its editor constrained to raw 1–30. Centralize native raw-to-mm and mm-to-raw functions on that scale. Preserve unsupported imported/raw values with a visible warning; never silently clamp on opening. Do not impose AE64's 3.3 mm limit. Physical firmware behavior beyond the captured UI/codec still requires hardware validation.

### P1/P2: broken or incomplete interaction details

- The row Clear button has `data-dks-clear` markup but no matching handler. Bind it and specify whether it clears timing only or removes the output; preferably offer an explicit Remove action that clears both.
- Live link updates query `data-dks-link`, but generated links lack that attribute. Add stable row/segment identity or render from state.
- `dksMaskValue` fallback builds PascalCase property names but the projection reads camelCase, producing an incorrect empty projection when the hidden mask is absent.
- Painting uses `document.onpointerup`, overwriting other code's handler. Use scoped listeners with cleanup; handle pointer cancel, lost capture, dialog close, window blur, and primary-button filtering.
- Buttons rely on pointerdown/pointerenter rather than a complete click/keyboard interaction. Support keyboard activation without double toggles. Keep typing in text fields functional.
- Threshold edits update the numeric field but leave timeline-header distances stale. Update all derived labels from the same draft.
- P1<P2 and R1<R2 are only checked on save. Add immediate, adjacent feedback and prevent staging invalid values; preserve partial numeric input while the user types.

## Recommended architecture

Extract focused DKS model/editor code into a small module if this helps stay under the repository's module-size limit. Keep shared mapping-picker and distance-input components rather than duplicating them.

The authoritative draft should contain four raw thresholds and four native rows. Clone it from the existing item. Keep the original values separately for no-op/cancel tests. Derive display-only timelines from that draft, never the reverse during rendering.

Suggested pure-function contracts:

```js
createDksDraft(item) // clone; pad four rows; preserve existing raw values
projectDksRow(row) // read-only view: nodes, segments, summary, unsupported flags
applyDksOperation(row, operation) // validated native edit or explicit rejection
validateDksDraft(draft, capabilities) // field-addressed errors/warnings
dksRawToMm(raw, capabilities)
dksMmToRaw(mm, capabilities)
```

Do not invent semantics for status values. Build a table from current encoder/decoder plus available original HE30 evidence. Distinguish syntactically encodable values from firmware-validated behavior. Enumerate codec-normalized native states and their projections, identify projection collisions, and preserve the source tuple when the user makes no change.

If the current timeline cannot represent every native state unambiguously, show an "Existing advanced timing — preserved" row with a read-only projection and an explicit replace/reset action. Offer only operations whose result is representable and understood. A conservative native-stage editor is preferable to an attractive timeline that silently changes the configuration. An expert raw-field inspector can remain collapsed; it must not imply unverified values are safe.

## Proposed UI

1. Compact header: DKS name, physical host key, layer, tutorial/info button. Keep the existing host selection and mapping pickers.
2. Threshold section: two balanced columns, Downstroke (P1/P2) and Upstroke (R2/R1). Sliders and editable mm inputs share one binding. Use full names alongside abbreviations.
3. Action lifecycle: four output rows, each with a colored action marker, shared output-key picker, verified timing controls/projection, and a clearly labeled clear/remove button.
4. Presets: show only verified native recipes. Label "At shallow press", "At deep release", etc. Do not promise a timed tap or a hold duration merely because an event bit is selected. Explain confirmed lifecycle semantics in the tutorial.
5. Row summary: plain language generated from verified semantics, including press/release boundaries. If semantics are unknown, identify native stages rather than fabricate behavior.
6. Footer: validation, Cancel, Stage DKS. Staging remains separate from device Apply.

Use one shared CSS grid definition for timeline headers and action rows. Currently the header has seven equal columns but the body uses a separate flex layout; the header/body also disagree on minimum grid sizing. This can misalign point labels. On narrow screens, scroll the timeline within its panel (with the output column sticky if practical), not the whole modal. Stack threshold columns on small widths. Use readable text sizes and theme variables rather than adding more hardcoded dark backgrounds. Selected timing must have shape/text/ARIA cues in addition to color.

The tutorial should distinguish travel-triggered DKS from timed macros. Explain press versus release stages, output rows, staging, and the exact supported hold behavior once verified. Clearly label any simulated illustration as a preview, not measured keyboard output. Do not copy unsupported AE64 tutorial claims into HE30.

## What can be reused from AE64

Reference: `G:/GitHub/everglide-ae64-pro-webdriver/js/app/dks.js`.

Reusable ideas: a dedicated draft, explicit row operations, linked segment identifiers, shared key-picker interactions, focused rendering, and a four-row colored lifecycle view.

Not reusable as protocol facts: AE64's seven visible cells map to an eight-bit mask (the center span uses 0x18, then release event 0x20, span 0x40, final event 0x80). HE30 currently uses packed native status fields and a synthetic seven-bit UI mask. AE64 also uses two depth values reused across phases, whereas HE30 currently stores four threshold bytes. Keep this distinction explicit. AE64's host/output allowlists and firmware version checks are device-specific.

## Required regression tests and acceptance

Add behavioral tests, not just source-string checks:

- Render/bind/save an untouched native row with status 3 and a full-hold row; native status data must not change merely from opening.
- Change one row's output or timing and assert all other rows/thresholds remain unchanged.
- Every offered UI operation survives edit -> stage -> reopen with identical intended state; unsupported operations are visibly rejected or disabled.
- Exhaustively characterize all 128 old masks to prevent restoring the same lossy adapter. Do not claim all 128 are valid firmware configurations.
- Native codec normalization is idempotent for documented valid states. Compare encoded bytes before/after a no-op edit for supported records.
- Imports with zero, one, two, three, four rows; missing timing fields; unassigned mappings; unknown values; threshold values outside the editable range.
- Unit conversion fixtures representing known physical values, including a Wooting 1.00 mm example, after the native scale is established.
- Clear/remove, output-picker cancel/confirm, every preset, threshold-header refresh, inline validation, pointer cancellation, keyboard activation, and repeated modal opening without listener buildup.
- 32-slot boundary and rejection of a 33rd DKS record; preserve host/base mapping and other advanced banks when editing/removing DKS.
- Both live and JSON-editor routes: desktop and narrow viewport; readable and aligned labels, no page-level horizontal overflow, working editable numeric fields.
- Run `node smoke-test.cjs` and new tests. State plainly if hardware validation is unavailable. Hardware follow-up should compare actual down/up events for a shallow press, full press/release, partial reversal, repeated crossings, and host release while an output is held.

Delivery order: (1) no-op preservation and honest state model, (2) row/import/units safety, (3) interaction defects, (4) layout and tutorial, (5) regression and visual verification. Report any unresolved native semantic question rather than hiding it behind automatic normalization.
