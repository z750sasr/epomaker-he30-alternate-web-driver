(function () {
  "use strict";

  const API = window.HE30Control;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const APP_MODE = document.body.dataset.appMode || "live";
  const APP_SCRIPT_URL = document.currentScript?.src || window.location.href;
  const appAssetUrl = (path) => new URL(path, APP_SCRIPT_URL).href;
  const FACTORY_PROFILE_URL = new URL("src/factory_config.json", APP_SCRIPT_URL).href;
  const FACTORY_RESET_SECTIONS = Object.freeze(["advanced", "keymap", "hall", "lighting"]);
  const PROFILE_SHARE_SECTIONS = Object.freeze(["advanced", "keymap", "hall", "settings", "lighting", "colors"]);
  const WOOTING_PROFILE_API_URL = "https://api.wooting.io/public/wootility/profiles";
  // Optional: set this to your own same-origin endpoint that accepts ?code= and returns Wooting's { data: profile } JSON.
  const WOOTING_PROFILE_PROXY_URL = "";
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
  const KEY_UNITS = Object.freeze({ Tab: 1.5, Caps: 1.75, Shift: 2.25, Ctrl: 1.25, Fn: 1.25, Alt: 1.25, Space: 2.75 });
  const keyUnit = (keyItem) => KEY_UNITS[keyItem.label] || 1;
  const keyWidth = (keyItem, unitSize = 70, gapSize = 8) => (keyUnit(keyItem) * unitSize) + ((keyUnit(keyItem) - 1) * gapSize);
  const PHYSICAL_KEYS = HE30_LAYOUT.flat();
  const physicalName = (index) => PHYSICAL_KEYS.find((key) => key.index === Number(index))?.label || `Key ${Number(index) + 1}`;
  const PHYSICAL_HID_CODES = Object.freeze({ 0: 41, 30: 58, 31: 59, 32: 60, 33: 61, 34: 62, 35: 63, 29: 53, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 43, 8: 20, 9: 26, 10: 8, 11: 21, 12: 23, 13: 57, 14: 4, 15: 22, 16: 7, 17: 9, 18: 10, 19: 225, 20: 29, 21: 27, 22: 6, 23: 25, 24: 5, 25: 224, 26: 255, 27: 226, 28: 44 });
  const MODIFIER_CHOICES = Object.freeze([[1, "Left Ctrl"], [2, "Left Shift"], [4, "Left Alt"], [8, "Left GUI"], [16, "Right Ctrl"], [32, "Right Shift"], [64, "Right Alt"], [128, "Right GUI"]]);
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
    { title: "Basic characters", items: [...letters, ...digits, ["Unassigned", 255, 255, 255, "N/A"], ["Space", 16, 0, 44, "Space"], ["Enter", 16, 0, 40, "Enter"], ["Tab", 16, 0, 43, "Tab"], ["Backspace", 16, 0, 42, "Bksp"], ["Escape", 16, 0, 41, "Esc"], ["Windows Key", 16, 8, 0, "Win"]].map((item) => key(...item)) },
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
    const scale = clamp(amount, 0, 1);
    return `#${[0, 2, 4].map((offset) => Math.round(Number.parseInt(normalized.slice(offset, offset + 2), 16) * scale).toString(16).padStart(2, "0")).join("")}`;
  }

  function spectrumLightingColor(hue, value) {
    const normalizedHue = ((Number(hue) % 360) + 360) % 360;
    const chroma = clamp(value, 0, 1);
    const sector = normalizedHue / 60;
    const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
    const [red, green, blue] = sector < 1 ? [chroma, secondary, 0]
      : sector < 2 ? [secondary, chroma, 0]
        : sector < 3 ? [0, chroma, secondary]
          : sector < 4 ? [0, secondary, chroma]
            : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    return `#${[red, green, blue].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function liveStripFramebufferColors() {
    if (!state.liveLightingActive) return null;
    const targets = state.liveLightingColors.slice(LIVE_STRIP_FRAME_START, LIVE_STRIP_FRAME_START + LIVE_STRIP_SEGMENT_COUNT);
    if (targets.some((color) => color && color !== "#000000")) state.liveStripFramebufferDetected = true;
    if (!state.liveStripFramebufferDetected) return null;
    return targets.map((target, index) => state.liveLightingDisplayColors[LIVE_STRIP_FRAME_START + index] || target || "#000000");
  }

  function stripFrameColors(light, timestamp) {
    const framebuffer = liveStripFramebufferColors();
    if (framebuffer) return { colors: framebuffer, source: "framebuffer" };
    const effect = Number(light?.effect);
    const brightness = clamp(light?.brightness, 0, 100) / 100;
    const baseColor = API.normalizeHexColor(light?.color, "#000000");
    if (effect === 2 || brightness === 0) return { colors: new Array(LIVE_STRIP_SEGMENT_COUNT).fill("#000000"), source: "effect" };
    const speed = clamp(light?.speed, 0, 4);
    const time = Number(timestamp) || 0;
    if (effect === 0) {
      const rotation = (time / Math.max(3000, 9000 - speed * 1200)) * 360;
      return { colors: Array.from({ length: LIVE_STRIP_SEGMENT_COUNT }, (_, index) => spectrumLightingColor(rotation + (index * 360 / LIVE_STRIP_SEGMENT_COUNT), brightness)), source: "effect" };
    }
    if (effect === 1) {
      const phase = (time / Math.max(700, 1700 - speed * 220)) * Math.PI * 2;
      return { colors: Array.from({ length: LIVE_STRIP_SEGMENT_COUNT }, (_, index) => scaleLightingColor(baseColor, brightness * (0.12 + 0.88 * ((Math.sin(phase - index * 0.7) + 1) / 2)))), source: "effect" };
    }
    if (effect === 4) {
      const phase = (time / Math.max(1400, 3200 - speed * 400)) * Math.PI * 2;
      const pulse = 0.1 + 0.9 * ((Math.sin(phase - Math.PI / 2) + 1) / 2);
      return { colors: new Array(LIVE_STRIP_SEGMENT_COUNT).fill(scaleLightingColor(baseColor, brightness * pulse)), source: "effect" };
    }
    return { colors: new Array(LIVE_STRIP_SEGMENT_COUNT).fill(scaleLightingColor(baseColor, brightness)), source: "effect" };
  }

  function updateLiveStripUI(timestamp) {
    const device = $("[data-strip-lighting]");
    if (!device || !state.liveLightingActive) return false;
    const light = state.liveStripLight || state.profile.logoLight;
    const frame = stripFrameColors(light, timestamp);
    const segments = $$('[data-strip-segment]', device);
    frame.colors.forEach((color, index) => segments[index]?.style.setProperty("--strip-color", color));
    const representative = frame.colors[Math.floor(frame.colors.length / 2)] || "#000000";
    device.style.setProperty("--strip-color", representative);
    device.style.setProperty("--strip-opacity", "1");
    device.dataset.stripSource = frame.source;
    device.dataset.stripEffect = String(Number(light.effect));
    const strip = $(".light-strip", device);
    if (strip) {
      strip.setAttribute("aria-label", `${lightingEffectName("logoLight", light.effect)} light strip, live ${frame.source === "framebuffer" ? "framebuffer" : "effect"} preview`);
      strip.title = `${lightingEffectName("logoLight", light.effect)} · ${light.brightness}% · Live ${frame.source === "framebuffer" ? "framebuffer" : "effect sync"}`;
    }
    const label = $("span", device);
    if (label) label.textContent = `${lightingEffectName("logoLight", light.effect)} · ${light.brightness}% · Live ${frame.source === "framebuffer" ? "frame" : "effect sync"}`;
    const status = $("#liveStripStatus");
    if (status) {
      status.textContent = state.liveStripError ? "Effect preview" : frame.source === "framebuffer" ? "Live from keyboard" : "Live effect sync";
      status.classList.toggle("live", !state.liveStripError);
    }
    return frame.source === "effect" && [0, 1, 4].includes(Number(light.effect)) && Number(light.brightness) > 0;
  }

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
    for (let index = LIVE_STRIP_FRAME_START; index < LIVE_STRIP_FRAME_START + LIVE_STRIP_SEGMENT_COUNT; index += 1) {
      const target = state.liveLightingColors[index];
      if (!target) continue;
      const current = state.liveLightingDisplayColors[index] || target;
      const next = blendLightingColor(current, target, blend);
      state.liveLightingDisplayColors[index] = next;
      if (next !== target) moving = true;
    }
    state.liveLightingFrameTime = timestamp;
    const stripMoving = updateLiveLightingUI(timestamp);
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
    const stripStatus = $("#liveStripStatus");
    if (stripStatus && !state.liveLightingActive) {
      stripStatus.textContent = state.liveLightingBusy ? "Starting live view" : "1 zone";
      stripStatus.classList.remove("live");
    }
    if (!state.liveLightingActive) return false;
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
    return updateLiveStripUI(timestamp);
  }

  async function pollLiveLighting(generation) {
    if (generation !== state.liveLightingGeneration || !state.liveLightingActive || !state.driver || state.page !== "lighting") return;
    try {
      const colors = await state.driver.readLiveColors();
      if (generation !== state.liveLightingGeneration || state.page !== "lighting") return;
      state.liveLightingColors = colors.map((color) => API.normalizeHexColor(color, "#000000"));
      state.liveLightingUpdatedAt = Date.now();
      state.liveLightingError = "";
      if (state.liveLightingUpdatedAt - state.liveStripUpdatedAt >= LIVE_STRIP_CONFIG_POLL_MS) {
        state.liveStripUpdatedAt = state.liveLightingUpdatedAt;
        try {
          const stripLight = await state.driver.readLiveStripSettings(state.profile.profileIndex);
          if (generation !== state.liveLightingGeneration || state.page !== "lighting") return;
          state.liveStripLight = stripLight;
          state.liveStripError = "";
        } catch (stripError) {
          if (generation !== state.liveLightingGeneration) return;
          if (!state.liveStripError) log("warning", "Live light-strip settings read failed; using the last effect", stripError.message);
          state.liveStripError = stripError.message;
        }
      }
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
    const initialStripColor = state.profile.logoLight.effect === 2 ? "#000000" : API.normalizeHexColor(state.profile.logoLight.color, "#000000");
    for (let index = LIVE_STRIP_FRAME_START; index < LIVE_STRIP_FRAME_START + LIVE_STRIP_SEGMENT_COUNT; index += 1) state.liveLightingDisplayColors[index] = initialStripColor;
    state.liveLightingColors.fill(null);
    state.liveStripLight = clone(state.profile.logoLight);
    state.liveStripUpdatedAt = 0;
    state.liveStripError = "";
    state.liveStripFramebufferDetected = false;
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
      state.liveStripLight = null;
      state.liveStripUpdatedAt = 0;
      state.liveStripError = "";
      state.liveStripFramebufferDetected = false;
      log("warning", "Live RGB framebuffer could not start", error.message);
      updateLiveLightingUI();
    }
  }

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
    state.liveStripLight = null;
    state.liveStripUpdatedAt = 0;
    state.liveStripError = "";
    state.liveStripFramebufferDetected = false;
    updateLiveLightingUI();
    if (state.driver) {
      try { await state.driver.stopLiveTelemetry(); }
      catch (error) { log("warning", "Live RGB diagnostic flag restoration failed", error.message); }
    }
  }

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

  function wootingLookupUrl(code) {
    const base = WOOTING_PROFILE_PROXY_URL || WOOTING_PROFILE_API_URL;
    if (base.includes("{code}")) return base.replace("{code}", encodeURIComponent(code));
    const url = new URL(base, window.location.href);
    url.searchParams.set("code", code);
    return url.href;
  }

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

  function openApplyConfirmation() {
    $("#confirmList").innerHTML = [...state.dirty].map((section) => `<span>${esc(({ keymap: "Key mappings (all four layers)", hall: "Hall-effect travel settings", settings: "Polling, tick, debounce, locks, and modes", lighting: "Main-key and light-strip lighting", colors: "Per-key color bank", advanced: "Advanced action banks and their host mappings" })[section] || section)}</span>`).join("");
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

  renderMiniKeyboard();
  bindStaticControls();
  if (APP_MODE === "live" && !API.HE30Driver.supported()) {
    if ($("#welcomeConnectButton")) $("#welcomeConnectButton").title = "WebHID requires Chrome or Edge on an HTTPS page";
    log("warning", "WebHID is unavailable in this browser");
  }
})();
