"use strict";

/**
 * HE30 Control application module.
 *
 * This project intentionally uses ordered, classic browser scripts instead of a
 * build tool. Top-level declarations are therefore shared by the application
 * files listed in index.html. Keep their order intact: foundation first,
 * bootstrap last. This keeps GitHub Pages deployment as simple as copying files.
 */
/**
 * Key mapping and Advanced-action editors.
 *
 * These functions manage modal dialogs, the visual host-key picker, DKS stages,
 * macros, paired actions, and restoration of the original host mapping when an
 * Advanced action is removed.
 */

// ---------------------------------------------------------------------------
// Shared keyboard click routing and Hall staging
// ---------------------------------------------------------------------------
// The same keyboard markup serves three pages. Its data-keyboard-mode attribute
// selects the correct editor without adding separate listeners to every key.
function handleKeyClick(button, event) {
  const index = Number(button.dataset.keyIndex);
  const mode = button.closest("[data-keyboard-mode]").dataset.keyboardMode;
  if (mode === "mapping") return openMapping(index);
  if (mode === "hall" && state.hallEditPending) return;
  const selected = mode === "hall" ? state.hallSelection : state.colorSelection;
  const wasEmpty = selected.size === 0;
  if (event.ctrlKey || event.metaKey) {
    if (selected.has(index) && selected.size > 1) selected.delete(index); else selected.add(index);
  } else {
    selected.clear(); selected.add(index);
  }
  if (mode === "hall") {
    if (wasEmpty && selected.size) return renderPage();
    updateHallSelectionUI(); syncHallFormToSelection();
  }
  else renderPage();
}

/** Copy the Hall form into every frozen edit-selection key and mark the bank dirty. */
function stageHallSettings() {
  const targetSelection = new Set(state.hallEditSelection);
  if (!state.hallEditPending || !targetSelection.size) return;
  const rapidTrigger = Boolean($("#hallRapidTrigger").checked);
  const fullTravel = rapidTrigger && Boolean($("#hallFullTravel").checked);
  const independentRt = rapidTrigger && Boolean($("#hallIndependentRt").checked);
  const insurance = Boolean($("#hallInsurance").checked);
  const values = {
    switch_type: Number($("#hallSwitchType").value),
    key_mode: rapidTrigger ? (fullTravel ? 2 : 1) : 0,
    key_actuation: Number($("#hallActuation").value),
    rt_press: Number($("#hallPress").value),
    rt_release: independentRt ? Number($("#hallRelease").value) : Number($("#hallPress").value),
    press_deadzone: insurance ? Number($("#hallPressDeadzone").value) : 0,
    release_deadzone: insurance ? Number($("#hallReleaseDeadzone").value) : 0,
  };
  if (precisionOptions()) {
    values.pressPrecision = Number($("#hallPressPrecision").value);
    values.releasePrecision = independentRt ? Number($("#hallReleasePrecision").value) : values.pressPrecision;
  }
  targetSelection.forEach((index) => Object.assign(state.profile.travelKeys[index], values, { deadzone_status: values.press_deadzone > 0 && values.release_deadzone > 0 }));
  const triggerBottom = Boolean($("#hallTriggerBottom").checked);
  const triggerBottomChanged = Boolean(state.profile.deviceSettings.stabilityMode) !== triggerBottom;
  state.profile.deviceSettings.stabilityMode = triggerBottom;
  markDirty("hall");
  if (triggerBottomChanged) markDirty("settings");
  state.hallEditPending = false;
  state.hallEditSelection.clear();
  log("change", `${switchTypeMeta(values.switch_type).name} and ${rapidTriggerModeName(values.key_mode)} settings staged on ${targetSelection.size} keys`);
  showToast(`Hall settings staged on ${targetSelection.size} key${targetSelection.size === 1 ? "" : "s"}.`);
  renderPage();
}

function discardHallEdit() {
  if (!state.hallEditPending) return;
  const targetCount = state.hallEditSelection.size;
  state.hallEditPending = false;
  state.hallEditSelection.clear();
  state.hallSelection.clear();
  log("info", `Pending Hall edits discarded for ${targetCount} keys`);
  showToast("Pending Hall edits discarded. Select another key or group.");
  renderPage();
}

// ---------------------------------------------------------------------------
// Normal key-mapping dialog
// ---------------------------------------------------------------------------
function openMapping(index) {
  state.mappingPickerTarget = null;
  state.mappingPickerScope = "all";
  state.mappingIndex = index;
  const mapping = API.compileAdvanced(state.profile).userKeys[state.layer][index];
  $("#mappingTitle").textContent = `Remap ${physicalName(index)}`;
  $("#mappingCurrent").textContent = `Currently: ${mappingLabel(mapping)}`;
  $("#mappingAddress").textContent = `${globalLayerLabel(state.profile.profileIndex, state.layer)} · Key ${index}`;
  $("#clearMappingButton").textContent = "Unassign key";
  $("#mappingSearch").value = "";
  renderMappingGroups("");
  $("#mappingDialog").showModal();
  setTimeout(() => $("#mappingSearch").focus(), 30);
}

function mappingSearchFields(item, group) {
  return [
    item.name, item.short, item.macName, item.macShort, item.searchTerms,
    group.title, `type ${item.type}`, `code ${item.code2}`, `hid ${item.code2}`,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

function mappingSearchScore(item, group, query) {
  if (!query) return 0;
  const directLabels = [item.name, item.short, item.macName, item.macShort].filter(Boolean).map((value) => String(value).toLowerCase());
  if (directLabels.includes(query)) return 0;
  if (directLabels.some((value) => value.startsWith(query))) return 1;
  if (mappingSearchFields(item, group).some((value) => value.includes(query))) return 2;
  return 3;
}

function mappingMatchesSearch(item, group, query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const fields = mappingSearchFields(item, group);
  return terms.every((term) => fields.some((value) => value.includes(term)));
}

function renderMappingGroups(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const pickerControl = state.mappingPickerTarget ? $(`#${state.mappingPickerTarget}`) : null;
  const current = pickerControl ? mappingFromControl(pickerControl) : state.profile.userKeys[state.layer][state.mappingIndex] || {};
  const macMode = Number(state.profile.deviceSettings.systemMode) === 1;
  $("#mappingGroups").innerHTML = MAPPING_GROUPS.map((group) => {
    if (group.macOnly && !macMode) return "";
    const items = group.items.filter((item) => {
      if (state.mappingPickerScope === "basic" && (item.type !== 16 || item.code1 !== 0)) return false;
      return mappingMatchesSearch(item, group, normalized);
    }).sort((left, right) => mappingSearchScore(left, group, normalized) - mappingSearchScore(right, group, normalized) || left.name.localeCompare(right.name));
    if (!items.length) return "";
    return `<section class="mapping-group"><h3>${esc(group.title)}</h3><div class="mapping-options">${items.map((item) => `<button class="mapping-option${item.type === current.type && item.code1 === current.code1 && item.code2 === current.code2 ? " active" : ""}" type="button" data-map="${item.type},${item.code1},${item.code2}"><strong>${esc((macMode && item.macName) || item.name)}</strong><small>${item.type} · ${item.code1} · ${item.code2}</small></button>`).join("")}</div></section>`;
  }).join("") || `<div class="empty-state"><strong>No mappings found</strong><p>Search by a key label, symbol, alias, function, or HID code.</p></div>`;
  $$('[data-map]', $("#mappingGroups")).forEach((button) => button.addEventListener("click", () => {
    const [type, code1, code2] = button.dataset.map.split(",").map(Number);
    const preset = ALL_MAPPINGS.find((item) => item.type === type && item.code1 === code1 && item.code2 === code2);
    applyMapping(preset);
  }));
}

/** Remove an Advanced action occupying a host before a normal mapping replaces it. */
function removeAdvancedAtHost(index, layer) {
  const before = state.profile.advancedKeys.length;
  const removed = state.profile.advancedKeys.filter((item) => (item.layer || 0) === layer && (item.index1 === index || item.index2 === index));
  removed.forEach(restoreAdvancedHosts);
  removed.forEach(restorePairTravel);
  state.profile.advancedKeys = state.profile.advancedKeys.filter((item) => !((item.layer || 0) === layer && (item.index1 === index || item.index2 === index)));
  return { advanced: state.profile.advancedKeys.length !== before, hall: removed.some((item) => item.type === "rs" || item.type === "socd") };
}

function applyMapping(preset) {
  if (state.mappingPickerTarget) {
    const control = $(`#${state.mappingPickerTarget}`);
    if (control) setMappingControl(control, mappingFromPreset(preset, 0));
    $("#mappingDialog").close();
    control?.focus();
    return;
  }
  const removedAdvanced = removeAdvancedAtHost(state.mappingIndex, state.layer);
  state.profile.userKeys[state.layer][state.mappingIndex] = mappingFromPreset(preset);
  markDirty("keymap", ...(removedAdvanced.advanced ? ["advanced"] : []), ...(removedAdvanced.hall ? ["hall"] : []));
  log("change", `${physicalName(state.mappingIndex)} mapped to ${preset.name} on ${globalLayerLabel(state.profile.profileIndex, state.layer)}`);
  $("#mappingDialog").close();
  renderPage();
  showToast(`${physicalName(state.mappingIndex)} → ${preset.name}`);
}

function clearMapping() {
  if (state.mappingPickerTarget) {
    const control = $(`#${state.mappingPickerTarget}`);
    if (control) setMappingControl(control, API.makeMapping(255, 255, 255, state.profile.profileIndex, 0));
    $("#mappingDialog").close();
    control?.focus();
    return;
  }
  const removedAdvanced = removeAdvancedAtHost(state.mappingIndex, state.layer);
  state.profile.userKeys[state.layer][state.mappingIndex] = API.makeMapping(255, 255, 255, state.profile.profileIndex, state.layer);
  markDirty("keymap", ...(removedAdvanced.advanced ? ["advanced"] : []), ...(removedAdvanced.hall ? ["hall"] : []));
  $("#mappingDialog").close(); renderPage(); showToast(`${physicalName(state.mappingIndex)} is now unassigned.`);
}

// ---------------------------------------------------------------------------
// Reusable mapping picker used inside Advanced editors
// ---------------------------------------------------------------------------
function mappingPickerField(id, selected, label, choices = ALL_MAPPINGS) {
  const current = selected || choices[0];
  const scope = choices === BASIC_MAPPING_CHOICES ? "basic" : "all";
  return `<div class="field"><span>${esc(label)}</span><button class="mapping-picker-control" id="${id}" type="button" data-open-mapping-picker data-mapping-label="${esc(label)}" data-mapping-scope="${scope}" data-mapping-value="${current.type},${current.code1},${current.code2}"><strong>${esc(mappingLabel(current))}</strong><small>Browse the key-mapping library →</small></button></div>`;
}

function mappingFromControl(control) {
  const [type = 255, code1 = 255, code2 = 255] = String(control?.dataset.mappingValue || "255,255,255").split(",").map(Number);
  const preset = ALL_MAPPINGS.find((item) => item.type === type && item.code1 === code1 && item.code2 === code2);
  return mappingFromPreset({ ...(preset || {}), type, code1, code2, name: preset?.name || API.mappingName(type, code1, code2) }, 0);
}

function setMappingControl(control, mapping) {
  control.dataset.mappingValue = `${mapping.type},${mapping.code1},${mapping.code2}`;
  const label = $("strong", control);
  if (label) label.textContent = mappingLabel(mapping);
}

function openAdvancedMappingPicker(control) {
  state.mappingPickerTarget = control.id;
  state.mappingPickerScope = control.dataset.mappingScope || "all";
  const current = mappingFromControl(control);
  $("#mappingTitle").textContent = `Choose ${control.dataset.mappingLabel || "output"}`;
  $("#mappingCurrent").textContent = `Currently: ${mappingLabel(current)}`;
  $("#mappingAddress").textContent = `Advanced action · ${globalLayerLabel(state.profile.profileIndex, state.advancedLayer)}`;
  $("#clearMappingButton").textContent = "Use Unassigned";
  $("#mappingSearch").value = "";
  renderMappingGroups("");
  $("#mappingDialog").showModal();
  setTimeout(() => $("#mappingSearch").focus(), 30);
}

// ---------------------------------------------------------------------------
// Visual host-key and layer selection
// ---------------------------------------------------------------------------
// Advanced mappings belong to a mapping layer, but paired Hall values belong to
// physical keys. The warning text makes this firmware distinction explicit.
function advancedLayerMessage(layer, paired = false) {
  const label = globalLayerLabel(state.profile.profileIndex, layer);
  const layerMessage = Number(layer) === 0
    ? `<b>Default layer selected.</b> This action is available whenever ${esc(label)} is active.`
    : `<b>Fn-layer warning:</b> this action only runs while ${esc(label)} is active. Make sure a reachable FN/FN1–FN11 mapping can enter that layer.`;
  const pairMessage = paired ? " Rappy Snappy and SOCD actuation/RT values are physical-switch settings, so they affect these keys on every layer." : "";
  return `${layerMessage}${pairMessage} Choosing a host already used by another Advanced action will replace that action when staged.`;
}

function advancedHostKeyboardHtml(layer, paired) {
  const compiled = API.compileAdvanced(state.profile);
  return `<div class="keyboard-grid advanced-host-keyboard" data-keyboard-mode="advanced-host">${HE30_LAYOUT.map((row) => `<div class="key-row">${row.map((keyItem) => {
    const index = keyItem.index;
    const position = state.advancedHostSelection.indexOf(index);
    const mapped = mappingKeyboardLabel(compiled.userKeys[layer][index]);
    const advanced = [112, 144, 145, 146, 147, 148].includes(compiled.userKeys[layer][index]?.type);
    return `<button class="keycap advanced-host-key${position >= 0 ? ` selected host-${position + 1}` : ""}${advanced ? " advanced" : ""}" type="button" data-advanced-host-key="${index}" aria-pressed="${position >= 0}" style="--key-width:${keyWidth(keyItem)}px;--key-u:${keyUnit(keyItem)}" title="Use physical ${esc(keyItem.label)} as ${paired ? "a paired" : "the"} host"><span class="mapped primary-label">${esc(mapped)}</span><span class="physical secondary-label">Physical: ${esc(keyItem.label)}</span><i class="advanced-host-order" aria-hidden="true">${position >= 0 ? position + 1 : ""}</i></button>`;
  }).join("")}</div>`).join("")}</div>`;
}

function advancedHostPickerHtml(type) {
  const paired = type === "rs" || type === "socd";
  const layer = state.advancedLayer;
  return `<div class="form-section advanced-host-section"><div class="advanced-host-heading"><div><h3>Host assignment</h3><p>Choose a layer, then select ${paired ? "two physical keys in order" : "one physical key"}.</p></div>${paired ? `<div class="advanced-host-slots" role="tablist" aria-label="Paired host slot"><button type="button" data-advanced-host-slot="0" class="active"><i>1</i><span>First host<strong>${esc(physicalName(state.advancedHostSelection[0]))}</strong></span></button><button type="button" data-advanced-host-slot="1"><i>2</i><span>Second host<strong>${esc(physicalName(state.advancedHostSelection[1]))}</strong></span></button></div>` : `<div class="advanced-single-host"><span>Selected host</span><strong>${esc(physicalName(state.advancedHostSelection[0]))}</strong></div>`}</div><input id="advLayer" type="hidden" value="${layer}" /><input id="advIndex1" type="hidden" value="${state.advancedHostSelection[0]}" />${paired ? `<input id="advIndex2" type="hidden" value="${state.advancedHostSelection[1]}" />` : ""}<div class="tabs advanced-layer-tabs" role="tablist" aria-label="Advanced action layer">${Array.from({ length: API.LAYER_COUNT }, (_, candidate) => `<button type="button" data-advanced-layer="${candidate}" class="${candidate === layer ? "active" : ""}" aria-selected="${candidate === layer}">${esc(globalLayerLabel(state.profile.profileIndex, candidate))}</button>`).join("")}</div><div class="advanced-host-board">${advancedHostKeyboardHtml(layer, paired)}</div><div class="keyboard-legend advanced-host-legend"><span><i></i>Selected host</span>${paired ? `<span><i class="host-two-dot"></i>Second host</span>` : ""}<span id="advancedHostInstruction">${paired ? "Choose which host slot to edit, then click a key" : "Click a key to change the host"}</span></div><div class="callout advanced-layer-note" id="advancedLayerNote">${advancedLayerMessage(layer, paired)}</div></div>`;
}

/** Initialize modal state before generating the type-specific Advanced form. */
function openAdvanced(type, editIndex = null) {
  state.advancedType = type;
  state.advancedEditIndex = editIndex;
  const item = editIndex == null ? {} : state.profile.advancedKeys[editIndex];
  const paired = type === "rs" || type === "socd";
  const index1 = item.index1 ?? PHYSICAL_KEYS[0].index;
  let index2 = item.index2 ?? PHYSICAL_KEYS[1].index;
  if (index2 === index1) index2 = PHYSICAL_KEYS.find(({ index }) => index !== index1)?.index ?? index1;
  state.advancedLayer = uiClamp(item.layer ?? 0, 0, API.LAYER_COUNT - 1);
  state.advancedHostSelection = paired ? [index1, index2] : [index1];
  state.advancedHostSlot = 0;
  const meta = ADVANCED_META[type];
  $("#advancedTitle").textContent = `${editIndex == null ? "Add" : "Edit"} ${meta.name}`;
  $("#advancedError").textContent = "";
  $("#advancedFields").innerHTML = advancedFormHtml(type, item);
  $("#advancedDialog").showModal();
  bindAdvancedForm();
}

// ---------------------------------------------------------------------------
// Type-specific Advanced form builders
// ---------------------------------------------------------------------------
function modifierPickerHtml(item) {
  const modifiers = uiClamp(Number(item.modifiers ?? item.key1?.code1 ?? 0), 0, 255);
  return `<div class="modifier-picker" data-modifier-picker><input id="comboModifierMask" type="hidden" value="${modifiers}" /><div class="modifier-options">${MODIFIER_CHOICES.map(([bit, name], index) => {
    const active = Boolean(modifiers & bit);
    return `<button class="modifier-option${active ? " selected" : ""}" type="button" data-modifier-option="${bit}" aria-pressed="${active}"><i>${active ? "✓" : index}</i><span>${esc(name)}</span></button>`;
  }).join("")}</div><p>Modifiers always use HID mask bit order 0–7: Left Ctrl, Left Shift, Left Alt, Left GUI, Right Ctrl, Right Shift, Right Alt, Right GUI. The keyboard receives one 8-bit modifier mask, not a press order.</p></div>`;
}

const DKS_STAGE_META = Object.freeze([
  { title: "First actuation", path: "Pressing", detail: "shallow press", trigger: "DownStart", value: 1 },
  { title: "Bottom", path: "Pressing", detail: "deep press", trigger: "DownEnd", value: 2 },
  { title: "Return", path: "Releasing", detail: "leaving bottom", trigger: "UpStart", value: 2 },
  { title: "Release top", path: "Releasing", detail: "near reset", trigger: "UpEnd", value: 1 },
]);
const DKS_HIDDEN_FIELDS = Object.freeze(["DownStart", "DownEnd", "UpStart", "UpEnd"]);

function dksStageSpec(stage) {
  return DKS_STAGE_META[uiClamp(stage, 1, 4) - 1];
}

function dksCellMode(entry, stageIndex) {
  const spec = dksStageSpec(stageIndex + 1);
  return Number(entry[spec.trigger[0].toLowerCase() + spec.trigger.slice(1)]) === spec.value ? "tap" : "off";
}

function dksHiddenInputs(entry, index) {
  return DKS_HIDDEN_FIELDS.map((field) => `<input id="dks${index}${field}" type="hidden" value="${uiClamp(entry[field[0].toLowerCase() + field.slice(1)], 0, 4)}" />`).join("");
}

function dksStageHeader(point, index) {
  const meta = DKS_STAGE_META[index];
  return `<div class="dks-stage-header"><i>${index + 1}</i><strong>${esc(meta.title)}</strong><small>${esc(meta.path)} · ${esc((point / 100).toFixed(2))} mm</small></div>`;
}

function dksActionCell(entry, actionIndex, stageIndex) {
  const stage = stageIndex + 1;
  const mode = dksCellMode(entry, stageIndex);
  const meta = DKS_STAGE_META[stageIndex];
  return `<div class="dks-matrix-cell ${mode}" data-dks-cell="${actionIndex},${stage}" title="${esc(meta.title)} · ${esc(meta.detail)}">
    <button type="button" class="dks-cell-main" data-dks-cell-action="tap" data-dks-action-index="${actionIndex}" data-dks-stage="${stage}"><strong>${mode === "tap" ? "Click" : "+"}</strong><span>${esc(meta.detail)}</span></button>
  </div>`;
}

function dksActionEditor(entry, index, points) {
  return `<article class="dks-action-card" data-dks-action-card="${index}">
    <header><i>${index + 1}</i><div><strong>Output ${index + 1}</strong><small>Click positions trigger once. Hold presets use the original driver's dragged-range behavior.</small></div></header>
    <div class="dks-action-toolbar">${mappingPickerField(`dksKey${index}`, entry.key, `Output ${index + 1} key`)}<div class="dks-row-presets" aria-label="DKS output presets">
      <button type="button" data-dks-preset="tap1" data-dks-action-index="${index}">Tap 1</button>
      <button type="button" data-dks-preset="tap2" data-dks-action-index="${index}">Tap 2</button>
      <button type="button" data-dks-preset="tap3" data-dks-action-index="${index}">Tap 3</button>
      <button type="button" data-dks-preset="tap4" data-dks-action-index="${index}">Tap 4</button>
      <button type="button" data-dks-preset="hold12" data-dks-action-index="${index}">Hold 1-2</button>
      <button type="button" data-dks-preset="hold14" data-dks-action-index="${index}">Hold 1-4</button>
      <button type="button" data-dks-preset="clear" data-dks-action-index="${index}">Clear</button>
    </div></div>
    ${dksHiddenInputs(entry, index)}
    <div class="dks-action-matrix" role="group" aria-label="Output ${index + 1} DKS travel stages">
      ${points.map((point, stageIndex) => `<div class="dks-stage-distance">${(point / 100).toFixed(2)} mm</div>${dksActionCell(entry, index, stageIndex)}`).join("")}
    </div>
  </article>`;
}

function advancedFormHtml(type, item) {
  const host = advancedHostPickerHtml(type);
  const finish = (content) => content;
  if (type === "dks") {
    const points = (item.dksPoint || [40, 160, 240, 80]).map((point) => uiClamp(point, 1, 255));
    const emptyDksKey = () => ({ key: API.makeMapping(255, 255, 255, state.profile.profileIndex, state.advancedLayer), downStart: 0, downEnd: 0, upStart: 0, upEnd: 0 });
    const dksKeys = item.dksKeys || [0, 1, 2, 3].map(emptyDksKey);
    return finish(`${host}<div class="form-section dks-editor"><div class="dks-section-heading"><div><h3>Dynamic keystroke grid</h3><p>Click any position to trigger that row's output once. To fire four commands from one physical key, use the four output rows; each row can have its own key and trigger point.</p></div><span class="chip">4 outputs · 4 positions</span></div><div class="dks-travel-editor">${points.map((point, index) => `<div>${dksStageHeader(point, index)}${rangeField(DKS_STAGE_META[index].title, `dksPoint${index}`, point, 1, 255, 1, "mm")}</div>`).join("")}</div><div class="dks-direction-rail" aria-hidden="true"><span>Pressing switch</span><i></i><span>Releasing switch</span></div><div class="dks-matrix-head" aria-hidden="true"><span>Output</span>${points.map(dksStageHeader).join("")}</div><div class="dks-actions">${dksKeys.map((entry, index) => dksActionEditor(entry, index, points)).join("")}</div><div class="callout"><b>HE30 model:</b> a DKS host key can run up to four output rows. Each row stores one output key plus four timing handles, matching the original driver's click-to-trigger and drag-to-hold behavior.</div></div>`);
  }
  if (type === "mt") return finish(`${host}<div class="form-section"><h3>Tap and hold outputs</h3><div class="field-grid">${mappingPickerField("mtClickKey", item.mtClickKey, "Tap output")}${mappingPickerField("mtDownKey", item.mtDownKey, "Hold output")}<label class="field"><span>Hold threshold</span><input id="mtTime" type="number" min="10" max="2550" step="10" value="${item.mtTime || 200}" /><small>10–2550 ms, stored in 10 ms steps</small></label></div></div>`);
  if (type === "tgl") return finish(`${host}<div class="form-section"><h3>Toggle output</h3><div class="field-grid">${mappingPickerField("tglKey", item.tglKey, "Output key")}</div></div>`);
  if (type === "rs" || type === "socd") {
    const option = item.option || {};
    const independent = Number(option.press || 10) !== Number(option.release ?? option.press ?? 10);
    const maximumTravel = pairTravelMaximum();
    const maximumTravelHundredths = Math.round(maximumTravel * 100);
    return finish(`${host}<div class="form-section"><h3>Paired outputs</h3><div class="field-grid">${mappingPickerField("pairKey1", item.key1, "First output")}${mappingPickerField("pairKey2", item.key2, "Second output")}${type === "socd" ? selectField("Priority", "pairPriority", [[0, "Last Input Priority"], [1, "Absolute 1st key"], [2, "Absolute 2nd key"], [3, "Neutral"]], option.priority ?? 0) : ""}</div></div><div class="form-section"><h3>Pair actuation and Rapid Trigger</h3>${hallSwitchRow("Set Press and Release independently", "When off, RT Release follows RT Press.", "pairIndependentRt", independent)}<div class="field-grid pair-travel-fields">${rangeField("Actuation", "pairActuation", option.actuation || 40, 1, maximumTravelHundredths, 1, "mm")}${rangeField("RT press", "pairPress", option.press || 10, 1, maximumTravelHundredths, 1, "mm")}${rangeField("RT release", "pairRelease", option.release ?? option.press ?? 10, 1, maximumTravelHundredths, 1, "mm", !independent)}</div><div class="callout" id="pairTravelLimitNote">Pair limits use the shorter host-key switch travel: ${maximumTravel.toFixed(2)} mm.</div></div>`);
  }
  if (type === "cb") {
    return finish(`${host}<div class="form-section"><h3>Combination</h3>${modifierPickerHtml(item)}<div class="field-grid combination-base-field">${mappingPickerField("comboBase", item.baseKey, "Base key", BASIC_MAPPING_CHOICES)}</div></div>`);
  }
  const actions = item.actions?.length ? item.actions : [{ action: "keydown", code: 4, delay: 0 }, { action: "keyup", code: 4, delay: 50 }];
  return finish(`${host}<div class="form-section"><h3>Playback</h3><div class="field-grid"><label class="field"><span>Repeat count</span><input id="macroRepeat" type="number" min="1" max="255" value="${item.macroRepeatCount || 1}" /></label></div></div><div class="form-section"><h3>Macro events</h3><div class="macro-rows" id="macroRows">${actions.map((action, index) => macroRow(action, index)).join("")}</div><button class="icon-action" id="addMacroRow" type="button" style="margin-top:10px">+ Add event</button><div class="callout">Delays are stored per event in milliseconds. Keep matched key-down and key-up events to avoid a stuck key.</div></div>`);
}

function macroRow(action, index) {
  const selected = BASIC_MAPPING_CHOICES.find((mapping) => mapping.code2 === Number(action.code)) || BASIC_MAPPING_CHOICES[0];
  return `<div class="macro-row" data-macro-row data-macro-index="${index}">${mappingPickerField(`macroKey${index}`, selected, `Event ${index + 1}`, BASIC_MAPPING_CHOICES)}${selectField("Action", `macroAction${index}`, [["keydown", "Key down"], ["keyup", "Key up"]], action.action)}<label class="field"><span>Delay ms</span><input id="macroDelay${index}" type="number" min="0" max="65535" value="${action.delay || 0}" /></label><button class="icon-action delete" type="button" data-remove-macro aria-label="Remove event">×</button></div>`;
}

function currentModifierMask() {
  return uiClamp(Number($("#comboModifierMask")?.value || 0), 0, 255);
}

function syncModifierPicker(modifiers) {
  const hidden = $("#comboModifierMask");
  if (!hidden) return;
  hidden.value = String(uiClamp(modifiers, 0, 255));
  $$('[data-modifier-option]', $("[data-modifier-picker]")).forEach((button, index) => {
    const active = Boolean(modifiers & Number(button.dataset.modifierOption));
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
    const badge = $("i", button);
    if (badge) badge.textContent = active ? "✓" : String(index);
  });
}

function bindModifierPicker() {
  const picker = $("[data-modifier-picker]");
  if (!picker) return;
  picker.onclick = (event) => {
    const option = event.target.closest("[data-modifier-option]");
    if (!option) return;
    const bit = Number(option.dataset.modifierOption);
    const modifiers = currentModifierMask();
    syncModifierPicker(modifiers & bit ? modifiers & ~bit : modifiers | bit);
  };
}

function syncAdvancedHostPicker() {
  const paired = state.advancedType === "rs" || state.advancedType === "socd";
  const first = state.advancedHostSelection[0];
  const second = paired ? state.advancedHostSelection[1] : null;
  if ($("#advIndex1")) $("#advIndex1").value = first;
  if ($("#advIndex2")) $("#advIndex2").value = second;
  $$('[data-advanced-host-slot]').forEach((button) => {
    const slot = Number(button.dataset.advancedHostSlot);
    button.classList.toggle("active", slot === state.advancedHostSlot);
    button.setAttribute("aria-selected", String(slot === state.advancedHostSlot));
    const label = $("strong", button);
    if (label) label.textContent = physicalName(state.advancedHostSelection[slot]);
  });
  const single = $(".advanced-single-host strong");
  if (single) single.textContent = physicalName(first);
  $$('[data-advanced-host-key]').forEach((button) => {
    const position = state.advancedHostSelection.indexOf(Number(button.dataset.advancedHostKey));
    button.classList.toggle("selected", position >= 0);
    button.classList.toggle("host-1", position === 0);
    button.classList.toggle("host-2", position === 1);
    button.setAttribute("aria-pressed", String(position >= 0));
    const badge = $(".advanced-host-order", button);
    if (badge) badge.textContent = position >= 0 ? position + 1 : "";
  });
  syncPairTravelLimits();
}

function setAdvancedLayer(layer) {
  state.advancedLayer = uiClamp(layer, 0, API.LAYER_COUNT - 1);
  if ($("#advLayer")) $("#advLayer").value = state.advancedLayer;
  $$('[data-advanced-layer]').forEach((button) => {
    const active = Number(button.dataset.advancedLayer) === state.advancedLayer;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const compiled = API.compileAdvanced(state.profile);
  $$('[data-advanced-host-key]').forEach((button) => {
    const mapping = compiled.userKeys[state.advancedLayer][Number(button.dataset.advancedHostKey)];
    const label = $(".mapped", button);
    if (label) label.textContent = mappingLabel(mapping);
    button.classList.toggle("advanced", [112, 144, 145, 146, 147, 148].includes(mapping?.type));
  });
  const paired = state.advancedType === "rs" || state.advancedType === "socd";
  const note = $("#advancedLayerNote");
  if (note) note.innerHTML = advancedLayerMessage(state.advancedLayer, paired);
}

function syncPairRtControls(copyPress = false) {
  const independent = Boolean($("#pairIndependentRt")?.checked);
  const press = $("#pairPress");
  const release = $("#pairRelease");
  const releaseNumber = $('[data-range-for="pairRelease"]');
  if (copyPress && !independent && press && release) {
    release.value = press.value;
    updateRangeOutput(release);
  }
  if (release) release.disabled = !independent;
  if (releaseNumber) releaseNumber.disabled = !independent;
  release?.closest(".field")?.classList.toggle("disabled", !independent);
}

function pairTravelMaximum() {
  const maxima = state.advancedHostSelection.slice(0, 2).map((index) => switchTravelMaximum(state.profile.travelKeys[index]));
  return maxima.length ? Math.min(...maxima) : API.FALLBACK_SWITCH_MAX_TRAVEL_MM;
}

function syncPairTravelLimits() {
  if (state.advancedType !== "rs" && state.advancedType !== "socd") return;
  const maximumTravel = pairTravelMaximum();
  const maximum = Math.round(maximumTravel * 100);
  [$("#pairActuation"), $("#pairPress"), $("#pairRelease")].forEach((input) => configureDistanceMaximum(input, maximum));
  const note = $("#pairTravelLimitNote");
  if (note) note.textContent = `Pair limits use the shorter host-key switch travel: ${maximumTravel.toFixed(2)} mm.`;
}

function dksInput(actionIndex, field) {
  return $(`#dks${actionIndex}${field}`);
}

function dksFieldValue(actionIndex, field) {
  return uiClamp(Number(dksInput(actionIndex, field)?.value || 0), 0, 4);
}

function setDksFieldValue(actionIndex, field, value) {
  const input = dksInput(actionIndex, field);
  if (input) input.value = String(uiClamp(value, 0, 4));
}

function syncDksMatrix(actionIndex) {
  $$(`[data-dks-action-index="${actionIndex}"][data-dks-stage]`).forEach((button) => {
    const stage = Number(button.dataset.dksStage);
    const spec = dksStageSpec(stage);
    const active = dksFieldValue(actionIndex, spec.trigger) === spec.value;
    const cell = button.closest("[data-dks-cell]");
    if (cell) {
      const mode = active ? "tap" : "off";
      cell.classList.remove("off", "tap", "down", "up");
      cell.classList.add(mode);
      const label = $(".dks-cell-main strong", cell);
      if (label) label.textContent = active ? "Click" : "+";
    }
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setDksCell(actionIndex, stage, action) {
  const spec = dksStageSpec(stage);
  const active = dksFieldValue(actionIndex, spec.trigger) === spec.value;
  if (action === "tap") {
    DKS_HIDDEN_FIELDS.forEach((field) => setDksFieldValue(actionIndex, field, 0));
    setDksFieldValue(actionIndex, spec.trigger, active ? 0 : spec.value);
  }
  syncDksMatrix(actionIndex);
}

function applyDksPreset(actionIndex, preset) {
  const tapStage = Number(String(preset).match(/^tap([1-4])$/)?.[1]);
  if (tapStage) {
    DKS_HIDDEN_FIELDS.forEach((field) => setDksFieldValue(actionIndex, field, 0));
    const spec = dksStageSpec(tapStage);
    setDksFieldValue(actionIndex, spec.trigger, spec.value);
  } else if (preset === "hold12") {
    DKS_HIDDEN_FIELDS.forEach((field) => setDksFieldValue(actionIndex, field, 0));
    setDksFieldValue(actionIndex, "DownStart", 1);
    setDksFieldValue(actionIndex, "DownEnd", 2);
  } else if (preset === "hold14") {
    DKS_HIDDEN_FIELDS.forEach((field) => setDksFieldValue(actionIndex, field, 0));
    setDksFieldValue(actionIndex, "DownStart", 1);
    setDksFieldValue(actionIndex, "UpEnd", 1);
  } else if (preset === "clear") {
    DKS_HIDDEN_FIELDS.forEach((field) => setDksFieldValue(actionIndex, field, 0));
  }
  syncDksMatrix(actionIndex);
}

// ---------------------------------------------------------------------------
// Advanced modal interactions
// ---------------------------------------------------------------------------
function bindAdvancedForm() {
  $$('input[type="range"]', $("#advancedFields")).forEach((input) => {
    if (input.dataset.advancedRangeBound) return;
    input.dataset.advancedRangeBound = "true";
    input.addEventListener("input", () => updateRangeOutput(input));
  });
  bindDistanceInputs($("#advancedFields"));
  $$('[data-advanced-layer]').forEach((button) => { button.onclick = () => setAdvancedLayer(Number(button.dataset.advancedLayer)); });
  $$('[data-advanced-host-slot]').forEach((button) => { button.onclick = () => { state.advancedHostSlot = Number(button.dataset.advancedHostSlot); syncAdvancedHostPicker(); }; });
  $$('[data-advanced-host-key]').forEach((button) => { button.onclick = () => {
    const index = Number(button.dataset.advancedHostKey);
    const paired = state.advancedType === "rs" || state.advancedType === "socd";
    const slot = paired ? state.advancedHostSlot : 0;
    const otherSlot = slot === 0 ? 1 : 0;
    if (paired && state.advancedHostSelection[otherSlot] === index) {
      state.advancedHostSelection[otherSlot] = state.advancedHostSelection[slot];
    }
    state.advancedHostSelection[slot] = index;
    if (paired && slot === 0) state.advancedHostSlot = 1;
    syncAdvancedHostPicker();
  }; });
  $$('[data-dks-cell-action]').forEach((button) => { button.onclick = () => setDksCell(Number(button.dataset.dksActionIndex), Number(button.dataset.dksStage), button.dataset.dksCellAction); });
  $$('[data-dks-preset]').forEach((button) => { button.onclick = () => applyDksPreset(Number(button.dataset.dksActionIndex), button.dataset.dksPreset); });
  $$('[data-dks-action-card]').forEach((card) => syncDksMatrix(Number(card.dataset.dksActionCard)));
  $("#pairIndependentRt")?.addEventListener("change", () => syncPairRtControls(true));
  $("#pairPress")?.addEventListener("input", () => syncPairRtControls(true));
  $('[data-range-for="pairPress"]')?.addEventListener("input", () => syncPairRtControls(true));
  syncPairRtControls(false);
  $$('[data-open-mapping-picker]', $("#advancedFields")).forEach((button) => { button.onclick = () => openAdvancedMappingPicker(button); });
  const addMacro = $("#addMacroRow");
  if (addMacro) addMacro.onclick = () => {
    const indexes = $$('[data-macro-row]', $("#macroRows")).map((row) => Number(row.dataset.macroIndex));
    const nextIndex = Math.max(-1, ...indexes) + 1;
    $("#macroRows").insertAdjacentHTML("beforeend", macroRow({ action: "keydown", code: 4, delay: 0 }, nextIndex));
    bindAdvancedForm();
  };
  $$('[data-remove-macro]', $("#advancedFields")).forEach((button) => button.onclick = () => button.closest('[data-macro-row]').remove());
  bindModifierPicker();
}

function parseMappingSelect(id) {
  return mappingFromControl($(`#${id}`));
}

function dksTimingActive(entry) {
  return ["downStart", "downEnd", "upStart", "upEnd"].some((field) => Number(entry[field]) > 0);
}

function dksOutputAssigned(entry) {
  return entry.key && Number(entry.key.type) !== 255;
}

// ---------------------------------------------------------------------------
// Save, restore, and delete Advanced actions
// ---------------------------------------------------------------------------
/**
 * Capture the mapping hidden underneath an Advanced action. This backup is why
 * deleting the action can restore the user's key instead of leaving Unassigned.
 */
function baseMappingForHost(layer, index) {
  const owner = state.profile.advancedKeys.find((entry) => (entry.layer || 0) === layer && (entry.index1 === index || entry.index2 === index));
  if (owner) {
    const stored = owner.index1 === index ? owner.baseMapping : owner.baseMapping2;
    return clone(stored || defaultMappingForPhysical(index, layer));
  }
  const current = state.profile.userKeys[layer][index];
  return clone([112, 144, 145, 146, 147, 148].includes(current?.type) ? defaultMappingForPhysical(index, layer) : current || defaultMappingForPhysical(index, layer));
}

function restoreAdvancedHosts(item) {
  const layer = item.layer || 0;
  state.profile.userKeys[layer][item.index1] = clone(item.baseMapping || defaultMappingForPhysical(item.index1, layer));
  if (item.index2 != null) state.profile.userKeys[layer][item.index2] = clone(item.baseMapping2 || defaultMappingForPhysical(item.index2, layer));
}

function restorePairTravel(item) {
  if (item.type !== "rs" && item.type !== "socd") return;
  if (item.baseTravel1) state.profile.travelKeys[item.index1] = clone(item.baseTravel1); else state.profile.travelKeys[item.index1].priority = 0;
  if (item.baseTravel2) state.profile.travelKeys[item.index2] = clone(item.baseTravel2); else state.profile.travelKeys[item.index2].priority = 0;
}

/**
 * Validate the modal, build one normalized action object, displace any conflicting
 * host actions, and stage the affected mapping/Hall/Advanced banks together.
 */
function saveAdvanced(event) {
  event.preventDefault();
  const type = state.advancedType;
  const layer = uiClamp($("#advLayer")?.value ?? state.advancedLayer, 0, API.LAYER_COUNT - 1);
  const index1 = Number($("#advIndex1").value);
  const existing = state.advancedEditIndex == null ? null : state.profile.advancedKeys[state.advancedEditIndex];
  const base = { type, layer, index1, baseMapping: existing && (existing.layer || 0) === layer && existing.index1 === index1 ? existing.baseMapping || baseMappingForHost(layer, index1) : baseMappingForHost(layer, index1) };
  let item = base;
  if (type === "dks") {
    const dksKeys = [0, 1, 2, 3].map((index) => ({
      key: parseMappingSelect(`dksKey${index}`),
      downStart: Number($(`#dks${index}DownStart`).value),
      downEnd: Number($(`#dks${index}DownEnd`).value),
      upStart: Number($(`#dks${index}UpStart`).value),
      upEnd: Number($(`#dks${index}UpEnd`).value),
    }));
    const activeRows = dksKeys.filter(dksTimingActive);
    if (!activeRows.length) return showAdvancedError("Choose at least one DKS output position.");
    if (activeRows.some((entry) => !dksOutputAssigned(entry))) return showAdvancedError("Choose an output key for every active DKS row.");
    item = { ...base, dksPoint: [0, 1, 2, 3].map((index) => Number($(`#dksPoint${index}`).value)), dksKeys };
  }
  if (type === "mt") item = { ...base, mtClickKey: parseMappingSelect("mtClickKey"), mtDownKey: parseMappingSelect("mtDownKey"), mtTime: uiClamp($("#mtTime").value, 10, 2550) };
  if (type === "tgl") item = { ...base, tglKey: parseMappingSelect("tglKey") };
  if (type === "rs" || type === "socd") {
    const index2 = Number($("#advIndex2").value);
    if (index1 === index2) return showAdvancedError("The paired keys must be different.");
    const press = Number($("#pairPress").value);
    const release = $("#pairIndependentRt")?.checked ? Number($("#pairRelease").value) : press;
    item = { ...base, index2, baseMapping2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseMapping2 || baseMappingForHost(layer, index2) : baseMappingForHost(layer, index2), baseTravel1: existing && (existing.layer || 0) === layer && existing.index1 === index1 ? existing.baseTravel1 || clone(state.profile.travelKeys[index1]) : clone(state.profile.travelKeys[index1]), baseTravel2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseTravel2 || clone(state.profile.travelKeys[index2]) : clone(state.profile.travelKeys[index2]), key1: parseMappingSelect("pairKey1"), key2: parseMappingSelect("pairKey2"), option: { actuation: Number($("#pairActuation").value), press, release, priority: type === "socd" ? Number($("#pairPriority").value) : 0 } };
  }
  if (type === "cb") {
    const modifiers = currentModifierMask();
    if (!modifiers) return showAdvancedError("Choose at least one modifier.");
    item = { ...base, modifiers, baseKey: parseMappingSelect("comboBase") };
  }
  if (type === "macro") {
    const actions = $$('[data-macro-row]', $("#macroRows")).map((row) => {
      const keyControl = $("[data-open-mapping-picker][id^=macroKey]", row);
      const code = mappingFromControl(keyControl).code2;
      return { action: $("select[id^=macroAction]", row).value, code, delay: uiClamp($("input[id^=macroDelay]", row).value, 0, 65535), kind: "key" };
    });
    if (!actions.length) return showAdvancedError("Add at least one macro event.");
    item = { ...base, macroRepeatCount: uiClamp($("#macroRepeat").value, 1, 255), actions };
  }
  const displaced = [];
  const candidate = state.profile.advancedKeys.filter((entry, index) => {
    if (index === state.advancedEditIndex) { displaced.push(entry); return false; }
    if ((entry.layer || 0) !== layer) return true;
    const keep = entry.index1 !== index1 && entry.index2 !== index1 && (item.index2 == null || (entry.index1 !== item.index2 && entry.index2 !== item.index2));
    if (!keep) displaced.push(entry);
    return keep;
  });
  candidate.push(item);
  try { API.compileAdvanced({ ...state.profile, advancedKeys: candidate }); } catch (error) { return showAdvancedError(error.message); }
  displaced.forEach(restoreAdvancedHosts);
  displaced.forEach(restorePairTravel);
  state.profile.advancedKeys = candidate;
  if (type === "rs" || type === "socd") {
    const option = item.option;
    [item.index1, item.index2].forEach((index) => Object.assign(state.profile.travelKeys[index], { key_mode: 1, key_actuation: option.actuation, rt_press: option.press, rt_release: option.release }));
    state.profile.travelKeys[item.index1].priority = type === "socd" ? option.priority : 0;
    state.profile.travelKeys[item.index2].priority = type === "socd" ? (option.priority === 1 ? 2 : option.priority === 2 ? 1 : option.priority) : 0;
  }
  const hallChanged = type === "rs" || type === "socd" || displaced.some((entry) => entry.type === "rs" || entry.type === "socd");
  markDirty("advanced", "keymap", ...(hallChanged ? ["hall"] : []));
  log("change", `${ADVANCED_META[type].name} staged on ${physicalName(index1)}`);
  $("#advancedDialog").close(); renderPage(); showToast(`${ADVANCED_META[type].name} staged.`);
}

function showAdvancedError(message) { $("#advancedError").textContent = message; }

/** Restore host mappings and physical Hall values before removing an action. */
function deleteAdvanced(index) {
  const item = state.profile.advancedKeys[index];
  if (!item) return;
  state.profile.advancedKeys.splice(index, 1);
  restoreAdvancedHosts(item);
  restorePairTravel(item);
  markDirty("advanced", "keymap", ...(item.type === "rs" || item.type === "socd" ? ["hall"] : []));
  log("change", `${ADVANCED_META[item.type]?.name || item.type} removed`);
  renderPage(); showToast("Advanced action removed and host mapping restored.");
}
