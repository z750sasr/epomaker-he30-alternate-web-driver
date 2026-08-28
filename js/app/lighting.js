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
 * Live lighting preview.
 *
 * Saved lighting settings live in the staged profile. When a keyboard is
 * connected this module polls only the 36-key RGB framebuffer. The light strip
 * has no proven live-pixel report, so it stays an explicitly configured preview.
 */

// ---------------------------------------------------------------------------
// Color math and light-strip effect simulation
// ---------------------------------------------------------------------------
// These helpers operate on CSS hex colors only; firmware byte conversion remains
// in the protocol codecs so presentation code never needs to know bank layout.
function blendLightingColor(fromColor, toColor, amount) {
  const from = API.normalizeHexColor(fromColor, "#000000").slice(1);
  const to = API.normalizeHexColor(toColor, "#000000").slice(1);
  const fromChannels = [0, 2, 4].map((offset) => Number.parseInt(from.slice(offset, offset + 2), 16));
  const toChannels = [0, 2, 4].map((offset) => Number.parseInt(to.slice(offset, offset + 2), 16));
  const channels = fromChannels.map((channel, index) => {
    const difference = toChannels[index] - channel;
    return Math.abs(difference) <= 2 ? toChannels[index] : Math.round(channel + difference * amount);
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function scaleLightingColor(color, amount) {
  const normalized = API.normalizeHexColor(color, "#000000").slice(1);
  const scale = uiClamp(amount, 0, 1);
  return `#${[0, 2, 4].map((offset) => Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * scale).toString(16).padStart(2, "0")).join("")}`;
}

function spectrumLightingColor(hue, value) {
  const normalizedHue = ((Number(hue) % 360) + 360) % 360;
  const chroma = uiClamp(value, 0, 1);
  const sector = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] = sector < 1 ? [chroma, secondary, 0]
    : sector < 2 ? [secondary, chroma, 0]
      : sector < 3 ? [0, chroma, secondary]
        : sector < 4 ? [0, secondary, chroma]
          : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return `#${[red, green, blue].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Produce one visual frame for firmware effects without writing any LEDs. */
function stripFrameColors(light, timestamp) {
  const effect = Number(light?.effect);
  const brightness = uiClamp(light?.brightness, 0, 100) / 100;
  const baseColor = API.normalizeHexColor(light?.color, "#000000");
  if (effect === 2 || brightness === 0) return new Array(LIGHT_STRIP_PREVIEW_SEGMENT_COUNT).fill("#000000");
  const speed = uiClamp(light?.speed, 0, 4);
  const time = Number(timestamp) || 0;
  if (effect === 0) {
    const rotation = (time / Math.max(3000, 9000 - speed * 1200)) * 360;
    return Array.from({ length: LIGHT_STRIP_PREVIEW_SEGMENT_COUNT }, (_, index) => spectrumLightingColor(rotation + (index * 360 / LIGHT_STRIP_PREVIEW_SEGMENT_COUNT), brightness));
  }
  if (effect === 1) {
    const phase = (time / Math.max(700, 1700 - speed * 220)) * Math.PI * 2;
    return Array.from({ length: LIGHT_STRIP_PREVIEW_SEGMENT_COUNT }, (_, index) => scaleLightingColor(baseColor, brightness * (0.12 + 0.88 * ((Math.sin(phase - index * 0.7) + 1) / 2))));
  }
  if (effect === 4) {
    const phase = (time / Math.max(1400, 3200 - speed * 400)) * Math.PI * 2;
    const pulse = 0.1 + 0.9 * ((Math.sin(phase - Math.PI / 2) + 1) / 2);
    return new Array(LIGHT_STRIP_PREVIEW_SEGMENT_COUNT).fill(scaleLightingColor(baseColor, brightness * pulse));
  }
  return new Array(LIGHT_STRIP_PREVIEW_SEGMENT_COUNT).fill(scaleLightingColor(baseColor, brightness));
}

function updateLightStripPreview(timestamp) {
  const device = $("[data-strip-lighting]");
  if (!device) return false;
  const light = state.profile.logoLight;
  const colors = stripFrameColors(light, timestamp);
  const segments = $$('[data-strip-segment]', device);
  colors.forEach((color, index) => segments[index]?.style.setProperty("--strip-color", color));
  const representative = colors[Math.floor(colors.length / 2)] || "#000000";
  device.style.setProperty("--strip-color", representative);
  device.style.setProperty("--strip-opacity", "1");
  device.dataset.stripEffect = String(Number(light.effect));
  const strip = $(".light-strip", device);
  if (strip) {
    strip.setAttribute("aria-label", `${lightingEffectName("logoLight", light.effect)} configured light strip preview`);
    strip.title = `${lightingEffectName("logoLight", light.effect)} · ${light.brightness}% · Configured preview`;
  }
  const label = $("span", device);
  if (label) label.textContent = `${lightingEffectName("logoLight", light.effect)} · ${light.brightness}% · Preview`;
  return [0, 1, 4].includes(Number(light.effect)) && Number(light.brightness) > 0;
}

// ---------------------------------------------------------------------------
// Browser animation loop
// ---------------------------------------------------------------------------
// Polling supplies relatively sparse HID samples. The animation loop blends
// toward the latest sample so key colors move smoothly without extra HID traffic.
function cancelLiveLightingAnimation({ clearDisplay = false } = {}) {
  if (state.liveLightingFrame) cancelAnimationFrame(state.liveLightingFrame);
  state.liveLightingFrame = 0;
  state.liveLightingFrameTime = 0;
  if (clearDisplay) state.liveLightingDisplayColors.fill(null);
}

function animateLiveLighting(timestamp) {
  state.liveLightingFrame = 0;
  if (!state.liveLightingActive || state.page !== "lighting") return;
  const elapsed = state.liveLightingFrameTime ? Math.min(50, Math.max(1, timestamp - state.liveLightingFrameTime)) : 16;
  const blend = 1 - Math.exp(-elapsed / LIVE_LIGHTING_SMOOTHING_MS);
  let moving = false;
  PHYSICAL_KEYS.forEach(({ index }) => {
    const target = state.liveLightingColors[index];
    if (!target) return;
    const current = state.liveLightingDisplayColors[index] || target;
    const next = blendLightingColor(current, target, blend);
    state.liveLightingDisplayColors[index] = next;
    if (next !== target) moving = true;
  });
  state.liveLightingFrameTime = timestamp;
  const stripMoving = updateLightStripPreview(timestamp);
  if (moving || stripMoving) state.liveLightingFrame = requestAnimationFrame(animateLiveLighting);
  else state.liveLightingFrameTime = 0;
}

function scheduleLiveLightingAnimation() {
  if (!state.liveLightingFrame && state.liveLightingActive && state.page === "lighting") {
    state.liveLightingFrame = requestAnimationFrame(animateLiveLighting);
  }
}

function updateLiveLightingUI(timestamp = performance.now()) {
  const status = $("#liveLightingStatus");
  if (status) {
    status.textContent = state.liveLightingError ? "Live view retrying" : state.liveLightingActive ? "Live from keyboard" : state.liveLightingBusy ? "Starting live view" : "Configured preview";
    status.classList.toggle("live", state.liveLightingActive && !state.liveLightingError);
  }
  if (!state.liveLightingActive) return updateLightStripPreview(timestamp);
  PHYSICAL_KEYS.forEach(({ index, label }) => {
    const color = state.liveLightingDisplayColors[index] || state.liveLightingColors[index];
    if (!color) return;
    const key = $(`[data-lighting-board] [data-light-index="${index}"]`);
    if (!key) return;
    key.style.setProperty("--key-led", color);
    key.style.setProperty("--key-opacity", "1");
    key.style.setProperty("--key-glow", "45%");
    key.title = `${label} live color: ${color.toUpperCase()}`;
  });
  return updateLightStripPreview(timestamp);
}

// ---------------------------------------------------------------------------
// Connected-keyboard polling lifecycle
// ---------------------------------------------------------------------------
/**
 * Read the volatile 36-key framebuffer. The strip has no known live-pixel
 * report, so the page deliberately does not infer physical strip colors.
 * `generation` invalidates an older async loop after the user stops/restarts it.
 */
async function pollLiveLighting(generation) {
  if (generation !== state.liveLightingGeneration || !state.liveLightingActive || !state.driver || state.page !== "lighting") return;
  try {
    const colors = await state.driver.readLiveColors();
    if (generation !== state.liveLightingGeneration || state.page !== "lighting") return;
    state.liveLightingColors = colors.map((color) => API.normalizeHexColor(color, "#000000"));
    state.liveLightingUpdatedAt = Date.now();
    state.liveLightingError = "";
    scheduleLiveLightingAnimation();
  } catch (error) {
    if (generation !== state.liveLightingGeneration) return;
    if (!state.liveLightingError) log("warning", "Live RGB frame read failed; retrying", error.message);
    state.liveLightingError = error.message;
    updateLiveLightingUI();
  }
  if (generation !== state.liveLightingGeneration || !state.liveLightingActive) return;
  const delay = [0, 3, 255].includes(state.profile?.light?.effect) ? 500 : 50;
  state.liveLightingTimer = window.setTimeout(() => void pollLiveLighting(generation), state.liveLightingError ? 1200 : delay);
}

async function startLiveLighting() {
  if (!state.driver || state.source !== "device" || state.page !== "lighting" || state.liveLightingActive || state.liveLightingBusy) return;
  if (state.calibrationActive || state.calibrationBusy) return;
  const driver = state.driver;
  const generation = ++state.liveLightingGeneration;
  cancelLiveLightingAnimation({ clearDisplay: true });
  PHYSICAL_KEYS.forEach(({ index }) => { state.liveLightingDisplayColors[index] = configuredLightingColor(index); });
  state.liveLightingColors.fill(null);
  state.liveLightingBusy = true;
  state.liveLightingError = "";
  updateLiveLightingUI();
  try {
    await driver.startLiveTelemetry(state.profile.profileIndex);
    if (generation !== state.liveLightingGeneration || driver !== state.driver || state.page !== "lighting") {
      await driver.stopLiveTelemetry();
      return;
    }
    state.liveLightingActive = true;
    state.liveLightingBusy = false;
    log("info", "Live RGB framebuffer started", { command: "0xDE", keys: PHYSICAL_KEYS.length });
    updateLiveLightingUI();
    await pollLiveLighting(generation);
  } catch (error) {
    if (generation !== state.liveLightingGeneration) return;
    try { await driver.stopLiveTelemetry(); } catch (_) { /* no-op */ }
    state.liveLightingActive = false;
    state.liveLightingBusy = false;
    state.liveLightingError = error.message;
    log("warning", "Live RGB framebuffer could not start", error.message);
    updateLiveLightingUI();
  }
}

/** Stop telemetry/polling and return the page to its staged-config preview. */
async function stopLiveLighting() {
  if (!state.liveLightingActive && !state.liveLightingBusy) return;
  ++state.liveLightingGeneration;
  if (state.liveLightingTimer) window.clearTimeout(state.liveLightingTimer);
  state.liveLightingTimer = 0;
  cancelLiveLightingAnimation({ clearDisplay: true });
  state.liveLightingActive = false;
  state.liveLightingBusy = false;
  state.liveLightingError = "";
  state.liveLightingColors.fill(null);
  updateLiveLightingUI();
  if (state.driver) {
    try { await state.driver.stopLiveTelemetry(); }
    catch (error) { log("warning", "Live RGB diagnostic flag restoration failed", error.message); }
  }
}

// Manual color edits update the staged preview immediately; the bank is not
// written until the normal Apply and verify workflow runs.
function previewSelectedKeyColor(value) {
  const color = API.normalizeHexColor(value, "#000000");
  const colorLabel = color.toUpperCase();
  const output = $("#selectedColorHex");
  if (output) output.textContent = colorLabel;
  state.colorSelection.forEach((index) => {
    const keycap = $(`[data-keyboard-mode="color"] [data-key-index="${index}"]`);
    if (keycap) {
      keycap.style.setProperty("--key-led", color);
      keycap.title = `${physicalName(index)} preview color: ${colorLabel}`;
      const swatch = $(".key-color-value i", keycap);
      if (swatch) swatch.style.setProperty("--swatch", color);
      const label = $(".key-color-value", keycap);
      if (label?.lastChild) label.lastChild.textContent = colorLabel;
    }
    if (!state.liveLightingActive && !state.profile.light.singleColor && state.profile.light.effect !== 255 && state.profile.light.brightness !== 0) {
      const previewKey = $(`[data-lighting-board] [data-light-index="${index}"]`);
      if (previewKey) {
        previewKey.style.setProperty("--key-led", color);
        previewKey.title = `${physicalName(index)} preview: ${colorLabel}`;
      }
    }
  });
}

// Per-key color selection mirrors the Hall editor's box gesture. The selection
// stays local to the workspace; colors are still changed only by Commit.
function bindColorDragSelection() {
  const grid = $('[data-keyboard-mode="color"]');
  if (!grid) return;
  const finish = (event, cancelled = false) => {
    const drag = state.colorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.colorDrag = null;
    try { if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    grid.classList.remove("drag-selecting");
    drag.box.remove();
    if (cancelled) {
      state.colorSelection = new Set(drag.initialSelection);
    } else if (!drag.moved && drag.startIndex != null) {
      state.colorSelection = selectionAfterColorBox(drag, new Set([drag.startIndex]));
    } else if (!state.colorSelection.size) {
      state.colorSelection = new Set(drag.initialSelection);
    }
    renderPage();
  };
  grid.addEventListener("pointerdown", (event) => {
    if (state.colorDrag) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const keycap = event.target.closest(".keycap[data-key-index]");
    event.preventDefault();
    const box = document.createElement("i");
    box.className = "color-selection-box";
    box.setAttribute("aria-hidden", "true");
    box.hidden = true;
    grid.append(box);
    state.colorDrag = {
      pointerId: event.pointerId,
      startIndex: keycap && grid.contains(keycap) ? Number(keycap.dataset.keyIndex) : null,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false,
      toggle: event.ctrlKey || event.metaKey,
      initialSelection: new Set(state.colorSelection),
      box,
    };
    grid.classList.add("drag-selecting");
    try { grid.setPointerCapture(event.pointerId); } catch (_) { /* no-op */ }
  });
  grid.addEventListener("pointermove", (event) => {
    const drag = state.colorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.currentX = event.clientX;
    drag.currentY = event.clientY;
    drag.moved ||= Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) >= 4;
    if (!drag.moved) return;
    updateColorSelectionBox(grid, drag);
  });
  grid.addEventListener("pointerup", finish);
  grid.addEventListener("pointercancel", (event) => finish(event, true));
  grid.addEventListener("lostpointercapture", (event) => { if (state.colorDrag?.pointerId === event.pointerId) finish(event); });
}

function selectionAfterColorBox(drag, boxedIndexes) {
  if (!drag.toggle) return new Set(boxedIndexes);
  const selected = new Set(drag.initialSelection);
  boxedIndexes.forEach((index) => {
    if (selected.has(index)) selected.delete(index); else selected.add(index);
  });
  return selected;
}

function updateColorSelectionBox(grid, drag) {
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
  state.colorSelection = selectionAfterColorBox(drag, boxedIndexes);
  $$('[data-keyboard-mode="color"] .keycap').forEach((button) => {
    const selected = state.colorSelection.has(Number(button.dataset.keyIndex));
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
