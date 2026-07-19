(function () {
  "use strict";

  const API = window.HE30Control;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const APP_MODE = document.body.dataset.appMode || "live";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  const HE30_LAYOUT = Object.freeze([
    [{ index: 0, label: "Esc" }, { index: 30, label: "F1" }, { index: 31, label: "F2" }, { index: 32, label: "F3" }, { index: 33, label: "F4" }, { index: 34, label: "F5" }, { index: 35, label: "F6" }],
    [{ index: 29, label: "`" }, { index: 1, label: "1" }, { index: 2, label: "2" }, { index: 3, label: "3" }, { index: 4, label: "4" }, { index: 5, label: "5" }, { index: 6, label: "6" }],
    [{ index: 7, label: "Tab" }, { index: 8, label: "Q" }, { index: 9, label: "W" }, { index: 10, label: "E" }, { index: 11, label: "R" }, { index: 12, label: "T" }],
    [{ index: 13, label: "Caps" }, { index: 14, label: "A" }, { index: 15, label: "S" }, { index: 16, label: "D" }, { index: 17, label: "F" }, { index: 18, label: "G" }],
    [{ index: 19, label: "Shift" }, { index: 20, label: "Z" }, { index: 21, label: "X" }, { index: 22, label: "C" }, { index: 23, label: "V" }, { index: 24, label: "B" }],
    [{ index: 25, label: "Ctrl" }, { index: 26, label: "Fn" }, { index: 27, label: "Alt" }, { index: 28, label: "Space" }],
  ]);
  const PHYSICAL_KEYS = HE30_LAYOUT.flat();
  const physicalName = (index) => PHYSICAL_KEYS.find((key) => key.index === Number(index))?.label || `Key ${Number(index) + 1}`;
  const PHYSICAL_HID_CODES = Object.freeze({ 0: 41, 30: 58, 31: 59, 32: 60, 33: 61, 34: 62, 35: 63, 29: 53, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 43, 8: 20, 9: 26, 10: 8, 11: 21, 12: 23, 13: 57, 14: 4, 15: 22, 16: 7, 17: 9, 18: 10, 19: 225, 20: 29, 21: 27, 22: 6, 23: 25, 24: 5, 25: 224, 26: 255, 27: 226, 28: 44 });
  const TELEMETRY_INDEX = new Map(Object.entries(PHYSICAL_HID_CODES).map(([index, code]) => [code, Number(index)]));

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((name, index) => [name, 16, 0, index + 4, name]);
  const digits = [["1", 30], ["2", 31], ["3", 32], ["4", 33], ["5", 34], ["6", 35], ["7", 36], ["8", 37], ["9", 38], ["0", 39]].map(([name, code]) => [name, 16, 0, code, name]);
  const functionKeys = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    const code = number <= 12 ? number + 57 : number + 91;
    return [`F${number}`, 16, 0, code, `F${number}`];
  });
  const key = (name, type, code1, code2, short = name) => ({ name, type, code1, code2, short });
  const MAPPING_GROUPS = Object.freeze([
    { title: "Basic characters", items: [...letters, ...digits, ["Space", 16, 0, 44, "Space"], ["Enter", 16, 0, 40, "Enter"], ["Tab", 16, 0, 43, "Tab"], ["Backspace", 16, 0, 42, "Bksp"], ["Escape", 16, 0, 41, "Esc"]].map((item) => key(...item)) },
    { title: "Symbols", items: [["Minus", 45, "-"], ["Equals", 46, "="], ["Left bracket", 47, "["], ["Right bracket", 48, "]"], ["Backslash", 49, "\\"], ["Semicolon", 51, ";"], ["Apostrophe", 52, "'"], ["Grave", 53, "`"], ["Comma", 54, ","], ["Period", 55, "."], ["Slash", 56, "/"]].map(([name, code, short]) => key(name, 16, 0, code, short)) },
    { title: "Function keys", items: functionKeys.map((item) => key(...item)) },
    { title: "Extended keys", items: [["Insert", 73], ["Home", 74], ["Page Up", 75], ["Delete", 76], ["End", 77], ["Page Down", 78], ["Right Arrow", 79], ["Left Arrow", 80], ["Down Arrow", 81], ["Up Arrow", 82], ["Caps Lock", 57], ["Print Screen", 70], ["Scroll Lock", 71], ["Pause", 72], ["Application", 101]].map(([name, code]) => key(name, 16, 0, code)) },
    { title: "Modifiers", items: [["Left Ctrl", 224, "LCtrl"], ["Left Shift", 225, "LShift"], ["Left Alt", 226, "LAlt"], ["Left GUI", 227, "LWin"], ["Right Ctrl", 228, "RCtrl"], ["Right Shift", 229, "RShift"], ["Right Alt", 230, "RAlt"], ["Right GUI", 231, "RWin"]].map(([name, code, short]) => key(name, 16, 0, code, short)) },
    { title: "Layers and profiles", items: [["FN layer 1", 255, 1, "FN1"], ["FN layer 2", 255, 2, "FN2"], ["FN layer 3", 255, 3, "FN3"], ["Profile 1", 253, 0, "P1"], ["Profile 2", 252, 0, "P2"], ["Profile 3", 251, 0, "P3"]].map(([name, code1, code2, short]) => key(name, 240, code1, code2, short)) },
    { title: "Media and applications", items: [["Play / Pause", 205, 0, "Play"], ["Next track", 181, 0, "Next"], ["Previous track", 182, 0, "Prev"], ["Stop", 183, 0, "Stop"], ["Volume up", 233, 0, "Vol+"], ["Volume down", 234, 0, "Vol−"], ["Mute", 226, 0, "Mute"], ["Calculator", 146, 1, "Calc"], ["Browser home", 35, 2, "Home"], ["Browser back", 36, 2, "Back"], ["Browser forward", 37, 2, "Forward"]].map(([name, code1, code2, short]) => key(name, 48, code1, code2, short)) },
    { title: "Mouse and system", items: [["Mouse left", 32, 1, 0, "M1"], ["Mouse right", 32, 2, 0, "M2"], ["Mouse middle", 32, 4, 0, "M3"], ["Mouse back", 32, 16, 0, "M4"], ["Mouse forward", 32, 8, 0, "M5"], ["Wheel up", 33, 0, 1, "Wheel+"], ["Wheel down", 33, 0, 255, "Wheel−"], ["Power", 64, 1, 0, "Power"], ["Sleep", 64, 2, 0, "Sleep"], ["Wake", 64, 4, 0, "Wake"]].map(([name, type, code1, code2, short]) => key(name, type, code1, code2, short)) },
    { title: "Keyboard functions", items: [["N / All", 160, 0, "N/ALL"], ["RGB mode +", 46, 0, "RGB+"], ["RGB mode −", 47, 0, "RGB−"], ["RGB mode", 48, 0, "RGB"], ["Brightness +", 50, 0, "Bright+"], ["Brightness −", 51, 0, "Bright−"], ["Brightness off", 53, 0, "Light off"], ["Speed +", 54, 0, "Speed+"], ["Speed −", 55, 0, "Speed−"], ["Color +", 61, 0, "Color+"]].map(([name, code1, code2, short]) => key(name, 240, code1, code2, short)) },
  ]);
  const ALL_MAPPINGS = MAPPING_GROUPS.flatMap((group) => group.items);
  const BASIC_MAPPING_CHOICES = ALL_MAPPINGS.filter((mapping) => mapping.type === 16 && mapping.code1 === 0);
  const ADVANCED_META = Object.freeze({
    dks: { name: "DKS", icon: "4×", description: "Trigger up to four actions across press and release travel." },
    mt: { name: "Mod-Tap", icon: "M/T", description: "Tap for one key, hold for another after a time threshold." },
    tgl: { name: "Toggle", icon: "T", description: "Press once to hold an output; press again to release it." },
    rs: { name: "Rappy Snappy", icon: "RS", description: "Pair two keys and prioritize the deeper active press." },
    socd: { name: "SOCD", icon: "S", description: "Resolve opposite key inputs with a chosen priority rule." },
    cb: { name: "Combination key", icon: "+", description: "Send modifiers and a base key from a single key." },
    macro: { name: "Macro", icon: "▶", description: "Play an ordered series of key events and delays." },
  });
  const PAGE_META = Object.freeze({
    overview: ["Workspace", "Overview", "Your keyboard at a glance."],
    mapping: ["Remapping", "Key mapping", "Click a key to choose its output on any layer."],
    hall: ["Magnetic switches", "Hall effect", "Tune actuation, Rapid Trigger, precision, and dead zones per key."],
    settings: ["Performance", "Device settings", "Configure polling, scanning, debounce, compatibility, and locks."],
    lighting: ["RGB", "Lighting", "Choose effects, brightness, speed, and per-key colors."],
    advanced: ["Multi-action behavior", "Advanced functions", "Configure DKS, Mod-Tap, Toggle, pairs, combinations, and macros."],
    profiles: ["Onboard memory", "Onboard profiles", "Read, switch, back up, and configure profiles stored on the keyboard."],
    diagnostics: ["Transparency", "Diagnostics", "Inspect identity, connection state, and the local command log."],
  });

  const state = {
    source: "none",
    driver: null,
    identity: null,
    info: null,
    profile: null,
    original: null,
    fileName: "",
    page: "overview",
    layer: 0,
    hallSelection: new Set([0]),
    hallDrag: null,
    liveMonitorActive: false,
    liveMonitorBusy: false,
    liveTelemetryUnsubscribe: null,
    liveTravel: new Array(128).fill(0),
    liveTravelRaw: new Array(128).fill(0),
    liveTravelStatus: new Array(128).fill(0),
    liveLastIndex: 0,
    liveFrame: 0,
    colorSelection: new Set([0]),
    dirty: new Set(),
    logs: [],
    mappingIndex: null,
    advancedEditIndex: null,
    advancedType: null,
    pendingProfile: null,
  };

  function mappingFromPreset(preset, layer = state.layer) {
    return { type: preset.type, code1: preset.code1, code2: preset.code2, code: preset.type === 16 && preset.code1 === 0 ? preset.code2 : -1, name: preset.short || preset.name, profile: state.profile?.profileIndex || 0, layer };
  }

  function mappingLabel(mapping) {
    if (!mapping || mapping.type === 255) return "Unassigned";
    return mapping.name || API.mappingName(mapping.type, mapping.code1, mapping.code2);
  }

  function defaultTravel() {
    return { switch_type: 0, key_mode: 0, priority: 0, key_max_length: 4, key_actuation: 40, rt_press: 10, rt_release: 10, pressPrecision: 0, releasePrecision: 0, press_deadzone: 0, release_deadzone: 0, deadzone_status: false };
  }

  function defaultSettings() {
    return { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, systemMode: 0 };
  }

  function makeDemoProfile() {
    const userKeys = {};
    for (let layer = 0; layer < 4; layer += 1) {
      userKeys[layer] = Array.from({ length: 128 }, (_, index) => API.makeMapping(255, 255, 255, 0, layer));
      PHYSICAL_KEYS.forEach(({ index }) => {
        if (layer === 0 && index !== 26 && PHYSICAL_HID_CODES[index] != null) userKeys[layer][index] = API.makeMapping(16, 0, PHYSICAL_HID_CODES[index], 0, layer);
      });
      userKeys[layer][26] = API.makeMapping(240, 255, 1, 0, layer);
    }
    return normalizeProfile({
      name: "HE30 Demo Profile",
      profileIndex: 0,
      userKeys,
      travelKeys: Array.from({ length: 128 }, defaultTravel),
      advancedKeys: [],
      light: { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2" },
      logoLight: { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2" },
      colorKeys: Array(128).fill("#66f7c2"),
      deviceSettings: defaultSettings(),
      _rawConfig: Array(64).fill(0),
    });
  }

  function normalizeProfile(input) {
    const profile = clone(input || {});
    const hasRawConfig = Array.isArray(profile._rawConfig) && profile._rawConfig.length >= 64;
    const derivedSections = [];
    if (profile.userKeys) derivedSections.push("keymap");
    if (Array.isArray(profile.travelKeys) && profile.travelKeys.length) derivedSections.push("hall");
    if (Array.isArray(profile.advancedKeys)) derivedSections.push("advanced");
    if (profile.deviceSettings) derivedSections.push("settings");
    if (profile.light || profile.logoLight) derivedSections.push("lighting");
    if (Array.isArray(profile.colorKeys) && profile.colorKeys.length) derivedSections.push("colors");
    profile._workspaceSections = Array.isArray(profile._workspaceSections) ? [...new Set(profile._workspaceSections)] : derivedSections;
    profile.profileIndex = clamp(profile.profileIndex ?? profile.profile ?? 0, 0, 3);
    profile.name ||= `Keyboard Profile ${profile.profileIndex + 1}`;
    const keys = profile.userKeys || {};
    profile.userKeys = {};
    for (let layer = 0; layer < 4; layer += 1) {
      profile.userKeys[layer] = Array.from({ length: 128 }, (_, index) => {
        const found = keys[layer]?.[index] || keys[String(layer)]?.[index];
        if (!found) return API.makeMapping(255, 255, 255, profile.profileIndex, layer);
        return { ...found, type: Number(found.type), code1: Number(found.code1), code2: Number(found.code2), code: found.code ?? -1, name: found.name || API.mappingName(Number(found.type), Number(found.code1), Number(found.code2)), profile: profile.profileIndex, layer };
      });
    }
    profile.travelKeys = Array.from({ length: 128 }, (_, index) => ({ ...defaultTravel(), ...(profile.travelKeys?.[index] || {}) }));
    profile.advancedKeys = Array.isArray(profile.advancedKeys) ? profile.advancedKeys : [];
    profile.light = { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2", ...(profile.light || {}) };
    profile.logoLight = { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2", ...(profile.logoLight || {}) };
    profile.colorKeys = Array.from({ length: 128 }, (_, index) => API.normalizeHexColor(profile.colorKeys?.[index] || profile.light.color));
    profile.deviceSettings = { ...defaultSettings(), ...(profile.deviceSettings || {}) };
    profile._rawConfig = Array.from(profile._rawConfig || Array(64).fill(0));
    profile._hasRawConfig = profile._hasRawConfig ?? hasRawConfig;
    return profile;
  }

  function log(level, message, detail) {
    state.logs.unshift({ time: new Date().toISOString(), level, message, detail });
    state.logs = state.logs.slice(0, 400);
    if (state.page === "diagnostics" && state.profile) renderPage();
  }

  function showToast(message, error = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast show${error ? " error" : ""}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3500);
  }

  function showProgress(title, percent = 0, message = "Please keep the keyboard connected.") {
    $("#progressOverlay").classList.remove("hidden");
    $("#progressTitle").textContent = title;
    updateProgress(percent, message);
  }

  function updateProgress(percent, message) {
    const value = clamp(percent, 0, 100);
    $("#progressBar").style.width = `${value}%`;
    $("#progressPercent").textContent = `${value}%`;
    $("#progressMessage").textContent = message;
  }

  function hideProgress() { $("#progressOverlay").classList.add("hidden"); }

  function setWorkspace(profile, source, metadata = {}) {
    state.profile = normalizeProfile(profile);
    state.original = clone(state.profile);
    state.source = source;
    state.identity = metadata.identity || state.identity;
    state.info = metadata.info || state.info;
    state.fileName = metadata.fileName || state.fileName;
    state.layer = 0;
    state.page = "overview";
    state.dirty.clear();
    state.hallSelection = new Set([0]);
    state.colorSelection = new Set([0]);
    $("#welcomeView").classList.add("hidden");
    $("#workspaceView").classList.remove("hidden");
    updateChrome();
    renderPage();
  }

  function updateChrome() {
    const connected = state.source === "device" && state.driver;
    $("#connectionPill")?.classList.toggle("connected", Boolean(connected));
    if ($("#connectionPill span")) $("#connectionPill span").textContent = connected ? `${state.identity?.name || "Keyboard"} connected` : "Not connected";
    if ($("#connectButton")) {
      $("#connectButton").textContent = "Connect keyboard";
      $("#connectButton").classList.toggle("hidden", Boolean(connected));
    }
    $("#deviceName").textContent = state.identity?.name || (state.source === "file" ? state.profile?.name || "JSON profile" : "HE30 Demo");
    $("#deviceMeta").textContent = connected ? `${state.identity.vidPid} · Profile ${state.profile.profileIndex + 1}` : state.source === "file" ? state.fileName : "No hardware writes";
    $("#applyButton").disabled = !connected || state.dirty.size === 0;
    $("#applyButton").classList.toggle("hidden", APP_MODE !== "live");
    $("#revertButton").disabled = state.dirty.size === 0;
    $("#dirtyBanner").classList.toggle("hidden", state.dirty.size === 0);
    $("#dirtyCount").textContent = state.dirty.size;
    $("#applyButton").title = connected ? "Write staged sections and verify them" : "Connect the keyboard to write changes";
    $$("#sideNav button").forEach((button) => button.classList.toggle("active", button.dataset.page === state.page));
  }

  function markDirty(...sections) {
    sections.forEach((section) => {
      state.dirty.add(section);
      if (state.profile && !state.profile._workspaceSections.includes(section)) state.profile._workspaceSections.push(section);
    });
    updateChrome();
  }

  function renderMiniKeyboard() {
    if ($("#welcomeKeyboard")) $("#welcomeKeyboard").innerHTML = HE30_LAYOUT.map((row, rowIndex) => `<div class="mini-row">${row.map((_, keyIndex) => `<i class="mini-key${(rowIndex + keyIndex) % 7 === 2 ? " glow" : ""}"></i>`).join("")}</div>`).join("");
  }

  function renderPage() {
    if (!state.profile) return;
    const [eyebrow, title, description] = PAGE_META[state.page];
    $("#pageEyebrow").textContent = eyebrow;
    $("#pageTitle").textContent = title;
    $("#pageDescription").textContent = description;
    const renderers = { overview: renderOverview, mapping: renderMapping, hall: renderHall, settings: renderSettings, lighting: renderLighting, advanced: renderAdvanced, profiles: renderProfiles, diagnostics: renderDiagnostics };
    $("#pageContent").innerHTML = renderers[state.page]();
    bindPageControls();
    updateChrome();
  }

  function keyboardHtml(mode, selected = new Set()) {
    const compiled = API.compileAdvanced(state.profile);
    return `<div class="keyboard-grid" data-keyboard-mode="${mode}">${HE30_LAYOUT.map((row) => `<div class="key-row">${row.map(({ index, label }) => {
      const mapping = compiled.userKeys[state.layer][index];
      const advanced = [112, 144, 145, 146, 147, 148].includes(mapping.type);
      const color = mode === "color" ? state.profile.colorKeys[index] : "";
      const mapped = mode === "hall" ? `${(state.profile.travelKeys[index].key_actuation / 100).toFixed(2)} mm` : mode === "color" ? color : mappingLabel(mapping);
      const livePercent = mode === "hall" ? clamp((state.liveTravel[index] / Math.max(0.01, state.profile.travelKeys[index].key_max_length || 4)) * 100, 0, 100) : 0;
      const styles = [];
      if (mode === "color") styles.push(`border-color:${esc(color)}`, `box-shadow:inset 0 -4px rgb(0 0 0 / 18%),0 0 12px ${esc(color)}33`);
      if (mode === "hall") styles.push(`--travel-pct:${livePercent.toFixed(2)}%`);
      const style = styles.length ? ` style="${styles.join(";")}"` : "";
      const content = mode === "mapping"
        ? `<span class="mapped primary-label">${esc(mapped)}</span><span class="physical secondary-label">Physical: ${esc(label)}</span>`
        : `<span class="physical">${esc(label)}</span><span class="mapped">${esc(mapped)}</span>`;
      const title = mode === "mapping" ? ` title="Physical ${esc(label)} is mapped to ${esc(mapped)}"` : "";
      const pressed = mode === "hall" || mode === "color" ? ` aria-pressed="${selected.has(index)}"` : "";
      const travelFill = mode === "hall" ? `<i class="travel-fill" aria-hidden="true"></i>` : "";
      return `<button class="keycap${selected.has(index) ? " selected" : ""}${advanced ? " advanced" : ""}${livePercent > .5 ? " live-pressed" : ""}" type="button" data-key-index="${index}"${style}${title}${pressed}>${travelFill}${content}${state.dirty.size ? "<i class=\"key-dot\"></i>" : ""}</button>`;
    }).join("")}</div>`).join("")}</div>`;
  }

  function layerTabs() {
    return `<div class="tabs" role="tablist">${[0, 1, 2, 3].map((layer) => `<button type="button" data-layer="${layer}" class="${layer === state.layer ? "active" : ""}">Layer ${layer}</button>`).join("")}</div>`;
  }

  function renderOverview() {
    const settings = state.profile.deviceSettings;
    const rapidCount = PHYSICAL_KEYS.filter(({ index }) => state.profile.travelKeys[index].key_mode > 0).length;
    const mappedCount = PHYSICAL_KEYS.filter(({ index }) => state.profile.userKeys[state.layer][index].type !== 255).length;
    const reportRate = ({ 1: "8,000", 2: "4,000", 3: "2,000", 4: "1,000" })[settings.reportRate] || "Unknown";
    return `
      <div class="stats-grid">
        ${statCard("Current profile", `Profile ${state.profile.profileIndex + 1}`, state.identity?.multiProfile ? "Four onboard slots available" : "Active workspace", "▣")}
        ${statCard("Polling rate", `${reportRate} Hz`, `Tick rate ${settings.tickRate || "auto"}`, "⌁")}
        ${statCard("Rapid Trigger", `${rapidCount} keys`, rapidCount ? "Enabled per-key" : "Standard actuation", "↕")}
        ${statCard("Advanced actions", state.profile.advancedKeys.length, `${mappedCount}/36 keys mapped on layer ${state.layer}`, "◆")}
      </div>
      <div class="section-heading"><div><h2>Configuration health</h2><p>Every area remains independent until it is staged.</p></div></div>
      <div class="overview-grid">
        <section class="panel panel-pad"><div class="quick-list">
          ${quickRow("⌨", "Key mapping", `${mappedCount} physical keys mapped on layer ${state.layer}`, "mapping")}
          ${quickRow("↕", "Hall effect", `${rapidCount} Rapid Trigger keys · ${(averageActuation()).toFixed(2)} mm average actuation`, "hall")}
          ${quickRow("✦", "Lighting", `Effect ${state.profile.light.effect} · ${state.profile.light.brightness}% brightness`, "lighting")}
          ${quickRow("⌁", "Advanced functions", `${state.profile.advancedKeys.length} configured action${state.profile.advancedKeys.length === 1 ? "" : "s"}`, "advanced")}
        </div></section>
        <aside class="panel safety-card"><span class="chip">WRITE SAFETY</span><h2>Changes stay local first.</h2><p>Keyboard reads create a restorable workspace. Apply writes only changed data banks, then reads them back to verify exact bytes.</p><ul><li>No firmware commands in this build</li><li>No automatic writes from controls</li><li>JSON export works without WebHID</li><li>Diagnostics never leave your browser</li></ul></aside>
      </div>`;
  }

  function statCard(label, value, detail, icon) { return `<article class="panel stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`; }
  function quickRow(icon, title, detail, page) { return `<div class="quick-row"><span>${icon}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><button class="icon-action" type="button" data-go-page="${page}">Open →</button></div>`; }
  function averageActuation() { return PHYSICAL_KEYS.reduce((sum, { index }) => sum + (Number(state.profile.travelKeys[index].key_actuation) || 0), 0) / PHYSICAL_KEYS.length / 100; }
  function precisionOptions() {
    if ([102, 103, 105].includes(state.identity?.type)) return [[0, "0.01 mm"], [1, "0.005 mm"], [2, "0.001 mm"]];
    if (state.identity?.type === 101) return [[0, "0.01 mm"], [1, "0.005 mm"]];
    return null;
  }

  function renderMapping() {
    return `<div class="layer-bar">${layerTabs()}<span class="selection-bar">Click a key to open the mapping library</span></div><section class="panel keyboard-panel">${keyboardHtml("mapping")}<div class="keyboard-legend"><span><i></i>Mapped key</span><span><i class="advanced-dot"></i>Advanced action</span><span><i class="staged-dot"></i>Workspace contains staged changes</span></div></section><div class="callout">F13–F24 and Fn1–Fn3 use the device encodings confirmed for this keyboard. Combination keys and macros are configured in Advanced functions.</div>`;
  }

  function renderHall() {
    const selected = [...state.hallSelection];
    const first = state.profile.travelKeys[selected[0] ?? 0];
    const precision = precisionOptions();
    const withCurrentPrecision = (current) => precision && precision.some(([value]) => Number(value) === Number(current)) ? precision : precision ? [...precision, [current, `Reserved value ${current} (current)`]] : null;
    const precisionCard = precision
      ? `<section class="panel form-card"><h3>Travel resolution</h3><p>Choose the measurement step used for press and release travel. This is resolution, not signal filtering.</p><div class="field-grid">${selectField("Press resolution", "hallPressPrecision", withCurrentPrecision(first.pressPrecision), first.pressPrecision)}${selectField("Release resolution", "hallReleasePrecision", withCurrentPrecision(first.releasePrecision), first.releasePrecision)}</div></section>`
      : `<section class="panel form-card"><h3>Travel resolution</h3><p>The captured original software does not expose precision selection for this device type.</p><div class="callout">Existing precision bits are preserved, but this app will not change them. The original interface enables this control only for device types 101, 102, 103, and 105—not type 104.</div></section>`;
    return `<div class="layer-bar"><div class="selection-bar"><b id="hallSelectionCount">${selected.length}</b> key<span id="hallSelectionPlural">${selected.length === 1 ? "" : "s"}</span> selected · Drag across keys, or Ctrl/Cmd-click to toggle</div><button class="button secondary" id="selectAllKeys" type="button">Select all 36</button></div>
      <section class="panel keyboard-panel hall-selection-panel">${keyboardHtml("hall", state.hallSelection)}</section>
      ${liveMonitorHtml()}
      <div class="section-heading"><div><h2>Selected-key tuning</h2><p>Values are in hundredths of a millimeter. Mixed groups show the first selected key.</p></div><button class="button primary" id="stageHallButton" type="button">Stage on ${selected.length} selected key${selected.length === 1 ? "" : "s"}</button></div>
      <div class="form-grid">
        <section class="panel form-card"><h3>Actuation behavior</h3><p>Choose normal or dynamic release behavior.</p><div class="field-grid">
          ${selectField("Key mode", "hallMode", [[0, "Standard"], [1, "Rapid Trigger"], [2, "Continuous Rapid Trigger"]], first.key_mode)}
          ${rangeField("Actuation", "hallActuation", first.key_actuation, 1, 400, 1, "mm")}
          ${rangeField("RT press", "hallPress", first.rt_press, 1, 400, 1, "mm")}
          ${rangeField("RT release", "hallRelease", first.rt_release, 1, 400, 1, "mm")}
        </div></section>
        ${precisionCard}
        <section class="panel form-card"><h3>Dead zones</h3><p>Ignore unstable travel near the top and bottom of the switch.</p><div class="field-grid">
          ${rangeField("Top dead zone", "hallPressDeadzone", first.press_deadzone, 0, 127, 1, "mm")}
          ${rangeField("Bottom dead zone", "hallReleaseDeadzone", first.release_deadzone, 0, 127, 1, "mm")}
        </div></section>
      </div>`;
  }

  function liveMonitorHtml() {
    const connected = state.source === "device" && Boolean(state.driver);
    const index = state.liveLastIndex ?? 0;
    const travel = state.profile.travelKeys[index] || defaultTravel();
    const distance = state.liveTravel[index] || 0;
    const maxDistance = Math.max(0.01, Number(travel.key_max_length) || 4);
    const travelPercent = clamp((distance / maxDistance) * 100, 0, 100);
    const actuation = clamp((Number(travel.key_actuation) || 1) / 100, 0, maxDistance);
    const actuationPercent = clamp((actuation / maxDistance) * 100, 0, 100);
    const mapped = API.compileAdvanced(state.profile).userKeys[state.layer][index];
    const status = distance < .01 ? "Released" : distance >= actuation ? "Actuated" : "Pre-travel";
    const monitorText = state.liveMonitorBusy ? "Working…" : state.liveMonitorActive ? "Stop live monitor" : "Start live monitor";
    return `<div class="section-heading live-heading"><div><h2>Live press distance</h2><p>See the physical Hall travel and actuation point as you press a key.</p></div><span class="live-session-note">${state.liveMonitorActive ? "Diagnostic stream active" : connected ? "Ready to monitor" : "Keyboard connection required"}</span></div>
      <section class="panel live-monitor${state.liveMonitorActive ? " active" : ""}" id="liveMonitor" style="--live-travel:${travelPercent.toFixed(2)}%;--live-actuation:${actuationPercent.toFixed(2)}%;--live-offset:${(travelPercent * .44).toFixed(2)}px">
        <div class="live-monitor-copy">
          <div class="live-status-line"><span class="live-dot${state.liveMonitorActive ? " active" : ""}"></span><b id="liveConnectionStatus">${state.liveMonitorActive ? "Live" : "Paused"}</b></div>
          <h3 id="liveKeyName">${esc(physicalName(index))}</h3>
          <p id="liveMappedName">Mapped to ${esc(mappingLabel(mapped))}</p>
          <strong class="live-distance" id="liveDistance">${distance.toFixed(2)} <small>mm</small></strong>
          <span class="live-state" id="liveState">${esc(status)}</span>
          <button class="button ${state.liveMonitorActive ? "secondary" : "primary"}" id="liveMonitorButton" type="button" ${!connected || state.liveMonitorBusy ? "disabled" : ""}>${monitorText}</button>
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
            <span class="scale-top">0.00 mm</span><span class="scale-bottom">${maxDistance.toFixed(2)} mm</span>
          </div>
          <div class="live-metrics">
            <span><small>Travel</small><strong id="liveTravelPercent">${travelPercent.toFixed(0)}%</strong></span>
            <span><small>Actuation</small><strong id="liveActuationValue">${actuation.toFixed(2)} mm</strong></span>
            <span><small>Mode</small><strong id="liveMode">${travel.key_mode > 0 ? "Rapid Trigger" : "Standard"}</strong></span>
          </div>
        </div>
      </section>`;
  }

  function selectField(label, id, options, selected) { return `<label class="field"><span>${esc(label)}</span><select id="${id}">${options.map(([value, name]) => `<option value="${value}"${String(value) === String(selected) ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`; }
  function rangeField(label, id, value, min, max, step, unit) { return `<label class="field"><span>${esc(label)}</span><div class="range-line"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><output class="range-value" for="${id}">${(Number(value) / 100).toFixed(2)} ${unit}</output></div></label>`; }

  function renderSettings() {
    const settings = state.profile.deviceSettings;
    return `<div class="form-grid">
      <section class="panel form-card"><h3>USB performance</h3><p>Polling controls host reports; tick rate controls internal scanning.</p><div class="field-grid">
        ${selectField("Polling rate", "reportRate", [[1, "8,000 Hz"], [2, "4,000 Hz"], [3, "2,000 Hz"], [4, "1,000 Hz"]], settings.reportRate)}
        ${selectField("Tick rate", "tickRate", [[0, "Automatic"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]], settings.tickRate)}
        ${selectField("Debounce", "debounce", Array.from({ length: 8 }, (_, index) => [index, `${index}`]), settings.debounce)}
        ${selectField("OS mode", "systemMode", [[0, "Windows"], [1, "macOS"]], settings.systemMode)}
      </div><div class="callout">8,000 Hz can use more CPU and may be less stable through some USB hubs. If input drops, test 1,000 Hz directly connected.</div></section>
      <section class="panel form-card"><h3>Input processing</h3><p>Compatibility modes exposed by the original software.</p><div class="switch-list">
        ${switchRow("Bottom Rapid Trigger", "Driver method: stability mode", "stabilityMode", settings.stabilityMode)}
        ${switchRow("Check mode", "Additional signal checks", "checkMode", settings.checkMode)}
      </div><div class="callout">The driver reads config bit 0 as “tachyonMode” and has an unused setter named “Berserk mode,” but the captured interface never exposes or calls it. The bit is preserved and intentionally not editable here.</div></section>
      <section class="panel form-card"><h3>Lock settings</h3><p>Prevent common shortcuts from interrupting a game.</p><div class="switch-list">
        ${switchRow("Windows key lock", "Blocks the GUI key", "lockWin", settings.lockWin)}
        ${switchRow("Alt + Tab lock", "Blocks app switching", "lockAltTab", settings.lockAltTab)}
        ${switchRow("Alt + F4 lock", "Blocks window close", "lockAltF4", settings.lockAltF4)}
      </div></section>
    </div>`;
  }

  function switchRow(title, detail, setting, checked) { return `<div class="switch-row"><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><label class="switch"><input type="checkbox" data-setting="${setting}"${checked ? " checked" : ""} /><i></i></label></div>`; }

  const LIGHT_EFFECTS = ["Off", "Static", "Breathing", "Wave", "Ripple", "Reactive", "Rain", "Spectrum", "Neon", "Comet", "Stars", "Laser", "Bloom", "Pulse", "Radar", "Snake", "Fireworks", "Heartbeat", "Aurora", "Waterfall", "Cross", "Spiral", "Music", "Custom"];
  function renderLighting() {
    return `<div class="overview-grid">
      <section class="panel form-card"><h3>Main key lighting</h3><p>Profile-wide RGB effect and behavior.</p><div class="lighting-preview" style="--preview-color:${esc(state.profile.light.color)}"><div class="preview-board">${Array.from({ length: 28 }, () => "<i></i>").join("")}</div></div><div class="field-grid" style="margin-top:16px">${lightFields("light", state.profile.light)}</div></section>
      <section class="panel form-card"><h3>Logo lighting</h3><p>Independent controls for the keyboard logo zone.</p><div class="lighting-preview" style="--preview-color:${esc(state.profile.logoLight.color)}"><div class="brand-mark" style="width:76px;height:76px;font-size:36px">H</div></div><div class="field-grid" style="margin-top:16px">${lightFields("logoLight", state.profile.logoLight)}</div></section>
    </div>
    <div class="section-heading"><div><h2>Per-key colors</h2><p>Select one or more keys, choose a color, then stage it.</p></div></div>
    <div class="color-toolbar"><label class="field"><span>Selected color</span><input id="perKeyColor" type="color" value="${esc(state.profile.colorKeys[[...state.colorSelection][0] || 0])}" /></label><button class="button primary" id="applyColorButton" type="button">Stage color on ${state.colorSelection.size} key${state.colorSelection.size === 1 ? "" : "s"}</button><button class="button secondary" id="selectAllColors" type="button">Select all 36</button></div>
    <section class="panel keyboard-panel">${keyboardHtml("color", state.colorSelection)}</section>`;
  }

  function lightFields(group, light) {
    const effects = LIGHT_EFFECTS.map((name, index) => [index, name]);
    return `${selectField("Effect", `${group}-effect`, effects, light.effect)}
      <label class="field"><span>Color</span><input type="color" data-light="${group}" data-light-prop="color" value="${esc(light.color)}" /></label>
      ${selectField("Brightness", `${group}-brightness`, [[0, "Off"], [20, "20%"], [40, "40%"], [60, "60%"], [80, "80%"], [100, "100%"]], light.brightness)}
      ${selectField("Speed", `${group}-speed`, [[0, "Slowest"], [1, "Slow"], [2, "Medium"], [3, "Fast"], [4, "Fastest"]], light.speed)}
      ${selectField("Direction", `${group}-direction`, [[0, "Forward"], [1, "Reverse"]], light.direction)}
      <div class="switch-row" style="grid-column:1/-1"><div><strong>Single color</strong><small>Use the selected color instead of the effect palette</small></div><label class="switch"><input type="checkbox" data-light="${group}" data-light-prop="singleColor"${light.singleColor ? " checked" : ""} /><i></i></label></div>`;
  }

  function renderAdvanced() {
    const count = (type) => state.profile.advancedKeys.filter((item) => item.type === type).length;
    const shared = count("mt") + 2 * (count("rs") + count("socd"));
    return `<div class="advanced-cards">${Object.entries(ADVANCED_META).map(([type, meta]) => `<article class="panel action-card"><span class="action-icon">${meta.icon}</span><h3>${meta.name}</h3><p>${meta.description}</p><button class="icon-action" type="button" data-add-advanced="${type}">+ Add ${meta.name}</button></article>`).join("")}</div>
      <div class="callout">Device banks: DKS ${count("dks")}/32 · Toggle ${count("tgl")}/32 · Shared Mod-Tap/pair bank ${shared}/32 · Macros ${count("macro")}/32. Pair actions use two shared slots.</div>
      <div class="section-heading"><div><h2>Configured actions</h2><p>Actions are compiled into device banks only when you apply.</p></div></div>
      <div class="configured-list">${state.profile.advancedKeys.length ? state.profile.advancedKeys.map((item, index) => configuredAction(item, index)).join("") : `<div class="panel empty-state"><strong>No advanced actions configured</strong><p>Add one above. The host mapping and underlying bank entry will be staged together.</p></div>`}</div>`;
  }

  function configuredAction(item, index) {
    const meta = ADVANCED_META[item.type] || { name: item.type, icon: "?" };
    const paired = item.index2 != null ? ` + ${physicalName(item.index2)}` : "";
    return `<article class="panel configured-row"><span class="action-icon">${meta.icon}</span><div><strong>${esc(meta.name)} · ${esc(physicalName(item.index1))}${esc(paired)}</strong><small>Layer ${item.layer || 0}${item.type === "macro" ? ` · ${(item.actions || []).length} events` : ""}</small></div><button class="icon-action" type="button" data-edit-advanced="${index}">Edit</button><button class="icon-action delete" type="button" data-delete-advanced="${index}">Delete</button></article>`;
  }

  function renderProfiles() {
    const multi = Boolean(state.identity?.multiProfile);
    const total = multi ? 4 : 1;
    return `<div class="profile-grid">${Array.from({ length: total }, (_, index) => `<article class="panel profile-card${index === state.profile.profileIndex ? " active" : ""}"><span class="profile-number">${index + 1}</span>${index === state.profile.profileIndex ? "<span class=\"active-label\">Active workspace</span>" : ""}<h3>Profile ${index + 1}</h3><p>${state.source === "device" ? "Stored in onboard memory." : "Available when a multi-profile keyboard is connected."}</p><button class="button ${index === state.profile.profileIndex ? "secondary" : "primary"}" type="button" data-profile="${index}" ${index === state.profile.profileIndex || state.source !== "device" ? "disabled" : ""}>${index === state.profile.profileIndex ? "Loaded" : "Switch and load"}</button></article>`).join("")}</div>
      <div class="section-heading"><div><h2>Profile portability</h2><p>Back up the complete current profile, including Hall and lighting data.</p></div></div>
      <section class="panel panel-pad"><div class="quick-list">${quickRow("⇩", "Export current backup", "Download a complete JSON copy of the current workspace", "export-profile")}${APP_MODE === "json" ? quickRow("⇧", "Import profile JSON", "Open another backup in this offline workspace", "import-profile") : quickRow("↗", "Open JSON editor", "Inspect or modify a backup without connecting a keyboard", "json-editor")}</div></section>
      ${multi ? "" : `<div class="callout">${state.identity ? `${esc(state.identity.name)} reports a single onboard profile.` : "Connect a supported multi-profile HE30 to switch among four onboard slots."}</div>`}`;
  }

  function renderDiagnostics() {
    const identity = state.identity || {};
    const rows = [["Workspace source", state.source], ["Device", identity.name || "Not connected"], ["VID:PID", identity.vidPid || "—"], ["Firmware", state.info?.firmware || "Not read"], ["Profile", state.profile.profileIndex + 1], ["WebHID", API.HE30Driver.supported() ? "Available" : "Unavailable"], ["Pending sections", [...state.dirty].join(", ") || "None"]];
    return `<div class="overview-grid"><section class="panel panel-pad"><div class="section-heading"><div><h2>Identity and state</h2><p>Read-only information about this browser session.</p></div></div><table class="identity-table">${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</table></section><aside class="panel safety-card"><span class="chip">SCOPE</span><h2>No firmware access.</h2><p>This build has no firmware image parser, bootloader device filter, updater command, or flash button.</p><ul><li>Normal-mode config devices only</li><li>Report writes require confirmation</li><li>Section read-back verification</li></ul></aside></div>
      <div class="section-heading"><div><h2>Session log</h2><p>Kept in memory and cleared when the page closes.</p></div><button class="button secondary" id="exportLogButton" type="button">Export log</button></div>
      <section class="panel panel-pad log-list">${state.logs.length ? state.logs.map((entry) => `<div class="log-row"><time>${new Date(entry.time).toLocaleTimeString()}</time><span class="log-level ${esc(entry.level)}">${esc(entry.level)}</span><span>${esc(entry.message)}</span></div>`).join("") : `<div class="empty-state"><strong>No device traffic yet</strong><p>Connect a keyboard or edit a setting to begin the session log.</p></div>`}</section>`;
  }

  function bindPageControls() {
    $$('[data-go-page]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.goPage === "export-profile") return exportProfile();
      if (button.dataset.goPage === "import-profile") return $("#fileInput")?.click();
      if (button.dataset.goPage === "json-editor") return window.location.assign("json_editor/");
      state.page = button.dataset.goPage; renderPage();
    }));
    $$('[data-layer]').forEach((button) => button.addEventListener("click", () => { state.layer = Number(button.dataset.layer); renderPage(); }));
    $$('[data-keyboard-mode] .keycap').forEach((button) => button.addEventListener("click", (event) => {
      const mode = button.closest("[data-keyboard-mode]").dataset.keyboardMode;
      if (mode !== "hall" || event.detail === 0) handleKeyClick(button, event);
    }));
    bindHallDragSelection();
    $("#liveMonitorButton")?.addEventListener("click", toggleLiveMonitor);
    if (state.page === "hall") scheduleLiveVisualUpdate();
    $("#selectAllKeys")?.addEventListener("click", () => { state.hallSelection = new Set(PHYSICAL_KEYS.map((key) => key.index)); renderPage(); });
    $("#stageHallButton")?.addEventListener("click", stageHallSettings);
    $$('input[type="range"]').forEach((input) => input.addEventListener("input", () => { const output = input.parentElement.querySelector("output"); if (output) output.textContent = `${(Number(input.value) / 100).toFixed(2)} mm`; }));
    ["reportRate", "tickRate", "debounce", "systemMode"].forEach((id) => $(`#${id}`)?.addEventListener("change", (event) => { state.profile.deviceSettings[id] = Number(event.target.value); markDirty("settings"); log("change", `${id} staged`); }));
    $$('[data-setting]').forEach((input) => input.addEventListener("change", () => { state.profile.deviceSettings[input.dataset.setting] = input.checked ? true : false; markDirty("settings"); log("change", `${input.dataset.setting} staged`); }));
    ["light", "logoLight"].forEach((group) => {
      ["effect", "brightness", "speed", "direction"].forEach((property) => $(`#${group}-${property}`)?.addEventListener("change", (event) => { state.profile[group][property] = Number(event.target.value); markDirty("lighting"); renderPage(); }));
    });
    $$('[data-light]').forEach((input) => input.addEventListener("change", () => { state.profile[input.dataset.light][input.dataset.lightProp] = input.type === "checkbox" ? input.checked : input.value; markDirty("lighting"); renderPage(); }));
    $("#applyColorButton")?.addEventListener("click", () => { const color = $("#perKeyColor").value; state.colorSelection.forEach((index) => { state.profile.colorKeys[index] = color; }); markDirty("colors"); log("change", `Per-key color staged on ${state.colorSelection.size} keys`); renderPage(); });
    $("#selectAllColors")?.addEventListener("click", () => { state.colorSelection = new Set(PHYSICAL_KEYS.map((key) => key.index)); renderPage(); });
    $$('[data-add-advanced]').forEach((button) => button.addEventListener("click", () => openAdvanced(button.dataset.addAdvanced)));
    $$('[data-edit-advanced]').forEach((button) => button.addEventListener("click", () => openAdvanced(state.profile.advancedKeys[Number(button.dataset.editAdvanced)].type, Number(button.dataset.editAdvanced))));
    $$('[data-delete-advanced]').forEach((button) => button.addEventListener("click", () => deleteAdvanced(Number(button.dataset.deleteAdvanced))));
    $$('[data-profile]').forEach((button) => button.addEventListener("click", () => promptProfileSwitch(Number(button.dataset.profile))));
    $("#exportLogButton")?.addEventListener("click", exportLog);
  }

  function bindHallDragSelection() {
    const grid = $('[data-keyboard-mode="hall"]');
    if (!grid) return;
    const finish = (event) => {
      const drag = state.hallDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!state.hallSelection.size) state.hallSelection.add(drag.startIndex);
      state.hallDrag = null;
      try { if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
      grid.classList.remove("drag-selecting");
      updateHallSelectionUI();
      syncHallFormToSelection();
    };
    grid.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const keycap = event.target.closest(".keycap");
      if (!keycap || !grid.contains(keycap)) return;
      event.preventDefault();
      const index = Number(keycap.dataset.keyIndex);
      const toggle = event.ctrlKey || event.metaKey;
      const mode = toggle && state.hallSelection.has(index) ? "remove" : "add";
      if (!toggle) state.hallSelection.clear();
      state.hallDrag = { pointerId: event.pointerId, startIndex: index, mode, touched: new Set() };
      grid.classList.add("drag-selecting");
      try { grid.setPointerCapture(event.pointerId); } catch (_) { /* no-op */ }
      applyHallDragIndex(index);
    });
    grid.addEventListener("pointermove", (event) => {
      if (!state.hallDrag || state.hallDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.keycap[data-key-index]');
      if (hovered && grid.contains(hovered)) applyHallDragIndex(Number(hovered.dataset.keyIndex));
    });
    grid.addEventListener("pointerup", finish);
    grid.addEventListener("pointercancel", finish);
    grid.addEventListener("lostpointercapture", (event) => { if (state.hallDrag?.pointerId === event.pointerId) finish(event); });
  }

  function applyHallDragIndex(index) {
    const drag = state.hallDrag;
    if (!drag || drag.touched.has(index)) return;
    drag.touched.add(index);
    if (drag.mode === "remove") {
      if (state.hallSelection.size > 1) state.hallSelection.delete(index);
    } else state.hallSelection.add(index);
    updateHallSelectionUI();
  }

  function updateHallSelectionUI() {
    $$('[data-keyboard-mode="hall"] .keycap').forEach((button) => {
      const selected = state.hallSelection.has(Number(button.dataset.keyIndex));
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const count = $("#hallSelectionCount");
    const plural = $("#hallSelectionPlural");
    const stage = $("#stageHallButton");
    if (count) count.textContent = state.hallSelection.size;
    if (plural) plural.textContent = state.hallSelection.size === 1 ? "" : "s";
    if (stage) stage.textContent = `Stage on ${state.hallSelection.size} selected key${state.hallSelection.size === 1 ? "" : "s"}`;
  }

  function syncHallFormToSelection() {
    const travel = state.profile.travelKeys[[...state.hallSelection][0] ?? 0];
    const values = { hallMode: travel.key_mode, hallActuation: travel.key_actuation, hallPress: travel.rt_press, hallRelease: travel.rt_release, hallPressPrecision: travel.pressPrecision, hallReleasePrecision: travel.releasePrecision, hallPressDeadzone: travel.press_deadzone, hallReleaseDeadzone: travel.release_deadzone };
    Object.entries(values).forEach(([id, value]) => {
      const input = $(`#${id}`);
      if (!input) return;
      input.value = value;
      const output = input.parentElement?.querySelector("output");
      if (output) output.textContent = `${(Number(value) / 100).toFixed(2)} mm`;
    });
  }

  function telemetryDivisor(index) {
    const mode = Number(state.profile.travelKeys[index]?.pressPrecision) || 0;
    return mode === 2 ? 1000 : mode === 1 ? 200 : 100;
  }

  function handleLiveTelemetry(event) {
    const index = TELEMETRY_INDEX.get(event.keyCode);
    if (index == null) return;
    const maxDistance = Math.max(0.01, Number(state.profile.travelKeys[index]?.key_max_length) || 4);
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
    const maxDistance = Math.max(0.01, Number(travel.key_max_length) || 4);
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
    text("#liveMode", travel.key_mode > 0 ? "Rapid Trigger" : "Standard");
    $$('[data-keyboard-mode="hall"] .keycap').forEach((button) => {
      const keyIndex = Number(button.dataset.keyIndex);
      const keyTravel = state.profile.travelKeys[keyIndex] || defaultTravel();
      const percent = clamp((state.liveTravel[keyIndex] / Math.max(0.01, keyTravel.key_max_length || 4)) * 100, 0, 100);
      button.style.setProperty("--travel-pct", `${percent.toFixed(2)}%`);
      button.classList.toggle("live-pressed", percent > .5);
    });
  }

  async function toggleLiveMonitor() {
    if (state.liveMonitorBusy) return;
    if (state.liveMonitorActive) await stopLiveMonitor(true);
    else await startLiveMonitor();
  }

  async function startLiveMonitor() {
    if (!state.driver || state.source !== "device") return showToast("Connect the keyboard to view live Hall travel.", true);
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

  function handleKeyClick(button, event) {
    const index = Number(button.dataset.keyIndex);
    const mode = button.closest("[data-keyboard-mode]").dataset.keyboardMode;
    if (mode === "mapping") return openMapping(index);
    const selected = mode === "hall" ? state.hallSelection : state.colorSelection;
    if (event.ctrlKey || event.metaKey) {
      if (selected.has(index) && selected.size > 1) selected.delete(index); else selected.add(index);
    } else {
      selected.clear(); selected.add(index);
    }
    if (mode === "hall") { updateHallSelectionUI(); syncHallFormToSelection(); }
    else renderPage();
  }

  function stageHallSettings() {
    const values = { key_mode: Number($("#hallMode").value), key_actuation: Number($("#hallActuation").value), rt_press: Number($("#hallPress").value), rt_release: Number($("#hallRelease").value), press_deadzone: Number($("#hallPressDeadzone").value), release_deadzone: Number($("#hallReleaseDeadzone").value) };
    if (precisionOptions()) {
      values.pressPrecision = Number($("#hallPressPrecision").value);
      values.releasePrecision = Number($("#hallReleasePrecision").value);
    }
    state.hallSelection.forEach((index) => Object.assign(state.profile.travelKeys[index], values, { deadzone_status: values.press_deadzone > 0 || values.release_deadzone > 0 }));
    markDirty("hall");
    log("change", `Hall settings staged on ${state.hallSelection.size} keys`);
    showToast(`Hall settings staged on ${state.hallSelection.size} key${state.hallSelection.size === 1 ? "" : "s"}.`);
    renderPage();
  }

  function openMapping(index) {
    state.mappingIndex = index;
    const mapping = API.compileAdvanced(state.profile).userKeys[state.layer][index];
    $("#mappingTitle").textContent = `Remap ${physicalName(index)}`;
    $("#mappingCurrent").textContent = `Currently: ${mappingLabel(mapping)}`;
    $("#mappingAddress").textContent = `Layer ${state.layer} · Key ${index}`;
    $("#mappingSearch").value = "";
    renderMappingGroups("");
    $("#mappingDialog").showModal();
    setTimeout(() => $("#mappingSearch").focus(), 30);
  }

  function renderMappingGroups(query) {
    const normalized = query.trim().toLowerCase();
    const current = state.profile.userKeys[state.layer][state.mappingIndex] || {};
    $("#mappingGroups").innerHTML = MAPPING_GROUPS.map((group) => {
      const items = group.items.filter((item) => !normalized || `${item.name} ${group.title}`.toLowerCase().includes(normalized));
      if (!items.length) return "";
      return `<section class="mapping-group"><h3>${esc(group.title)}</h3><div class="mapping-options">${items.map((item) => `<button class="mapping-option${item.type === current.type && item.code1 === current.code1 && item.code2 === current.code2 ? " active" : ""}" type="button" data-map="${item.type},${item.code1},${item.code2}"><strong>${esc(item.name)}</strong><small>${item.type} · ${item.code1} · ${item.code2}</small></button>`).join("")}</div></section>`;
    }).join("") || `<div class="empty-state"><strong>No mappings found</strong><p>Try a shorter search.</p></div>`;
    $$('[data-map]', $("#mappingGroups")).forEach((button) => button.addEventListener("click", () => {
      const [type, code1, code2] = button.dataset.map.split(",").map(Number);
      const preset = ALL_MAPPINGS.find((item) => item.type === type && item.code1 === code1 && item.code2 === code2);
      applyMapping(preset);
    }));
  }

  function removeAdvancedAtHost(index, layer) {
    const before = state.profile.advancedKeys.length;
    const removed = state.profile.advancedKeys.filter((item) => (item.layer || 0) === layer && (item.index1 === index || item.index2 === index));
    removed.forEach(restoreAdvancedHosts);
    removed.forEach(restorePairTravel);
    state.profile.advancedKeys = state.profile.advancedKeys.filter((item) => !((item.layer || 0) === layer && (item.index1 === index || item.index2 === index)));
    return { advanced: state.profile.advancedKeys.length !== before, hall: removed.some((item) => item.type === "rs" || item.type === "socd") };
  }

  function applyMapping(preset) {
    const removedAdvanced = removeAdvancedAtHost(state.mappingIndex, state.layer);
    state.profile.userKeys[state.layer][state.mappingIndex] = mappingFromPreset(preset);
    markDirty("keymap", ...(removedAdvanced.advanced ? ["advanced"] : []), ...(removedAdvanced.hall ? ["hall"] : []));
    log("change", `${physicalName(state.mappingIndex)} mapped to ${preset.name} on layer ${state.layer}`);
    $("#mappingDialog").close();
    renderPage();
    showToast(`${physicalName(state.mappingIndex)} → ${preset.name}`);
  }

  function clearMapping() {
    const removedAdvanced = removeAdvancedAtHost(state.mappingIndex, state.layer);
    state.profile.userKeys[state.layer][state.mappingIndex] = API.makeMapping(255, 255, 255, state.profile.profileIndex, state.layer);
    markDirty("keymap", ...(removedAdvanced.advanced ? ["advanced"] : []), ...(removedAdvanced.hall ? ["hall"] : []));
    $("#mappingDialog").close(); renderPage(); showToast(`${physicalName(state.mappingIndex)} is now unassigned.`);
  }

  function mappingSelect(id, selected, label, choices = ALL_MAPPINGS) {
    const current = selected || choices[0];
    const available = choices.some((mapping) => mapping.type === current.type && mapping.code1 === current.code1 && mapping.code2 === current.code2)
      ? choices
      : [{ ...current, name: mappingLabel(current) }, ...choices];
    return `<label class="field"><span>${esc(label)}</span><select id="${id}">${available.map((mapping) => `<option value="${mapping.type},${mapping.code1},${mapping.code2}"${mapping.type === current.type && mapping.code1 === current.code1 && mapping.code2 === current.code2 ? " selected" : ""}>${esc(mapping.name)}</option>`).join("")}</select></label>`;
  }

  function hostSelect(id, selected, label, exclude = null) {
    return `<label class="field"><span>${esc(label)}</span><select id="${id}">${PHYSICAL_KEYS.filter((keyItem) => keyItem.index !== exclude).map((keyItem) => `<option value="${keyItem.index}"${keyItem.index === Number(selected) ? " selected" : ""}>${esc(keyItem.label)} · index ${keyItem.index}</option>`).join("")}</select></label>`;
  }

  function openAdvanced(type, editIndex = null) {
    state.advancedType = type;
    state.advancedEditIndex = editIndex;
    const item = editIndex == null ? {} : state.profile.advancedKeys[editIndex];
    const meta = ADVANCED_META[type];
    $("#advancedTitle").textContent = `${editIndex == null ? "Add" : "Edit"} ${meta.name}`;
    $("#advancedError").textContent = "";
    $("#advancedFields").innerHTML = advancedFormHtml(type, item);
    $("#advancedDialog").showModal();
    bindAdvancedForm();
  }

  function advancedFormHtml(type, item) {
    const layer = item.layer || 0;
    const index1 = item.index1 ?? PHYSICAL_KEYS[0].index;
    const host = `<div class="form-section"><h3>Host assignment</h3><div class="field-grid">${selectField("Layer", "advLayer", [[0, "Layer 0"], [1, "Layer 1"], [2, "Layer 2"], [3, "Layer 3"]], layer)}${hostSelect("advIndex1", index1, "Host key")}</div></div>`;
    if (type === "dks") {
      const points = item.dksPoint || [40, 160, 300, 80];
      const dksKeys = item.dksKeys || [0, 1, 2, 3].map(() => ({ key: mappingFromPreset(BASIC_MAPPING_CHOICES[0]), downStart: 1, downEnd: 2, upStart: 2, upEnd: 1 }));
      const statusOptions = [[0, "Off"], [1, "Stage 1"], [2, "Stage 2"], [3, "Stage 3"], [4, "Full travel"]];
      return `${host}<div class="form-section"><h3>Travel points</h3><div class="field-grid">${points.map((point, index) => rangeField(`Point ${index + 1}`, `dksPoint${index}`, point, 1, 400, 1, "mm")).join("")}</div></div><div class="form-section"><h3>Four output actions</h3><div class="field-grid">${dksKeys.map((entry, index) => mappingSelect(`dksKey${index}`, entry.key, `Action ${index + 1}`)).join("")}</div><div class="dks-grid" style="margin-top:14px"><span>Output</span><span>Press start</span><span>Press end</span><span>Release start</span><span>Release end</span>${dksKeys.map((entry, index) => `<strong>Action ${index + 1}</strong>${selectField("", `dks${index}DownStart`, statusOptions, entry.downStart)}${selectField("", `dks${index}DownEnd`, statusOptions, entry.downEnd)}${selectField("", `dks${index}UpStart`, statusOptions, entry.upStart)}${selectField("", `dks${index}UpEnd`, statusOptions, entry.upEnd)}`).join("")}</div><div class="callout">Stage paths define when each output presses and releases across the four travel points.</div></div>`;
    }
    if (type === "mt") return `${host}<div class="form-section"><h3>Tap and hold outputs</h3><div class="field-grid">${mappingSelect("mtClickKey", item.mtClickKey, "Tap output")}${mappingSelect("mtDownKey", item.mtDownKey, "Hold output")}<label class="field"><span>Hold threshold</span><input id="mtTime" type="number" min="10" max="2550" step="10" value="${item.mtTime || 200}" /><small>10–2550 ms, stored in 10 ms steps</small></label></div></div>`;
    if (type === "tgl") return `${host}<div class="form-section"><h3>Toggle output</h3><div class="field-grid">${mappingSelect("tglKey", item.tglKey, "Output key")}</div></div>`;
    if (type === "rs" || type === "socd") {
      const option = item.option || {};
      return `${host}<div class="form-section"><h3>Paired key</h3><div class="field-grid">${hostSelect("advIndex2", item.index2 ?? PHYSICAL_KEYS[1].index, "Second host key", index1)}${mappingSelect("pairKey1", item.key1, "First output")}${mappingSelect("pairKey2", item.key2, "Second output")}${type === "socd" ? selectField("Priority", "pairPriority", [[0, "Neutral / last input"], [1, "First key wins"], [2, "Second key wins"]], option.priority || 0) : ""}</div></div><div class="form-section"><h3>Pair actuation</h3><div class="field-grid">${rangeField("Actuation", "pairActuation", option.actuation || 40, 1, 400, 1, "mm")}${rangeField("RT press", "pairPress", option.press || 10, 1, 400, 1, "mm")}${rangeField("RT release", "pairRelease", option.release || 10, 1, 400, 1, "mm")}</div></div>`;
    }
    if (type === "cb") {
      const modifiers = item.modifiers || 0;
      return `${host}<div class="form-section"><h3>Combination</h3><div class="field-grid"><div class="field full"><span>Modifiers</span><div class="switch-list">${[[1, "Left Ctrl"], [2, "Left Shift"], [4, "Left Alt"], [8, "Left GUI"], [16, "Right Ctrl"], [32, "Right Shift"], [64, "Right Alt"], [128, "Right GUI"]].map(([bit, name]) => switchRow(name, `Modifier mask ${bit}`, `modifier-${bit}`, Boolean(modifiers & bit))).join("")}</div></div>${mappingSelect("comboBase", item.baseKey, "Base key", BASIC_MAPPING_CHOICES)}</div></div>`;
    }
    const actions = item.actions?.length ? item.actions : [{ action: "keydown", code: 4, delay: 0 }, { action: "keyup", code: 4, delay: 50 }];
    return `${host}<div class="form-section"><h3>Playback</h3><div class="field-grid"><label class="field"><span>Repeat count</span><input id="macroRepeat" type="number" min="1" max="255" value="${item.macroRepeatCount || 1}" /></label></div></div><div class="form-section"><h3>Macro events</h3><div class="macro-rows" id="macroRows">${actions.map((action, index) => macroRow(action, index)).join("")}</div><button class="icon-action" id="addMacroRow" type="button" style="margin-top:10px">+ Add event</button><div class="callout">Delays are stored per event in milliseconds. Keep matched key-down and key-up events to avoid a stuck key.</div></div>`;
  }

  function macroRow(action, index) {
    const selected = BASIC_MAPPING_CHOICES.find((mapping) => mapping.code2 === Number(action.code)) || BASIC_MAPPING_CHOICES[0];
    return `<div class="macro-row" data-macro-row>${mappingSelect(`macroKey${index}`, selected, `Event ${index + 1}`, BASIC_MAPPING_CHOICES)}${selectField("Action", `macroAction${index}`, [["keydown", "Key down"], ["keyup", "Key up"]], action.action)}<label class="field"><span>Delay ms</span><input id="macroDelay${index}" type="number" min="0" max="65535" value="${action.delay || 0}" /></label><button class="icon-action delete" type="button" data-remove-macro aria-label="Remove event">×</button></div>`;
  }

  function bindAdvancedForm() {
    $$('input[type="range"]', $("#advancedFields")).forEach((input) => input.addEventListener("input", () => { const output = input.parentElement.querySelector("output"); if (output) output.textContent = `${(Number(input.value) / 100).toFixed(2)} mm`; }));
    $("#addMacroRow")?.addEventListener("click", () => { const rows = $$('[data-macro-row]', $("#macroRows")); $("#macroRows").insertAdjacentHTML("beforeend", macroRow({ action: "keydown", code: 4, delay: 0 }, rows.length)); bindAdvancedForm(); });
    $$('[data-remove-macro]', $("#advancedFields")).forEach((button) => button.onclick = () => button.closest('[data-macro-row]').remove());
  }

  function parseMappingSelect(id) {
    const [type, code1, code2] = $(`#${id}`).value.split(",").map(Number);
    const preset = ALL_MAPPINGS.find((item) => item.type === type && item.code1 === code1 && item.code2 === code2) || { name: API.mappingName(type, code1, code2), short: "" };
    return mappingFromPreset({ ...preset, type, code1, code2 }, Number($("#advLayer").value));
  }

  function baseMappingForHost(layer, index) {
    const owner = state.profile.advancedKeys.find((entry) => (entry.layer || 0) === layer && (entry.index1 === index || entry.index2 === index));
    if (owner) {
      const stored = owner.index1 === index ? owner.baseMapping : owner.baseMapping2;
      return clone(stored || API.makeMapping(255, 255, 255, state.profile.profileIndex, layer));
    }
    return clone(state.profile.userKeys[layer][index]);
  }

  function restoreAdvancedHosts(item) {
    const layer = item.layer || 0;
    state.profile.userKeys[layer][item.index1] = clone(item.baseMapping || API.makeMapping(255, 255, 255, state.profile.profileIndex, layer));
    if (item.index2 != null) state.profile.userKeys[layer][item.index2] = clone(item.baseMapping2 || API.makeMapping(255, 255, 255, state.profile.profileIndex, layer));
  }

  function restorePairTravel(item) {
    if (item.type !== "rs" && item.type !== "socd") return;
    if (item.baseTravel1) state.profile.travelKeys[item.index1] = clone(item.baseTravel1); else state.profile.travelKeys[item.index1].priority = 0;
    if (item.baseTravel2) state.profile.travelKeys[item.index2] = clone(item.baseTravel2); else state.profile.travelKeys[item.index2].priority = 0;
  }

  function saveAdvanced(event) {
    event.preventDefault();
    const type = state.advancedType;
    const layer = Number($("#advLayer").value);
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
      item = { ...base, index2, baseMapping2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseMapping2 || baseMappingForHost(layer, index2) : baseMappingForHost(layer, index2), baseTravel1: existing && (existing.layer || 0) === layer && existing.index1 === index1 ? existing.baseTravel1 || clone(state.profile.travelKeys[index1]) : clone(state.profile.travelKeys[index1]), baseTravel2: existing && (existing.layer || 0) === layer && existing.index2 === index2 ? existing.baseTravel2 || clone(state.profile.travelKeys[index2]) : clone(state.profile.travelKeys[index2]), key1: parseMappingSelect("pairKey1"), key2: parseMappingSelect("pairKey2"), option: { actuation: Number($("#pairActuation").value), press: Number($("#pairPress").value), release: Number($("#pairRelease").value), priority: type === "socd" ? Number($("#pairPriority").value) : 0 } };
    }
    if (type === "cb") {
      const modifiers = $$('[data-setting^="modifier-"]', $("#advancedFields")).filter((input) => input.checked).reduce((sum, input) => sum + Number(input.dataset.setting.split("-")[1]), 0);
      if (!modifiers) return showAdvancedError("Choose at least one modifier.");
      item = { ...base, modifiers, baseKey: parseMappingSelect("comboBase") };
    }
    if (type === "macro") {
      const actions = $$('[data-macro-row]', $("#macroRows")).map((row) => {
        const select = $("select[id^=macroKey]", row);
        const code = Number(select.value.split(",")[2]);
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
      state.profile.travelKeys[item.index2].priority = type === "socd" ? (option.priority === 1 ? 2 : option.priority === 2 ? 1 : 0) : 0;
    }
    const hallChanged = type === "rs" || type === "socd" || displaced.some((entry) => entry.type === "rs" || entry.type === "socd");
    markDirty("advanced", "keymap", ...(hallChanged ? ["hall"] : []));
    log("change", `${ADVANCED_META[type].name} staged on ${physicalName(index1)}`);
    $("#advancedDialog").close(); renderPage(); showToast(`${ADVANCED_META[type].name} staged.`);
  }

  function showAdvancedError(message) { $("#advancedError").textContent = message; }

  function deleteAdvanced(index) {
    const item = state.profile.advancedKeys[index];
    if (!item) return;
    state.profile.advancedKeys.splice(index, 1);
    state.profile.userKeys[item.layer || 0][item.index1] = item.baseMapping || API.makeMapping(255, 255, 255, state.profile.profileIndex, item.layer || 0);
    if (item.index2 != null) state.profile.userKeys[item.layer || 0][item.index2] = item.baseMapping2 || API.makeMapping(255, 255, 255, state.profile.profileIndex, item.layer || 0);
    restorePairTravel(item);
    markDirty("advanced", "keymap", ...(item.type === "rs" || item.type === "socd" ? ["hall"] : []));
    log("change", `${ADVANCED_META[item.type]?.name || item.type} removed`);
    renderPage(); showToast("Advanced action removed and host mapping restored.");
  }

  async function connectKeyboard() {
    try {
      if (state.liveMonitorActive) await stopLiveMonitor(false);
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

  async function loadFile(file) {
    if (!file) return;
    try {
      if (state.liveMonitorActive) await stopLiveMonitor(false);
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

  function openApplyConfirmation() {
    $("#confirmList").innerHTML = [...state.dirty].map((section) => `<span>${esc(({ keymap: "Key mappings (all four layers)", hall: "Hall-effect travel settings", settings: "Polling, tick, debounce, locks, and modes", lighting: "Main and logo lighting", colors: "Per-key color bank", advanced: "Advanced action banks and their host mappings" })[section] || section)}</span>`).join("");
    $("#confirmBackupCheck").checked = false;
    $("#confirmApplyButton").disabled = true;
    $("#confirmDialog").showModal();
  }

  async function applyToKeyboard(event) {
    event.preventDefault();
    $("#confirmDialog").close();
    if (!state.driver || state.source !== "device" || !state.dirty.size) return;
    const dirty = [...state.dirty];
    try {
      if (state.liveMonitorActive) await stopLiveMonitor(false);
      showProgress("Writing staged changes", 0, "Do not disconnect the keyboard.");
      const verified = await state.driver.writeProfile(state.profile, dirty, updateProgress);
      state.profile = normalizeProfile(verified);
      state.original = clone(state.profile);
      state.dirty.clear();
      log("verify", `Applied and verified: ${dirty.join(", ")}`);
      renderPage();
      showToast("All staged changes were written and verified.");
    } catch (error) {
      log("error", "Write or verification failed", error.message);
      showToast(`Write stopped: ${error.message}`, true);
    } finally { hideProgress(); updateChrome(); }
  }

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
    try {
      if (state.liveMonitorActive) await stopLiveMonitor(false);
      showProgress(`Loading profile ${state.pendingProfile + 1}`, 5, "Switching the active onboard slot…");
      await state.driver.setActiveProfile(state.pendingProfile);
      const profile = await state.driver.readProfile(state.pendingProfile, updateProgress);
      setWorkspace(profile, "device", { identity: state.identity, info: state.info });
      log("info", `Switched to onboard profile ${state.pendingProfile + 1}`);
      showToast(`Profile ${state.pendingProfile + 1} loaded.`);
    } catch (error) { log("error", "Profile switch failed", error.message); showToast(error.message, true); }
    finally { state.pendingProfile = null; hideProgress(); }
  }

  async function resetToLanding({ closeDevice = false, stopMonitor = true, message = "" } = {}) {
    if (state.liveFrame) cancelAnimationFrame(state.liveFrame);
    state.liveFrame = 0;
    if (stopMonitor && state.liveMonitorActive && state.driver) {
      try { await stopLiveMonitor(false); } catch (_) { /* the device may already be gone */ }
    }
    state.liveTelemetryUnsubscribe?.();
    state.liveTelemetryUnsubscribe = null;
    state.liveMonitorActive = false;
    state.liveMonitorBusy = false;
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
    state.liveTravel.fill(0);
    state.liveTravelRaw.fill(0);
    state.liveTravelStatus.fill(0);
    $("#workspaceView")?.classList.add("hidden");
    $("#welcomeView")?.classList.remove("hidden");
    updateChrome();
    if (message) showToast(message, true);
  }

  async function returnHome() {
    if (state.profile && state.dirty.size && !window.confirm("Discard the staged workspace and return home? Nothing has been written.")) return;
    await resetToLanding({ closeDevice: true });
  }

  function bindStaticControls() {
    $("#connectButton")?.addEventListener("click", connectKeyboard);
    $("#welcomeConnectButton")?.addEventListener("click", connectKeyboard);
    $("#openFileButton")?.addEventListener("click", () => $("#fileInput")?.click());
    $("#welcomeFileButton")?.addEventListener("click", () => $("#fileInput")?.click());
    $("#fileInput")?.addEventListener("change", (event) => loadFile(event.target.files[0]));
    $("#demoButton")?.addEventListener("click", async () => {
      if (state.driver) { try { await state.driver.close(); } catch (_) { /* no-op */ } }
      state.driver = null; state.identity = null; state.info = null;
      setWorkspace(makeDemoProfile(), "demo", { identity: null, info: null });
      log("info", "Demo workspace opened");
    });
    $("#homeButton")?.addEventListener("click", returnHome);
    $("#sideNav")?.addEventListener("click", async (event) => { const button = event.target.closest("[data-page]"); if (!button) return; if (state.page === "hall" && button.dataset.page !== "hall" && state.liveMonitorActive) await stopLiveMonitor(false); state.page = button.dataset.page; renderPage(); });
    $("#exportButton")?.addEventListener("click", exportProfile);
    $("#revertButton")?.addEventListener("click", revertStaged);
    $("#applyButton")?.addEventListener("click", openApplyConfirmation);
    $("#confirmBackupCheck")?.addEventListener("change", (event) => { $("#confirmApplyButton").disabled = !event.target.checked; });
    $("#confirmApplyButton")?.addEventListener("click", applyToKeyboard);
    $("#confirmSwitchButton")?.addEventListener("click", switchProfile);
    $("#mappingSearch")?.addEventListener("input", (event) => renderMappingGroups(event.target.value));
    $("#clearMappingButton")?.addEventListener("click", clearMapping);
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
    window.addEventListener("beforeunload", () => { if (state.liveMonitorActive && state.driver) void state.driver.stopLiveTelemetry(); });
  }

  renderMiniKeyboard();
  bindStaticControls();
  if (APP_MODE === "live" && !API.HE30Driver.supported()) {
    if ($("#welcomeConnectButton")) $("#welcomeConnectButton").title = "WebHID requires Chrome or Edge on an HTTPS page";
    log("warning", "WebHID is unavailable in this browser");
  }
})();
