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

function renderMappingGroups(query) {
  const normalized = query.trim().toLowerCase();
  const pickerControl = state.mappingPickerTarget ? $(`#${state.mappingPickerTarget}`) : null;
  const current = pickerControl ? mappingFromControl(pickerControl) : state.profile.userKeys[state.layer][state.mappingIndex] || {};
  const macMode = Number(state.profile.deviceSettings.systemMode) === 1;
  $("#mappingGroups").innerHTML = MAPPING_GROUPS.map((group) => {
    if (group.macOnly && !macMode) return "";
    const items = group.items.filter((item) => {
      if (state.mappingPickerScope === "basic" && (item.type !== 16 || item.code1 !== 0)) return false;
      return !normalized || `${item.name} ${item.macName || ""} ${group.title}`.toLowerCase().includes(normalized);
    });
    if (!items.length) return "";
    return `<section class="mapping-group"><h3>${esc(group.title)}</h3><div class="mapping-options">${items.map((item) => `<button class="mapping-option${item.type === current.type && item.code1 === current.code1 && item.code2 === current.code2 ? " active" : ""}" type="button" data-map="${item.type},${item.code1},${item.code2}"><strong>${esc((macMode && item.macName) || item.name)}</strong><small>${item.type} · ${item.code1} · ${item.code2}</small></button>`).join("")}</div></section>`;
  }).join("") || `<div class="empty-state"><strong>No mappings found</strong><p>Try a shorter search.</p></div>`;
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
    const mapped = mappingLabel(compiled.userKeys[layer][index]);
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
  state.advancedLayer = clamp(item.layer ?? 0, 0, API.LAYER_COUNT - 1);
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
function normalizeModifierOrder(order, modifiers = 0) {
  const validBits = new Set(MODIFIER_CHOICES.map(([bit]) => bit));
  const result = [];
  (Array.isArray(order) ? order : []).map(Number).forEach((bit) => {
    if (validBits.has(bit) && (modifiers & bit) && !result.includes(bit)) result.push(bit);
  });
  MODIFIER_CHOICES.forEach(([bit]) => { if ((modifiers & bit) && !result.includes(bit)) result.push(bit); });
  return result;
}

function modifierSequenceHtml(order) {
  if (!order.length) return `<div class="modifier-order-empty">Choose modifiers above in the order you want them displayed.</div>`;
  return order.map((bit, index) => {
    const name = MODIFIER_CHOICES.find(([value]) => value === bit)?.[1] || `Modifier ${bit}`;
    return `<div class="modifier-order-item"><span><i>${index + 1}</i>${esc(name)}</span><div><button type="button" data-modifier-move="-1" data-modifier-bit="${bit}" aria-label="Move ${esc(name)} earlier"${index === 0 ? " disabled" : ""}>←</button><button type="button" data-modifier-move="1" data-modifier-bit="${bit}" aria-label="Move ${esc(name)} later"${index === order.length - 1 ? " disabled" : ""}>→</button><button type="button" data-modifier-remove="${bit}" aria-label="Remove ${esc(name)}">×</button></div></div>`;
  }).join("");
}

function modifierPickerHtml(item) {
  const modifiers = Number(item.modifiers) || 0;
  const order = normalizeModifierOrder(item.modifierOrder, modifiers);
  return `<div class="modifier-picker" data-modifier-picker><input id="comboModifierOrder" type="hidden" value="${order.join(",")}" /><div class="modifier-options">${MODIFIER_CHOICES.map(([bit, name]) => {
    const position = order.indexOf(bit);
    return `<button class="modifier-option${position >= 0 ? " selected" : ""}" type="button" data-modifier-option="${bit}" aria-pressed="${position >= 0}"><i>${position >= 0 ? position + 1 : "+"}</i><span>${esc(name)}</span></button>`;
  }).join("")}</div><div class="modifier-order-heading"><strong>Selected order</strong><small>Use the arrows to reorder the chosen modifiers.</small></div><div class="modifier-order-list" id="comboModifierSequence">${modifierSequenceHtml(order)}</div><p>The selection order is preserved in this workspace and exported backups. The keyboard firmware encodes the active modifiers as one HID mask and sends them together.</p></div>`;
}

function dksStagePicker(id, label, value) {
  const selected = clamp(value, 0, 4);
  return `<div class="dks-stage-picker" data-dks-stage-picker><div><strong>${esc(label)}</strong><small>${selected ? `Stage ${selected}` : "Off"}</small></div><input id="${id}" type="hidden" value="${selected}" />${[[0, "Off"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]].map(([stage, text]) => `<button type="button" data-dks-stage-choice="${stage}" class="${stage === selected ? "active" : ""}" aria-pressed="${stage === selected}">${text}</button>`).join("")}</div>`;
}

function dksActionEditor(entry, index) {
  return `<article class="dks-action-card"><header><i>${index + 1}</i><div><strong>Output ${index + 1}</strong><small>Choose a key, then place its down/up transitions on the four travel stages.</small></div></header>${mappingPickerField(`dksKey${index}`, entry.key, `Output ${index + 1} key`)}<div class="dks-transition-groups"><section><h4>Pressing ↓</h4>${dksStagePicker(`dks${index}DownStart`, "Key down", entry.downStart)}${dksStagePicker(`dks${index}DownEnd`, "Key up", entry.downEnd)}</section><section><h4>Releasing ↑</h4>${dksStagePicker(`dks${index}UpStart`, "Key down", entry.upStart)}${dksStagePicker(`dks${index}UpEnd`, "Key up", entry.upEnd)}</section></div></article>`;
}

function advancedFormHtml(type, item) {
  const host = advancedHostPickerHtml(type);
  const finish = (content) => content;
  if (type === "dks") {
    const points = (item.dksPoint || [40, 160, 240, 80]).map((point) => clamp(point, 1, 255));
    const dksKeys = item.dksKeys || [0, 1, 2, 3].map(() => ({ key: mappingFromPreset(BASIC_MAPPING_CHOICES[0]), downStart: 1, downEnd: 2, upStart: 2, upEnd: 1 }));
    return finish(`${host}<div class="form-section dks-editor"><div class="dks-section-heading"><div><h3>Four travel stages</h3><p>Like Wootility DKS, each output can press or release at independently chosen points while the switch travels down and back up.</p></div><span class="chip">0.01–2.55 mm</span></div><div class="dks-travel-editor">${points.map((point, index) => `<div><i>${index + 1}</i>${rangeField(`Stage ${index + 1}`, `dksPoint${index}`, point, 1, 255, 1, "mm")}</div>`).join("")}</div><div class="dks-direction-rail" aria-hidden="true"><span>Pressing switch ↓</span><i></i><span>Releasing switch ↑</span></div><div class="dks-actions">${dksKeys.map(dksActionEditor).join("")}</div><div class="callout"><b>Transition model:</b> “Key down” holds an output; “Key up” releases it. Set a transition to Off when that half of the travel should not change the output.</div></div>`);
  }
  if (type === "mt") return finish(`${host}<div class="form-section"><h3>Tap and hold outputs</h3><div class="field-grid">${mappingPickerField("mtClickKey", item.mtClickKey, "Tap output")}${mappingPickerField("mtDownKey", item.mtDownKey, "Hold output")}<label class="field"><span>Hold threshold</span><input id="mtTime" type="number" min="10" max="2550" step="10" value="${item.mtTime || 200}" /><small>10–2550 ms, stored in 10 ms steps</small></label></div></div>`);
  if (type === "tgl") return finish(`${host}<div class="form-section"><h3>Toggle output</h3><div class="field-grid">${mappingPickerField("tglKey", item.tglKey, "Output key")}</div></div>`);
  if (type === "rs" || type === "socd") {
    const option = item.option || {};
    const independent = Number(option.press || 10) !== Number(option.release ?? option.press ?? 10);
    return finish(`${host}<div class="form-section"><h3>Paired outputs</h3><div class="field-grid">${mappingPickerField("pairKey1", item.key1, "First output")}${mappingPickerField("pairKey2", item.key2, "Second output")}${type === "socd" ? selectField("Priority", "pairPriority", [[0, "Last Input Priority"], [1, "Absolute 1st key"], [2, "Absolute 2nd key"], [3, "Neutral"]], option.priority ?? 0) : ""}</div></div><div class="form-section"><h3>Pair actuation and Rapid Trigger</h3>${hallSwitchRow("Set Press and Release independently", "When off, RT Release follows RT Press.", "pairIndependentRt", independent)}<div class="field-grid pair-travel-fields">${rangeField("Actuation", "pairActuation", option.actuation || 40, 1, 400, 1, "mm")}${rangeField("RT press", "pairPress", option.press || 10, 1, 400, 1, "mm")}${rangeField("RT release", "pairRelease", option.release ?? option.press ?? 10, 1, 400, 1, "mm", !independent)}</div></div>`);
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

function currentModifierOrder() {
  return String($("#comboModifierOrder")?.value || "").split(",").filter(Boolean).map(Number).filter((bit, index, values) => MODIFIER_CHOICES.some(([value]) => value === bit) && values.indexOf(bit) === index);
}

function syncModifierPicker(order) {
  const hidden = $("#comboModifierOrder");
  if (!hidden) return;
  hidden.value = order.join(",");
  $$('[data-modifier-option]', $("[data-modifier-picker]")).forEach((button) => {
    const position = order.indexOf(Number(button.dataset.modifierOption));
    button.classList.toggle("selected", position >= 0);
    button.setAttribute("aria-pressed", String(position >= 0));
    const badge = $("i", button);
    if (badge) badge.textContent = position >= 0 ? position + 1 : "+";
  });
  const sequence = $("#comboModifierSequence");
  if (sequence) sequence.innerHTML = modifierSequenceHtml(order);
}

function bindModifierPicker() {
  const picker = $("[data-modifier-picker]");
  if (!picker) return;
  picker.onclick = (event) => {
    const order = currentModifierOrder();
    const option = event.target.closest("[data-modifier-option]");
    const remove = event.target.closest("[data-modifier-remove]");
    const move = event.target.closest("[data-modifier-move]");
    if (option) {
      const bit = Number(option.dataset.modifierOption);
      const position = order.indexOf(bit);
      if (position >= 0) order.splice(position, 1); else order.push(bit);
    } else if (remove) {
      const position = order.indexOf(Number(remove.dataset.modifierRemove));
      if (position >= 0) order.splice(position, 1);
    } else if (move) {
      const position = order.indexOf(Number(move.dataset.modifierBit));
      const next = position + Number(move.dataset.modifierMove);
      if (position >= 0 && next >= 0 && next < order.length) [order[position], order[next]] = [order[next], order[position]];
    } else return;
    syncModifierPicker(order);
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
}

function setAdvancedLayer(layer) {
  state.advancedLayer = clamp(layer, 0, API.LAYER_COUNT - 1);
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

function syncDksStagePicker(picker, stage) {
  const value = clamp(stage, 0, 4);
  const input = $("input[type=hidden]", picker);
  if (input) input.value = value;
  $$('[data-dks-stage-choice]', picker).forEach((button) => {
    const active = Number(button.dataset.dksStageChoice) === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const status = $("small", picker);
  if (status) status.textContent = value ? `Stage ${value}` : "Off";
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
  $$('[data-dks-stage-choice]').forEach((button) => { button.onclick = () => syncDksStagePicker(button.closest("[data-dks-stage-picker]"), Number(button.dataset.dksStageChoice)); });
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
  const layer = clamp($("#advLayer")?.value ?? state.advancedLayer, 0, API.LAYER_COUNT - 1);
  const index1 = Number($("#advIndex1").value);
  const existing = state.advancedEditIndex == null ? null : state.profile.advancedKeys[state.advancedEditIndex];
  const base = { type, layer, index1, baseMapping: existing && (existing.layer || 0) === layer && existing.index1 === index1 ? existing.baseMapping || baseMappingForHost(layer, index1) : baseMappingForHost(layer, index1) };
  let item = base;
  if (type === "dks") item = { ...base, dksPoint: [0, 1, 2, 3].map((index) => Number($(`#dksPoint${index}`).value)), dksKeys: [0, 1, 2, 3].map((index) => ({ key: parseMappingSelect(`dksKey${index}`), downStart: Number($(`#dks${index}DownStart`).value), downEnd: Number($(`#dks${index}DownEnd`).value), upStart: Number($(`#dks${index}UpStart`).value), upEnd: Number($(`#dks${index}UpEnd`).value) })) };
  if (type === "mt") item = { ...base, mtClickKey: parseMappingSelect("mtClickKey"), mtDownKey: parseMappingSelect("mtDownKey"), mtTime: clamp($("#mtTime").value, 10, 2550) };
  if (type === "tgl") item = { ...base, tglKey: parseMappingSelect("tglKey") };
  if (type === "rs" || type === "socd") {
    const index2 = Number($("#advIndex2").value);
    if (index1 === index2) return showAdvancedError("The paired keys must be different.");
    const press = Number($("#pairPress").value);
    const release = $("#pairIndependentRt")?.checked ? Number($("#pairRelease").value) : press;
    item = { ...base, index2, baseMapping2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseMapping2 || baseMappingForHost(layer, index2) : baseMappingForHost(layer, index2), baseTravel1: existing && (existing.layer || 0) === layer && existing.index1 === index1 ? existing.baseTravel1 || clone(state.profile.travelKeys[index1]) : clone(state.profile.travelKeys[index1]), baseTravel2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseTravel2 || clone(state.profile.travelKeys[index2]) : clone(state.profile.travelKeys[index2]), key1: parseMappingSelect("pairKey1"), key2: parseMappingSelect("pairKey2"), option: { actuation: Number($("#pairActuation").value), press, release, priority: type === "socd" ? Number($("#pairPriority").value) : 0 } };
  }
  if (type === "cb") {
    const modifierOrder = currentModifierOrder();
    const modifiers = modifierOrder.reduce((mask, bit) => mask | bit, 0);
    if (!modifierOrder.length) return showAdvancedError("Choose at least one modifier.");
    item = { ...base, modifiers, modifierOrder, baseKey: parseMappingSelect("comboBase") };
  }
  if (type === "macro") {
    const actions = $$('[data-macro-row]', $("#macroRows")).map((row) => {
      const keyControl = $("[data-open-mapping-picker][id^=macroKey]", row);
      const code = mappingFromControl(keyControl).code2;
      return { action: $("select[id^=macroAction]", row).value, code, delay: clamp($("input[id^=macroDelay]", row).value, 0, 65535), kind: "key" };
    });
    if (!actions.length) return showAdvancedError("Add at least one macro event.");
    item = { ...base, macroRepeatCount: clamp($("#macroRepeat").value, 1, 255), actions };
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
