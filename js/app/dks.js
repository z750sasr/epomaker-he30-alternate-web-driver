"use strict";

/**
 * HE30-native Dynamic Keystroke editor.
 *
 * The firmware stores four threshold bytes and four output rows. Each output
 * row has four constrained range fields anchored at P1, P2, R2, and R1. It is
 * not the freely selectable seven-cell bitmap used by some other keyboards.
 */
const DKS_POINT_MIN = 1;
const DKS_POINT_MAX = 30;
const DKS_POINT_META = Object.freeze([
  { label: "P1", detail: "shallow press", phase: "down" },
  { label: "P2", detail: "deep press", phase: "down" },
  { label: "R2", detail: "deep release", phase: "up" },
  { label: "R1", detail: "shallow release", phase: "up" },
]);
const DKS_FIELD_META = Object.freeze([
  { field: "downStart", maximum: 4 },
  { field: "downEnd", maximum: 3 },
  { field: "upStart", maximum: 2 },
  { field: "upEnd", maximum: 1 },
]);
const DKS_COLORS = Object.freeze(["#ff6f91", "#ffb454", "#6fa8ff", "#73f0c0"]);
const DKS_ANCHOR_COLORS = Object.freeze(["#6f8cff", "#55d6be", "#f3c969", "#ff8a65"]);
let dksPointerGesture = null;

function dksRawToMm(raw) {
  return Number(raw) / 10;
}

function dksMmToRaw(mm) {
  return Math.round(Number(mm) * 10);
}

function dksEmptyMapping() {
  return API.makeMapping(0, 0, 0, state.profile?.profileIndex || 0, state.advancedLayer || 0);
}

function dksOutputAssigned(entry) {
  const key = entry?.key;
  if (!key) return false;
  const tuple = [Number(key.type), Number(key.code1), Number(key.code2)];
  return !(tuple.every((value) => value === 0) || tuple.every((value) => value === 255));
}

function dksTimingActive(entry) {
  return DKS_FIELD_META.some(({ field }) => Number(entry?.[field]) > 0);
}

/** Hide the companion value created by the native downStart=3 packing rule. */
function dksSemanticRow(row = {}) {
  const semantic = { ...row };
  if (Number(semantic.downStart) === 3 && Number(semantic.downEnd) === 2) semantic.downEnd = 0;
  return semantic;
}

function createDksDraft(item = {}) {
  const suppliedPoints = Array.isArray(item.dksPoint) ? item.dksPoint : [];
  const defaults = [10, 30, 30, 10];
  const points = defaults.map((fallback, index) => {
    const value = Number(suppliedPoints[index]);
    return Number.isFinite(value) ? Math.round(value) : fallback;
  });
  const sourceRows = Array.isArray(item.dksKeys) ? item.dksKeys : [];
  const rows = Array.from({ length: 4 }, (_, index) => {
    const source = sourceRows[index];
    if (!source) return { key: dksEmptyMapping(), downStart: 0, downEnd: 0, upStart: 0, upEnd: 0, _timingDirty: false };
    const row = {
      ...clone(source),
      key: clone(source.key || dksEmptyMapping()),
      downStart: Number(source.downStart) || 0,
      downEnd: Number(source.downEnd) || 0,
      upStart: Number(source.upStart) || 0,
      upEnd: Number(source.upEnd) || 0,
      _timingDirty: Boolean(source._timingDirty),
    };
    if (Number.isInteger(source._statusBits)) row._statusBits = source._statusBits;
    return row;
  });
  return { points, rows, pointEdited: [false, false, false, false] };
}

/** Read-only projection of native start/range values onto the four anchors. */
function projectDksRow(row) {
  const semantic = dksSemanticRow(row);
  return DKS_FIELD_META.flatMap(({ field }, anchor) => {
    const value = Number(semantic?.[field]) || 0;
    if (value <= 0) return [];
    return [{ field, anchor, value, end: Math.min(3, anchor + value - 1), tap: value === 1 }];
  });
}

function dksAnchorMaximum(row, anchor) {
  const semantic = dksSemanticRow(row);
  if (anchor === 0 && Number(semantic.downEnd) > 0) return 2;
  if (anchor === 0 && Number(semantic.upStart) > 0) return 3;
  if (anchor === 1 && Number(semantic.upStart) > 0) return 2;
  return DKS_FIELD_META[anchor].maximum;
}

/**
 * Edit one native anchor and prevent overlap by shortening any earlier hold.
 * Adjacent ranges may meet at the later anchor, matching the vendor editor.
 */
function editDksAnchor(draft, rowIndex, anchor, requestedValue) {
  const row = draft.rows[rowIndex];
  if (!row || !DKS_FIELD_META[anchor]) return draft;
  Object.assign(row, dksSemanticRow(row));
  const { field } = DKS_FIELD_META[anchor];
  row[field] = uiClamp(Math.round(Number(requestedValue) || 0), 0, dksAnchorMaximum(row, anchor));
  if (Number(row.downEnd) > 0 && Number(row.downStart) > 2) row.downStart = 2;
  else if (Number(row.upStart) > 0 && Number(row.downStart) > 3) row.downStart = 3;
  if (Number(row.upStart) > 0 && Number(row.downEnd) > 2) row.downEnd = 2;
  row._timingDirty = true;
  return draft;
}

function applyDksPresetToDraft(draft, rowIndex, preset) {
  const recipes = {
    tapP1: [1, 0, 0, 0], tapP2: [0, 1, 0, 0],
    tapR2: [0, 0, 1, 0], tapR1: [0, 0, 0, 1],
    fullHold: [4, 0, 0, 0],
  };
  const recipe = recipes[preset];
  const row = draft.rows[rowIndex];
  if (!row || !recipe) return draft;
  DKS_FIELD_META.forEach(({ field }, index) => { row[field] = recipe[index]; });
  row._timingDirty = true;
  return draft;
}

function clearDksDraftRow(draft, rowIndex) {
  const row = draft.rows[rowIndex];
  if (!row) return draft;
  row.key = dksEmptyMapping();
  DKS_FIELD_META.forEach(({ field }) => { row[field] = 0; });
  row._timingDirty = true;
  return draft;
}

function validateDksDraft(draft) {
  const errors = [];
  const warnings = [];
  const points = draft?.points || [];
  if (points.some((point) => !Number.isInteger(Number(point)))) errors.push("All four travel points must be whole HE30 raw units (0.1 mm each).");
  if (Number(points[0]) > Number(points[1])) errors.push("P1 cannot be deeper than P2; equal positions are supported.");
  if (Number(points[3]) > Number(points[2])) errors.push("R1 cannot be deeper than R2; equal positions are supported.");
  points.forEach((point, index) => {
    if (Number(point) < DKS_POINT_MIN || Number(point) > DKS_POINT_MAX) warnings.push(`${DKS_POINT_META[index].label} is raw ${point}, outside the original editor's 0.1–3.0 mm range. It will be preserved until edited.`);
  });
  (draft?.rows || []).forEach((row, index) => {
    const semantic = dksSemanticRow(row);
    const assigned = dksOutputAssigned(row);
    const timing = dksTimingActive(row);
    if (assigned && !timing) errors.push(`Output ${index + 1} has a key but no timing anchor.`);
    if (!assigned && timing) errors.push(`Output ${index + 1} has timing but no output key.`);
    DKS_FIELD_META.forEach(({ field, maximum }) => {
      const value = Number(semantic[field]);
      if (!Number.isInteger(value) || value < 0 || value > maximum) errors.push(`Output ${index + 1} has an unsupported ${field} value (${row[field]}).`);
    });
    if (Number(semantic.downEnd) > 0 && Number(semantic.downStart) > 2) errors.push(`Output ${index + 1} overlaps its P1 and P2 ranges.`);
    if (Number(semantic.upStart) > 0 && Number(semantic.downStart) > 3) errors.push(`Output ${index + 1} overlaps its P1 and R2 ranges.`);
    if (Number(semantic.upStart) > 0 && Number(semantic.downEnd) > 2) errors.push(`Output ${index + 1} overlaps its P2 and R2 ranges.`);
  });
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function dksThresholdField(index, raw) {
  const meta = DKS_POINT_META[index];
  const outside = raw < DKS_POINT_MIN || raw > DKS_POINT_MAX;
  const sliderValue = uiClamp(raw, DKS_POINT_MIN, DKS_POINT_MAX);
  return `<label class="field dks-threshold-field${outside ? " outlier" : ""}"><span>${meta.label} · ${esc(meta.detail)}</span><div class="range-line editable"><input type="range" min="${DKS_POINT_MIN}" max="${DKS_POINT_MAX}" step="1" value="${sliderValue}" data-dks-threshold-range="${index}" /><input class="range-number" type="number" min="0.1" max="3" step="0.1" value="${dksRawToMm(raw).toFixed(1)}" data-dks-threshold-number="${index}" aria-label="${meta.label} millimetres" /><i>mm</i></div><small>${outside ? `Preserving imported raw ${raw}; edit to return to 0.1–3.0 mm.` : `HE30 raw ${raw} · 0.1 mm steps`}</small></label>`;
}

function dksThresholdHeader(points) {
  return `<div class="dks-native-head"><span>Output key</span><div class="dks-path-heading"><b style="margin-bottom: 2rem;">Press → bottom → release</b><div class="dks-point-scale">${DKS_POINT_META.map((meta, index) => `<span style="--dks-anchor:${DKS_ANCHOR_COLORS[index]};--dks-x:${dksAnchorPercent(index)}"><i>${meta.label}</i><small>${DKS_FIELD_META[index].field}</small><em data-dks-point-label="${index}">${dksRawToMm(points[index]).toFixed(1)} mm</em></span>`).join("")}</div></div><span>Behavior</span></div>`;
}

function dksRowSummary(row) {
  if (!dksTimingActive(row)) return "No timing configured";
  const output = dksOutputAssigned(row) ? mappingLabel(row.key) : "unassigned output";
  return projectDksRow(row).map((segment) => {
    const start = DKS_POINT_META[segment.anchor].label;
    const end = DKS_POINT_META[segment.end].label;
    return segment.tap ? `Tap ${output} at ${start}` : `Press ${output} at ${start}; hold until ${end}; release there`;
  }).join(". ");
}

function dksAnchorPercent(anchor) {
  return `${(Number(anchor) * 100) / 3}%`;
}

function dksSegmentStyle(anchor, segment) {
  return `--dks-anchor:${DKS_ANCHOR_COLORS[anchor]};--dks-start:${dksAnchorPercent(anchor)};--dks-end:${dksAnchorPercent(segment?.end ?? anchor)};--dks-lane:${30 + anchor * 4}px`;
}

function dksRowTrack(row, rowIndex) {
  const semantic = dksSemanticRow(row);
  const segments = projectDksRow(semantic);
  return `<div class="dks-track-shell"><div class="dks-native-track" data-dks-track="${rowIndex}" role="group" aria-label="Output ${rowIndex + 1} timing"><div class="dks-base-rail" aria-hidden="true"></div><div class="dks-span-layer" aria-hidden="true">${DKS_FIELD_META.map(({ field }, anchor) => {
    const segment = segments.find((candidate) => candidate.field === field);
    return `<i class="dks-native-segment${segment?.tap ? " tap" : ""}${segment ? " active" : ""}" data-dks-span="${rowIndex}:${anchor}" style="${dksSegmentStyle(anchor, segment)}"></i>`;
  }).join("")}</div>${DKS_FIELD_META.map(({ field }, anchor) => {
    const value = Number(semantic[field]) || 0;
    const maximum = dksAnchorMaximum(semantic, anchor);
    const point = DKS_POINT_META[anchor];
    return `<div class="dks-checkpoint-wrap${value ? " active" : ""}" style="--dks-x:${dksAnchorPercent(anchor)};--dks-anchor:${DKS_ANCHOR_COLORS[anchor]}"><button class="dks-checkpoint" type="button" data-dks-checkpoint="${rowIndex}:${anchor}" aria-pressed="${Boolean(value)}" aria-valuemin="0" aria-valuemax="${maximum}" aria-valuenow="${value}" aria-label="${point.label} ${point.detail}; native value ${value}" title="Click for a tap; drag right to extend"></button><div class="dks-checkpoint-label"><span>${field} · <i data-dks-row-point="${anchor}">${dksRawToMm(state.dksDraft.points[anchor]).toFixed(1)} mm</i></span><span class="dks-native-value${value ? " on" : ""}" data-dks-value="${rowIndex}:${anchor}" title="Native hold-range value">${value}</span><button type="button" data-dks-anchor-clear="${rowIndex}:${anchor}" ${value ? "" : "disabled"} aria-label="Disable ${point.label}" title="Disable ${point.label}">×</button></div></div>`;
  }).join("")}</div></div>`;
}

function dksActionEditor(row, index) {
  const invalid = dksOutputAssigned(row) !== dksTimingActive(row);
  return `<article class="dks-action-row${dksOutputAssigned(row) ? " assigned" : " empty"}${invalid ? " invalid" : ""}" data-dks-action-card="${index}" style="--dks-action:${DKS_COLORS[index]}"><div class="dks-action-key-wrap"><i class="dks-output-number">${index + 1}</i>${mappingPickerField(`dksKey${index}`, row.key, `Output ${index + 1} key`)}<button class="dks-clear-action" type="button" data-dks-clear="${index}">Remove output</button></div>${dksRowTrack(row, index)}<p class="dks-row-summary">${esc(dksRowSummary(row))}</p></article>`;
}

function dksEditorHtml() {
  const draft = state.dksDraft;
  return `<div class="form-section dks-editor"><div class="dks-section-heading"><div><h3>Dynamic Keystroke</h3><p>HE30 uses four trigger anchors. A longer native range carries an output through the intervals between anchors; those intervals are not separate trigger slots.</p></div><span class="chip">HE30 NATIVE · 4 OUTPUTS</span></div><div class="dks-threshold-groups"><section><header><span>DOWNSTROKE</span><b>Press points</b></header>${dksThresholdField(0, draft.points[0])}${dksThresholdField(1, draft.points[1])}</section><section class="release"><header><span>UPSTROKE</span><b>Release points</b></header>${dksThresholdField(2, draft.points[2])}${dksThresholdField(3, draft.points[3])}</section></div><div class="dks-sequence"><div class="dks-sequence-heading"><div><h3>Output timing</h3><p>Press a checkpoint and release without moving for value 1. Drag right for values 2–4 where supported. Use × beneath a checkpoint to disable it.</p></div><div class="dks-legend">${DKS_POINT_META.map((point, index) => `<span><i style="--legend-color:${DKS_ANCHOR_COLORS[index]}"></i>${point.label}</span>`).join("")}</div></div><p class="dks-interaction-status" id="dksInteractionStatus" aria-live="polite">Choose an output, then click a checkpoint for a tap or drag it right to hold through later checkpoints.</p>${dksThresholdHeader(draft.points)}<div class="dks-action-stack" id="dksActionStack">${draft.rows.map(dksActionEditor).join("")}</div><div class="dks-gesture-hint"><span>↔</span><p><b>Mouse or touch:</b> click a checkpoint for a tap; drag right to extend its held range. <b>Keyboard:</b> focus a checkpoint, use ←/→ to change its native value, and Delete or Backspace to disable it.</p></div></div><div class="form-error dks-inline-validation" id="dksInlineValidation" aria-live="polite"></div><details class="callout dks-tutorial"><summary>How HE30 DKS timing works</summary><p>Click an anchor for one trigger. Extend its slider across later anchors to behave like a normally held key. Crossing back over a configured starting point can trigger that action again. HE30 stores constrained anchor/range values; unlike AE64, its in-between spans are not independently selectable bits.</p></details><div class="callout dks-firmware-note"><b>Read-back safety:</b> untouched native timing words—including unknown bits—are preserved byte-for-byte. Editing a row intentionally replaces that row with a supported HE30 timing recipe.</div></div>`;
}

function syncDksInlineValidation() {
  const target = $("#dksInlineValidation");
  if (!target || !state.dksDraft) return;
  const result = validateDksDraft(state.dksDraft);
  target.classList.toggle("warning", !result.errors.length && result.warnings.length > 0);
  target.textContent = result.errors[0] || result.warnings.join(" ");
}

function renderDksActionRows() {
  const stack = $("#dksActionStack");
  if (!stack) return;
  stack.innerHTML = state.dksDraft.rows.map(dksActionEditor).join("");
  bindDksRowControls();
  syncDksInlineValidation();
}

function setDksInteractionStatus(message, tone = "") {
  const target = $("#dksInteractionStatus");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("active", tone === "active");
  target.classList.toggle("cleared", tone === "cleared");
}

function syncDksPointLabels(index, raw) {
  const text = `${dksRawToMm(raw).toFixed(1)} mm`;
  $$(`[data-dks-point-label="${index}"], [data-dks-row-point="${index}"]`, $("#advancedFields")).forEach((label) => { label.textContent = text; });
}

function dksDescribeAnchorEdit(rowIndex, anchor) {
  const row = dksSemanticRow(state.dksDraft?.rows?.[rowIndex]);
  const point = DKS_POINT_META[anchor];
  const value = Number(row?.[DKS_FIELD_META[anchor].field]) || 0;
  if (!value) return `Output ${rowIndex + 1} · ${point.label} disabled.`;
  if (value === 1) return `Output ${rowIndex + 1} · ${point.label} is a one-shot tap at ${dksRawToMm(state.dksDraft.points[anchor]).toFixed(1)} mm.`;
  const end = DKS_POINT_META[Math.min(3, anchor + value - 1)].label;
  return `Output ${rowIndex + 1} · ${point.label} holds through ${end} (native value ${value}).`;
}

function dksUpdateRowVisual(rowIndex) {
  const root = $("#advancedFields");
  const row = state.dksDraft?.rows?.[rowIndex];
  if (!root || !row) return;
  const semantic = dksSemanticRow(row);
  const segments = projectDksRow(semantic);
  const card = $(`[data-dks-action-card="${rowIndex}"]`, root);
  if (card) {
    card.classList.toggle("assigned", dksOutputAssigned(row));
    card.classList.toggle("empty", !dksOutputAssigned(row));
    card.classList.toggle("invalid", dksOutputAssigned(row) !== dksTimingActive(row));
  }
  $$('[data-dks-checkpoint]', root).forEach((checkpoint) => {
    const [currentRow, anchor] = checkpoint.dataset.dksCheckpoint.split(":").map(Number);
    if (currentRow !== rowIndex) return;
    const field = DKS_FIELD_META[anchor].field;
    const value = Number(semantic[field]) || 0;
    const maximum = dksAnchorMaximum(semantic, anchor);
    const point = DKS_POINT_META[anchor];
    checkpoint.parentElement.classList.toggle("active", Boolean(value));
    checkpoint.setAttribute("aria-pressed", String(Boolean(value)));
    checkpoint.setAttribute("aria-valuemin", "0");
    checkpoint.setAttribute("aria-valuemax", String(maximum));
    checkpoint.setAttribute("aria-valuenow", String(value));
    checkpoint.setAttribute("aria-label", `${point.label} ${point.detail}; native value ${value}`);
  });
  $$('[data-dks-value]', root).forEach((label) => {
    const [currentRow, anchor] = label.dataset.dksValue.split(":").map(Number);
    if (currentRow !== rowIndex) return;
    const value = Number(semantic[DKS_FIELD_META[anchor].field]) || 0;
    label.textContent = String(value);
    label.classList.toggle("on", Boolean(value));
  });
  $$('[data-dks-anchor-clear]', root).forEach((button) => {
    const [currentRow, anchor] = button.dataset.dksAnchorClear.split(":").map(Number);
    if (currentRow !== rowIndex) return;
    button.disabled = !(Number(semantic[DKS_FIELD_META[anchor].field]) > 0);
  });
  $$('[data-dks-span]', root).forEach((span) => {
    const [currentRow, anchor] = span.dataset.dksSpan.split(":").map(Number);
    if (currentRow !== rowIndex) return;
    const field = DKS_FIELD_META[anchor].field;
    const segment = segments.find((candidate) => candidate.field === field);
    span.classList.toggle("active", Boolean(segment));
    span.classList.toggle("tap", Boolean(segment?.tap));
    span.setAttribute("style", dksSegmentStyle(anchor, segment));
  });
  const summary = card ? $(".dks-row-summary", card) : null;
  if (summary) summary.textContent = dksRowSummary(row);
  syncDksInlineValidation();
}

function dksPointerValue(rowIndex, anchor, clientX) {
  const track = $(`[data-dks-track="${rowIndex}"]`, $("#advancedFields"));
  if (!track) return 1;
  const bounds = track.getBoundingClientRect();
  if (!bounds.width) return 1;
  const relative = uiClamp((clientX - bounds.left) / bounds.width, 0, 1);
  return dksPointerValueFromRatio(state.dksDraft.rows[rowIndex], anchor, relative);
}

/** Snap after the pointer crosses the midpoint between two checkpoints. */
function dksPointerValueFromRatio(row, anchor, ratio) {
  const maximum = dksAnchorMaximum(dksSemanticRow(row), anchor);
  const relative = uiClamp(Number(ratio) || 0, 0, 1);
  let value = 1;
  for (let destination = anchor + 1; destination < 4; destination += 1) {
    if (relative >= (destination - 0.5) / 3) value = destination - anchor + 1;
  }
  return uiClamp(value, 1, maximum);
}

function bindDksRowControls() {
  $$('[data-dks-checkpoint]', $("#advancedFields")).forEach((checkpoint) => {
    const [rowIndex, anchor] = checkpoint.dataset.dksCheckpoint.split(":").map(Number);
    checkpoint.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      checkpoint.focus();
      dksPointerGesture = { rowIndex, anchor, pointerId: event.pointerId, startX: event.clientX, dragged: false };
      checkpoint.setPointerCapture?.(event.pointerId);
    };
    checkpoint.onpointermove = (event) => {
      if (!dksPointerGesture || dksPointerGesture.pointerId !== event.pointerId || dksPointerGesture.rowIndex !== rowIndex || dksPointerGesture.anchor !== anchor) return;
      if (!dksPointerGesture.dragged && Math.abs(event.clientX - dksPointerGesture.startX) < 4) return;
      dksPointerGesture.dragged = true;
      editDksAnchor(state.dksDraft, rowIndex, anchor, dksPointerValue(rowIndex, anchor, event.clientX));
      dksUpdateRowVisual(rowIndex);
      setDksInteractionStatus(dksDescribeAnchorEdit(rowIndex, anchor), "active");
    };
    const finishPointerGesture = (event) => {
      if (!dksPointerGesture || (event && dksPointerGesture.pointerId !== event.pointerId)) return;
      const gesture = dksPointerGesture;
      if (event?.type === "pointerup" && !gesture.dragged) editDksAnchor(state.dksDraft, rowIndex, anchor, 1);
      dksPointerGesture = null;
      renderDksActionRows();
      setDksInteractionStatus(dksDescribeAnchorEdit(rowIndex, anchor), "active");
    };
    checkpoint.onpointerup = finishPointerGesture;
    checkpoint.onpointercancel = finishPointerGesture;
    checkpoint.onlostpointercapture = finishPointerGesture;
    checkpoint.onkeydown = (event) => {
      const value = Number(dksSemanticRow(state.dksDraft.rows[rowIndex])[DKS_FIELD_META[anchor].field]) || 0;
      let nextValue = null;
      if (event.key === "ArrowRight") nextValue = Math.min(dksAnchorMaximum(dksSemanticRow(state.dksDraft.rows[rowIndex]), anchor), Math.max(1, value + 1));
      if (event.key === "ArrowLeft") nextValue = value <= 1 ? 1 : value - 1;
      if (event.key === "Enter" || event.key === " ") nextValue = 1;
      if (event.key === "Delete" || event.key === "Backspace") nextValue = 0;
      if (nextValue === null) return;
      event.preventDefault();
      editDksAnchor(state.dksDraft, rowIndex, anchor, nextValue);
      dksUpdateRowVisual(rowIndex);
      setDksInteractionStatus(dksDescribeAnchorEdit(rowIndex, anchor), nextValue ? "active" : "cleared");
    };
  });
  $$('[data-dks-anchor-clear]', $("#advancedFields")).forEach((button) => {
    button.onclick = () => {
      const [rowIndex, anchor] = button.dataset.dksAnchorClear.split(":").map(Number);
      editDksAnchor(state.dksDraft, rowIndex, anchor, 0);
      renderDksActionRows();
      setDksInteractionStatus(dksDescribeAnchorEdit(rowIndex, anchor), "cleared");
    };
  });
  $$('[data-dks-preset]', $("#advancedFields")).forEach((button) => {
    button.onclick = () => {
      applyDksPresetToDraft(state.dksDraft, Number(button.dataset.dksActionIndex), button.dataset.dksPreset);
      renderDksActionRows();
      setDksInteractionStatus(`Output ${Number(button.dataset.dksActionIndex) + 1} timing preset applied.`, "active");
    };
  });
  $$('[data-dks-clear]', $("#advancedFields")).forEach((button) => {
    button.onclick = () => {
      clearDksDraftRow(state.dksDraft, Number(button.dataset.dksClear));
      renderDksActionRows();
      setDksInteractionStatus(`Output ${Number(button.dataset.dksClear) + 1} key and timing removed.`, "cleared");
    };
  });
  $$('[data-open-mapping-picker]', $("#dksActionStack")).forEach((button) => { button.onclick = () => openAdvancedMappingPicker(button); });
}

function bindDksEditor() {
  if (!state.dksDraft) return;
  bindDksRowControls();
  $$('[data-dks-threshold-range]', $("#advancedFields")).forEach((input) => {
    input.oninput = () => {
      const index = Number(input.dataset.dksThresholdRange);
      state.dksDraft.points[index] = Number(input.value);
      state.dksDraft.pointEdited[index] = true;
      const number = $(`[data-dks-threshold-number="${index}"]`);
      if (number) number.value = dksRawToMm(state.dksDraft.points[index]).toFixed(1);
      syncDksPointLabels(index, state.dksDraft.points[index]);
      syncDksInlineValidation();
    };
  });
  $$('[data-dks-threshold-number]', $("#advancedFields")).forEach((input) => {
    const update = (finalize) => {
      const index = Number(input.dataset.dksThresholdNumber);
      const raw = dksMmToRaw(input.value);
      if (!Number.isFinite(raw)) return syncDksInlineValidation();
      const normalized = finalize ? uiClamp(raw, DKS_POINT_MIN, DKS_POINT_MAX) : raw;
      state.dksDraft.points[index] = normalized;
      state.dksDraft.pointEdited[index] = true;
      const range = $(`[data-dks-threshold-range="${index}"]`);
      if (range) range.value = String(uiClamp(normalized, DKS_POINT_MIN, DKS_POINT_MAX));
      syncDksPointLabels(index, normalized);
      if (finalize) input.value = dksRawToMm(normalized).toFixed(1);
      syncDksInlineValidation();
    };
    input.oninput = () => update(false);
    input.onchange = () => update(true);
  });
  syncDksInlineValidation();
}
