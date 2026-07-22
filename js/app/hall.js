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
 * Hall-effect tuning, live travel telemetry, and switch calibration.
 *
 * The normal editor modifies state.profile.travelKeys. Live monitoring and
 * calibration are the exceptions: they temporarily talk to the connected
 * keyboard and always restore temporary firmware flags when stopped.
 */

// ---------------------------------------------------------------------------
// Coupled range + numeric distance controls
// ---------------------------------------------------------------------------
// Firmware stores distances as hundredths of a millimeter. Range controls keep
// integers; the neighboring number inputs present friendly decimal millimeters.
function updateRangeOutput(input) {
  if (!input) return;
  const divisor = Number(input.dataset.distanceDivisor) || 100;
  const decimals = Number(input.dataset.distanceDecimals ?? 2);
  const millimeters = Number(input.value) / divisor;
  const number = input.parentElement?.querySelector(`[data-range-for="${input.id}"]`);
  if (number) number.value = millimeters.toFixed(Math.max(2, decimals));
  const output = input.parentElement?.querySelector("output");
  if (output) output.textContent = `${millimeters.toFixed(decimals)} mm`;
}

function setDistanceFromNumber(number, normalize = false) {
  const range = $(`#${number?.dataset.rangeFor}`);
  if (!range || number.value === "") return;
  const divisor = Number(range.dataset.distanceDivisor) || 100;
  const minimum = Number(number.min) || 0.01;
  const maximum = Number(number.max) || 4;
  const millimeters = clamp(Number(number.value), minimum, maximum);
  range.value = clamp(Math.round(millimeters * divisor), Number(range.min), Number(range.max));
  if (normalize) updateRangeOutput(range);
}

function nudgeDistanceControl(control, direction) {
  const range = control.matches('input[type="range"]') ? control : $(`#${control.dataset.rangeFor}`);
  if (!range) return;
  const number = range.parentElement?.querySelector(`[data-range-for="${range.id}"]`);
  const divisor = Number(range.dataset.distanceDivisor) || 100;
  const current = Number(range.value) / divisor;
  const minimum = number ? Number(number.min) : Number(range.min) / divisor;
  const maximum = number ? Number(number.max) : Number(range.max) / divisor;
  range.value = clamp(Math.round(clamp(current + direction * 0.01, minimum, maximum) * divisor), Number(range.min), Number(range.max));
  updateRangeOutput(range);
  range.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Couple each range with its editable number field. data-* binding flags prevent
 * duplicate listeners when a modal refreshes only part of its contents.
 */
function bindDistanceInputs(root = document) {
  $$('[data-range-for]', root).forEach((number) => {
    if (number.dataset.distanceBound) return;
    number.dataset.distanceBound = "true";
    number.addEventListener("input", () => setDistanceFromNumber(number));
    number.addEventListener("change", () => setDistanceFromNumber(number, true));
    number.addEventListener("blur", () => setDistanceFromNumber(number, true));
    number.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      nudgeDistanceControl(number, event.key === "ArrowRight" ? 1 : -1);
    });
  });
  $$('.range-line.editable input[type="range"]', root).forEach((range) => {
    if (range.dataset.distanceKeyBound) return;
    range.dataset.distanceKeyBound = "true";
    range.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    nudgeDistanceControl(range, event.key === "ArrowRight" ? 1 : -1);
    });
  });
}

function configureRtInput(input, precision, value = input?.value) {
  if (!input) return;
  const meta = rtPrecisionMeta(precision);
  input.dataset.distanceDivisor = meta.divisor;
  input.dataset.distanceDecimals = meta.decimals;
  input.max = Math.min(511, Math.max(Math.round(4 * meta.divisor), Number(value) || 1));
  input.value = clamp(value, 1, Number(input.max));
  const number = input.parentElement?.querySelector(`[data-range-for="${input.id}"]`);
  if (number) {
    number.min = Math.max(0.01, 1 / meta.divisor).toFixed(2);
    number.max = (Number(input.max) / meta.divisor).toFixed(2);
    number.step = "0.01";
  }
  const note = input.closest(".field")?.querySelector("small");
  if (note) note.textContent = `${meta.step} per step`;
  updateRangeOutput(input);
}

function setHallFieldDisabled(input, disabled) {
  if (!input) return;
  input.disabled = Boolean(disabled);
  const number = input.parentElement?.querySelector(`[data-range-for="${input.id}"]`);
  if (number) number.disabled = Boolean(disabled);
  input.closest(".field")?.classList.toggle("disabled", Boolean(disabled));
}

function copyHallPressToRelease() {
  const press = $("#hallPress");
  const release = $("#hallRelease");
  if (!press || !release) return;
  const pressPrecision = $("#hallPressPrecision");
  const releasePrecision = $("#hallReleasePrecision");
  if (pressPrecision && releasePrecision) releasePrecision.value = pressPrecision.value;
  configureRtInput(release, pressPrecision?.value ?? 0, press.value);
}

// ---------------------------------------------------------------------------
// Hall form state and precision handling
// ---------------------------------------------------------------------------
function syncHallControlAvailability() {
  const rapid = Boolean($("#hallRapidTrigger")?.checked);
  const independent = rapid && Boolean($("#hallIndependentRt")?.checked);
  const insurance = Boolean($("#hallInsurance")?.checked);
  const fullTravel = $("#hallFullTravel");
  const independentSwitch = $("#hallIndependentRt");
  if (fullTravel) fullTravel.disabled = !rapid;
  if (independentSwitch) independentSwitch.disabled = !rapid;
  setHallFieldDisabled($("#hallPress"), !rapid);
  setHallFieldDisabled($("#hallRelease"), !independent);
  setHallFieldDisabled($("#hallPressPrecision"), !rapid);
  setHallFieldDisabled($("#hallReleasePrecision"), !independent);
  setHallFieldDisabled($("#hallPressDeadzone"), !insurance);
  setHallFieldDisabled($("#hallReleaseDeadzone"), !insurance);
}

function changeHallPrecision(kind) {
  const precision = $(`#hall${kind}Precision`);
  const input = $(`#hall${kind}`);
  if (!precision || !input) return;
  const oldDivisor = Number(input.dataset.distanceDivisor) || 100;
  const millimeters = Number(input.value) / oldDivisor;
  const next = rtPrecisionMeta(precision.value);
  configureRtInput(input, precision.value, Math.round(millimeters * next.divisor));
  if (kind === "Press" && !$("#hallIndependentRt")?.checked) copyHallPressToRelease();
}

/** Freeze the current selection for a staged multi-key edit. */
function beginHallEdit() {
  if (state.hallEditPending || !state.hallSelection.size || state.calibrationActive) return;
  state.hallEditPending = true;
  state.hallEditSelection = new Set(state.hallSelection);
  updateHallSelectionUI();
}

function setHallWorkspaceView(view) {
  if (!["tuning", "switches"].includes(view)) return;
  state.hallWorkspaceView = view;
  const switchPaneActive = view === "switches";
  $$('[data-hall-workspace]').forEach((button) => {
    const active = button.dataset.hallWorkspace === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-hall-workspace-pane]').forEach((pane) => { pane.hidden = pane.dataset.hallWorkspacePane !== view; });
  const title = $("#hallWorkspaceTitle");
  if (title) title.textContent = switchPaneActive ? "Switch selector" : "Selected-key tuning";
  const status = $("#hallEditStatus");
  if (status && !state.hallEditPending && !state.calibrationActive) status.textContent = switchPaneActive
    ? "Assign the installed switch model to the currently selected keys, or open the comparison."
    : "Change a setting to prepare it for the currently selected keys.";
}

function bindHallControls() {
  $$('[data-hall-workspace]').forEach((button) => button.addEventListener("click", () => setHallWorkspaceView(button.dataset.hallWorkspace)));
  const tuning = $("#hallTuningGrid");
  tuning?.addEventListener("input", beginHallEdit);
  tuning?.addEventListener("change", beginHallEdit);
  $("#hallRapidTrigger")?.addEventListener("change", (event) => {
    if (!event.target.checked && $("#hallFullTravel")) $("#hallFullTravel").checked = false;
    syncHallControlAvailability();
  });
  $("#hallIndependentRt")?.addEventListener("change", (event) => {
    if (!event.target.checked) copyHallPressToRelease();
    syncHallControlAvailability();
  });
  $("#hallInsurance")?.addEventListener("change", (event) => {
    [$("#hallPressDeadzone"), $("#hallReleaseDeadzone")].forEach((input) => {
      if (!input) return;
      input.value = event.target.checked ? (Number(input.value) || 10) : 0;
      updateRangeOutput(input);
    });
    syncHallControlAvailability();
  });
  $("#hallPress")?.addEventListener("input", () => { if (!$("#hallIndependentRt")?.checked) copyHallPressToRelease(); });
  $("#hallPressPrecision")?.addEventListener("change", () => changeHallPrecision("Press"));
  $("#hallReleasePrecision")?.addEventListener("change", () => changeHallPrecision("Release"));
  $$('[data-rt-sensitivity-preset]').forEach((button) => button.addEventListener("click", () => {
    const millimeters = Number(button.dataset.rtSensitivityPreset);
    const press = $("#hallPress");
    const release = $("#hallRelease");
    if (!press || !release || !Number.isFinite(millimeters)) return;
    press.value = Math.round(millimeters * (Number(press.dataset.distanceDivisor) || 100));
    updateRangeOutput(press);
    if ($("#hallIndependentRt")?.checked) {
      release.value = Math.round(millimeters * (Number(release.dataset.distanceDivisor) || 100));
      updateRangeOutput(release);
    } else {
      copyHallPressToRelease();
    }
    press.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  syncHallControlAvailability();
}

// ---------------------------------------------------------------------------
// Pointer/mouse/touch box selection
// ---------------------------------------------------------------------------
// Pointer capture keeps receiving move/up events even if the pointer leaves the
// keyboard during a drag. A small movement threshold separates drag from click.
function bindHallDragSelection() {
  const grid = $('[data-keyboard-mode="hall"]');
  if (!grid || state.calibrationActive) return;
  const finish = (event, cancelled = false) => {
    const drag = state.hallDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.hallDrag = null;
    try { if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    grid.classList.remove("drag-selecting");
    drag.box.remove();
    if (cancelled) {
      state.hallSelection = new Set(drag.initialSelection);
    } else if (!drag.moved && drag.startIndex != null) {
      const clickedSelection = selectionAfterHallBox(drag, new Set([drag.startIndex]));
      state.hallSelection = clickedSelection.size ? clickedSelection : new Set(drag.initialSelection);
    } else if (!state.hallSelection.size) {
      state.hallSelection = new Set(drag.initialSelection);
    }
    if (!drag.initialSelection.size && state.hallSelection.size) return renderPage();
    updateHallSelectionUI();
    syncHallFormToSelection();
  };
  grid.addEventListener("pointerdown", (event) => {
    if (state.hallDrag || state.hallEditPending) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const keycap = event.target.closest(".keycap[data-key-index]");
    event.preventDefault();
    const box = document.createElement("i");
    box.className = "hall-selection-box";
    box.setAttribute("aria-hidden", "true");
    box.hidden = true;
    grid.append(box);
    state.hallDrag = {
      pointerId: event.pointerId,
      startIndex: keycap && grid.contains(keycap) ? Number(keycap.dataset.keyIndex) : null,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false,
      toggle: event.ctrlKey || event.metaKey,
      initialSelection: new Set(state.hallSelection),
      box,
    };
    grid.classList.add("drag-selecting");
    try { grid.setPointerCapture(event.pointerId); } catch (_) { /* no-op */ }
  });
  grid.addEventListener("pointermove", (event) => {
    const drag = state.hallDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.currentX = event.clientX;
    drag.currentY = event.clientY;
    drag.moved ||= Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) >= 4;
    if (!drag.moved) return;
    updateHallSelectionBox(grid, drag);
  });
  grid.addEventListener("pointerup", finish);
  grid.addEventListener("pointercancel", (event) => finish(event, true));
  grid.addEventListener("lostpointercapture", (event) => { if (state.hallDrag?.pointerId === event.pointerId) finish(event); });
}

function selectionAfterHallBox(drag, boxedIndexes) {
  if (!drag.toggle) return new Set(boxedIndexes);
  const selected = new Set(drag.initialSelection);
  boxedIndexes.forEach((index) => {
    if (selected.has(index)) selected.delete(index); else selected.add(index);
  });
  return selected;
}

function updateHallSelectionBox(grid, drag) {
  const gridRect = grid.getBoundingClientRect();
  const left = Math.min(drag.startX, drag.currentX);
  const top = Math.min(drag.startY, drag.currentY);
  const right = Math.max(drag.startX, drag.currentX);
  const bottom = Math.max(drag.startY, drag.currentY);
  drag.box.hidden = false;
  Object.assign(drag.box.style, {
    left: `${left - gridRect.left}px`,
    top: `${top - gridRect.top}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
  const boxedIndexes = new Set();
  $$('.keycap[data-key-index]', grid).forEach((button) => {
    const keyRect = button.getBoundingClientRect();
    if (keyRect.right >= left && keyRect.left <= right && keyRect.bottom >= top && keyRect.top <= bottom) {
      boxedIndexes.add(Number(button.dataset.keyIndex));
    }
  });
  state.hallSelection = selectionAfterHallBox(drag, boxedIndexes);
  updateHallSelectionUI();
}

function updateHallSelectionUI() {
  const locked = state.hallEditPending;
  const targetCount = locked ? state.hallEditSelection.size : state.hallSelection.size;
  const grid = $('[data-keyboard-mode="hall"]');
  grid?.classList.toggle("hall-selection-locked", locked);
  $$('[data-keyboard-mode="hall"] .keycap').forEach((button) => {
    const selected = state.hallSelection.has(Number(button.dataset.keyIndex));
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-disabled", String(locked || state.calibrationActive));
  });
  const count = $("#hallSelectionCount");
  const plural = $("#hallSelectionPlural");
  const instruction = $("#hallSelectionInstruction");
  const editStatus = $("#hallEditStatus");
  const stage = $("#stageHallButton");
  if (count) count.textContent = state.hallSelection.size;
  if (plural) plural.textContent = state.hallSelection.size === 1 ? "" : "s";
  if (instruction) instruction.textContent = locked ? "Commit or discard these edits before choosing different keys" : "Hold and drag a box around keys, or Ctrl/Cmd-click to toggle";
  if (editStatus && locked) editStatus.textContent = `Pending edits are locked to ${targetCount} selected key${targetCount === 1 ? "" : "s"}. Commit them or discard this edit batch.`;
  const selectAll = $("#selectAllKeys");
  if (selectAll && !state.calibrationActive) selectAll.disabled = locked;
  const discard = $("#discardHallButton");
  if (discard) discard.disabled = state.calibrationActive || !locked;
  if (stage) {
    stage.disabled = state.calibrationActive || !locked;
    stage.classList.toggle("pending", locked);
    stage.textContent = locked ? `Commit changes on ${targetCount} selected key${targetCount === 1 ? "" : "s"}` : "No changes to stage";
  }
}

/** Copy the first selected key's Hall values into the shared tuning form. */
function syncHallFormToSelection() {
  if (state.hallEditPending || !state.hallSelection.size) return;
  const travel = state.profile.travelKeys[[...state.hallSelection][0]];
  const values = { hallSwitchType: travel.switch_type, hallActuation: travel.key_actuation, hallPress: travel.rt_press, hallRelease: travel.rt_release, hallPressPrecision: travel.pressPrecision, hallReleasePrecision: travel.releasePrecision, hallPressDeadzone: travel.press_deadzone, hallReleaseDeadzone: travel.release_deadzone };
  Object.entries(values).forEach(([id, value]) => {
    const input = $(`#${id}`);
    if (!input) return;
    input.value = value;
    updateRangeOutput(input);
  });
  configureRtInput($("#hallPress"), travel.pressPrecision, travel.rt_press);
  configureRtInput($("#hallRelease"), travel.releasePrecision, travel.rt_release);
  if ($("#hallRapidTrigger")) $("#hallRapidTrigger").checked = Number(travel.key_mode) > 0;
  if ($("#hallFullTravel")) $("#hallFullTravel").checked = Number(travel.key_mode) === 2;
  if ($("#hallIndependentRt")) $("#hallIndependentRt").checked = Number(travel.rt_press) !== Number(travel.rt_release) || Number(travel.pressPrecision) !== Number(travel.releasePrecision);
  if ($("#hallInsurance")) $("#hallInsurance").checked = Number(travel.press_deadzone) > 0 && Number(travel.release_deadzone) > 0;
  if ($("#hallTriggerBottom")) $("#hallTriggerBottom").checked = Boolean(state.profile.deviceSettings.stabilityMode);
  syncHallControlAvailability();
}

function telemetryDivisor(index) {
  const mode = Number(state.profile.travelKeys[index]?.pressPrecision) || 0;
  return mode === 2 ? 1000 : mode === 1 ? 200 : 100;
}

// ---------------------------------------------------------------------------
// Live press-distance monitoring
// ---------------------------------------------------------------------------
// HID input reports may arrive faster than the screen should repaint. Handlers
// store the newest values; requestAnimationFrame performs one visual update.
function handleLiveTelemetry(event) {
  const index = TELEMETRY_INDEX.get(event.keyCode);
  if (index == null) return;
  const maxDistance = switchTravelMaximum(state.profile.travelKeys[index]);
  const distance = clamp(event.rawTravel / telemetryDivisor(index), 0, maxDistance);
  state.liveTravelRaw[index] = event.rawTravel;
  state.liveTravel[index] = distance;
  state.liveTravelStatus[index] = event.status;
  state.liveLastIndex = index;
  scheduleLiveVisualUpdate();
}

function scheduleLiveVisualUpdate() {
  if (state.liveFrame) return;
  state.liveFrame = requestAnimationFrame(() => {
    state.liveFrame = 0;
    updateLiveVisual();
  });
}

function updateLiveVisual() {
  if (state.page !== "hall" || !state.profile) return;
  const index = state.liveLastIndex ?? 0;
  const travel = state.profile.travelKeys[index] || defaultTravel();
  const distance = state.liveTravel[index] || 0;
  const maxDistance = switchTravelMaximum(travel);
  const travelPercent = clamp((distance / maxDistance) * 100, 0, 100);
  const actuation = clamp((Number(travel.key_actuation) || 1) / 100, 0, maxDistance);
  const actuationPercent = clamp((actuation / maxDistance) * 100, 0, 100);
  const mapped = API.compileAdvanced(state.profile).userKeys[state.layer][index];
  const status = distance < .01 ? "Released" : distance >= actuation ? "Actuated" : "Pre-travel";
  const monitor = $("#liveMonitor");
  if (monitor) {
    monitor.style.setProperty("--live-travel", `${travelPercent.toFixed(2)}%`);
    monitor.style.setProperty("--live-actuation", `${actuationPercent.toFixed(2)}%`);
    monitor.style.setProperty("--live-offset", `${(travelPercent * .44).toFixed(2)}px`);
    monitor.classList.toggle("pressed", distance >= .01);
    monitor.classList.toggle("actuated", distance >= actuation);
  }
  const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  text("#liveKeyName", physicalName(index));
  text("#liveMappedName", `Mapped to ${mappingLabel(mapped)}`);
  const distanceElement = $("#liveDistance");
  if (distanceElement) distanceElement.innerHTML = `${distance.toFixed(2)} <small>mm</small>`;
  text("#liveState", status);
  text("#liveKeycapLabel", physicalName(index));
  text("#liveTravelPercent", `${travelPercent.toFixed(0)}%`);
  text("#liveActuationValue", `${actuation.toFixed(2)} mm`);
  text("#liveMode", rapidTriggerModeName(travel.key_mode));
  text("#liveScaleMaximum", `${maxDistance.toFixed(2)} mm`);
  $$('[data-keyboard-mode="hall"] .keycap').forEach((button) => {
    const keyIndex = Number(button.dataset.keyIndex);
    const keyTravel = state.profile.travelKeys[keyIndex] || defaultTravel();
    const percent = clamp((state.liveTravel[keyIndex] / switchTravelMaximum(keyTravel)) * 100, 0, 100);
    button.style.setProperty("--travel-pct", `${percent.toFixed(2)}%`);
    button.classList.toggle("live-pressed", percent > .5);
  });
}

async function toggleLiveMonitor() {
  if (state.liveMonitorBusy) return;
  if (state.liveMonitorActive) await stopLiveMonitor(true);
  else await startLiveMonitor();
}

/** Temporarily enable firmware Dynamic Display reports for the active profile. */
async function startLiveMonitor() {
  if (!state.driver || state.source !== "device") return showToast("Connect the keyboard to view live Hall travel.", true);
  if (state.calibrationActive || state.calibrationBusy) return showToast("Stop switch calibration before starting the live Hall monitor.", true);
  state.liveMonitorBusy = true;
  renderPage();
  try {
    state.liveTelemetryUnsubscribe?.();
    state.liveTelemetryUnsubscribe = state.driver.subscribeTelemetry(handleLiveTelemetry);
    await state.driver.startLiveTelemetry(state.profile.profileIndex);
    state.liveMonitorActive = true;
    log("info", "Live Hall distance monitor started");
    showToast("Live Hall monitor started. Press any key to see its travel.");
  } catch (error) {
    try { await state.driver.stopLiveTelemetry(); } catch (_) { /* no-op */ }
    state.liveTelemetryUnsubscribe?.();
    state.liveTelemetryUnsubscribe = null;
    state.liveMonitorActive = false;
    log("error", "Live Hall monitor could not start", error.message);
    showToast(`Live monitor could not start: ${error.message}`, true);
  } finally {
    state.liveMonitorBusy = false;
    if (state.page === "hall") renderPage();
  }
}

/** Stop reports and let the driver restore the previous Dynamic Display flag. */
async function stopLiveMonitor(render = true) {
  if (!state.driver && !state.liveMonitorActive) return;
  state.liveMonitorBusy = true;
  if (render && state.page === "hall") renderPage();
  try {
    if (state.driver) await state.driver.stopLiveTelemetry();
    log("info", "Live Hall distance monitor stopped");
  } catch (error) {
    log("warning", "Live Hall monitor restoration failed", error.message);
    showToast(`Monitor stopped, but the diagnostic flag could not be restored: ${error.message}`, true);
  } finally {
    state.liveTelemetryUnsubscribe?.();
    state.liveTelemetryUnsubscribe = null;
    state.liveMonitorActive = false;
    state.liveMonitorBusy = false;
    state.liveTravel.fill(0);
    state.liveTravelRaw.fill(0);
    state.liveTravelStatus.fill(0);
    if (render && state.page === "hall") renderPage();
  }
}

// ---------------------------------------------------------------------------
// Switch calibration session
// ---------------------------------------------------------------------------
function calibrationStatusClass(status) {
  if (status === 255) return "calibration-complete";
  if (status === 0) return "calibration-waiting";
  return status == null ? "" : "calibration-progress";
}

function calibrationCompletedCount() {
  return PHYSICAL_KEYS.filter(({ index }) => state.calibrationStatus[index] === 255).length;
}

function handleCalibrationTelemetry(event) {
  const index = TELEMETRY_INDEX.get(event.keyCode);
  if (index == null) return;
  const completedBefore = calibrationCompletedCount();
  state.calibrationStatus[index] = event.status;
  state.calibrationTravelRaw[index] = event.rawTravel;
  state.calibrationLastIndex = index;
  const button = $(`[data-keyboard-mode="hall"] .keycap[data-key-index="${index}"]`);
  if (button) {
    button.classList.remove("calibration-waiting", "calibration-progress", "calibration-complete");
    const statusClass = calibrationStatusClass(event.status);
    if (statusClass) button.classList.add(statusClass);
    button.style.setProperty("--calibration-pct", `${clamp((event.rawTravel / 340) * 100, 0, 100).toFixed(2)}%`);
  }
  const completed = calibrationCompletedCount();
  const completedElement = $("#calibrationCompleted");
  if (completedElement) completedElement.textContent = `${completed} / ${PHYSICAL_KEYS.length}`;
  const progress = $("#calibrationProgressFill");
  if (progress) progress.style.width = `${((completed / PHYSICAL_KEYS.length) * 100).toFixed(2)}%`;
  const current = $("#calibrationLastKey");
  if (current) current.textContent = physicalName(index);
  if (completed === PHYSICAL_KEYS.length && completedBefore !== completed) showToast("All 36 switches report calibration complete. Stop calibration to exit safely.");
}

async function toggleCalibration() {
  if (state.calibrationBusy) return;
  if (state.calibrationActive) await stopCalibration(true);
  else await startCalibration();
}

/**
 * Serialize calibration startup so rapid clicks cannot create overlapping HID
 * operations. Calibration and normal live monitoring are mutually exclusive.
 */
function startCalibration() {
  if (!state.driver || state.source !== "device") return showToast("Connect the keyboard before starting calibration.", true);
  if (state.calibrationOperationPromise) return state.calibrationOperationPromise;
  state.calibrationBusy = true;
  if (state.page === "hall") renderPage();
  let operation;
  operation = (async () => {
    try {
      if (state.liveMonitorActive || state.liveMonitorBusy) await stopLiveMonitor(false);
      if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
      state.calibrationUnsubscribe?.();
      state.calibrationUnsubscribe = state.driver.subscribeCalibration(handleCalibrationTelemetry);
      state.calibrationStatus.fill(null);
      state.calibrationTravelRaw.fill(0);
      PHYSICAL_KEYS.forEach(({ index }) => { state.calibrationStatus[index] = 0; });
      state.calibrationLastIndex = null;
      await state.driver.startCalibration();
      state.calibrationActive = true;
      log("info", "Switch calibration mode started");
      showToast("Calibration started. Press every key fully, one at a time.");
    } catch (error) {
      state.calibrationUnsubscribe?.();
      state.calibrationUnsubscribe = null;
      state.calibrationActive = false;
      log("error", "Switch calibration could not start", error.message);
      showToast(`Calibration could not start: ${error.message}`, true);
    } finally {
      if (state.calibrationOperationPromise === operation) state.calibrationOperationPromise = null;
      state.calibrationBusy = false;
      if (state.page === "hall") renderPage();
    }
  })();
  state.calibrationOperationPromise = operation;
  return operation;
}

async function stopCalibration(render = true) {
  if (state.calibrationOperationPromise) {
    try { await state.calibrationOperationPromise; } catch (_) { /* start failure is reported by startCalibration */ }
  }
  if (!state.driver || !state.calibrationActive) return;
  state.calibrationBusy = true;
  if (render && state.page === "hall") renderPage();
  const completed = calibrationCompletedCount();
  try {
    if (state.driver) await state.driver.endCalibration();
    log("info", `Switch calibration stopped with ${completed}/${PHYSICAL_KEYS.length} keys complete`);
    showToast(`Calibration stopped. ${completed} of ${PHYSICAL_KEYS.length} keys completed.`);
  } catch (error) {
    log("warning", "Switch calibration stop command failed", error.message);
    showToast(`Calibration ended locally, but the keyboard did not confirm: ${error.message}`, true);
  } finally {
    state.calibrationUnsubscribe?.();
    state.calibrationUnsubscribe = null;
    state.calibrationActive = false;
    state.calibrationBusy = false;
    if (render && state.page === "hall") renderPage();
  }
}
