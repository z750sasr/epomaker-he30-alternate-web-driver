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
 * Shared data, state, and small helpers.
 * Read this file first when learning the UI: it defines the keyboard layout,
 * mapping catalog, central state object, and the render dispatcher used by every
 * page-specific module.
 */

// Small DOM helpers keep the render modules readable. `$` returns one element;
// `$$` always returns a real array, which is convenient for map/forEach.
const API = window.HE30Control;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const APP_MODE = document.body.dataset.appMode || "live";
// foundation.js lives two folders below the site root. Resolve every data and
// image URL from the root so the same scripts work on / and /json_editor/.
const APP_SCRIPT_URL = document.currentScript?.src || window.location.href;
const APP_ROOT_URL = new URL("../../", APP_SCRIPT_URL);
const appAssetUrl = (path) => new URL(path, APP_ROOT_URL).href;
const FACTORY_PROFILE_URL = new URL("src/factory_config.json", APP_ROOT_URL).href;
const FACTORY_RESET_SECTIONS = Object.freeze(["advanced", "keymap", "hall", "lighting"]);
const PROFILE_SHARE_SECTIONS = Object.freeze(["advanced", "keymap", "hall", "settings", "lighting", "colors"]);
const WOOTING_PROFILE_API_URL = "https://api.wooting.io/public/wootility/profiles";
// Optional: set this to your own same-origin endpoint that accepts ?code= and returns Wooting's { data: profile } JSON.
const WOOTING_PROFILE_PROXY_URL = "";
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

// ---------------------------------------------------------------------------
// Physical keyboard and feature catalogs
// ---------------------------------------------------------------------------
// Firmware banks contain 128 slots, but this board exposes 36 physical keys.
// `index` is the slot used by firmware; `label` is only presentation text.
const HE30_LAYOUT = Object.freeze([
  [{ index: 0, label: "Esc" }, { index: 30, label: "F1" }, { index: 31, label: "F2" }, { index: 32, label: "F3" }, { index: 33, label: "F4" }, { index: 34, label: "F5" }, { index: 35, label: "F6" }],
  [{ index: 29, label: "`" }, { index: 1, label: "1" }, { index: 2, label: "2" }, { index: 3, label: "3" }, { index: 4, label: "4" }, { index: 5, label: "5" }, { index: 6, label: "6" }],
  [{ index: 7, label: "Tab" }, { index: 8, label: "Q" }, { index: 9, label: "W" }, { index: 10, label: "E" }, { index: 11, label: "R" }, { index: 12, label: "T" }],
  [{ index: 13, label: "Caps" }, { index: 14, label: "A" }, { index: 15, label: "S" }, { index: 16, label: "D" }, { index: 17, label: "F" }, { index: 18, label: "G" }],
  [{ index: 19, label: "Shift" }, { index: 20, label: "Z" }, { index: 21, label: "X" }, { index: 22, label: "C" }, { index: 23, label: "V" }, { index: 24, label: "B" }],
  [{ index: 25, label: "Ctrl" }, { index: 26, label: "Fn" }, { index: 27, label: "Alt" }, { index: 28, label: "Space" }],
]);
const KEY_UNITS = Object.freeze({ Tab: 1.5, Caps: 1.75, Shift: 2.25, Ctrl: 1.25, Fn: 1.25, Alt: 1.25, Space: 2.75 });
const keyUnit = (keyItem) => KEY_UNITS[keyItem.label] || 1;
const keyWidth = (keyItem, unitSize = 70, gapSize = 8) => (keyUnit(keyItem) * unitSize) + ((keyUnit(keyItem) - 1) * gapSize);
const PHYSICAL_KEYS = HE30_LAYOUT.flat();
const physicalName = (index) => PHYSICAL_KEYS.find((key) => key.index === Number(index))?.label || `Key ${Number(index) + 1}`;
const PHYSICAL_HID_CODES = Object.freeze({ 0: 41, 30: 58, 31: 59, 32: 60, 33: 61, 34: 62, 35: 63, 29: 53, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 43, 8: 20, 9: 26, 10: 8, 11: 21, 12: 23, 13: 57, 14: 4, 15: 22, 16: 7, 17: 9, 18: 10, 19: 225, 20: 29, 21: 27, 22: 6, 23: 25, 24: 5, 25: 224, 26: 255, 27: 226, 28: 44 });
const MODIFIER_CHOICES = Object.freeze([[1, "Left Ctrl"], [2, "Left Shift"], [4, "Left Alt"], [8, "Left GUI"], [16, "Right Ctrl"], [32, "Right Shift"], [64, "Right Alt"], [128, "Right GUI"]]);
// Switch metadata drives the Hall selector, travel scale, comparison table, and
// the two product-image slots shown for each switch.
const SWITCH_TYPES = Object.freeze([
  {
    value: 0, name: "Aurora Purple Switches", short: "AP", color: "#b985ff", maxTravel: 3.4, factory: true,
    images: [
      { src: "images/aurora_purple_1.png", alt: "Aurora Purple magnetic switch close-up", label: "Product close-up" },
      { src: "images/aurora_purple_2.png", alt: "Collection of Aurora Purple magnetic switches", label: "Switch collection" },
    ],
  },
  {
    value: 1, name: "Gateron Jade Pro HE", short: "JP", color: "#7de7ff", maxTravel: 3.5,
    images: [
      { src: "images/gateron_jade_pro_1.webp", alt: "Gateron Jade Pro HE switch close-up", label: "Product close-up" },
      { src: "images/gateron_jade_pro_2.webp", alt: "Gateron Jade Pro HE switches shown from multiple angles", label: "Multi-angle view" },
    ],
  },
  {
    value: 2, name: "Gateron Magnetic Jade Gaming HE", short: "MJ", color: "#66f7c2", maxTravel: 3.5,
    images: [
      { src: "images/gateron_jade_gaming_1.webp", alt: "Gateron Magnetic Jade Gaming HE switch front and rear views", label: "Front and rear" },
      { src: "images/gateron_jade_gaming_2.png", alt: "Collection of Gateron Magnetic Jade Gaming HE switches", label: "Switch collection" },
    ],
  },
  {
    value: 3, name: "Mount Tai GT HE", short: "MT", color: "#ffbe5c", maxTravel: 3.5,
    images: [
      { src: "images/mount_tai_gt_he_1.webp", alt: "Mount Tai GT HE magnetic switches product lineup", label: "Product lineup" },
      { src: "images/mount_tai_gt_he_2.png", alt: "Collection of Mount Tai GT HE magnetic switches", label: "Switch collection" },
    ],
  },
]);
const SWITCH_COMPARISON_ROWS = Object.freeze([
  ["Total travel", "3.4 ± 0.3 mm", "3.5 ± 0.2 mm", "3.5 ± 0.1 mm", "3.5 mm or 3.4 ± 0.2 mm?"],
  ["Initial force", "37 ± 5 gf", "36 ± 5 gf", "36 ± 5 gf", "35 ± 8 gf"],
  ["Bottom-out force", "45 ± 5 gf", "50 ± 10 gf", "50 ± 10 gf", "47 gf"],
  ["Stem material", "POM", "POM", "POM", "UPE Mix"],
  ["Upper housing material", "PC", "PC", "PC", "PC"],
  ["Bottom housing material", "PA", "Nylon/PA?", "PA66", "PC, fused with upper housing"],
  ["Initial magnetic flux", "80 ± 10 Gs", "120 ± 8 Gs", "120 ± 8 Gs", "100 Gs"],
  ["Bottom magnetic flux", "500 ± 10 Gs", "700 ± 30 Gs", "700 ± 30 Gs", "640 Gs"],
  ["Factory lubricated", "?", "Yes", "Yes", "Yes"],
  ["Spring length", "20 mm", "20 mm", "20 mm", "22 mm"],
  ["Lifespan", "?", "100 million", "100 million", "100 million"],
  ["Trigger travel?", "2.5 ± 0.5 mm", "—", "—", "—"],
  ["Light diffuser material", "PMMA", "—", "—", "—"],
  ["Magnetic-flux test basis", "—", "1.2 mm PCB", "1.2 mm PCB", "—"],
]);
// Edit the href values in this block to change the clickable comparison sources.
const SWITCH_SOURCE_LINKS = Object.freeze([
  [{ label: "AliExpress", href: "https://aliexpress.com/item/1005009897745009.html" }],
  [{ label: "Official Gateron website", href: "https://www.gateron.com/products/gateron-magnetic-jade-pro-switch-set" }],
  [{ label: "Official Gateron website", href: "https://www.gateron.com/products/gateron-magnetic-jade-gaming-switch-set" }],
  [
    { label: "MCHOSE Ace 68 Turbo", href: "https://www.mchose.store/products/mchose-ace-68-turbo-full-aluminum-esports-hall-effect-keyboard" },
    { label: "MCHOSE Ace 68 Air", href: "https://www.mchose.store/products/mchose-ace-68-air-hall-effect-magnetic-switch-gaming-keyboard" },
    { label: "AliExpress", href: "https://aliexpress.com/i/1005008778917624.html" },
  ],
]);
const TELEMETRY_INDEX = new Map(Object.entries(PHYSICAL_HID_CODES).map(([index, code]) => [code, Number(index)]));
const LIVE_LIGHTING_SMOOTHING_MS = 72;
const LIVE_STRIP_CONFIG_POLL_MS = 500;
const LIVE_STRIP_FRAME_START = 36;
const LIVE_STRIP_SEGMENT_COUNT = 12;

// ---------------------------------------------------------------------------
// Key-mapping catalog
// ---------------------------------------------------------------------------
// A mapping is the firmware triplet { type, code1, code2 }. These friendly lists
// are UI presets; API.mappingName() performs the reverse triplet-to-label lookup.
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((name, index) => [name, 16, 0, index + 4, name]);
const digits = [["1", 30], ["2", 31], ["3", 32], ["4", 33], ["5", 34], ["6", 35], ["7", 36], ["8", 37], ["9", 38], ["0", 39]].map(([name, code]) => [name, 16, 0, code, name]);
const functionKeys = Array.from({ length: 24 }, (_, index) => {
  const number = index + 1;
  const code = number <= 12 ? number + 57 : number + 91;
  return [`F${number}`, 16, 0, code, `F${number}`];
});
const key = (name, type, code1, code2, short = name) => ({ name, type, code1, code2, short });
const globalLayerNumber = (profileIndex, layer) => clamp(profileIndex, 0, API.PROFILE_COUNT - 1) * API.LAYER_COUNT + clamp(layer, 0, API.LAYER_COUNT - 1);
const globalLayerLabel = (profileIndex, layer) => {
  const number = globalLayerNumber(profileIndex, layer);
  return `Layer ${number}${Number(layer) === 0 ? " · Default" : ` · FN${number}`}`;
};
const fnLayerMappings = Array.from({ length: API.TOTAL_LAYER_COUNT }, (_, index) => key(`${index === 0 ? "FN" : `FN${index}`} · Layer ${index}`, 240, 255, index, index === 0 ? "FN" : `FN${index}`));
const MAPPING_GROUPS = Object.freeze([
  { title: "Basic characters", items: [...letters, ...digits, ["Space", 16, 0, 44, "Space"], ["Enter", 16, 0, 40, "Enter"], ["Tab", 16, 0, 43, "Tab"], ["Backspace", 16, 0, 42, "Bksp"], ["Escape", 16, 0, 41, "Esc"], ["Windows Key", 16, 8, 0, "Win"]].map((item) => key(...item)) },
  { title: "Symbols", items: [["Minus", 45, "-"], ["Equals", 46, "="], ["Left bracket", 47, "["], ["Right bracket", 48, "]"], ["Backslash", 49, "\\"], ["Semicolon", 51, ";"], ["Apostrophe", 52, "'"], ["Grave", 53, "`"], ["Comma", 54, ","], ["Period", 55, "."], ["Slash", 56, "/"]].map(([name, code, short]) => key(name, 16, 0, code, short)) },
  { title: "Function keys", items: functionKeys.map((item) => key(...item)) },
  { title: "Extended keys", items: [["Insert", 73], ["Home", 74], ["Page Up", 75], ["Delete", 76], ["End", 77], ["Page Down", 78], ["Right Arrow", 79], ["Left Arrow", 80], ["Down Arrow", 81], ["Up Arrow", 82], ["Caps Lock", 57], ["Print Screen", 70], ["Scroll Lock", 71], ["Pause", 72], ["Application", 101]].map(([name, code]) => key(name, 16, 0, code)) },
  { title: "Modifiers", items: [key("Left Ctrl", 16, 1, 0, "LCtrl"), key("Left Shift", 16, 2, 0, "LShift"), { ...key("Left Alt", 16, 4, 0, "LAlt"), macName: "Left Option", macShort: "LOption" }, { ...key("Left GUI", 16, 8, 0, "LWin"), macName: "Left Command", macShort: "LCmd" }, key("Right Ctrl", 16, 16, 0, "RCtrl"), key("Right Shift", 16, 32, 0, "RShift"), { ...key("Right Alt", 16, 64, 0, "RAlt"), macName: "Right Option", macShort: "ROption" }, { ...key("Right GUI", 16, 128, 0, "RWin"), macName: "Right Command", macShort: "RCmd" }] },
  { title: "Layers and profiles", items: [...fnLayerMappings, ...[["Profile 1", 253, 0, "P1"], ["Profile 2", 252, 0, "P2"], ["Profile 3", 251, 0, "P3"]].map(([name, code1, code2, short]) => key(name, 240, code1, code2, short))] },
  { title: "Media and applications", items: [["Play / Pause", 205, 0, "Play"], ["Next track", 181, 0, "Next"], ["Previous track", 182, 0, "Prev"], ["Stop", 183, 0, "Stop"], ["Volume up", 233, 0, "Vol+"], ["Volume down", 234, 0, "Vol−"], ["Mute", 226, 0, "Mute"], ["Calculator", 146, 1, "Calc"], ["Browser home", 35, 2, "Home"], ["Browser back", 36, 2, "Back"], ["Browser forward", 37, 2, "Forward"]].map(([name, code1, code2, short]) => key(name, 48, code1, code2, short)) },
  { title: "macOS", macOnly: true, items: [["Siri", 207, 0, "Siri"], ["Launchpad", 160, 2, "Launchpad"]].map(([name, code1, code2, short]) => key(name, 48, code1, code2, short)) },
  { title: "Mouse and system", items: [["Mouse left", 32, 1, 0, "M1"], ["Mouse right", 32, 2, 0, "M2"], ["Mouse middle", 32, 4, 0, "M3"], ["Mouse back", 32, 16, 0, "M4"], ["Mouse forward", 32, 8, 0, "M5"], ["Wheel up", 33, 0, 1, "Wheel+"], ["Wheel down", 33, 0, 255, "Wheel−"], ["Power", 64, 1, 0, "Power"], ["Sleep", 64, 2, 0, "Sleep"], ["Wake", 64, 4, 0, "Wake"]].map(([name, type, code1, code2, short]) => key(name, type, code1, code2, short)) },
  { title: "Keyboard functions", items: [["Factory reset (hold 3s)", 8, 0, "Reset 3s"], ["Open EPOMAKER web driver", 87, 0, "EPOMAKER Web"], ["Windows mode", 4, 0, "WinOS"], ["macOS mode", 5, 0, "MacOS"], ["Toggle Windows / macOS", 6, 0, "Win/Mac"], ["N / All", 160, 0, "N/ALL"], ["RGB mode +", 46, 0, "RGB+"], ["RGB mode −", 47, 0, "RGB−"], ["RGB mode", 48, 0, "RGB"], ["Brightness +", 50, 0, "Bright+"], ["Brightness −", 51, 0, "Bright−"], ["Brightness off", 53, 0, "Light off"], ["Speed +", 54, 0, "Speed+"], ["Speed −", 55, 0, "Speed−"], ["Color +", 61, 0, "Color+"]].map(([name, code1, code2, short]) => key(name, 240, code1, code2, short)) },
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
// The render dispatcher uses this table to update the shared page heading before
// calling the selected page's render function.
const PAGE_META = Object.freeze({
  overview: ["Workspace", "Overview", "Your keyboard at a glance."],
  mapping: ["Remapping", "Key mapping", "Click a key to choose its output on any layer."],
  hall: ["Magnetic switches", "Hall effect", "Tune actuation, Rapid Trigger, precision, and dead zones per key."],
  settings: ["Performance", "Device settings", "Configure polling, scanning, debounce, compatibility, and locks."],
  lighting: ["RGB", "Lighting", "Preview and edit the saved colors for all 36 keys and the light strip."],
  advanced: ["Multi-action behavior", "Advanced functions", "Configure DKS, Mod-Tap, Toggle, pairs, combinations, and macros."],
  profiles: ["Onboard memory", "Onboard profiles", "Read, switch, back up, and configure profiles stored on the keyboard."],
  diagnostics: ["Transparency", "Diagnostics", "Inspect identity, connection state, and the local command log."],
  about: ["Personal", "About me", "fps lover, pc master race, cs2, apex legends, overwatch, AAA games"],
});

// ABOUT ME CUSTOM HTML — edit freely between the START and END comments.
// This markup is intentionally rendered as HTML rather than escaped text.
const ABOUT_ME_HTML = `
  <!-- ABOUT ME: START CUSTOM HTML -->
  <article class="about-me-starter">
    <span class="chip">ABOUT THE CREATOR</span>
    <h2>I'm some kind of a loser in life</h2>
    <p>Hey, I mainly started this project for my own use. If you wandered aroung the Internet, found this and used this, I hope you find it useful!</p>
    <p>And please come to my Steam profile, comment something there so I know that someone actually uses this! It made me feel less alone.</p>
    <p>Additionally, please come to my friend's Steam profile and bash/force/badmouthing him to make a web driver for his FUN60 keyboard.</p>
    <div class="about-me-links">
      <a
        href="https://steamcommunity.com/profiles/76561198317725930/"
        target="_blank"
        rel="noopener noreferrer"
        class="steam-link"
        aria-label="View Steam profile"
      >
        <img
          src="https://cdn.simpleicons.org/steam"
          alt=""
          width="24"
          height="24"
        />
        <span>Steam Profile</span>
      </a>

      <div class="about-me-links">
      <a
        href="https://steamcommunity.com/profiles/76561198746955854"
        target="_blank"
        rel="noopener noreferrer"
        class="steam-link"
        aria-label="View Steam profile"
      >
        <img
          src="https://cdn.simpleicons.org/steam"
          alt=""
          width="24"
          height="24"
        />
        <span>Friend's Steam Profile</span>
      </a>
      <a href="https://github.com/z750sasr" target="_blank" rel="noopener noreferrer">The type of Hub website that I rarely use</a>
    </div>
  </article>
  <!-- ABOUT ME: END CUSTOM HTML -->
`;

// ---------------------------------------------------------------------------
// Central application state
// ---------------------------------------------------------------------------
// The app is intentionally small enough to use one plain state object instead of
// a framework. Render functions read this object; event handlers update it and
// call renderPage(). `profile` is the staged copy and `original` is the rollback
// snapshot. Nothing reaches keyboard flash until applyToKeyboard() is confirmed.
const state = {
  // Workspace identity and current navigation.
  source: "none",
  driver: null,
  identity: null,
  info: null,
  profile: null,
  original: null,
  fileName: "",
  page: "overview",
  layer: 0,

  // Hall editor selection and temporary live/calibration sessions.
  hallSelection: new Set(),
  hallEditSelection: new Set(),
  hallEditPending: false,
  hallWorkspaceView: "tuning",
  hallDrag: null,
  liveMonitorActive: false,
  liveMonitorBusy: false,
  liveTelemetryUnsubscribe: null,
  profileChangeUnsubscribe: null,
  profileSyncBusy: false,
  profileSyncTarget: null,
  profileSyncLayer: 0,
  queuedProfileChange: null,
  liveTravel: new Array(128).fill(0),
  liveTravelRaw: new Array(128).fill(0),
  liveTravelStatus: new Array(128).fill(0),
  liveLastIndex: 0,
  liveFrame: 0,
  calibrationActive: false,
  calibrationBusy: false,
  calibrationOperationPromise: null,
  calibrationUnsubscribe: null,
  calibrationStatus: new Array(128).fill(null),
  calibrationTravelRaw: new Array(128).fill(0),
  calibrationLastIndex: null,

  // Live lighting uses a polled target color array plus a smoothed display array.
  liveLightingActive: false,
  liveLightingBusy: false,
  liveLightingTimer: 0,
  liveLightingGeneration: 0,
  liveLightingColors: new Array(128).fill(null),
  liveLightingDisplayColors: new Array(128).fill(null),
  liveLightingFrame: 0,
  liveLightingFrameTime: 0,
  liveLightingUpdatedAt: 0,
  liveLightingError: "",
  liveStripLight: null,
  liveStripUpdatedAt: 0,
  liveStripError: "",
  liveStripFramebufferDetected: false,

  // Staged edits and modal/editor state.
  colorSelection: new Set([0]),
  dirty: new Set(),
  logs: [],
  mappingIndex: null,
  mappingPickerTarget: null,
  mappingPickerScope: "all",
  advancedEditIndex: null,
  advancedType: null,
  pendingProfile: null,
  factoryResetBusy: false,

  // Profile sharing and Wooting import are kept separate so either panel can
  // show its own progress/error state without affecting the other.
  shareExportCode: "",
  shareImportText: "",
  shareImportProfile: null,
  shareStatus: "",
  shareError: false,
  shareBusy: false,
  wootingCode: "",
  wootingJson: "",
  wootingImport: null,
  wootingStatus: "",
  wootingError: false,
  wootingBusy: false,
  profileDisclosureOpen: { wooting: false, sharing: false },
  advancedLayer: 0,
  advancedHostSelection: [],
  advancedHostSlot: 0,
};

// ---------------------------------------------------------------------------
// Profile defaults and normalization
// ---------------------------------------------------------------------------
function mappingFromPreset(preset, layer = state.layer) {
  const macMode = Number(state.profile?.deviceSettings?.systemMode) === 1;
  return { type: preset.type, code1: preset.code1, code2: preset.code2, code: preset.type === 16 && preset.code1 === 0 ? preset.code2 : -1, name: (macMode && preset.macShort) || preset.short || preset.name, profile: state.profile?.profileIndex || 0, layer };
}

function mappingLabel(mapping) {
  if (!mapping || mapping.type === 255) return "Unassigned";
  if (Number(state.profile?.deviceSettings?.systemMode) === 1 && mapping.type === 16 && mapping.code1) {
    const names = ["Ctrl", "Shift", "Option", "Command", "Right Ctrl", "Right Shift", "Right Option", "Right Command"];
    const modifiers = names.filter((_, bit) => mapping.code1 & (1 << bit));
    if (mapping.code2) modifiers.push(API.mappingName(16, 0, mapping.code2));
    return modifiers.join("+") || "Unassigned";
  }
  return mapping.name || API.mappingName(mapping.type, mapping.code1, mapping.code2);
}

function defaultMappingForPhysical(index, layer = 0) {
  const profileIndex = state.profile?.profileIndex || 0;
  if (Number(index) === 26) return API.makeMapping(240, 255, globalLayerNumber(profileIndex, 1), profileIndex, layer);
  const hidCode = PHYSICAL_HID_CODES[Number(index)];
  if (hidCode == null || hidCode === 255) return API.makeMapping(255, 255, 255, profileIndex, layer);
  return hidCode >= 224 && hidCode <= 231
    ? API.makeMapping(16, 1 << (hidCode - 224), 0, profileIndex, layer)
    : API.makeMapping(16, 0, hidCode, profileIndex, layer);
}

function defaultTravel() {
  return { switch_type: 0, key_mode: 0, priority: 0, key_max_length: 4, key_actuation: 40, rt_press: 10, rt_release: 10, pressPrecision: 0, releasePrecision: 0, press_deadzone: 0, release_deadzone: 0, deadzone_status: false };
}

function defaultSettings() {
  return { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, tachyonMode: false, systemMode: 0 };
}

function makeDemoProfile() {
  const userKeys = {};
  for (let layer = 0; layer < API.LAYER_COUNT; layer += 1) {
    userKeys[layer] = Array.from({ length: 128 }, (_, index) => API.makeMapping(255, 255, 255, 0, layer));
    PHYSICAL_KEYS.forEach(({ index }) => {
      if (layer === 0 && index !== 26 && PHYSICAL_HID_CODES[index] != null) {
        const hidCode = PHYSICAL_HID_CODES[index];
        userKeys[layer][index] = hidCode >= 224 && hidCode <= 231
          ? API.makeMapping(16, 1 << (hidCode - 224), 0, 0, layer)
          : API.makeMapping(16, 0, hidCode, 0, layer);
      }
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

/**
 * Convert vendor JSON, shared JSON, or demo data into one predictable shape.
 * Every later module can then safely assume four 128-entry mapping layers, one
 * 128-entry Hall bank, complete lighting objects, and default device settings.
 */
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
  profile.profileIndex = API.inferProfileIndex(profile);
  profile.name ||= `Keyboard Profile ${profile.profileIndex + 1}`;
  const keys = profile.userKeys || {};
  profile.userKeys = {};
  for (let layer = 0; layer < API.LAYER_COUNT; layer += 1) {
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

// ---------------------------------------------------------------------------
// Shared feedback and workspace lifecycle
// ---------------------------------------------------------------------------
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

/** Install a normalized profile as both the staged workspace and rollback copy. */
function setWorkspace(profile, source, metadata = {}) {
  const previousPage = state.page;
  const previousLayer = state.layer;
  state.profile = normalizeProfile(profile);
  state.original = clone(state.profile);
  state.source = source;
  state.identity = metadata.identity || state.identity;
  state.info = metadata.info || state.info;
  state.fileName = metadata.fileName || state.fileName;
  state.layer = clamp(metadata.layer ?? (metadata.preserveView ? previousLayer : 0), 0, API.LAYER_COUNT - 1);
  state.page = metadata.preserveView ? previousPage : "overview";
  state.dirty.clear();
  state.hallSelection = new Set();
  state.hallEditSelection = new Set();
  state.hallEditPending = false;
  state.colorSelection = new Set([0]);
  state.shareExportCode = "";
  state.shareImportText = "";
  state.shareImportProfile = null;
  state.shareStatus = "";
  state.shareError = false;
  state.wootingCode = "";
  state.wootingJson = "";
  state.wootingImport = null;
  state.wootingStatus = "";
  state.wootingError = false;
  state.wootingBusy = false;
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

/**
 * Mark firmware banks that must be written. Keeping this bank-level set is what
 * lets applyToKeyboard() avoid rewriting unrelated settings.
 */
function markDirty(...sections) {
  sections.forEach((section) => {
    state.dirty.add(section);
    if (state.profile && !state.profile._workspaceSections.includes(section)) state.profile._workspaceSections.push(section);
  });
  updateChrome();
}

function renderMiniKeyboard() {
  if ($("#welcomeKeyboard")) $("#welcomeKeyboard").innerHTML = HE30_LAYOUT.map((row, rowIndex) => `<div class="mini-row">${row.map((keyItem, keyIndex) => `<i class="mini-key${(rowIndex + keyIndex) % 7 === 2 ? " glow" : ""}" style="--mini-key-width:${keyWidth(keyItem, 56, 7)}px"></i>`).join("")}</div>`).join("");
}

/** Render the active page, then bind controls created by that render. */
function renderPage() {
  if (!state.profile) return;
  const [eyebrow, title, description] = PAGE_META[state.page];
  $("#pageEyebrow").textContent = eyebrow;
  $("#pageTitle").textContent = title;
  $("#pageDescription").textContent = description;
  const renderers = { overview: renderOverview, mapping: renderMapping, hall: renderHall, settings: renderSettings, lighting: renderLighting, advanced: renderAdvanced, profiles: renderProfiles, diagnostics: renderDiagnostics, about: renderAboutMe };
  $("#pageContent").innerHTML = renderers[state.page]();
  bindPageControls();
  updateChrome();
}
