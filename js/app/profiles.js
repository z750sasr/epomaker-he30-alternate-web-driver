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
 * Device synchronization, profiles, imports, sharing, and factory reset.
 *
 * This is the boundary between staged browser data and persisted data. Read and
 * write operations show progress, preserve backups, and verify hardware writes
 * through the protocol driver before the UI marks a section clean.
 */

// ---------------------------------------------------------------------------
// Profile switching and live hardware synchronization
// ---------------------------------------------------------------------------
/**
 * Firmware can reconstruct an action's behavior but not every editor convenience
 * (for example original host mappings). Merge those UI-only fields back after a
 * profile reread so later deletion/restoration remains lossless.
 */
function preserveAdvancedUiMetadata(profile, stagedActions) {
  const used = new Set();
  profile.advancedKeys.forEach((decoded) => {
    const matchIndex = stagedActions.findIndex((staged, index) => !used.has(index)
      && staged.type === decoded.type
      && Number(staged.layer || 0) === Number(decoded.layer || 0)
      && Number(staged.index1) === Number(decoded.index1)
      && (decoded.index2 == null || Number(staged.index2) === Number(decoded.index2)));
    if (matchIndex < 0) return;
    used.add(matchIndex);
    const staged = stagedActions[matchIndex];
    ["baseMapping", "baseMapping2", "baseTravel1", "baseTravel2"].forEach((property) => {
      if (staged[property] != null) decoded[property] = clone(staged[property]);
    });
    if (decoded.type === "cb") decoded.modifierOrder = normalizeModifierOrder(staged.modifierOrder, decoded.modifiers);
  });
  return profile;
}

function preserveStagedProfileForSwitch(nextProfileIndex) {
  if (!state.profile || !state.dirty.size) return false;
  const snapshot = {
    savedAt: new Date().toISOString(),
    reason: `Keyboard switched to profile ${nextProfileIndex + 1}`,
    dirtySections: [...state.dirty],
    profile: state.profile,
  };
  try {
    const identity = state.identity?.vidPid || "keyboard";
    localStorage.setItem(`he30-staged-${identity}-p${state.profile.profileIndex}`, JSON.stringify(snapshot));
    log("warning", `Staged profile ${state.profile.profileIndex + 1} saved to browser recovery before switching`, { nextProfile: nextProfileIndex + 1, dirtySections: snapshot.dirtySections });
  } catch (error) {
    log("warning", "Could not save staged profile recovery before switching", error.message);
  }
  return true;
}

/**
 * The one profile-switch pipeline used by both UI buttons and hardware events.
 * It serializes reads, optionally activates the onboard profile, refreshes every
 * workspace page, and returns the visible editor to the requested local layer.
 */
async function syncDeviceProfile(profileIndex, { activate = false, layer = 0, origin = "keyboard" } = {}) {
  if (!state.driver || state.source !== "device") return;
  const target = clamp(profileIndex, 0, API.PROFILE_COUNT - 1);
  const targetLayer = clamp(layer, 0, API.LAYER_COUNT - 1);
  if (state.profileSyncBusy) {
    if (state.profileSyncTarget === target) state.profileSyncLayer = targetLayer;
    else state.queuedProfileChange = { profileIndex: target, layer: targetLayer, origin };
    return;
  }

  const driver = state.driver;
  const profileChanged = state.profile?.profileIndex !== target;
  const recoveredStagedChanges = state.profile?.profileIndex !== target && preserveStagedProfileForSwitch(target);
  const resumeLiveMonitor = state.liveMonitorActive;
  state.profileSyncBusy = true;
  state.profileSyncTarget = target;
  state.profileSyncLayer = targetLayer;
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    showProgress(`Loading profile ${target + 1}`, 5, activate ? "Switching the active onboard slot…" : "Keyboard profile changed. Refreshing its settings…");
    if (activate) await driver.setActiveProfile(target);
    const profile = await driver.readProfile(target, (percent, message) => updateProgress(10 + Math.round(percent * .9), message));
    if (driver !== state.driver || state.source !== "device") return;
    // A profile-key press is usually made from an Fn layer, so the keyboard's
    // transition report contains 1/5/9. Once the new profile is fully loaded,
    // show its base layer instead: local 0, displayed globally as 0/4/8.
    // Layer-only changes within the already loaded profile remain live.
    const activeLayer = profileChanged ? 0 : (activate ? targetLayer : (state.profileSyncTarget === target ? state.profileSyncLayer : targetLayer));
    try { localStorage.setItem(`he30-backup-${state.identity.vidPid}-p${target}`, JSON.stringify({ savedAt: new Date().toISOString(), profile })); } catch (error) { log("warning", "Browser backup storage unavailable", error.message); }
    setWorkspace(profile, "device", { identity: state.identity, info: state.info, preserveView: true, layer: activeLayer });
    log("info", `${origin === "keyboard" ? "Keyboard selected" : "Selected"} profile ${target + 1}; workspace refreshed on layer ${activeLayer}`);
    showToast(recoveredStagedChanges
      ? `Profile ${target + 1} loaded. Previous staged changes were saved to browser recovery.`
      : `Profile ${target + 1} is live. All pages now show its settings.`);
    if (resumeLiveMonitor && state.page === "hall") await startLiveMonitor();
  } catch (error) {
    log("error", "Profile synchronization failed", error.message);
    showToast(`Could not refresh profile ${target + 1}: ${error.message}`, true);
  } finally {
    state.profileSyncBusy = false;
    state.profileSyncTarget = null;
    hideProgress();
    const queued = state.queuedProfileChange;
    state.queuedProfileChange = null;
    if (queued && state.driver === driver && (state.profile?.profileIndex !== queued.profileIndex || state.layer !== queued.layer)) {
      void syncDeviceProfile(queued.profileIndex, queued);
    }
  }
}

/** Coalesce rapid Fn/profile reports while a previous profile read is in flight. */
function handleHardwareProfileChange(event) {
  if (!state.driver || state.source !== "device" || !state.profile) return;
  const profileIndex = clamp(event.profileIndex, 0, API.PROFILE_COUNT - 1);
  const layer = clamp(event.layer, 0, API.LAYER_COUNT - 1);
  if (state.profileSyncBusy) {
    if (state.profileSyncTarget === profileIndex) state.profileSyncLayer = layer;
    else state.queuedProfileChange = { profileIndex, layer, origin: "keyboard" };
    return;
  }
  if (state.profile.profileIndex === profileIndex) {
    if (state.layer !== layer) {
      state.layer = layer;
      log("event", `Keyboard changed to ${globalLayerLabel(profileIndex, layer)} on profile ${profileIndex + 1}`);
      renderPage();
    }
    return;
  }
  void syncDeviceProfile(profileIndex, { layer, origin: "keyboard" });
}

// ---------------------------------------------------------------------------
// Workspace input/output
// ---------------------------------------------------------------------------
async function connectKeyboard() {
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    state.profileChangeUnsubscribe?.();
    state.profileChangeUnsubscribe = null;
    if (state.driver) { try { await state.driver.close(); } catch (_) { /* no-op */ } state.driver = null; }
    showProgress("Connecting keyboard", 3, "Choose your compatible keyboard in the browser prompt.");
    const driver = await API.HE30Driver.request(log);
    state.driver = driver;
    state.identity = driver.identity;
    updateProgress(7, "Reading device identity and active profile…");
    const [info, profileIndex] = await Promise.all([driver.getInfo(), driver.getActiveProfile()]);
    state.info = info;
    const profile = await driver.readProfile(profileIndex, (percent, message) => updateProgress(8 + Math.round(percent * .9), message));
    try { localStorage.setItem(`he30-backup-${state.identity.vidPid}-p${profileIndex}`, JSON.stringify({ savedAt: new Date().toISOString(), profile })); } catch (error) { log("warning", "Browser backup storage unavailable", error.message); }
    setWorkspace(profile, "device", { identity: state.identity, info });
    state.profileChangeUnsubscribe = driver.subscribeProfileChange(handleHardwareProfileChange);
    log("info", `Profile ${profileIndex + 1} loaded; in-browser recovery backup created`);
    showToast(`${state.identity.name} connected. Profile ${profileIndex + 1} is ready.`);
  } catch (error) {
    log("error", "Connection failed", error.message);
    showToast(error.message, true);
    if (state.driver) { try { await state.driver.close(); } catch (_) { /* no-op */ } }
    state.driver = null;
    updateChrome();
  } finally { hideProgress(); }
}

/** Open an offline profile backup and normalize it into the same UI workspace. */
async function loadFile(file) {
  if (!file) return;
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    const source = (await file.text()).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(source);
    const profile = normalizeProfile(parsed);
    const connected = state.source === "device" && state.driver;
    if (connected) {
      const importedSections = Array.isArray(parsed._workspaceSections) ? parsed._workspaceSections.filter((section) => ["keymap", "hall", "advanced", "settings", "lighting", "colors"].includes(section)) : profile._workspaceSections;
      if (!importedSections.length) throw new Error("This file has no supported configuration sections.");
      const deviceSnapshot = clone(state.original || state.profile);
      const merged = normalizeProfile({ ...clone(state.profile), ...parsed, profileIndex: state.profile.profileIndex });
      if (!parsed._hasRawConfig && !(Array.isArray(parsed._rawConfig) && parsed._rawConfig.length >= 64)) {
        merged._rawConfig = clone(state.profile._rawConfig);
        merged._hasRawConfig = true;
      }
      setWorkspace(merged, "device", { fileName: file.name, identity: state.identity, info: state.info });
      state.original = deviceSnapshot;
      markDirty(...importedSections);
      log("warning", `Imported ${file.name} over the connected profile; staged ${importedSections.join(", ")}`);
      showToast("Backup imported and staged. Review it before applying to the keyboard.");
    } else {
      setWorkspace(profile, "file", { fileName: file.name, identity: null, info: null });
      state.driver = null; state.identity = null; state.info = null;
      log("info", `Opened local JSON file ${file.name}`);
      updateChrome(); showToast("JSON profile opened. Connect first, then reopen it to stage a hardware restore.");
    }
  } catch (error) { showToast(`Could not open JSON: ${error.message}`, true); }
  if ($("#fileInput")) $("#fileInput").value = "";
}

function exportProfile() {
  if (!state.profile) return;
  const fileName = (state.fileName || `${state.identity?.name || "HE30"}-profile-${state.profile.profileIndex + 1}.json`).replace(/\.json$/i, "") + ".json";
  download(fileName, JSON.stringify(state.profile, null, 2), "application/json");
  log("info", `Exported ${fileName}`);
  showToast("Complete profile backup exported.");
}

function exportLog() { download(`he30-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(state.logs, null, 2), "application/json"); }
function download(fileName, content, type) { const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(new Blob([content], { type })); anchor.download = fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000); }

// ---------------------------------------------------------------------------
// Wooting profile import
// ---------------------------------------------------------------------------
function wootingLookupUrl(code) {
  const base = WOOTING_PROFILE_PROXY_URL || WOOTING_PROFILE_API_URL;
  if (base.includes("{code}")) return base.replace("{code}", encodeURIComponent(code));
  const url = new URL(base, window.location.href);
  url.searchParams.set("code", code);
  return url.href;
}

/** Convert and validate without mutating the staged profile; staging is explicit. */
function prepareWootingImport(payload, sourceLabel) {
  const converted = API.convertWootingProfile(payload, state.profile);
  state.wootingImport = converted;
  state.wootingError = false;
  const lighting = converted.summary.staticLightingImported
    ? `, plus ${converted.summary.colorsCopied} Static RGB colors at ${converted.summary.brightness}% brightness`
    : "";
  state.wootingStatus = `Analyzed ${sourceLabel}: ${converted.summary.layerCount} layer${converted.summary.layerCount === 1 ? "" : "s"}, ${converted.summary.mappingsCopied} mappings, and ${converted.summary.advancedImported} advanced actions${lighting} are ready to stage.`;
  log("verify", `Analyzed Wooting profile ${converted.summary.name}`, converted.summary);
}

async function loadWootingShareCode() {
  if (state.wootingBusy) return;
  state.wootingCode = $("#wootingCodeInput")?.value || state.wootingCode;
  state.wootingImport = null;
  state.wootingError = false;
  let code;
  try { code = API.normalizeWootingShareCode(state.wootingCode); } catch (error) {
    state.wootingStatus = error.message;
    state.wootingError = true;
    renderPage();
    return;
  }
  state.wootingCode = code;
  state.wootingBusy = true;
  state.wootingStatus = "Reading the shared profile from Wooting…";
  renderPage();
  try {
    const response = await fetch(wootingLookupUrl(code), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Wooting returned HTTP ${response.status}.`);
    prepareWootingImport(await response.json(), `code ${code}`);
  } catch (error) {
    state.wootingImport = null;
    state.wootingError = true;
    state.wootingStatus = WOOTING_PROFILE_PROXY_URL
      ? `The configured Wooting profile endpoint failed: ${error.message}`
      : "Wooting blocks this GitHub Pages origin from reading the response. Click Open source JSON, copy the complete first-party response, and analyze it in the JSON box.";
    log("warning", "Wooting share-code lookup was unavailable", error.message);
  } finally {
    state.wootingBusy = false;
    renderPage();
  }
}

function analyzeWootingJson() {
  state.wootingJson = $("#wootingJsonInput")?.value || state.wootingJson;
  state.wootingImport = null;
  if (!state.wootingJson.trim()) {
    state.wootingStatus = "Paste a Wooting profile JSON response or choose a JSON file first.";
    state.wootingError = true;
    renderPage();
    return;
  }
  try {
    prepareWootingImport(JSON.parse(state.wootingJson.replace(/^\uFEFF/, "")), "pasted JSON");
  } catch (error) {
    state.wootingImport = null;
    state.wootingStatus = `Could not analyze the Wooting profile: ${error.message}`;
    state.wootingError = true;
    log("warning", "Rejected Wooting profile JSON", error.message);
  }
  renderPage();
}

async function loadWootingJsonFile(file) {
  if (!file) return;
  try {
    state.wootingJson = (await file.text()).replace(/^\uFEFF/, "");
    prepareWootingImport(JSON.parse(state.wootingJson), file.name);
  } catch (error) {
    state.wootingImport = null;
    state.wootingStatus = `Could not analyze ${file.name}: ${error.message}`;
    state.wootingError = true;
    log("warning", "Rejected Wooting profile file", error.message);
  }
  renderPage();
}

function stageWootingImport() {
  if (!state.wootingImport || !state.profile) return;
  const { profile, summary } = state.wootingImport;
  state.profile = normalizeProfile(profile);
  state.layer = 0;
  state.wootingImport = null;
  const lighting = summary.staticLightingImported ? `, and Preset lighting with ${summary.colorsCopied} colors at ${summary.brightness}% brightness` : "";
  state.wootingStatus = `Staged ${summary.name}: ${summary.mappingsCopied} mappings across ${summary.layerCount} layer${summary.layerCount === 1 ? "" : "s"}, Hall tuning on ${summary.hallKeysCopied} keys, ${summary.advancedImported} advanced actions${lighting}.`;
  state.wootingError = false;
  markDirty(...summary.sections);
  log("change", `Staged supported Wooting settings from ${summary.name}`, summary);
  renderPage();
  showToast(`Wooting settings staged. Review Key mapping, Hall effect, Advanced functions${summary.staticLightingImported ? ", and Preset Config lighting" : ""} before applying.`);
}

// ---------------------------------------------------------------------------
// Compressed HE30 profile sharing
// ---------------------------------------------------------------------------
async function generateProfileShareCode() {
  if (!state.profile || state.shareBusy) return;
  state.shareBusy = true;
  renderPage();
  try {
    state.shareExportCode = await API.encodeProfileShare(state.profile);
    log("info", `Generated compressed share code for Profile ${state.profile.profileIndex + 1}`);
    showToast(`Profile code generated (${state.shareExportCode.length.toLocaleString()} characters).`);
  } catch (error) {
    log("error", "Could not generate profile share code", error.message);
    showToast(`Could not generate profile code: ${error.message}`, true);
  } finally {
    state.shareBusy = false;
    renderPage();
  }
}

async function copyProfileShareCode() {
  if (!state.shareExportCode) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.shareExportCode);
    else {
      const output = $("#shareCodeOutput");
      output.focus(); output.select();
      if (!document.execCommand("copy")) throw new Error("Clipboard access was denied.");
    }
    showToast("Compressed profile code copied.");
  } catch (error) { showToast(`Could not copy automatically: ${error.message}`, true); }
}

async function validateProfileShareCode() {
  if (state.shareBusy) return;
  state.shareImportText = $("#shareCodeInput")?.value || state.shareImportText;
  state.shareImportProfile = null;
  state.shareError = false;
  if (!state.shareImportText.trim()) {
    state.shareStatus = "Paste an HE30P1 profile code first.";
    state.shareError = true;
    renderPage();
    return;
  }
  state.shareBusy = true;
  state.shareStatus = "Validating compressed profile data…";
  renderPage();
  try {
    const decoded = await API.decodeProfileShare(state.shareImportText);
    state.shareImportProfile = normalizeProfile(decoded);
    state.shareStatus = `Valid Profile ${state.shareImportProfile.profileIndex + 1} code. All six configuration sections passed validation.`;
    state.shareError = false;
    log("verify", `Validated compressed Profile ${state.shareImportProfile.profileIndex + 1} share code`);
  } catch (error) {
    state.shareImportProfile = null;
    state.shareStatus = error.message;
    state.shareError = true;
    log("warning", "Rejected profile share code", error.message);
  } finally {
    state.shareBusy = false;
    renderPage();
  }
}

/** Retarget self-referencing Fn layers when copying a share into another profile. */
async function replaceProfileFromShare(targetProfileIndex) {
  if (state.shareBusy || !state.shareImportProfile || !state.driver || state.source !== "device" || !state.identity?.multiProfile) return;
  const target = clamp(targetProfileIndex, 0, API.PROFILE_COUNT - 1);
  const source = state.shareImportProfile.profileIndex;
  const stagedWarning = target === state.profile.profileIndex && state.dirty.size ? " Any staged changes in the loaded profile will be discarded." : "";
  const confirmation = `Replace onboard Profile ${target + 1} with the validated shared Profile ${source + 1}?\n\nAll mappings, Hall settings, advanced actions/macros, device settings, lighting, and per-key colors will be written and verified. Fn targets inside the source profile's four-layer range will be translated to Profile ${target + 1}; deliberate cross-profile targets will remain unchanged.${stagedWarning}`;
  if (!window.confirm(confirmation)) return;

  const driver = state.driver;
  const replacement = normalizeProfile(API.retargetSharedProfile(state.shareImportProfile, target));
  state.shareBusy = true;
  renderPage();
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    showProgress(`Replacing Profile ${target + 1}`, 0, "Writing the validated shared profile…");
    const verified = await driver.writeProfile(replacement, PROFILE_SHARE_SECTIONS, updateProgress);
    if (driver !== state.driver || state.source !== "device") throw new Error("The keyboard connection changed during profile replacement.");
    if (target === state.profile.profileIndex) {
      setWorkspace(verified, "device", { identity: state.identity, info: state.info, preserveView: true, layer: 0 });
    } else {
      state.shareImportText = "";
      state.shareImportProfile = null;
      state.shareStatus = "";
      state.shareError = false;
    }
    log("verify", `Shared profile written and verified on Profile ${target + 1}`);
    showToast(`Profile ${target + 1} was replaced and verified.`);
  } catch (error) {
    log("error", "Shared profile replacement stopped", error.message);
    showToast(`Profile replacement stopped: ${error.message}`, true);
  } finally {
    state.shareBusy = false;
    hideProgress();
    if (state.profile) renderPage();
    updateChrome();
  }
}

// ---------------------------------------------------------------------------
// Safe factory reset using the bundled, user-maintained template
// ---------------------------------------------------------------------------
/** Fail closed if a factory JSON update does not contain every required bank. */
function validateFactoryProfileTemplate(profile) {
  if (!profile || typeof profile !== "object") throw new Error("The bundled factory profile is not a JSON object.");
  for (let layer = 0; layer < API.LAYER_COUNT; layer += 1) {
    const mappings = profile.userKeys?.[layer] || profile.userKeys?.[String(layer)];
    if (!Array.isArray(mappings) || mappings.length < API.KEY_COUNT) throw new Error(`Factory layer ${layer} must contain ${API.KEY_COUNT} mappings.`);
    mappings.forEach((mapping, index) => {
      if (!mapping || !["type", "code1", "code2"].every((field) => Number.isFinite(Number(mapping[field])))) {
        throw new Error(`Factory layer ${layer}, key ${index + 1} has an invalid mapping.`);
      }
      if (Number(mapping.type) === 240 && Number(mapping.code1) === 255) {
        const fnTarget = Number(mapping.code2);
        if (!Number.isInteger(fnTarget) || fnTarget < 0 || fnTarget >= API.LAYER_COUNT) {
          throw new Error(`Factory layer ${layer}, key ${index + 1} targets FN${fnTarget}, outside Profile 1's four-layer template.`);
        }
      }
    });
  }
  if (!Array.isArray(profile.travelKeys) || profile.travelKeys.length < API.KEY_COUNT) throw new Error(`The factory profile must contain ${API.KEY_COUNT} Hall records.`);
  if (!Array.isArray(profile.advancedKeys)) throw new Error("The factory advanced-action list is missing.");
  if (!profile.light || !profile.logoLight) throw new Error("The factory lighting presets are missing.");
  return profile;
}

async function loadFactoryProfileTemplate() {
  const response = await fetch(FACTORY_PROFILE_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load the bundled factory profile (HTTP ${response.status}).`);
  return validateFactoryProfileTemplate(await response.json());
}

function prepareFactoryProfile(template, targetProfileIndex, existingProfile) {
  const target = clamp(targetProfileIndex, 0, API.PROFILE_COUNT - 1);
  const prepared = clone(template);
  prepared.profileIndex = target;
  prepared.name = `HE30 Factory Profile ${target + 1}`;
  prepared.userKeys = {};
  for (let layer = 0; layer < API.LAYER_COUNT; layer += 1) {
    const sourceMappings = template.userKeys?.[layer] || template.userKeys?.[String(layer)];
    prepared.userKeys[layer] = sourceMappings.map((sourceMapping) => {
      const mapping = { ...sourceMapping, type: Number(sourceMapping.type), code1: Number(sourceMapping.code1), code2: Number(sourceMapping.code2), profile: target, layer };
      if (mapping.type === 240 && mapping.code1 === 255) mapping.code2 = API.translateFactoryFnLayer(mapping.code2, target);
      mapping.name = API.mappingName(mapping.type, mapping.code1, mapping.code2);
      if (mapping.name === "Unassigned") mapping.name = "";
      return mapping;
    });
  }
  prepared.deviceSettings = clone(existingProfile.deviceSettings);
  prepared._rawConfig = clone(existingProfile._rawConfig);
  prepared._hasRawConfig = true;
  prepared.colorKeys = clone(existingProfile.colorKeys);
  prepared._workspaceSections = [...FACTORY_RESET_SECTIONS];
  return normalizeProfile(prepared);
}

/** Stage factory values only; the normal Apply confirmation still controls writes. */
async function resetFromFactoryProfile(scope) {
  if (state.factoryResetBusy || !state.driver || state.source !== "device") return;
  const resetAll = scope === "all";
  if (!resetAll && scope !== "current") return;
  const currentProfileIndex = state.profile.profileIndex;
  const targets = resetAll ? Array.from({ length: API.PROFILE_COUNT }, (_, index) => index) : [currentProfileIndex];
  const targetLabel = resetAll ? "all three onboard profiles" : `onboard Profile ${currentProfileIndex + 1}`;
  const confirmation = `Restore ${targetLabel} from the bundled factory configuration?\n\nThis overwrites mappings, Hall settings, advanced actions/macros, and lighting presets. Device-performance settings and per-key RGB colors stay unchanged. Any staged changes in the affected profile${resetAll ? "s" : ""} will be discarded.`;
  if (!window.confirm(confirmation)) return;

  const driver = state.driver;
  const verifiedProfiles = new Map();
  let completed = 0;
  state.factoryResetBusy = true;
  renderPage();
  try {
    if (state.calibrationActive || state.calibrationBusy) await stopCalibration(false);
    if (state.liveMonitorActive) await stopLiveMonitor(false);
    if (state.liveLightingActive || state.liveLightingBusy) await stopLiveLighting();
    showProgress(resetAll ? "Resetting all profiles" : `Resetting Profile ${currentProfileIndex + 1}`, 1, "Validating the bundled factory configuration…");
    const template = await loadFactoryProfileTemplate();
    const share = 100 / targets.length;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex];
      const base = targetIndex * share;
      const existing = await driver.readProfile(target, (percent, message) => updateProgress(Math.round(base + percent * share * 0.2), `Profile ${target + 1}: ${message}`));
      if (driver !== state.driver || state.source !== "device") throw new Error("The keyboard connection changed during the reset.");
      const factoryProfile = prepareFactoryProfile(template, target, existing);
      const verified = await driver.writeProfile(factoryProfile, FACTORY_RESET_SECTIONS, (percent, message) => updateProgress(Math.round(base + share * 0.2 + percent * share * 0.8), `Profile ${target + 1}: ${message}`));
      verifiedProfiles.set(target, verified);
      completed += 1;
      log("verify", `Factory configuration written and verified on Profile ${target + 1}`);
    }
    const restoredCurrent = verifiedProfiles.get(currentProfileIndex) || await driver.readProfile(currentProfileIndex);
    setWorkspace(restoredCurrent, "device", { identity: state.identity, info: state.info, preserveView: true, layer: 0 });
    updateProgress(100, "Factory configuration restored and verified.");
    showToast(resetAll ? "All three profiles were restored and verified." : `Profile ${currentProfileIndex + 1} was restored and verified.`);
  } catch (error) {
    if (verifiedProfiles.has(currentProfileIndex)) {
      setWorkspace(verifiedProfiles.get(currentProfileIndex), "device", { identity: state.identity, info: state.info, preserveView: true, layer: 0 });
    }
    const partial = completed ? ` ${completed} profile${completed === 1 ? " was" : "s were"} already restored and verified.` : "";
    log("error", "Factory reset stopped", error.message);
    showToast(`Factory reset stopped: ${error.message}${partial}`, true);
  } finally {
    state.factoryResetBusy = false;
    hideProgress();
    if (state.profile) renderPage();
    updateChrome();
    if (state.page === "lighting" && state.driver && state.source === "device") void startLiveLighting();
  }
}
