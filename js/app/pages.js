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
 * Page rendering and page-level event binding.
 *
 * Render functions turn the current state into HTML. bindPageControls() then
 * attaches behavior to that freshly rendered HTML. No data is written to the
 * keyboard here; edits only update the staged in-memory workspace.
 */

// ---------------------------------------------------------------------------
// Shared keyboard visualization
// ---------------------------------------------------------------------------
/**
 * Build the 36-key board used by Mapping, Hall, and Color pages.
 * `mode` changes the secondary information inside each key, while data-index
 * always preserves the physical firmware slot for event handlers.
 */
function keyboardHtml(mode, selected = new Set()) {
  const compiled = API.compileAdvanced(state.profile);
  const hallKeyboard = mode === "hall";
  return `<div class="keyboard-grid" data-keyboard-mode="${mode}">${HE30_LAYOUT.map((row) => `<div class="key-row">${row.map((keyItem) => {
    const { index, label } = keyItem;
    const mapping = compiled.userKeys[state.layer][index];
    const advanced = [112, 144, 145, 146, 147, 148].includes(mapping.type);
    const color = mode === "color" ? state.profile.colorKeys[index] : "";
    const mapped = mode === "hall" ? `${(state.profile.travelKeys[index].key_actuation / 100).toFixed(2)} mm` : mode === "color" ? color : mappingLabel(mapping);
    const livePercent = mode === "hall" ? clamp((state.liveTravel[index] / switchTravelMaximum(state.profile.travelKeys[index])) * 100, 0, 100) : 0;
    const calibrationStatus = mode === "hall" && state.calibrationActive ? state.calibrationStatus[index] : null;
    const calibrationPercent = mode === "hall" && state.calibrationActive ? clamp((state.calibrationTravelRaw[index] / 340) * 100, 0, 100) : 0;
    const calibrationClass = calibrationStatus === 255 ? " calibration-complete" : calibrationStatus === 0 ? " calibration-waiting" : calibrationStatus != null ? " calibration-progress" : "";
    const switchType = mode === "hall" ? switchTypeMeta(state.profile.travelKeys[index].switch_type) : null;
    const styles = [`--key-width:${hallKeyboard ? keyWidth(keyItem, 74, 9) : keyWidth(keyItem)}px`, `--key-u:${keyUnit(keyItem)}`];
    if (mode === "color") styles.push(`--key-led:${esc(color)}`);
    if (mode === "hall") styles.push(`--travel-pct:${livePercent.toFixed(2)}%`);
    if (mode === "hall" && state.calibrationActive) styles.push(`--calibration-pct:${calibrationPercent.toFixed(2)}%`);
    const style = styles.length ? ` style="${styles.join(";")}"` : "";
    const content = mode === "mapping"
      ? `<span class="mapped primary-label">${esc(mapped)}</span><span class="physical secondary-label">Physical: ${esc(label)}</span>`
      : mode === "color"
        ? `<span class="physical">${esc(label)}</span><span class="key-color-value"><i style="--swatch:${esc(color)}"></i>${esc(color.toUpperCase())}</span>`
        : `<span class="physical">${esc(label)}</span><span class="mapped">${esc(mapped)}</span>`;
    const title = mode === "mapping"
      ? ` title="Physical ${esc(label)} is mapped to ${esc(mapped)}"`
      : mode === "color" ? ` title="${esc(label)} saved color: ${esc(color.toUpperCase())}"` : "";
    const pressed = mode === "hall" || mode === "color" ? ` aria-pressed="${selected.has(index)}"` : "";
    const travelFill = mode === "hall" ? `<i class="travel-fill" aria-hidden="true"></i>` : "";
    const calibrationFill = mode === "hall" && state.calibrationActive ? `<i class="calibration-fill" aria-hidden="true"></i>` : "";
    const switchIndicator = switchType ? `<i class="switch-type-indicator" style="--switch-color:${switchType.color}" role="img" aria-label="${esc(switchType.name)}" title="${esc(switchType.name)}">${esc(switchType.short)}</i>` : "";
    return `<button class="keycap${selected.has(index) ? " selected" : ""}${advanced ? " advanced" : ""}${livePercent > .5 ? " live-pressed" : ""}${calibrationClass}" type="button" data-key-index="${index}"${style}${title}${pressed}${state.calibrationActive && mode === "hall" ? " aria-disabled=\"true\"" : ""}>${travelFill}${calibrationFill}${content}${state.dirty.size ? "<i class=\"key-dot\"></i>" : ""}${switchIndicator}</button>`;
  }).join("")}</div>`).join("")}</div>`;
}

function layerTabs() {
  return `<div class="tabs" role="tablist">${Array.from({ length: API.LAYER_COUNT }, (_, layer) => `<button type="button" data-layer="${layer}" class="${layer === state.layer ? "active" : ""}">${globalLayerLabel(state.profile.profileIndex, layer)}</button>`).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Overview, Mapping, and Hall pages
// ---------------------------------------------------------------------------
function renderOverview() {
  const settings = state.profile.deviceSettings;
  const rapidCount = PHYSICAL_KEYS.filter(({ index }) => state.profile.travelKeys[index].key_mode > 0).length;
  const mappedCount = PHYSICAL_KEYS.filter(({ index }) => state.profile.userKeys[state.layer][index].type !== 255).length;
  const reportRate = ({ 1: "8,000", 2: "4,000", 3: "2,000", 4: "1,000" })[settings.reportRate] || "Unknown";
  return `
    <div class="stats-grid">
      ${statCard("Current profile", `Profile ${state.profile.profileIndex + 1}`, state.identity?.multiProfile ? "Three onboard profiles · 12 total layers" : "Active workspace", "▣")}
      ${statCard("Polling rate", `${reportRate} Hz`, `Tick rate ${(["Low", "Medium", "High"])[settings.tickRate] || `Reserved ${settings.tickRate}`}`, "⌁")}
      ${statCard("Rapid Trigger", `${rapidCount} keys`, rapidCount ? "Enabled per-key" : "Standard actuation", "↕")}
      ${statCard("Advanced actions", state.profile.advancedKeys.length, `${mappedCount}/36 keys mapped on ${globalLayerLabel(state.profile.profileIndex, state.layer)}`, "◆")}
    </div>
    <div class="section-heading"><div><h2>Configuration health</h2><p>Every area remains independent until it is staged.</p></div></div>
    <div class="overview-grid">
      <section class="panel panel-pad"><div class="quick-list">
        ${quickRow("⌨", "Key mapping", `${mappedCount} physical keys mapped on ${globalLayerLabel(state.profile.profileIndex, state.layer)}`, "mapping")}
        ${quickRow("↕", "Hall effect", `${rapidCount} Rapid Trigger keys · ${(averageActuation()).toFixed(2)} mm average actuation`, "hall")}
        ${quickRow("✦", "Lighting", `${lightingEffectName("light", state.profile.light.effect)} · ${state.profile.light.brightness}% brightness`, "lighting")}
        ${quickRow("⌁", "Advanced functions", `${state.profile.advancedKeys.length} configured action${state.profile.advancedKeys.length === 1 ? "" : "s"}`, "advanced")}
      </div></section>
      <aside class="panel safety-card"><span class="chip">WRITE SAFETY</span><h2>Changes stay local first.</h2><p>Keyboard reads create a restorable workspace. Apply writes only changed data banks, then reads them back to verify exact bytes.</p><ul><li>No firmware commands in this build</li><li>No automatic writes from controls</li><li>JSON export works without WebHID</li><li>Diagnostics never leave your browser</li></ul></aside>
    </div>`;
}

function statCard(label, value, detail, icon) { return `<article class="panel stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`; }
function quickRow(icon, title, detail, page) { return `<div class="quick-row"><span>${icon}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><button class="icon-action" type="button" data-go-page="${page}">Open →</button></div>`; }
function averageActuation() { return PHYSICAL_KEYS.reduce((sum, { index }) => sum + (Number(state.profile.travelKeys[index].key_actuation) || 0), 0) / PHYSICAL_KEYS.length / 100; }
function precisionOptions() {
  if (state.identity?.type == null || [102, 103, 104, 105].includes(state.identity.type)) return [[0, "0.01 mm"], [1, "0.005 mm"], [2, "0.001 mm"]];
  if (state.identity?.type === 101) return [[0, "0.01 mm"], [1, "0.005 mm"]];
  return null;
}

function rtPrecisionMeta(mode) {
  if (Number(mode) === 2) return { divisor: 1000, max: 500, decimals: 3, step: "0.001 mm" };
  if (Number(mode) === 1) return { divisor: 200, max: 500, decimals: 3, step: "0.005 mm" };
  return { divisor: 100, max: 340, decimals: 2, step: "0.01 mm" };
}

function rapidTriggerModeName(mode) {
  return Number(mode) === 2 ? "Full Travel RT" : Number(mode) === 1 ? "Rapid Trigger" : "Standard";
}

function switchTypeMeta(value) {
  const numeric = clamp(value, 0, 15);
  return SWITCH_TYPES.find((type) => type.value === numeric) || { value: numeric, name: `Reserved switch type ${numeric}`, short: "?", color: "#7f91a2" };
}

function switchTravelMaximum(travel) {
  const configured = SWITCH_TYPES.find((type) => type.value === Number(travel?.switch_type))?.maxTravel;
  if (Number.isFinite(configured) && configured > 0) return configured;
  return Math.max(0.01, Number(travel?.key_max_length) || 3.5);
}

function switchTypeOptions(current) {
  const options = SWITCH_TYPES.map((type) => [type.value, `${type.name}${type.factory ? " · Factory" : ""}`]);
  const numeric = clamp(current, 0, 15);
  if (!SWITCH_TYPES.some((type) => type.value === numeric)) options.push([numeric, `Reserved switch type ${numeric} · Current`]);
  return options;
}

function switchTypeLegendHtml() {
  return `<div class="hall-switch-legend" aria-label="Switch type indicator legend">${SWITCH_TYPES.map((type) => `<span><i style="--switch-color:${type.color}">${type.short}</i>${esc(type.name)}${type.factory ? " · Factory" : ""}</span>`).join("")}</div>`;
}

function switchComparisonHtml() {
  const imageSlots = SWITCH_TYPES.map((type) => `<article class="switch-image-card"><h4><i style="--switch-color:${type.color}">${esc(type.short)}</i>${esc(type.name)}</h4><div class="switch-image-slots">${type.images.map((image, index) => `<figure class="switch-image-frame" data-switch-image-slot="${type.value}-${index + 1}"><img src="${esc(appAssetUrl(image.src))}" alt="${esc(image.alt)}" loading="lazy" decoding="async"><figcaption>${esc(image.label)}</figcaption></figure>`).join("")}</div></article>`).join("");
  const headers = SWITCH_TYPES.map((type) => `<th scope="col"><i style="--switch-color:${type.color}">${esc(type.short)}</i><span>${esc(type.name)}${type.factory ? "<small>Factory</small>" : ""}</span></th>`).join("");
  const rows = SWITCH_COMPARISON_ROWS.map(([label, ...values]) => `<tr><th scope="row">${esc(label)}</th>${values.map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`).join("");
  const sources = SWITCH_SOURCE_LINKS.map((links) => `<td><span class="switch-source-links">${links.map((source) => `<a href="${esc(source.href)}" target="_blank" rel="noopener noreferrer">${esc(source.label)}<span aria-hidden="true">↗</span></a>`).join("")}</span></td>`).join("");
  return `<details class="switch-comparison"><summary><span><strong>Compare all four switches</strong><small>Specifications and eight product images</small></span><i aria-hidden="true">+</i></summary><div class="switch-comparison-content"><div class="switch-image-grid" aria-label="Switch product images">${imageSlots}</div><div class="switch-comparison-table-wrap"><table><caption>Magnetic switch comparison from Switch Comparision.xlsx</caption><thead><tr><th scope="col">Specification</th>${headers}</tr></thead><tbody>${rows}<tr><th scope="row">Sources</th>${sources}</tr></tbody></table></div><p class="switch-comparison-note"><b>Workbook notes:</b> Question marks and the disputed Mount Tai travel value are preserved as supplied. Blank specifications are shown as —.</p></div></details>`;
}

function calibrationPanelHtml() {
  const connected = state.source === "device" && Boolean(state.driver);
  const completed = PHYSICAL_KEYS.filter(({ index }) => state.calibrationStatus[index] === 255).length;
  const activeKeys = PHYSICAL_KEYS.filter(({ index }) => state.calibrationStatus[index] != null && ![0, 255].includes(state.calibrationStatus[index])).length;
  const lastKey = state.calibrationLastIndex == null ? "Waiting for a key" : physicalName(state.calibrationLastIndex);
  const buttonText = state.calibrationBusy ? "Working\u2026" : state.calibrationActive ? "Stop calibration" : "Start calibration";
  return `<section class="panel calibration-panel${state.calibrationActive ? " active" : ""}">
    <div class="calibration-heading"><div><span class="chip">SWITCH CALIBRATION</span><h2>${state.calibrationActive ? "Calibration in progress" : "Calibrate Magnetic Switches"}</h2><p>${state.calibrationActive ? "Press every physical key one at a time until it turns blue." : "Re-measure the top and bottom range of all 36 magnetic switches using the keyboard's original calibration mode."}</p></div><button class="button ${state.calibrationActive ? "secondary" : "primary"}" id="calibrationButton" type="button"${!connected || state.calibrationBusy ? " disabled" : ""}>${buttonText}</button></div>
    ${state.calibrationActive ? `<div class="calibration-progress"><div><span>Completed</span><strong id="calibrationCompleted">${completed} / ${PHYSICAL_KEYS.length}</strong></div><div class="calibration-progress-track"><i id="calibrationProgressFill" style="width:${((completed / PHYSICAL_KEYS.length) * 100).toFixed(2)}%"></i></div><div><span>Current key</span><strong id="calibrationLastKey">${esc(lastKey)}</strong></div></div>
      <div class="calibration-instructions"><ol><li>Press each key at a steady pace using normal typing force until it fully bottoms out.</li><li>Calibrate one key at a time. Blue means that key is complete.</li><li>When all keys are complete, choose <b>Stop calibration</b> to exit safely.</li><li>Recalibrate after replacing any magnetic switch.</li></ol><div class="calibration-legend"><span><i class="waiting"></i>Awaiting</span><span><i class="progress"></i>Measuring${activeKeys ? ` (${activeKeys})` : ""}</span><span><i class="complete"></i>Complete</span></div></div>` : `<div class="calibration-idle-note">Calibration is a live hardware operation and does not create staged profile changes. Live Hall monitoring is stopped before calibration begins.</div>`}
  </section>`;
}

function renderMapping() {
  return `<div class="layer-bar">${layerTabs()}<span class="selection-bar">Click a key to open the mapping library</span></div><section class="panel keyboard-panel">${keyboardHtml("mapping")}<div class="keyboard-legend"><span><i></i>Mapped key</span><span><i class="advanced-dot"></i>Advanced action</span><span><i class="staged-dot"></i>Workspace contains staged changes</span></div></section><div class="callout">FN and FN1–FN11 can target any of the keyboard's 12 global layers. Profiles 1, 2, and 3 use default layers 0, 4, and 8; each profile editor shows its default layer plus its three local Fn layers.</div>`;
}

/**
 * Render Hall tuning from the first selected key. Changes are held in form
 * controls until the user stages them, which protects multi-key selections from
 * accidental partial updates.
 */
function renderHall() {
  const selected = [...state.hallSelection];
  const first = state.profile.travelKeys[selected[0] ?? 0] || defaultTravel();
  const switchType = switchTypeMeta(first.switch_type);
  const mixedSwitchTypes = selected.length > 1 && new Set(selected.map((index) => Number(state.profile.travelKeys[index].switch_type))).size > 1;
  const precision = precisionOptions();
  const rapidTrigger = Number(first.key_mode) > 0;
  const fullTravel = Number(first.key_mode) === 2;
  const independentRt = Number(first.rt_press) !== Number(first.rt_release) || Number(first.pressPrecision) !== Number(first.releasePrecision);
  const insurance = Number(first.press_deadzone) > 0 && Number(first.release_deadzone) > 0;
  const withCurrentPrecision = (current) => precision && precision.some(([value]) => Number(value) === Number(current)) ? precision : precision ? [...precision, [current, `Reserved value ${current} (current)`]] : null;
  const precisionCard = precision
    ? `<section class="panel form-card experimental-setting-card"><span class="chip caution-chip">HIDDEN SETTING · USE WITH CAUTION</span><h3>RT sensitivity accuracy</h3><p>Sets the stored measurement step for Rapid Trigger Press and Release. The original HE30 interface hides this selector, so back up the profile before using it.</p><div class="field-grid">${selectField("Press accuracy", "hallPressPrecision", withCurrentPrecision(first.pressPrecision), first.pressPrecision, !rapidTrigger)}${selectField("Release accuracy", "hallReleasePrecision", withCurrentPrecision(first.releasePrecision), first.releasePrecision, !rapidTrigger || !independentRt)}</div><div class="rt-preset-row"><span>Common sensitivity values</span><button class="button secondary" type="button" data-rt-sensitivity-preset="0.05"${!rapidTrigger ? " disabled" : ""}>0.05 mm</button><button class="button secondary" type="button" data-rt-sensitivity-preset="0.10"${!rapidTrigger ? " disabled" : ""}>0.10 mm</button></div><div class="callout caution-callout"><b>Experimental:</b> the firmware record has only two precision bits. The two buttons set valid 0.05/0.10 mm RT sensitivity values; they are not additional precision codes. Hardware precision remains 0.01, 0.005, or 0.001 mm.</div></section>`
    : `<section class="panel form-card"><h3>RT sensitivity accuracy</h3><p>This HE30 model uses fixed 0.01 mm Rapid Trigger units in the original interface.</p><div class="callout">The precision bits remain intact when settings are saved. Like the original driver, this app hides the selector for device type 104.</div></section>`;
  const switchPaneActive = state.hallWorkspaceView === "switches";
  const workspaceTitle = switchPaneActive ? "Switch selector" : "Selected-key tuning";
  const workspaceStatus = state.calibrationActive
    ? "Finish calibration before editing Hall settings."
    : state.hallEditPending
      ? `Pending edits are locked to ${state.hallEditSelection.size} selected key${state.hallEditSelection.size === 1 ? "" : "s"}. Commit them or discard this edit batch.`
      : switchPaneActive
        ? "Assign the installed switch model to the currently selected keys, or open the comparison."
        : "Change a setting to prepare it for the currently selected keys.";
  return `${calibrationPanelHtml()}<div class="hall-primary-grid">
    <div class="hall-config-column">
      <section class="panel keyboard-panel hall-selection-panel"><div class="hall-keyboard-heading"><div><h2>${state.calibrationActive ? "Calibration status" : "Switch selection"}</h2><p id="hallSelectionHint">${state.calibrationActive ? "Use the physical keyboard. Red is awaiting, yellow is measuring, and blue is complete." : `<b id="hallSelectionCount">${selected.length}</b> key<span id="hallSelectionPlural">${selected.length === 1 ? "" : "s"}</span> selected · <span id="hallSelectionInstruction">${state.hallEditPending ? "Commit or discard these edits before choosing different keys" : "Hold and drag a box around keys, or Ctrl/Cmd-click to toggle"}</span>`}</p></div><button class="button secondary" id="selectAllKeys" type="button"${state.calibrationActive || state.hallEditPending ? " disabled" : ""}>Select all 36</button></div>${keyboardHtml("hall", state.hallSelection)}${switchTypeLegendHtml()}</section>
    </div>
    ${liveMonitorHtml()}
  </div>
  <div class="hall-workspace-toggle" role="group" aria-label="Hall editing section"><button type="button" id="hallWorkspaceTuning" data-hall-workspace="tuning" aria-controls="hallActuationPane" aria-pressed="${String(!switchPaneActive)}" class="${switchPaneActive ? "" : "active"}">Actuation tuning</button><button type="button" id="hallWorkspaceSwitches" data-hall-workspace="switches" aria-controls="hallSwitchPane" aria-pressed="${String(switchPaneActive)}" class="${switchPaneActive ? "active" : ""}">Switch selector</button></div>
      ${selected.length ? `<div class="section-heading hall-tuning-heading"><div><h2 id="hallWorkspaceTitle">${workspaceTitle}</h2><p id="hallEditStatus">${workspaceStatus}</p></div><div class="hall-edit-actions"><button class="button secondary" id="discardHallButton" type="button"${state.calibrationActive || !state.hallEditPending ? " disabled" : ""}>Discard changes</button><button class="button primary hall-stage-button${state.hallEditPending ? " pending" : ""}" id="stageHallButton" type="button"${state.calibrationActive || !state.hallEditPending ? " disabled" : ""}>${state.hallEditPending ? `Commit changes on ${state.hallEditSelection.size} selected key${state.hallEditSelection.size === 1 ? "" : "s"}` : "No changes to stage"}</button></div></div>
      <div class="hall-workspace-content${state.calibrationActive ? " calibration-locked" : ""}" id="hallTuningGrid">
        <div class="form-grid hall-tuning-grid hall-workspace-pane" id="hallActuationPane" data-hall-workspace-pane="tuning"${switchPaneActive ? " hidden" : ""}>
          <section class="panel form-card"><h3>Actuation and Rapid Trigger</h3><p>Set the fixed actuation point, then choose standard, regular RT, or the firmware's full-travel RT mode.</p><div class="switch-list hall-switch-list">
        ${hallSwitchRow("Rapid Trigger", "Rapid Trigger dynamically actuates and resets your key based on your intention to press or release the key. Rapid Trigger starts and ends after the actuation point.", "hallRapidTrigger", rapidTrigger)}
        ${hallSwitchRow("Continuous Rapid Trigger", "Hidden in the original HE30 interface. This experimental firmware mode uses key_mode 2; back up your profile and use it with caution.", "hallFullTravel", fullTravel, !rapidTrigger)}
        ${hallSwitchRow("Set Press and Release independently", "Off keeps both RT sensitivity values the same", "hallIndependentRt", independentRt, !rapidTrigger)}
          </div><div class="field-grid hall-distance-fields">
        ${rangeField("Actuation", "hallActuation", first.key_actuation, 1, 400, 1, "mm", false, true)}
        ${rtRangeField("RT Press", "hallPress", first.rt_press, first.pressPrecision, !rapidTrigger)}
        ${rtRangeField("RT Release", "hallRelease", first.rt_release, first.releasePrecision, !rapidTrigger || !independentRt)}
          </div><div class="callout">When enabled, Rapid Trigger ends when the entire key is released. When disabled, Rapid Trigger ends at the actuation point.</div></section>
          <section class="panel form-card"><h3>Deadzone Settings</h3><p>Limits the usable travel at both ends of the switch to reduce accidental, disconnected, or missed triggers.</p><div class="switch-list hall-switch-list">
        ${hallSwitchRow("Switch Deadzones", "Enable the top and bottom deadzones", "hallInsurance", insurance)}
        ${hallSwitchRow("Switch Bottom Out", "Adds the firmware's forced 0.1 mm bottom zone", "hallTriggerBottom", Boolean(state.profile.deviceSettings.stabilityMode))}
          </div><div class="field-grid hall-distance-fields">
        ${rangeField("Top Deadzone", "hallPressDeadzone", first.press_deadzone, 0, 127, 1, "mm", !insurance, true)}
        ${rangeField("Bottom Deadzone", "hallReleaseDeadzone", first.release_deadzone, 0, 127, 1, "mm", !insurance, true)}
          </div><div class="callout">Trigger Bottom is profile-wide, not stored inside each key. It writes the original driver's stability-mode bit.</div></section>
          ${precisionCard}
          <section class="panel form-card hall-data-card"><h3>Stored fields</h3><p>The per-key values are encoded directly into the keyboard's 8-byte Hall record.</p><dl class="hall-field-reference"><div><dt>switch_type</dt><dd>${SWITCH_TYPES.map((type) => `${type.value} ${esc(type.name)}`).join(", ")}</dd></div><div><dt>key_mode</dt><dd>0 standard, 1 RT, 2 full-travel RT</dd></div><div><dt>pressPrecision</dt><dd>RT Press unit selector</dd></div><div><dt>releasePrecision</dt><dd>RT Release unit selector</dd></div><div><dt>deadzone_status</dt><dd>Derived: both insurance zones are above zero</dd></div></dl></section>
        </div>
        <div class="form-grid hall-tuning-grid hall-workspace-pane hall-switch-selector-grid" id="hallSwitchPane" data-hall-workspace-pane="switches"${switchPaneActive ? "" : " hidden"}>
          <section class="panel form-card switch-type-card"><h3>Change Switch Type</h3><p>Choose the magnetic switch installed beneath the selected keys. This writes the firmware's per-key <code>switch_type</code> field.</p><div class="field-grid">${selectField("Switch model", "hallSwitchType", switchTypeOptions(first.switch_type), first.switch_type)}</div><div class="switch-type-current"><i style="--switch-color:${switchType.color}">${esc(switchType.short)}</i><span><strong>${mixedSwitchTypes ? "Mixed switch types selected" : esc(switchType.name)}</strong><small>${mixedSwitchTypes ? "Choose a model above to apply one type to every selected key." : switchType.factory ? "Factory-installed option" : "Saved for the selected key"}</small></span></div>${switchComparisonHtml()}</section>
        </div>
      </div>` : `<section class="panel hall-selection-required"><span class="chip">SELECT KEYS FIRST</span><h2>Choose one or more switches to tune</h2><p>Click a key, Ctrl/Cmd-click multiple keys, or hold and drag a selection box. The selected editing section will appear here.</p></section>`}
`
  ;
}

/** Build the connected-device-only travel gauge and switch cutaway. */
function liveMonitorHtml() {
  const connected = state.source === "device" && Boolean(state.driver);
  const index = state.liveLastIndex ?? 0;
  const travel = state.profile.travelKeys[index] || defaultTravel();
  const distance = state.liveTravel[index] || 0;
  const maxDistance = switchTravelMaximum(travel);
  const travelPercent = clamp((distance / maxDistance) * 100, 0, 100);
  const actuation = clamp((Number(travel.key_actuation) || 1) / 100, 0, maxDistance);
  const actuationPercent = clamp((actuation / maxDistance) * 100, 0, 100);
  const mapped = API.compileAdvanced(state.profile).userKeys[state.layer][index];
  const status = distance < .01 ? "Released" : distance >= actuation ? "Actuated" : "Pre-travel";
  const monitorText = state.calibrationActive ? "Calibration owns the stream" : state.liveMonitorBusy ? "Working…" : state.liveMonitorActive ? "Stop live monitor" : "Start live monitor";
  return `<section class="panel live-monitor hall-live-panel${state.liveMonitorActive ? " active" : ""}" id="liveMonitor" style="--live-travel:${travelPercent.toFixed(2)}%;--live-actuation:${actuationPercent.toFixed(2)}%;--live-offset:${(travelPercent * .44).toFixed(2)}px">
      <div class="hall-live-heading"><div><h2>Live press distance</h2><p>See Hall travel and the actuation point while pressing a key.</p></div><span class="live-session-note">${state.calibrationActive ? "Paused for calibration" : state.liveMonitorActive ? "Diagnostic stream active" : connected ? "Ready to monitor" : "Keyboard connection required"}</span></div>
      <div class="live-monitor-copy">
        <div class="live-status-line"><span class="live-dot${state.liveMonitorActive ? " active" : ""}"></span><b id="liveConnectionStatus">${state.liveMonitorActive ? "Live" : "Paused"}</b></div>
        <h3 id="liveKeyName">${esc(physicalName(index))}</h3>
        <p id="liveMappedName">Mapped to ${esc(mappingLabel(mapped))}</p>
        <strong class="live-distance" id="liveDistance">${distance.toFixed(2)} <small>mm</small></strong>
        <span class="live-state" id="liveState">${esc(status)}</span>
        <button class="button ${state.liveMonitorActive ? "secondary" : "primary"}" id="liveMonitorButton" type="button" ${!connected || state.liveMonitorBusy || state.calibrationActive ? "disabled" : ""}>${monitorText}</button>
        <small class="live-safety">Temporarily uses the keyboard’s original Dynamic Display diagnostic flag and restores it when stopped.</small>
      </div>
      <div class="switch-infographic" aria-label="Live key travel infographic">
        <div class="switch-cutaway">
          <div class="switch-keycap"><span id="liveKeycapLabel">${esc(physicalName(index))}</span></div>
          <div class="switch-stem"></div>
          <div class="switch-housing"><i></i><i></i></div>
          <div class="magnet"></div>
          <div class="sensor"></div>
        </div>
        <div class="travel-scale">
          <div class="scale-track"><i class="scale-fill"></i><span class="current-marker" id="liveCurrentMarker"></span><span class="actuation-marker" id="liveActuationMarker"><b>Actuation</b></span></div>
          <span class="scale-top">0.00 mm</span><span class="scale-bottom" id="liveScaleMaximum">${maxDistance.toFixed(2)} mm</span>
        </div>
        <div class="live-metrics">
          <span><small>Travel</small><strong id="liveTravelPercent">${travelPercent.toFixed(0)}%</strong></span>
          <span><small>Actuation</small><strong id="liveActuationValue">${actuation.toFixed(2)} mm</strong></span>
          <span><small>Mode</small><strong id="liveMode">${rapidTriggerModeName(travel.key_mode)}</strong></span>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Reusable form builders
// ---------------------------------------------------------------------------
// These helpers return markup only. hall.js and editors.js attach behavior after
// the page/modal has been inserted into the DOM.
function selectField(label, id, options, selected, disabled = false) { return `<label class="field"><span>${esc(label)}</span><select id="${id}"${disabled ? " disabled" : ""}>${options.map(([value, name]) => `<option value="${value}"${String(value) === String(selected) ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`; }
function distanceNumberEditor(id, value, divisor, min, max, disabled = false) {
  const millimeters = Number(value) / divisor;
  const minimum = Number(min) <= 0 ? 0 : Math.max(0.01, Number(min) / divisor);
  const maximum = Number(max) / divisor;
  const decimals = divisor > 100 ? 3 : 2;
  return `<span class="range-number-control"><input class="range-number" type="number" min="${minimum.toFixed(decimals)}" max="${maximum.toFixed(decimals)}" step="0.01" value="${millimeters.toFixed(decimals)}" inputmode="decimal" aria-label="${id} distance in millimeters" data-range-for="${id}"${disabled ? " disabled" : ""} /><span>mm</span></span>`;
}
function rangeField(label, id, value, min, max, step, unit, disabled = false, editable = true) { return `<label class="field"><span>${esc(label)}</span><div class="range-line${editable ? " editable" : ""}"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-distance-divisor="100" data-distance-decimals="2"${disabled ? " disabled" : ""} />${editable ? distanceNumberEditor(id, value, 100, min, max, disabled) : `<output class="range-value" for="${id}">${(Number(value) / 100).toFixed(2)} ${unit}</output>`}</div></label>`; }
function rtRangeField(label, id, value, precision, disabled = false) {
  const meta = rtPrecisionMeta(precision);
  const maximum = Math.min(511, Math.max(Math.round(4 * meta.divisor), Number(value) || 1));
  return `<label class="field"><span>${esc(label)}</span><div class="range-line editable"><input id="${id}" type="range" min="1" max="${maximum}" step="1" value="${value}" data-distance-divisor="${meta.divisor}" data-distance-decimals="${meta.decimals}"${disabled ? " disabled" : ""} />${distanceNumberEditor(id, value, meta.divisor, 1, maximum, disabled)}</div><small>${esc(meta.step)} per stored step; arrows adjust 0.01 mm</small></label>`;
}

function hallSwitchRow(title, detail, id, checked, disabled = false) { return `<div class="switch-row"><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><label class="switch"><input id="${id}" type="checkbox"${checked ? " checked" : ""}${disabled ? " disabled" : ""} /><i></i></label></div>`; }

function factoryResetCardHtml() {
  const profileNumber = clamp((state.profile?.profileIndex ?? 0) + 1, 1, API.PROFILE_COUNT);
  const connected = state.source === "device" && Boolean(state.driver);
  const disabled = !connected || state.factoryResetBusy;
  const status = state.factoryResetBusy ? "RESETTING…" : connected ? "FACTORY PROFILE READY" : "CONNECT KEYBOARD";
  const buttonTitle = connected ? "" : "Connect the keyboard to restore its onboard configuration.";
  return `<div class="section-heading factory-reset-heading"><div><h2>Factory reset</h2><p>Restore onboard mappings and behavior from the bundled Profile 1 factory configuration.</p></div><span class="chip factory-reset-status">${status}</span></div>
    <section class="panel panel-pad factory-reset-panel" aria-describedby="factoryResetScope">
      <div class="factory-reset-grid">
        <article class="factory-reset-action"><div><strong>Reset current profile</strong><p>Restores Profile ${profileNumber}'s four layers, Hall settings, advanced actions, macros, and lighting preset.</p></div><button class="button secondary" type="button" data-factory-reset="current"${disabled ? " disabled" : ""}${buttonTitle ? ` title="${esc(buttonTitle)}"` : ""}>${state.factoryResetBusy ? "Resetting…" : `Reset Profile ${profileNumber}`}</button></article>
        <article class="factory-reset-action danger"><div><strong>Reset all profiles</strong><p>Restores all three onboard profiles and translates the factory FN/FN1/FN2/FN3 targets to each profile's own four layers.</p></div><button class="button secondary" type="button" data-factory-reset="all"${disabled ? " disabled" : ""}${buttonTitle ? ` title="${esc(buttonTitle)}"` : ""}>${state.factoryResetBusy ? "Resetting…" : "Reset all profiles"}</button></article>
      </div>
      <div class="callout factory-reset-note" id="factoryResetScope"><b>Exact scope:</b> the factory file does not contain device-performance settings or a per-key RGB bank, so those values are preserved. Each profile is read before writing and read back afterward for verification.</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Settings and lighting pages
// ---------------------------------------------------------------------------
function renderSettings() {
  const settings = state.profile.deviceSettings;
  return `<div class="form-grid">
    <section class="panel form-card"><h3>USB performance</h3><p>Polling controls host reports; tick rate controls internal scanning.</p><div class="field-grid">
      ${selectField("Polling rate", "reportRate", [[1, "8,000 Hz"], [2, "4,000 Hz"], [3, "2,000 Hz"], [4, "1,000 Hz"]], settings.reportRate)}
      ${selectField("Tick rate", "tickRate", [[0, "Low"], [1, "Medium"], [2, "High"]], settings.tickRate)}
      ${selectField("Debounce", "debounce", [[0, "Close"], [1, "Low"], [4, "Medium"], [7, "High"]], settings.debounce)}
      ${selectField("OS mode", "systemMode", [[0, "Windows"], [1, "macOS"]], settings.systemMode)}
    </div><div class="callout">8,000 Hz can use more CPU and may be less stable through some USB hubs. The OS mode byte is valid firmware state, although the original driver changes it through remappable Windows/macOS function keys instead of showing this selector.</div></section>
    <section class="panel form-card"><h3>Input processing</h3><p>Compatibility modes exposed by the original software.</p><div class="switch-list">
      ${switchRow("Check mode", "Additional signal checks", "checkMode", settings.checkMode)}
      ${switchRow("Tachyon / Berserker mode", "Experimental firmware latency-processing bit", "tachyonMode", settings.tachyonMode)}
    </div><div class="callout caution-callout"><b>Hidden setting · use with caution.</b> Tachyon/Berserker mode is a valid stored firmware bit, but the original driver does not list it as a normal option. Stability and compatibility effects are not documented. Trigger Bottom remains grouped with Hall settings because it changes Rapid Trigger behavior.</div></section>
    <section class="panel form-card"><h3>Lock settings</h3><p>Prevent common shortcuts from interrupting a game.</p><div class="switch-list">
      ${switchRow("Windows key lock", "Blocks the GUI key", "lockWin", settings.lockWin)}
      ${switchRow("Alt + Tab lock", "Blocks app switching", "lockAltTab", settings.lockAltTab)}
      ${switchRow("Alt + F4 lock", "Blocks window close", "lockAltF4", settings.lockAltF4)}
    </div></section>
  </div>${factoryResetCardHtml()}`;
}

function switchRow(title, detail, setting, checked) { return `<div class="switch-row"><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><label class="switch"><input type="checkbox" data-setting="${setting}"${checked ? " checked" : ""} /><i></i></label></div>`; }

// Effect IDs are firmware values, not arbitrary UI ordering. Do not renumber.
const MAIN_LIGHT_EFFECTS = Object.freeze([
  { value: 1, name: "Spectrum", glyph: "▥", brightness: true, speed: true },
  { value: 2, name: "Stairs", glyph: "▟", brightness: true, color: true, palette: true },
  { value: 3, name: "Static", glyph: "≡", brightness: true, color: true, palette: true },
  { value: 4, name: "Breathing", glyph: "≈", brightness: true, speed: true, color: true, palette: true },
  { value: 5, name: "Hundred Flowers", glyph: "✿", brightness: true, speed: true },
  { value: 6, name: "Waves", glyph: "≋", brightness: true, speed: true, direction: true, color: true, palette: true },
  { value: 7, name: "Up and Down Waves", glyph: "≋", brightness: true, speed: true, color: true, palette: true },
  { value: 8, name: "Fountain", glyph: "♨", brightness: true, speed: true, color: true, palette: true },
  { value: 9, name: "Galaxy", glyph: "✺", brightness: true, speed: true, direction: true, color: true, palette: true },
  { value: 10, name: "Rotation", glyph: "↻", brightness: true, speed: true, direction: true, color: true, palette: true },
  { value: 11, name: "Tide", glyph: "≋", brightness: true, speed: true, color: true, palette: true },
  { value: 12, name: "Ocean Waves", glyph: "♒", brightness: true, speed: true, color: true, palette: true },
  { value: 13, name: "Ripples", glyph: "◎", brightness: true, speed: true, color: true, palette: true },
  { value: 14, name: "Always On Ripples", glyph: "◉", brightness: true, speed: true, color: true, palette: true },
  { value: 15, name: "Single Point", glyph: "⊙", brightness: true, color: true, palette: true },
  { value: 16, name: "Grid", glyph: "▦", brightness: true, speed: true, color: true, palette: true },
  { value: 17, name: "Piano", glyph: "▥", brightness: true, speed: true, color: true, palette: true },
  { value: 18, name: "Flowing Light", glyph: "∿", brightness: true, speed: true, color: true, palette: true },
  { value: 19, name: "Raindrops", glyph: "☂", brightness: true, speed: true, color: true, palette: true },
  { value: 20, name: "Starlight", glyph: "★", brightness: true, speed: true, color: true, palette: true },
  { value: 21, name: "Fireworks", glyph: "✺", brightness: true, speed: true, direction: true, color: true, palette: true },
  { value: 22, name: "Waveband", glyph: "〰", brightness: true, speed: true, color: true, palette: true },
  { value: 255, name: "Lights Off", glyph: "○" },
  { value: 0, name: "Preset", glyph: "✣", brightness: true },
]);
const LIGHT_STRIP_EFFECTS = Object.freeze([
  { value: 0, name: "Spectrum", glyph: "▥", brightness: true, speed: true, color: true },
  { value: 1, name: "Wave", glyph: "≋", brightness: true, speed: true, color: true },
  { value: 2, name: "Close", glyph: "○" },
  { value: 3, name: "Always on", glyph: "≡", brightness: true, speed: true, color: true },
  { value: 4, name: "Breathing", glyph: "≈", brightness: true, speed: true, color: true },
]);
const lightingEffects = (group) => group === "logoLight" ? LIGHT_STRIP_EFFECTS : MAIN_LIGHT_EFFECTS;
const lightingEffect = (group, value) => lightingEffects(group).find((effect) => effect.value === Number(value));
const lightingEffectName = (group, value) => lightingEffect(group, value)?.name || `Effect ${value}`;

function configuredLightingColor(index) {
  if (state.liveLightingActive && state.liveLightingColors[index]) return state.liveLightingColors[index];
  const light = state.profile.light;
  if (light.effect === 255 || light.brightness === 0) return "#000000";
  return API.normalizeHexColor(light.singleColor ? light.color : state.profile.colorKeys[index], "#000000");
}

function lightingKeyboardPreview() {
  const brightness = clamp(state.profile.light.brightness, 0, 100);
  return `<div class="keyboard-grid lighting-board" data-lighting-board aria-label="Configured 36-key lighting preview">${HE30_LAYOUT.map((row) => `<div class="key-row">${row.map((keyItem) => {
    const { index, label } = keyItem;
    const color = configuredLightingColor(index);
    const opacity = state.profile.light.effect === 255 ? 0.18 : 0.35 + brightness * 0.0065;
    return `<i class="keycap lighting-board-key" data-light-index="${index}" style="--key-width:${keyWidth(keyItem)}px;--key-u:${keyUnit(keyItem)};--key-led:${esc(color)};--key-opacity:${opacity.toFixed(2)};--key-glow:${Math.round(opacity * 45)}%" title="${esc(label)}: ${esc(color.toUpperCase())}"><span>${esc(label)}</span></i>`;
  }).join("")}</div>`).join("")}</div>`;
}

function lightStripPreview() {
  const light = state.liveLightingActive && state.liveStripLight ? state.liveStripLight : state.profile.logoLight;
  const color = light.effect === 2 || light.brightness === 0 ? "#000000" : API.normalizeHexColor(light.color, "#000000");
  const opacity = light.effect === 2 || light.brightness === 0 ? 0.15 : 0.35 + clamp(light.brightness, 0, 100) * 0.0065;
  const segments = Array.from({ length: LIVE_STRIP_SEGMENT_COUNT }, (_, index) => `<i data-strip-segment="${index}" style="--strip-color:${esc(color)}"></i>`).join("");
  return `<div class="strip-device" data-strip-lighting data-strip-effect="${Number(light.effect)}" style="--strip-color:${esc(color)};--strip-opacity:${opacity.toFixed(2)}">
    <div class="light-strip" role="img" aria-label="Light strip preview color ${esc(color.toUpperCase())}">${segments}</div>
    <span>${esc(lightingEffectName("logoLight", light.effect))} · ${light.brightness}% · ${esc(color.toUpperCase())}</span>
  </div>`;
}

function renderLighting() {
  const selectedIndex = [...state.colorSelection][0];
  const selectedColor = API.normalizeHexColor(state.profile.colorKeys[selectedIndex ?? 0], state.profile.light.color);
  const selectedNames = [...state.colorSelection].map(physicalName);
  const selectionLabel = !selectedNames.length ? "No keys selected" : selectedNames.length <= 3 ? selectedNames.join(", ") : `${selectedNames.slice(0, 2).join(", ")} + ${selectedNames.length - 2} more`;
  const liveStatus = state.liveLightingActive ? "Live from keyboard" : state.liveLightingBusy ? "Starting live view" : state.source === "device" ? "Configured preview" : "Saved configuration";
  return `<div class="lighting-control-grid">
    <section class="panel form-card main-light-card"><div class="lighting-card-heading"><div><h3>Main key lighting</h3><p>Current RGB output for all 36 keys when connected.</p></div><span class="lighting-zone-badge${state.liveLightingActive ? " live" : ""}" id="liveLightingStatus">${esc(liveStatus)}</span></div><div class="lighting-preview keyboard-lighting-preview">${lightingKeyboardPreview()}</div>${effectPicker("light", state.profile.light)}<div class="field-grid lighting-effect-fields">${lightFields("light", state.profile.light)}</div></section>
    <section class="panel form-card strip-light-card"><div class="lighting-card-heading"><div><h3>Light strip</h3><p>The small independent lighting strip on the keyboard.</p></div><span class="lighting-zone-badge${state.liveLightingActive ? " live" : ""}" id="liveStripStatus">${state.liveLightingActive ? "Live sync" : state.liveLightingBusy ? "Starting live view" : "1 zone"}</span></div><div class="lighting-preview strip-lighting-preview">${lightStripPreview()}</div>${effectPicker("logoLight", state.profile.logoLight)}<div class="field-grid lighting-effect-fields">${lightFields("logoLight", state.profile.logoLight)}</div></section>
  </div>
  <div class="section-heading lighting-section-heading"><div><h2>Per-key colors</h2><p>Configure the RGB color for each key individually. This effect is saved in the "Preset" effect above. Commit changes, then click on "Apply to keyboard"</p></div><span class="configured-badge">Configured values</span></div>
  <div class="color-toolbar panel">
    <label class="field color-picker-field"><span>Selected color</span><div class="color-input-row"><input id="perKeyColor" type="color" value="${esc(selectedColor)}" /><output id="selectedColorHex">${esc(selectedColor.toUpperCase())}</output></div></label>
    <div class="color-selection-summary"><small>Selection</small><strong>${esc(selectionLabel)}</strong></div>
    <button class="button primary" id="applyColorButton" type="button"${state.colorSelection.size ? "" : " disabled"}>Commit changes on ${state.colorSelection.size} key${state.colorSelection.size === 1 ? "" : "s"}</button>
    <button class="button secondary" id="useMainColorButton" type="button">Use main color</button>
    <button class="button secondary" id="selectAllColors" type="button">Select all 36</button>
  </div>
  <section class="panel keyboard-panel color-keyboard-panel">${keyboardHtml("color", state.colorSelection)}<div class="keyboard-legend color-legend"><span><i class="selected-color-dot"></i>Selected</span><span>Click a key to select it · Ctrl/Cmd-click for multiple keys</span><span>Colors are staged locally until you apply them to the keyboard</span></div></section>
  <div class="callout lighting-callout">The 36-key preview reads the keyboard's current RGB framebuffer while connected. The strip also stays live: its onboard effect settings are refreshed from the keyboard and animated here, while firmware-provided strip pixels are used automatically when available.</div>`;
}

function effectPicker(group, light) {
  const isLightStrip = group === "logoLight";
  const label = isLightStrip  ? "Light strip effect"  : "Main key lighting effect";
  const pickerClass = isLightStrip  ? "effect-picker-light-strip"  : "effect-picker";

  return `<div class="effect-picker-block"><h4>Effect</h4><div class="${pickerClass}" role="radiogroup" aria-label="${label}">${lightingEffects(group).map((effect) => {
    const active = effect.value === Number(light.effect);
    return `<button class="effect-option${active ? " active" : ""}" type="button" role="radio" aria-checked="${active}" data-light-effect="${group}" data-effect-value="${effect.value}" title="${esc(effect.name)}"><span class="effect-glyph" aria-hidden="true">${effect.glyph}</span><strong>${esc(effect.name)}</strong></button>`;
  }).join("")}</div></div>`;
}

function lightFields(group, light) {
  const effect = lightingEffect(group, light.effect) || lightingEffects(group)[0];
  const fields = [];
  if (effect.color) fields.push(`<label class="field"><span>Color</span><input type="color" data-light="${group}" data-light-prop="color" value="${esc(light.color)}" /></label>`);
  if (effect.brightness) {
    const brightnessOptions = [[0, "Off"], [20, "20%"], [40, "40%"], [60, "60%"], [80, "80%"], [100, "100%"]];
    const brightness = clamp(light.brightness, 0, 100);
    if (!brightnessOptions.some(([value]) => value === brightness)) brightnessOptions.push([brightness, `${brightness}% · Imported`]);
    brightnessOptions.sort((left, right) => left[0] - right[0]);
    fields.push(selectField("Brightness", `${group}-brightness`, brightnessOptions, brightness));
  }
  if (effect.speed) fields.push(selectField("Speed", `${group}-speed`, [[0, "Slowest"], [1, "Slow"], [2, "Medium"], [3, "Fast"], [4, "Fastest"]], light.speed));
  if (effect.direction) fields.push(selectField("Direction", `${group}-direction`, [[0, "Forward"], [1, "Reverse"]], light.direction));
  if (effect.palette) fields.push(`<div class="switch-row lighting-palette-switch"><div><strong>Single color</strong><small>Use the selected color instead of the effect palette</small></div><label class="switch"><input type="checkbox" data-light="${group}" data-light-prop="singleColor"${light.singleColor ? " checked" : ""} /><i></i></label></div>`);
  return fields.length ? fields.join("") : `<div class="effect-no-controls">${esc(effect.name)} has no additional controls.</div>`;
}

// ---------------------------------------------------------------------------
// Advanced, Profiles, Diagnostics, and About pages
// ---------------------------------------------------------------------------
function renderAdvanced() {
  const count = (type) => state.profile.advancedKeys.filter((item) => item.type === type).length;
  const shared = count("mt") + 2 * (count("rs") + count("socd"));
  return `<div class="advanced-cards">${Object.entries(ADVANCED_META).map(([type, meta]) => `<article class="panel action-card"><span class="action-icon">${meta.icon}</span><h3>${meta.name}</h3><p>${meta.description}</p><button class="icon-action" type="button" data-add-advanced="${type}">+ Add ${meta.name}</button></article>`).join("")}</div>
    <div class="callout advanced-scope-note"><b>Four-layer support:</b> choose the action's layer inside the editor. Actions on Fn layers only run while that layer is active; paired Hall tuning remains physical and applies across every layer.</div>
    <div class="callout">Device banks: DKS ${count("dks")}/32 · Toggle ${count("tgl")}/32 · Shared Mod-Tap/pair bank ${shared}/32 · Macros ${count("macro")}/32. Pair actions use two shared slots.</div>
    <div class="section-heading"><div><h2>Configured actions</h2><p>Actions are compiled into device banks only when you apply.</p></div></div>
    <div class="configured-list">${state.profile.advancedKeys.length ? state.profile.advancedKeys.map((item, index) => configuredAction(item, index)).join("") : `<div class="panel empty-state"><strong>No advanced actions configured</strong><p>Add one above. The host mapping and underlying bank entry will be staged together.</p></div>`}</div>`;
}

function configuredAction(item, index) {
  const meta = ADVANCED_META[item.type] || { name: item.type, icon: "?" };
  const paired = item.index2 != null ? ` + ${physicalName(item.index2)}` : "";
  const option = item.option || {};
  const detail = item.type === "macro"
    ? `${(item.actions || []).length} events`
    : item.type === "rs" || item.type === "socd"
      ? `${(Number(option.actuation || 0) / 100).toFixed(2)} mm · RT ${(Number(option.press || 0) / 100).toFixed(2)}/${(Number(option.release || option.press || 0) / 100).toFixed(2)} mm`
      : item.type === "dks" ? `${(item.dksKeys || []).length} output paths` : "Onboard action";
  return `<article class="panel configured-row"><span class="action-icon">${meta.icon}</span><div class="configured-action-copy"><strong>${esc(meta.name)}</strong><span>${esc(physicalName(item.index1))}${esc(paired)}</span><small>${esc(globalLayerLabel(state.profile.profileIndex, item.layer || 0))} · ${esc(detail)}</small></div><div class="configured-action-buttons"><button class="icon-action" type="button" data-edit-advanced="${index}">Edit</button><button class="icon-action delete" type="button" data-delete-advanced="${index}">Delete</button></div></article>`;
}

function normalizedWootingCode(value = state.wootingCode) {
  try { return API.normalizeWootingShareCode(value); } catch (_) { return ""; }
}

function profileDisclosureHtml(id, title, description, chip, content) {
  const open = Boolean(state.profileDisclosureOpen?.[id]);
  return `<details class="profile-tool-disclosure" data-profile-disclosure="${id}"${open ? " open" : ""}><summary><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="profile-disclosure-actions"><i class="chip">${esc(chip)}</i><b aria-hidden="true">⌄</b></span></summary><div class="profile-disclosure-content">${content}</div></details>`;
}

function wootingImportHtml() {
  const pending = state.wootingImport;
  const summary = pending?.summary;
  const code = normalizedWootingCode();
  const sourceUrl = code ? `${WOOTING_PROFILE_API_URL}?code=${encodeURIComponent(code)}` : "";
  const matchLabel = summary ? `${summary.matchedKeyCount}/36 HE30 keys matched` : "Fn uses Wooting's Windows-key position";
  const layoutLabel = summary ? `${summary.layoutKind === "function-row" ? "Function-row" : "Compact"} matrix` : "";
  const travelLabel = summary
    ? (summary.switchTravelDetected
      ? `${(summary.minimumSourceTravel / 100).toFixed(2)}${summary.minimumSourceTravel === summary.maximumSourceTravel ? "" : `–${(summary.maximumSourceTravel / 100).toFixed(2)}`} mm source travel`
      : "4.00 mm default source travel")
    : "";
  const content = `<div class="profile-share-grid wooting-import-grid">
      <section class="panel panel-pad share-card"><div class="share-card-heading"><div><h3>Wooting share code</h3><p>Paste the short code from Wootility. Direct lookup uses Wooting's own public profile endpoint.</p></div><button class="button secondary compact" id="loadWootingCode" type="button"${state.wootingBusy ? " disabled" : ""}>${state.wootingBusy ? "Loading…" : "Load code"}</button></div>
        <input class="share-code wooting-code-input" id="wootingCodeInput" type="text" spellcheck="false" autocomplete="off" aria-label="Wooting profile share code" placeholder="c4be8f8508212554b1992b5d83a1adf79f29" value="${esc(state.wootingCode)}" />
        <div class="share-card-footer"><small>Wooting currently restricts browser reads to wootility.io. If lookup is blocked, open its first-party JSON and paste it in the next card.</small>${sourceUrl ? `<a class="button secondary compact" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source JSON</a>` : ""}</div>
      </section>
      <section class="panel panel-pad share-card"><div class="share-card-heading"><div><h3>Wooting profile JSON</h3><p>Paste the complete response or choose a downloaded JSON file, then analyze it before staging.</p></div><button class="button secondary compact" id="analyzeWootingJson" type="button"${state.wootingBusy ? " disabled" : ""}>Analyze JSON</button></div>
        <textarea class="share-code wooting-json-input" id="wootingJsonInput" spellcheck="false" autocomplete="off" aria-label="Wooting profile JSON" placeholder='Paste {"data":{"version":…}} or the profile object…'>${esc(state.wootingJson)}</textarea>
        <input id="wootingFileInput" type="file" accept="application/json,.json" hidden />
        <div class="share-card-footer"><small>No macros, key combinations, or controller bindings are copied. Fn maps from Wooting's Windows-key position.</small><button class="button secondary compact" id="chooseWootingFile" type="button">Choose JSON file</button></div>
      </section>
    </div>
    ${state.wootingStatus ? `<div class="share-validation wooting-validation${state.wootingError ? " error" : " valid"}">${esc(state.wootingStatus)}</div>` : ""}
    ${summary ? `<section class="panel panel-pad wooting-preview"><div class="share-card-heading"><div><h3>${esc(summary.name)}</h3><p>Version ${summary.version || "unknown"} · ${summary.layerCount} layer${summary.layerCount === 1 ? "" : "s"} · ${esc(matchLabel)} · ${esc(layoutLabel)} · ${esc(travelLabel)}</p></div><button class="button primary compact" id="stageWootingImport" type="button">Stage supported settings</button></div><div class="wooting-summary-grid"><span><strong>${summary.mappingsCopied}</strong> mappings</span><span><strong>${summary.hallKeysCopied}</strong> Hall keys</span><span><strong>${summary.advancedImported}</strong> advanced actions</span><span><strong>${summary.staticLightingImported ? summary.colorsCopied : 0}</strong> Preset colors</span><span><strong>${summary.staticLightingImported ? `${summary.brightness}%` : "—"}</strong> brightness</span><span><strong>${summary.advancedSkipped}</strong> skipped actions</span></div>${summary.warnings.length ? `<ul class="wooting-warnings">${summary.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}</section>` : ""}`;
  return profileDisclosureHtml("wooting", "Import a Wooting profile", "Copy mappings, Hall tuning, advanced actions, and Static per-key lighting.", "WOOTING", content);
}

function profileShareHtml() {
  const connected = state.source === "device" && Boolean(state.driver);
  const multiProfile = connected && Boolean(state.identity?.multiProfile);
  const pending = state.shareImportProfile;
  const sourceProfile = pending ? pending.profileIndex + 1 : 0;
  const exportMeta = state.shareExportCode ? `${state.shareExportCode.length.toLocaleString()} characters · gzip + Base64URL` : "Nothing leaves this browser unless you copy the code.";
  const content = `<div class="profile-share-grid">
      <section class="panel panel-pad share-card"><div class="share-card-heading"><div><h3>Export current profile</h3><p>Includes all four layers, Hall data, advanced actions, device settings, lighting, and per-key colors.</p></div><button class="button secondary compact" id="generateShareCode" type="button"${state.shareBusy ? " disabled" : ""}>${state.shareBusy ? "Working…" : "Generate code"}</button></div>
        <textarea class="share-code" id="shareCodeOutput" readonly spellcheck="false" aria-label="Generated compressed profile code" placeholder="Generate a code for the current workspace…">${esc(state.shareExportCode)}</textarea>
        <div class="share-card-footer"><small>${esc(exportMeta)}</small><button class="button primary compact" id="copyShareCode" type="button"${!state.shareExportCode ? " disabled" : ""}>Copy code</button></div>
      </section>
      <section class="panel panel-pad share-card"><div class="share-card-heading"><div><h3>Import shared profile</h3><p>Paste a code, validate every configuration bank, then choose the onboard profile to replace.</p></div><button class="button secondary compact" id="validateShareCode" type="button"${state.shareBusy ? " disabled" : ""}>${state.shareBusy ? "Validating…" : "Validate code"}</button></div>
        <textarea class="share-code" id="shareCodeInput" spellcheck="false" autocomplete="off" aria-label="Compressed profile code to import" placeholder="Paste an HE30P1 profile code…">${esc(state.shareImportText)}</textarea>
        ${state.shareStatus ? `<div class="share-validation${state.shareError ? " error" : " valid"}">${esc(state.shareStatus)}</div>` : ""}
        ${pending ? `<div class="share-targets"><div><strong>Validated Profile ${sourceProfile}</strong><small>Choose the onboard destination. Fn targets inside layers ${(sourceProfile - 1) * API.LAYER_COUNT}–${sourceProfile * API.LAYER_COUNT - 1} will move with the profile; deliberate cross-profile Fn targets stay unchanged.</small></div><div class="share-target-grid">${Array.from({ length: API.PROFILE_COUNT }, (_, index) => `<button class="button ${index === state.profile.profileIndex ? "primary" : "secondary"}" type="button" data-share-target="${index}"${!multiProfile || state.shareBusy ? " disabled" : ""}>Replace Profile ${index + 1}${index === state.profile.profileIndex ? " · loaded" : ""}</button>`).join("")}</div>${!multiProfile ? `<div class="callout"><b>Connect the three-profile HE30</b> to write this validated code to onboard memory.</div>` : ""}</div>` : ""}
      </section>
    </div>`;
  return `${wootingImportHtml()}${profileDisclosureHtml("sharing", "Compressed profile sharing", "Export or import one complete profile as a versioned text code.", "HE30P1", content)}`;
}

function renderProfiles() {
  const multi = Boolean(state.identity?.multiProfile);
  const profileIndexes = multi ? Array.from({ length: API.PROFILE_COUNT }, (_, index) => index) : [state.profile.profileIndex];
  return `<div class="profile-grid">${profileIndexes.map((index) => `<article class="panel profile-card${index === state.profile.profileIndex ? " active" : ""}"><span class="profile-number">${index + 1}</span>${index === state.profile.profileIndex ? "<span class=\"active-label\">Active workspace</span>" : ""}<h3>Profile ${index + 1}</h3><p>${state.source === "device" ? "Stored in onboard memory." : "Profile identity recovered from this backup."}</p><button class="button ${index === state.profile.profileIndex ? "secondary" : "primary"}" type="button" data-profile="${index}" ${index === state.profile.profileIndex || state.source !== "device" ? "disabled" : ""}>${index === state.profile.profileIndex ? "Loaded" : "Switch and load"}</button></article>`).join("")}</div>
    <div class="section-heading"><div><h2>Profile portability</h2><p>Back up the complete current profile, including Hall and lighting data.</p></div></div>
    <section class="panel panel-pad"><div class="quick-list">${quickRow("⇩", "Export current backup", "Download a complete JSON copy of the current workspace", "export-profile")}${APP_MODE === "json" ? quickRow("⇧", "Import profile JSON", "Open another backup in this offline workspace", "import-profile") : quickRow("↗", "Open JSON editor", "Inspect or modify a backup without connecting a keyboard", "json-editor")}</div></section>
    ${profileShareHtml()}
    ${multi ? `<div class="callout">Profile 1 owns layers 0–3, Profile 2 owns layers 4–7, and Profile 3 owns layers 8–11. A key mapped to FN/FN1–FN11 may jump directly to any corresponding global layer.</div>` : `<div class="callout">${state.identity ? `${esc(state.identity.name)} reports a single onboard profile.` : "Connect a supported multi-profile HE30 to switch among three onboard profiles."}</div>`}`;
}

function renderDiagnostics() {
  const identity = state.identity || {};
  const rows = [["Workspace source", state.source], ["Device", identity.name || "Not connected"], ["VID:PID", identity.vidPid || "—"], ["Firmware", state.info?.firmware || "Not read"], ["Profile", state.profile.profileIndex + 1], ["WebHID", API.HE30Driver.supported() ? "Available" : "Unavailable"], ["Pending sections", [...state.dirty].join(", ") || "None"]];
  return `<div class="overview-grid"><section class="panel panel-pad"><div class="section-heading"><div><h2>Identity and state</h2><p>Read-only information about this browser session.</p></div></div><table class="identity-table">${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</table></section><aside class="panel safety-card"><span class="chip">SCOPE</span><h2>No firmware access.</h2><p>This build has no firmware image parser, bootloader device filter, updater command, or flash button.</p><ul><li>Normal-mode config devices only</li><li>Report writes require confirmation</li><li>Section read-back verification</li></ul></aside></div>
    <div class="section-heading"><div><h2>Session log</h2><p>Kept in memory and cleared when the page closes.</p></div><button class="button secondary" id="exportLogButton" type="button">Export log</button></div>
    <section class="panel panel-pad log-list">${state.logs.length ? state.logs.map((entry) => `<div class="log-row"><time>${new Date(entry.time).toLocaleTimeString()}</time><span class="log-level ${esc(entry.level)}">${esc(entry.level)}</span><span>${esc(entry.message)}</span></div>`).join("") : `<div class="empty-state"><strong>No device traffic yet</strong><p>Connect a keyboard or edit a setting to begin the session log.</p></div>`}</section>`;
}

function renderAboutMe() {
  return `<section class="panel about-me-page"><header class="about-me-guidance"><div><h2>ye ye whatever bro??? du ma cho Tung beo</h2></div></header><div class="about-me-custom">${ABOUT_ME_HTML}</div></section>`;
}

/**
 * Bind controls created by the most recent renderPage() call.
 * Permanent shell buttons are intentionally absent here; app.js binds those once
 * at startup, while these transient controls must be rebound after every render.
 */
function bindPageControls() {
  $$('[data-go-page]').forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.goPage === "export-profile") return exportProfile();
    if (button.dataset.goPage === "import-profile") return $("#fileInput")?.click();
    if (button.dataset.goPage === "json-editor") return window.location.assign("json_editor/");
    if (state.calibrationActive && button.dataset.goPage !== "hall") await stopCalibration(false);
    if (state.page === "hall" && button.dataset.goPage !== "hall") { state.hallEditPending = false; state.hallEditSelection.clear(); }
    state.page = button.dataset.goPage; renderPage();
  }));
  $$('[data-layer]').forEach((button) => button.addEventListener("click", () => { state.layer = Number(button.dataset.layer); renderPage(); }));
  $$('[data-keyboard-mode] .keycap').forEach((button) => button.addEventListener("click", (event) => {
    const mode = button.closest("[data-keyboard-mode]").dataset.keyboardMode;
    if (mode === "hall" && state.calibrationActive) return;
    if (mode !== "hall" || event.detail === 0) handleKeyClick(button, event);
  }));
  bindHallDragSelection();
  $("#liveMonitorButton")?.addEventListener("click", toggleLiveMonitor);
  $("#calibrationButton")?.addEventListener("click", toggleCalibration);
  if (state.page === "hall") scheduleLiveVisualUpdate();
  if (state.page === "lighting" && state.source === "device" && state.driver) void startLiveLighting();
  $("#selectAllKeys")?.addEventListener("click", () => { if (state.hallEditPending) return; state.hallSelection = new Set(PHYSICAL_KEYS.map((key) => key.index)); renderPage(); });
  $("#discardHallButton")?.addEventListener("click", discardHallEdit);
  $("#stageHallButton")?.addEventListener("click", stageHallSettings);
  $$('input[type="range"]').forEach((input) => input.addEventListener("input", () => updateRangeOutput(input)));
  bindDistanceInputs();
  if (state.page === "hall") { bindHallControls(); updateHallSelectionUI(); }
  ["reportRate", "tickRate", "debounce", "systemMode"].forEach((id) => $(`#${id}`)?.addEventListener("change", (event) => { state.profile.deviceSettings[id] = Number(event.target.value); markDirty("settings"); log("change", `${id} staged`); }));
  $$('[data-setting]').forEach((input) => input.addEventListener("change", () => { state.profile.deviceSettings[input.dataset.setting] = input.checked ? true : false; markDirty("settings"); log("change", `${input.dataset.setting} staged`); }));
  ["light", "logoLight"].forEach((group) => {
    ["brightness", "speed", "direction"].forEach((property) => $(`#${group}-${property}`)?.addEventListener("change", (event) => { state.profile[group][property] = Number(event.target.value); markDirty("lighting"); renderPage(); }));
  });
  $$('[data-light-effect]').forEach((button) => button.addEventListener("click", () => {
    const group = button.dataset.lightEffect;
    state.profile[group].effect = Number(button.dataset.effectValue);
    markDirty("lighting");
    log("change", `${lightingEffectName(group, state.profile[group].effect)} lighting effect staged`);
    renderPage();
  }));
  $$('[data-light]').forEach((input) => input.addEventListener("change", () => { state.profile[input.dataset.light][input.dataset.lightProp] = input.type === "checkbox" ? input.checked : input.value; markDirty("lighting"); renderPage(); }));
  $("#perKeyColor")?.addEventListener("input", (event) => previewSelectedKeyColor(event.target.value));
  $("#applyColorButton")?.addEventListener("click", () => { const color = $("#perKeyColor").value; state.colorSelection.forEach((index) => { state.profile.colorKeys[index] = color; }); markDirty("colors"); log("change", `Per-key color staged on ${state.colorSelection.size} keys`); renderPage(); });
  $("#useMainColorButton")?.addEventListener("click", () => { const input = $("#perKeyColor"); input.value = API.normalizeHexColor(state.profile.light.color); previewSelectedKeyColor(input.value); });
  $("#selectAllColors")?.addEventListener("click", () => { state.colorSelection = new Set(PHYSICAL_KEYS.map((key) => key.index)); renderPage(); });
  $$('[data-add-advanced]').forEach((button) => button.addEventListener("click", () => openAdvanced(button.dataset.addAdvanced)));
  $$('[data-edit-advanced]').forEach((button) => button.addEventListener("click", () => openAdvanced(state.profile.advancedKeys[Number(button.dataset.editAdvanced)].type, Number(button.dataset.editAdvanced))));
  $$('[data-delete-advanced]').forEach((button) => button.addEventListener("click", () => deleteAdvanced(Number(button.dataset.deleteAdvanced))));
  $$('[data-profile]').forEach((button) => button.addEventListener("click", () => promptProfileSwitch(Number(button.dataset.profile))));
  $$('[data-factory-reset]').forEach((button) => button.addEventListener("click", () => resetFromFactoryProfile(button.dataset.factoryReset)));
  $("#generateShareCode")?.addEventListener("click", generateProfileShareCode);
  $("#copyShareCode")?.addEventListener("click", copyProfileShareCode);
  $("#validateShareCode")?.addEventListener("click", validateProfileShareCode);
  $("#shareCodeInput")?.addEventListener("input", (event) => {
    state.shareImportText = event.target.value;
    state.shareImportProfile = null;
    state.shareStatus = "";
    state.shareError = false;
    $(".share-validation")?.remove();
    $(".share-targets")?.remove();
  });
  $$('[data-share-target]').forEach((button) => button.addEventListener("click", () => replaceProfileFromShare(Number(button.dataset.shareTarget))));
  $$('[data-profile-disclosure]').forEach((details) => details.addEventListener("toggle", () => {
    state.profileDisclosureOpen[details.dataset.profileDisclosure] = details.open;
  }));
  $("#loadWootingCode")?.addEventListener("click", loadWootingShareCode);
  $("#analyzeWootingJson")?.addEventListener("click", analyzeWootingJson);
  $("#chooseWootingFile")?.addEventListener("click", () => $("#wootingFileInput")?.click());
  $("#wootingFileInput")?.addEventListener("change", (event) => loadWootingJsonFile(event.target.files?.[0]));
  $("#stageWootingImport")?.addEventListener("click", stageWootingImport);
  $("#wootingCodeInput")?.addEventListener("input", (event) => {
    state.wootingCode = event.target.value;
    state.wootingImport = null;
    state.wootingStatus = "";
    state.wootingError = false;
  });
  $("#wootingJsonInput")?.addEventListener("input", (event) => {
    state.wootingJson = event.target.value;
    state.wootingImport = null;
    state.wootingStatus = "";
    state.wootingError = false;
  });
  $("#exportLogButton")?.addEventListener("click", exportLog);
}
