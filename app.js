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
 * Application bootstrap and permanent DOM bindings.
 *
 * All other application scripts define behavior; this final script starts the
 * app and binds controls that exist for the entire lifetime of the document.
 */

// ---------------------------------------------------------------------------
// Commit, rollback, and profile-switch commands
// ---------------------------------------------------------------------------
// Until this confirmation succeeds, every edit elsewhere in the app is only a
// staged JavaScript object change and can be discarded safely.
function openApplyConfirmation() {
  $("#confirmList").innerHTML = [...state.dirty].map((section) => `<span>${esc(({ keymap: "Key mappings (all four layers)", hall: "Hall-effect travel settings", settings: "Polling, tick, debounce, locks, and modes", lighting: "Main-key and light-strip lighting", colors: "Per-key color bank", advanced: "Advanced action banks and their host mappings" })[section] || section)}</span>`).join("");
  $("#confirmBackupCheck").checked = false;
  $("#confirmApplyButton").disabled = true;
  $("#confirmDialog").showModal();
}

/** Write only dirty banks, let the driver verify them, then reread the profile. */
async function applyToKeyboard(event) {
  event.preventDefault();
  $("#confirmDialog").close();
  if (!state.driver || state.source !== "device" || !state.dirty.size) return;
  const dirty = [...state.dirty];
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    showProgress("Writing staged changes", 0, "Do not disconnect the keyboard.");
    const stagedAdvanced = clone(state.profile.advancedKeys);
    const verified = await state.driver.writeProfile(state.profile, dirty, updateProgress);
    state.profile = preserveAdvancedUiMetadata(normalizeProfile(verified), stagedAdvanced);
    state.original = clone(state.profile);
    state.dirty.clear();
    log("verify", `Applied and verified: ${dirty.join(", ")}`);
    renderPage();
    showToast("All staged changes were written and verified.");
  } catch (error) {
    log("error", "Write or verification failed", error.message);
    showToast(`Write stopped: ${error.message}`, true);
  } finally {
    hideProgress(); updateChrome();
    if (state.page === "lighting" && state.driver && state.source === "device") void startLiveLighting();
  }
}

/** Replace staged state with the snapshot captured by setWorkspace(). */
function revertStaged() {
  if (!state.original || !state.dirty.size) return;
  state.profile = clone(state.original);
  state.dirty.clear();
  log("info", "All staged changes reverted locally");
  renderPage(); showToast("Staged changes reverted. Nothing was written.");
}

function promptProfileSwitch(profileIndex) {
  state.pendingProfile = profileIndex;
  $("#switchProfileTitle").textContent = `Switch to profile ${profileIndex + 1}?`;
  $("#switchProfileDialog").showModal();
}

async function switchProfile(event) {
  event.preventDefault();
  $("#switchProfileDialog").close();
  if (!state.driver || state.pendingProfile == null) return;
  const profileIndex = state.pendingProfile;
  state.pendingProfile = null;
  await syncDeviceProfile(profileIndex, { activate: true, layer: 0, origin: "interface" });
}

// ---------------------------------------------------------------------------
// Session teardown
// ---------------------------------------------------------------------------
/**
 * Stop every live operation, unsubscribe device events, clear sensitive workspace
 * data, and return to the connection screen. Disconnect and Home share this path.
 */
async function resetToLanding({ closeDevice = false, stopMonitor = true, message = "" } = {}) {
  if (state.liveFrame) cancelAnimationFrame(state.liveFrame);
  state.liveFrame = 0;
  if (stopMonitor && (state.calibrationActive || state.calibrationBusy) && state.driver) {
    try { await stopCalibration(false); } catch (_) { /* the device may already be gone */ }
  }
  if (stopMonitor && state.liveMonitorActive && state.driver) {
    try { await stopLiveMonitor(false); } catch (_) { /* the device may already be gone */ }
  }
  if (stopMonitor && (state.liveLightingActive || state.liveLightingBusy) && state.driver) {
    try { await stopLiveLighting(); } catch (_) { /* the device may already be gone */ }
  }
  state.liveTelemetryUnsubscribe?.();
  state.liveTelemetryUnsubscribe = null;
  state.calibrationUnsubscribe?.();
  state.calibrationUnsubscribe = null;
  state.profileChangeUnsubscribe?.();
  state.profileChangeUnsubscribe = null;
  state.liveMonitorActive = false;
  state.liveMonitorBusy = false;
  state.calibrationActive = false;
  state.calibrationBusy = false;
  state.calibrationOperationPromise = null;
  state.liveLightingActive = false;
  state.liveLightingBusy = false;
  state.liveLightingGeneration += 1;
  if (state.liveLightingTimer) window.clearTimeout(state.liveLightingTimer);
  state.liveLightingTimer = 0;
  cancelLiveLightingAnimation({ clearDisplay: true });
  state.liveLightingColors.fill(null);
  state.liveStripLight = null;
  state.liveStripUpdatedAt = 0;
  state.liveStripError = "";
  state.liveStripFramebufferDetected = false;
  if (closeDevice && state.driver) {
    try { await state.driver.close(); } catch (_) { /* no-op */ }
  }
  state.driver = null;
  state.identity = null;
  state.info = null;
  state.profile = null;
  state.original = null;
  state.fileName = "";
  state.source = "none";
  state.dirty.clear();
  state.pendingProfile = null;
  state.profileSyncBusy = false;
  state.profileSyncTarget = null;
  state.queuedProfileChange = null;
  state.liveTravel.fill(0);
  state.liveTravelRaw.fill(0);
  state.liveTravelStatus.fill(0);
  state.calibrationStatus.fill(null);
  state.calibrationTravelRaw.fill(0);
  state.calibrationLastIndex = null;
  $("#workspaceView")?.classList.add("hidden");
  $("#welcomeView")?.classList.remove("hidden");
  updateChrome();
  if (message) showToast(message, true);
}

async function returnHome() {
  if (state.profile && state.dirty.size && !window.confirm("Discard the staged workspace and return home? Nothing has been written.")) return;
  await resetToLanding({ closeDevice: true });
}

// ---------------------------------------------------------------------------
// One-time application bootstrap
// ---------------------------------------------------------------------------
// Unlike bindPageControls(), these elements are part of index.html and survive
// every page render, so their listeners are attached exactly once.
function bindStaticControls() {
  $("#connectButton")?.addEventListener("click", connectKeyboard);
  $("#welcomeConnectButton")?.addEventListener("click", connectKeyboard);
  $("#openFileButton")?.addEventListener("click", () => $("#fileInput")?.click());
  $("#welcomeFileButton")?.addEventListener("click", () => $("#fileInput")?.click());
  $("#fileInput")?.addEventListener("change", (event) => loadFile(event.target.files[0]));
  $("#demoButton")?.addEventListener("click", async () => {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    state.profileChangeUnsubscribe?.();
    state.profileChangeUnsubscribe = null;
    if (state.driver) { try { await state.driver.close(); } catch (_) { /* no-op */ } }
    state.driver = null; state.identity = null; state.info = null;
    setWorkspace(makeDemoProfile(), "demo", { identity: null, info: null });
    log("info", "Demo workspace opened");
  });
  $("#homeButton")?.addEventListener("click", returnHome);
  $("#sideNav")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    if (state.page === "hall" && button.dataset.page !== "hall" && (state.calibrationActive || state.calibrationBusy)) await stopCalibration(false);
    if (state.page === "hall" && button.dataset.page !== "hall" && state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.page === "hall" && button.dataset.page !== "hall") { state.hallEditPending = false; state.hallEditSelection.clear(); }
    if (state.page === "lighting" && button.dataset.page !== "lighting" && (state.liveLightingActive || state.liveLightingBusy)) await stopLiveLighting();
    state.page = button.dataset.page;
    renderPage();
  });
  $("#exportButton")?.addEventListener("click", exportProfile);
  $("#revertButton")?.addEventListener("click", revertStaged);
  $("#applyButton")?.addEventListener("click", openApplyConfirmation);
  $("#confirmBackupCheck")?.addEventListener("change", (event) => { $("#confirmApplyButton").disabled = !event.target.checked; });
  $("#confirmApplyButton")?.addEventListener("click", applyToKeyboard);
  $("#confirmSwitchButton")?.addEventListener("click", switchProfile);
  $("#mappingSearch")?.addEventListener("input", (event) => renderMappingGroups(event.target.value));
  $("#clearMappingButton")?.addEventListener("click", clearMapping);
  $("#mappingDialog")?.addEventListener("close", () => { state.mappingPickerTarget = null; state.mappingPickerScope = "all"; });
  $("#saveAdvancedButton")?.addEventListener("click", saveAdvanced);
  document.addEventListener("keydown", (event) => {
    if (state.source !== "device" || !state.driver) return;
    const target = event.target;
    const isTyping = target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable || (target instanceof HTMLInputElement && ["text", "search", "number", "color"].includes(target.type));
    if (isTyping) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  if (navigator.hid) navigator.hid.addEventListener("disconnect", (event) => {
    if (state.driver?.device !== event.device) return;
    log("warning", "Keyboard disconnected");
    void resetToLanding({ stopMonitor: false, message: "Keyboard disconnected. Returned to the connection screen." });
  });
  window.addEventListener("beforeunload", () => {
    if (state.calibrationActive && state.driver) void state.driver.endCalibration();
    else if ((state.liveMonitorActive || state.liveLightingActive) && state.driver) void state.driver.stopLiveTelemetry();
  });
}

// Start only after every preceding application module has loaded.
renderMiniKeyboard();
bindStaticControls();
if (APP_MODE === "live" && !API.HE30Driver.supported()) {
  if ($("#welcomeConnectButton")) $("#welcomeConnectButton").title = "WebHID requires Chrome or Edge on an HTTPS page";
  log("warning", "WebHID is unavailable in this browser");
}
