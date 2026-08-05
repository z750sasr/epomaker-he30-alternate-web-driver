"use strict";

/**
 * HE30 binary protocol module.
 *
 * Files in js/protocol are ordered classic scripts so the codec remains usable
 * directly from GitHub Pages without bundling. protocol.js is loaded last and
 * exposes the deliberately small public API as window.HE30Control.
 */
/**
 * Protocol constants, byte helpers, mapping names, and Wooting conversion.
 * Nothing in this file contacts a device; its functions only normalize or
 * translate data.
 */
const global = window;

// ---------------------------------------------------------------------------
// Wire-format constants and supported hardware
// ---------------------------------------------------------------------------
// WebHID reports are 64 bytes. Bank reads/writes reserve protocol header bytes,
// leaving 56 payload bytes per transaction.
const REPORT_SIZE = 64;
const CHUNK_SIZE = 56;
const REQUEST_PREFIX = 0x55;
const RESPONSE_PREFIX = 0xaa;
const PROFILE_COUNT = 3;
const LAYER_COUNT = 4;
const TOTAL_LAYER_COUNT = PROFILE_COUNT * LAYER_COUNT;
const KEY_COUNT = 128;
const PROFILE_SHARE_PREFIX = "HE30P1.";
const PROFILE_SHARE_FORMAT = "he30-profile";
const PROFILE_SHARE_MAX_LENGTH = 262144;
const TRAVEL_SHARE_FIELDS = Object.freeze(["switch_type", "key_mode", "priority", "key_max_length", "key_actuation", "rt_press", "rt_release", "pressPrecision", "releasePrecision", "press_deadzone", "release_deadzone", "deadzone_status"]);
const WOOTING_VALUE_MAX = 16383;
const WOOTING_TRAVEL_HUNDREDTHS = 400;
const WOOTING_SHARE_CODE_PATTERN = /^[0-9a-f]{36,40}$/i;
const WOOTING_BASE_COORDINATES = Object.freeze([
  [0, 1, 0],
  [1, 1, 1], [2, 1, 2], [3, 1, 3], [4, 1, 4], [5, 1, 5], [6, 1, 6],
  [7, 2, 0], [8, 2, 1], [9, 2, 2], [10, 2, 3], [11, 2, 4], [12, 2, 5],
  [13, 3, 0], [14, 3, 1], [15, 3, 2], [16, 3, 3], [17, 3, 4], [18, 3, 5],
  [19, 4, 0], [20, 4, 2], [21, 4, 3], [22, 4, 4], [23, 4, 5], [24, 4, 6],
  [25, 5, 0], [26, 5, 1], [27, 5, 2], [28, 5, 6],
]);
const WOOTING_FUNCTION_ROW_COORDINATES = Object.freeze([
  [0, 0, 0], [30, 0, 2], [31, 0, 3], [32, 0, 4], [33, 0, 5], [34, 0, 6], [35, 0, 7],
  [29, 1, 0],
]);
const HE30_PHYSICAL_HID_CODES = Object.freeze({
  0: 41, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 43, 8: 20, 9: 26,
  10: 8, 11: 21, 12: 23, 13: 57, 14: 4, 15: 22, 16: 7, 17: 9, 18: 10,
  19: 225, 20: 29, 21: 27, 22: 6, 23: 25, 24: 5, 25: 224, 27: 226, 28: 44,
  29: 53, 30: 58, 31: 59, 32: 60, 33: 61, 34: 62, 35: 63,
});

// Only normal configuration interfaces belong here. Firmware/bootloader device
// IDs are intentionally excluded from both the filter and public API.
const DEVICE_MODELS = Object.freeze({
  "19f5:fb27": { name: "EPOMAKER HE30", type: 102, multiProfile: false },
  "19f5:fb4c": { name: "EPOMAKER HE30", type: 104, multiProfile: true },
  "19f5:fb79": { name: "EPOMAKER GT60", type: 105, multiProfile: false },
});

const DEVICE_FILTERS = Object.freeze([
  { vendorId: 0x19f5, productId: 0xfb27, usagePage: 0x0001, usage: 0 },
  { vendorId: 0x19f5, productId: 0xfb4c, usagePage: 0x0001, usage: 0 },
  { vendorId: 0x19f5, productId: 0xfb79, usagePage: 0x0001, usage: 0 },
]);

const KEY_NAMES = Object.freeze({
  0: "", 4: "A", 5: "B", 6: "C", 7: "D", 8: "E", 9: "F", 10: "G",
  11: "H", 12: "I", 13: "J", 14: "K", 15: "L", 16: "M", 17: "N",
  18: "O", 19: "P", 20: "Q", 21: "R", 22: "S", 23: "T", 24: "U",
  25: "V", 26: "W", 27: "X", 28: "Y", 29: "Z", 30: "1", 31: "2",
  32: "3", 33: "4", 34: "5", 35: "6", 36: "7", 37: "8", 38: "9",
  39: "0", 40: "Enter", 41: "Esc", 42: "Backspace", 43: "Tab", 44: "Space",
  45: "-", 46: "=", 47: "[", 48: "]", 49: "\\", 51: ";", 52: "'",
  53: "`", 54: ",", 55: ".", 56: "/", 57: "Caps", 58: "F1", 59: "F2",
  60: "F3", 61: "F4", 62: "F5", 63: "F6", 64: "F7", 65: "F8",
  66: "F9", 67: "F10", 68: "F11", 69: "F12", 70: "Print Screen",
  71: "Scroll Lock", 72: "Pause", 73: "Insert", 74: "Home", 75: "Page Up",
  76: "Delete", 77: "End", 78: "Page Down", 79: "Right", 80: "Left",
  81: "Down", 82: "Up", 83: "Num Lock", 84: "Num /", 85: "Num *",
  86: "Num -", 87: "Num +", 88: "Num Enter", 89: "Num 1", 90: "Num 2",
  91: "Num 3", 92: "Num 4", 93: "Num 5", 94: "Num 6", 95: "Num 7",
  96: "Num 8", 97: "Num 9", 98: "Num 0", 99: "Num .", 101: "Menu",
  104: "F13", 105: "F14", 106: "F15", 107: "F16", 108: "F17",
  109: "F18", 110: "F19", 111: "F20", 112: "F21", 113: "F22",
  114: "F23", 115: "F24",
});

const SPECIAL_NAMES = new Map([
  ...Array.from({ length: TOTAL_LAYER_COUNT }, (_, index) => [`255:${index}`, index === 0 ? "FN" : `FN${index}`]),
  ["8:0", "Factory reset (hold 3s)"], ["87:0", "Open EPOMAKER web driver"],
  ["253:0", "Profile 1"], ["252:0", "Profile 2"], ["251:0", "Profile 3"],
  ["4:0", "Windows mode"], ["5:0", "macOS mode"], ["6:0", "Toggle Windows/macOS"],
  ["160:0", "N/ALL"], ["46:0", "RGB Mode+"], ["47:0", "RGB Mode-"],
  ["48:0", "RGB Mode"], ["50:0", "Bright+"], ["51:0", "Bright-"],
  ["53:0", "Bright Off"], ["54:0", "Speed+"], ["55:0", "Speed-"],
  ["60:0", "Color-"], ["61:0", "Color+"], ["62:0", "Color"],
]);

const CONSUMER_NAMES = new Map([
  ["131:1", "Player"], ["233:0", "Volume+"], ["234:0", "Volume-"],
  ["226:0", "Mute"], ["205:0", "Play"], ["183:0", "Stop"],
  ["182:0", "Previous"], ["181:0", "Next"], ["111:0", "Screen Bright+"],
  ["112:0", "Screen Bright-"], ["35:2", "Web Home"], ["39:2", "Web Refresh"],
  ["38:2", "Web Stop"], ["37:2", "Web Forward"], ["36:2", "Web Back"],
  ["42:2", "Web Favorites"], ["33:2", "Web Search"], ["146:1", "Calculator"],
  ["148:1", "Computer"], ["138:1", "Email"], ["207:0", "Siri"],
  ["160:2", "Launchpad"],
]);

// ---------------------------------------------------------------------------
// Small byte and layer helpers
// ---------------------------------------------------------------------------
function hex(value, width = 2) {
  return Number(value).toString(16).toUpperCase().padStart(width, "0");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function profileConfigOffset(profileIndex) {
  return 64 * clamp(profileIndex, 0, PROFILE_COUNT - 1);
}

/** Move factory-relative Fn targets into the destination profile's four layers. */
function translateFactoryFnLayer(sourceGlobalLayer, targetProfileIndex) {
  const source = Number(sourceGlobalLayer);
  const target = Number(targetProfileIndex);
  if (!Number.isInteger(source) || source < 0 || source >= LAYER_COUNT) {
    throw new Error("A factory Fn target must be one of Profile 1's local layers 0 through 3.");
  }
  if (!Number.isInteger(target) || target < 0 || target >= PROFILE_COUNT) {
    throw new Error("A valid target profile is required for Fn translation.");
  }
  return target * LAYER_COUNT + source;
}

function translateProfileFnLayer(globalLayer, sourceProfileIndex, targetProfileIndex) {
  const layer = Number(globalLayer);
  const source = Number(sourceProfileIndex);
  const target = Number(targetProfileIndex);
  if (!Number.isInteger(layer) || layer < 0 || layer >= TOTAL_LAYER_COUNT) throw new Error("A valid global Fn layer is required.");
  if (!Number.isInteger(source) || source < 0 || source >= PROFILE_COUNT || !Number.isInteger(target) || target < 0 || target >= PROFILE_COUNT) {
    throw new Error("Valid source and target profiles are required for Fn translation.");
  }
  const sourceStart = source * LAYER_COUNT;
  if (layer < sourceStart || layer >= sourceStart + LAYER_COUNT) return layer;
  return target * LAYER_COUNT + (layer - sourceStart);
}

function factoryResetPayload(profileIndex) {
  const profile = Number(profileIndex);
  if (!Number.isInteger(profile) || profile < 0 || profile >= PROFILE_COUNT) throw new Error("A valid onboard profile index is required for a profile reset.");
  return [0xee, 0, profile + 1, 1, 0, 0, 0, profile];
}

function factoryResetAllPayload() {
  return [0xee, 0, 0, 1, 0, 0, 0, 0xff];
}

function littleEndian(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function readLittleEndian(low, high) {
  return ((high & 0xff) << 8) | (low & 0xff);
}

function sum8(values) {
  return values.reduce((sum, value) => sum + value, 0) & 0xff;
}

function arraysEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Asynchronous input reports
// ---------------------------------------------------------------------------
// These reports arrive outside normal request/response traffic. The driver must
// recognize and route them before handing a report to a waiting command.
function decodeTelemetryReport(bytes) {
  const report = Array.from(bytes || []);
  if (report[0] !== 0xa0) return null;
  const type = report[1] || 0;
  const code1 = report[2] || 0;
  const code2 = report[3] || 0;
  let keyCode = 0;
  if (type === 16) {
    keyCode = code2;
    if (code1) keyCode = ({ 1: 224, 2: 225, 4: 226, 8: 227, 16: 228, 32: 229, 64: 230, 128: 231 })[code1] || code2;
  } else if (type === 240 && code1 === 255) keyCode = 255;
  return {
    type,
    code1,
    code2,
    keyCode,
    rawTravel: readLittleEndian(report[7] || 0, report[6] || 0),
    status: report[10] || 0,
    report,
  };
}

function decodeProfileChangeReport(bytes) {
  const report = Array.from(bytes || []);
  if (report[0] !== 0xa1) return null;
  const rawLayer = report[1] || 0;
  const reportsGlobalLayer = rawLayer >= LAYER_COUNT && rawLayer < TOTAL_LAYER_COUNT;
  const profileIndex = reportsGlobalLayer
    ? Math.floor(rawLayer / LAYER_COUNT)
    : clamp(report[2] || 0, 0, PROFILE_COUNT - 1);
  const layer = rawLayer % LAYER_COUNT;
  return {
    layer,
    globalLayer: profileIndex * LAYER_COUNT + layer,
    profileIndex,
    rawLayer,
    report,
  };
}

// ---------------------------------------------------------------------------
// Colors and mapping labels
// ---------------------------------------------------------------------------
function normalizeHexColor(value, fallback = "#ff0000") {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split("").map((part) => part + part).join("")}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(value) {
  const color = normalizeHexColor(value).slice(1);
  return {
    r: Number.parseInt(color.slice(0, 2), 16),
    g: Number.parseInt(color.slice(2, 4), 16),
    b: Number.parseInt(color.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${hex(clamp(r, 0, 255))}${hex(clamp(g, 0, 255))}${hex(clamp(b, 0, 255))}`.toLowerCase();
}

function mappingName(mappingOrType, code1, code2) {
  const mapping = typeof mappingOrType === "object" && mappingOrType !== null
    ? mappingOrType
    : { type: Number(mappingOrType), code1: Number(code1), code2: Number(code2) };
  if (!mapping) return "Unassigned";
  if (mapping.type === 255 || mapping.type === 0) return "Unassigned";
  if (mapping.type === 16) {
    const modifiers = [];
    const names = ["Ctrl", "Shift", "Alt", "Win", "Right Ctrl", "Right Shift", "Right Alt", "Right Win"];
    for (let bit = 0; bit < 8; bit += 1) {
      if (mapping.code1 & (1 << bit)) modifiers.push(names[bit]);
    }
    if (mapping.code2) modifiers.push(KEY_NAMES[mapping.code2] || `HID ${mapping.code2}`);
    return modifiers.join("+") || "Unassigned";
  }
  if (mapping.type === 48) return CONSUMER_NAMES.get(`${mapping.code1}:${mapping.code2}`) || "Consumer control";
  if (mapping.type === 240) return SPECIAL_NAMES.get(`${mapping.code1}:${mapping.code2}`) || "Keyboard function";
  if (mapping.type === 32) return ({ 1: "Mouse left", 2: "Mouse right", 4: "Mouse middle", 8: "Mouse forward", 16: "Mouse back" })[mapping.code1] || "Mouse button";
  if (mapping.type === 33) return mapping.code2 === 255 ? "Wheel down" : "Wheel up";
  if (mapping.type === 64) return ({ 1: "Power", 2: "Sleep", 4: "Wake" })[mapping.code1] || "System control";
  if (mapping.type === 112) return `Macro ${mapping.code1 + 1}`;
  if (mapping.type === 144) return "DKS";
  if (mapping.type === 145) return "Toggle";
  if (mapping.type === 146) return "Mod-Tap";
  if (mapping.type === 147) return "Rappy Snappy";
  if (mapping.type === 148) return "SOCD";
  return `Type ${mapping.type}`;
}

/** Create the friendly mapping object used throughout the UI and codecs. */
function makeMapping(type, code1, code2, profile = 0, layer = 0) {
  const mapping = { type, code1, code2, code: -1, name: "", profile, layer };
  mapping.name = mappingName(mapping) === "Unassigned" ? "" : mappingName(mapping);
  return mapping;
}

// ---------------------------------------------------------------------------
// Wooting compatibility conversion
// ---------------------------------------------------------------------------
// Wooting models use layouts and normalized travel values that differ from HE30.
// Conversion first maps physical coordinates, then clamps every unsupported or
// wider value to the HE30 firmware representation.
function normalizeWootingShareCode(value) {
  const source = String(value || "").trim();
  const queryCode = (() => {
    try { return global.URL ? new global.URL(source).searchParams.get("code") || "" : ""; } catch (_) { return ""; }
  })();
  const code = queryCode || source.match(/[0-9a-f]{36,40}/i)?.[0] || "";
  if (!WOOTING_SHARE_CODE_PATTERN.test(code)) throw new Error("Enter a valid 36- or 40-character Wooting share code.");
  return code.toLowerCase();
}

function wootingDistanceToHundredths(value, maximum = WOOTING_TRAVEL_HUNDREDTHS, sourceTravel = WOOTING_TRAVEL_HUNDREDTHS) {
  const normalized = clamp(value, 0, WOOTING_VALUE_MAX);
  const sourceMaximum = clamp(sourceTravel, 1, 1000);
  return clamp(Math.round((normalized / WOOTING_VALUE_MAX) * sourceMaximum), 1, maximum);
}

function wootingKeyboardHid(byte) {
  const value = Number(byte);
  if (value >= 0x01 && value <= 0x2e) return value + 3;
  if (value >= 0x30 && value <= 0x51) return value + 3;
  if (value >= 0x63 && value <= 0x6a) return 0xe0 + (value - 0x63);
  if (value >= 0x6b && value <= 0x76) return 0x68 + (value - 0x6b);
  if (value === 0x77) return 0x65;
  return ({
    0x52: 0x63, 0x53: 0x55, 0x54: 0x38, 0x55: 0x57, 0x56: 0x58,
    0x57: 0x59, 0x58: 0x5a, 0x59: 0x5b, 0x5a: 0x5c, 0x5b: 0x5d,
    0x5c: 0x5e, 0x5d: 0x5f, 0x5e: 0x60, 0x5f: 0x61, 0x60: 0x62,
    0x61: 0x64, 0xed: 0x8a, 0xee: 0x8b, 0xef: 0x92, 0xf0: 0x93,
    0xf1: 0x94, 0xf2: 0x87, 0xf3: 0x88, 0xf4: 0x89, 0xf5: 0x8a,
    0xf6: 0x8b, 0xf7: 0x8c,
  })[value] ?? null;
}

function decodeWootingMapping(value, profile = 0, layer = 0) {
  const byte = Number(typeof value === "object" && value !== null ? value.byte : value);
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
  if (byte === 0) return makeMapping(255, 255, 255, profile, layer);
  const hid = wootingKeyboardHid(byte);
  if (hid !== null) {
    return hid >= 0xe0 && hid <= 0xe7
      ? makeMapping(16, 1 << (hid - 0xe0), 0, profile, layer)
      : makeMapping(16, 0, hid, profile, layer);
  }
  const consumerUsage = ({
    0xc0: 0x00b5, 0xc1: 0x00b6, 0xc2: 0x00cd, 0xc3: 0x00e2,
    0xc4: 0x00e9, 0xc5: 0x00ea, 0xc6: 0x0183, 0xc7: 0x018a,
    0xc8: 0x0192, 0xc9: 0x0194, 0xca: 0x0221, 0xcb: 0x0223,
    0xcc: 0x0224, 0xcd: 0x0225, 0xce: 0x00b7, 0xcf: 0x0227,
    0xd0: 0x022a, 0xd6: 0x0070, 0xd7: 0x006f,
  })[byte];
  if (consumerUsage !== undefined) return makeMapping(48, consumerUsage & 255, consumerUsage >> 8, profile, layer);
  if (byte === 0xd1 || byte === 0xd2) return makeMapping(64, byte === 0xd1 ? 1 : 2, 0, profile, layer);
  if (byte >= 0xd8 && byte <= 0xdc) return makeMapping(32, 1 << (byte - 0xd8), 0, profile, layer);
  if (byte === 0xe5) return makeMapping(240, 253, 0, profile, layer);
  if (byte === 0xe2) return makeMapping(240, 252, 0, profile, layer);
  if (byte === 0xe3) return makeMapping(240, 251, 0, profile, layer);
  return null;
}

function defaultHe30PhysicalMapping(index, profile, layer) {
  const hid = HE30_PHYSICAL_HID_CODES[index];
  if (hid === undefined) return makeMapping(255, 255, 255, profile, layer);
  return hid >= 0xe0 && hid <= 0xe7
    ? makeMapping(16, 1 << (hid - 0xe0), 0, profile, layer)
    : makeMapping(16, 0, hid, profile, layer);
}

function wootingCoordinate(value) {
  if (!value || typeof value !== "object") return "";
  const row = Number(value.rowNr ?? value.row);
  const column = Number(value.colNr ?? value.col ?? value.column);
  return Number.isInteger(row) && Number.isInteger(column) ? `${row}:${column}` : "";
}

function wootingLayerMap(entries) {
  const result = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const coordinate = wootingCoordinate(entry?.index ?? entry?.keyIndex);
    if (coordinate) result.set(coordinate, entry?.value ?? entry?.key ?? entry?.keybind);
  });
  return result;
}

function wootingExplicitTravelHundredths(value) {
  const millimeters = Number(value);
  return Number.isFinite(millimeters) && millimeters >= 0.1 && millimeters <= 10
    ? Math.round(millimeters * 100)
    : null;
}

function wootingTravelValue(value) {
  if (!value || typeof value !== "object") return null;
  for (const field of ["totalTravelMm", "maxTravelMm", "travelMm", "actuationRangeMm", "totalTravel", "maxTravel", "travelDistance", "actuationRange"]) {
    const travel = wootingExplicitTravelHundredths(value[field]);
    if (travel !== null) return travel;
  }
  return null;
}

function wootingSwitchTravel(input, source) {
  const roots = [source, source?.switchSelector, source?.switchSettings, source?.switchConfig];
  if (input !== source) roots.push(input, input?.switchSelector, input?.switchSettings, input?.switchConfig);
  const defaultTravel = roots.map(wootingTravelValue).find((value) => value !== null) ?? WOOTING_TRAVEL_HUNDREDTHS;
  const perCoordinate = new Map();
  roots.forEach((root) => {
    if (!root || typeof root !== "object") return;
    [root.switches, root.keys, root.assignments, root.perKey].forEach((entries) => {
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const coordinate = wootingCoordinate(entry?.index ?? entry?.keyIndex ?? entry?.position);
        const travel = wootingTravelValue(entry);
        if (coordinate && travel !== null) perCoordinate.set(coordinate, travel);
      });
    });
  });
  return {
    detected: defaultTravel !== WOOTING_TRAVEL_HUNDREDTHS || perCoordinate.size > 0,
    defaultTravel,
    perCoordinate,
    forCoordinate(coordinate) { return perCoordinate.get(coordinate) ?? defaultTravel; },
  };
}

function wootingRgbColor(value) {
  if (!value || typeof value !== "object") return null;
  const red = Number(value.red ?? value.r);
  const green = Number(value.green ?? value.g);
  const blue = Number(value.blue ?? value.b);
  return [red, green, blue].every(Number.isFinite) ? rgbToHex(red, green, blue) : null;
}

function wootingDksStatus(entry, action) {
  const state = Number(entry?.[`action${action}`]);
  return Number.isInteger(state) ? state : 3;
}

/** Translate one Wooting DKS entry into the HE30's four-stage byte format. */
function convertWootingDks(item, layer, index, baseMapping, sourceActuation, profile, sourceTravel) {
  const dks = item?.dks;
  if (!dks || typeof dks !== "object") return null;
  const secondary = wootingDistanceToHundredths(dks.secondaryActuation ?? Math.min(WOOTING_VALUE_MAX, sourceActuation * 2), 255, sourceTravel);
  const primary = wootingDistanceToHundredths(sourceActuation, 255, sourceTravel);
  const dksKeys = [];
  for (let action = 0; action < 4; action += 1) {
    const output = decodeWootingMapping(dks[`action${action}`], profile, layer);
    if (!output || output.type === 255) continue;
    const points = [0, 1, 2, 3].map((point) => wootingDksStatus(dks[`point${point}`], action));
    const firstState = (state, indexes) => indexes.find((point) => points[point] === state);
    const pressDown = firstState(1, [0, 1]);
    const pressUp = firstState(2, [0, 1]);
    const releaseDown = firstState(1, [2, 3]);
    const releaseUp = firstState(2, [2, 3]);
    dksKeys.push({
      key: output,
      downStart: pressDown === undefined ? 0 : pressDown + 1,
      downEnd: pressUp === undefined ? 0 : pressUp + 1,
      upStart: releaseDown === undefined ? 0 : (releaseDown === 2 ? 2 : 1),
      upEnd: releaseUp === undefined ? 0 : (releaseUp === 2 ? 2 : 1),
    });
  }
  if (!dksKeys.length) return null;
  return { type: "dks", layer, index1: index, baseMapping, dksPoint: [primary, secondary, secondary, primary], dksKeys };
}

/**
 * Copy supported settings into a clone of targetProfile. Keeping the target as a
 * base preserves HE30-only settings that Wooting cannot represent.
 */
function convertWootingProfile(input, targetProfile) {
  const source = input?.data && typeof input.data === "object" ? input.data : input;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("The Wooting profile response is not a JSON object.");
  if (!Array.isArray(source.remap) || !source.remap.length) throw new Error("This Wooting profile has no key-mapping layers.");
  const result = JSON.parse(JSON.stringify(targetProfile || {}));
  const targetProfileIndex = inferProfileIndex(result);
  result.userKeys ||= {};
  for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
    const mappings = result.userKeys[layer] || result.userKeys[String(layer)] || [];
    result.userKeys[layer] = Array.from({ length: KEY_COUNT }, (_, index) => {
      const mapping = mappings[index];
      return mapping ? { ...mapping, profile: targetProfileIndex, layer } : makeMapping(255, 255, 255, targetProfileIndex, layer);
    });
  }
  result.travelKeys = Array.from({ length: KEY_COUNT }, (_, index) => ({
    switch_type: 0, key_mode: 0, priority: 0, key_max_length: 4, key_actuation: 40,
    rt_press: 10, rt_release: 10, pressPrecision: 0, releasePrecision: 0,
    press_deadzone: 0, release_deadzone: 0, deadzone_status: false,
    ...(result.travelKeys?.[index] || {}),
  }));
  result.advancedKeys = Array.isArray(result.advancedKeys) ? result.advancedKeys.map((item) => ({ ...item })) : [];
  result.light = {
    effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2",
    ...(result.light || {}),
  };
  result.colorKeys = Array.from({ length: KEY_COUNT }, (_, index) => normalizeHexColor(result.colorKeys?.[index], result.light.color));

  const layerCount = Math.min(source.remap.length, LAYER_COUNT);
  const layerMaps = Array.from({ length: layerCount }, (_, layer) => wootingLayerMap(source.remap[layer]));
  const allCoordinates = new Set(layerMaps.flatMap((map) => [...map.keys()]));
  const hasFunctionRow = ["0:0", "0:2", "0:3", "0:4", "0:5", "0:6", "0:7"].every((coordinate) => allCoordinates.has(coordinate));
  const coordinateRows = hasFunctionRow
    ? [...WOOTING_BASE_COORDINATES.filter(([index]) => index !== 0), ...WOOTING_FUNCTION_ROW_COORDINATES]
    : [...WOOTING_BASE_COORDINATES];
  const targetByCoordinate = new Map(coordinateRows.map(([index, row, column]) => [`${row}:${column}`, index]));
  const switchTravel = wootingSwitchTravel(input, source);
  const warnings = [];
  let mappingsCopied = 0;
  let unsupportedMappings = 0;
  const touchedHosts = new Set();
  const mappedPhysicalIndexes = new Set();

  for (let layer = 0; layer < layerCount; layer += 1) {
    coordinateRows.forEach(([index, row, column]) => {
      const coordinate = `${row}:${column}`;
      if (!layerMaps[layer].has(coordinate)) return;
      touchedHosts.add(`${layer}:${index}`);
      mappedPhysicalIndexes.add(index);
      const mapping = decodeWootingMapping(layerMaps[layer].get(coordinate), targetProfileIndex, layer);
      if (!mapping) { unsupportedMappings += 1; return; }
      result.userKeys[layer][index] = mapping;
      mappingsCopied += 1;
    });
  }

  const removedActions = [];
  result.advancedKeys = result.advancedKeys.filter((item) => {
    const layer = clamp(item?.layer, 0, LAYER_COUNT - 1);
    const collides = touchedHosts.has(`${layer}:${Number(item?.index1)}`) || (item?.index2 != null && touchedHosts.has(`${layer}:${Number(item.index2)}`));
    if (collides) removedActions.push(item);
    return !collides;
  });
  removedActions.forEach((item) => {
    const layer = clamp(item?.layer, 0, LAYER_COUNT - 1);
    [Number(item?.index1), Number(item?.index2)].filter(Number.isInteger).forEach((index, position) => {
      if (touchedHosts.has(`${layer}:${index}`)) return;
      result.userKeys[layer][index] = JSON.parse(JSON.stringify((position === 0 ? item.baseMapping : item.baseMapping2) || defaultHe30PhysicalMapping(index, targetProfileIndex, layer)));
    });
  });

  const analog = source.analog && typeof source.analog === "object" ? source.analog : {};
  const customActuations = new Map((Array.isArray(source.customActuations) ? source.customActuations : []).map((entry) => [wootingCoordinate(entry?.index ?? entry?.keyIndex), entry?.value]));
  const perKeyRapidTrigger = new Map((Array.isArray(analog.perKeyRapidTrigger) ? analog.perKeyRapidTrigger : []).map((entry) => [wootingCoordinate(entry?.index ?? entry?.keyIndex), entry?.value]));
  coordinateRows.forEach(([index, row, column]) => {
    const coordinate = `${row}:${column}`;
    if (!allCoordinates.has(coordinate)) return;
    const travel = result.travelKeys[index];
    const maximum = Number(travel.switch_type) === 0 ? 340 : 350;
    const sourceTravel = switchTravel.forCoordinate(coordinate);
    const actuation = customActuations.has(coordinate) ? customActuations.get(coordinate) : analog.actPoint;
    if (Number.isFinite(Number(actuation))) travel.key_actuation = wootingDistanceToHundredths(actuation, maximum, sourceTravel);
    const override = perKeyRapidTrigger.get(coordinate);
    const overrideObject = override && typeof override === "object" ? override : null;
    const enabled = override === undefined ? Boolean(analog.rapidTrigger) : overrideObject ? overrideObject.enabled !== false : Boolean(override);
    const sensitivity = overrideObject?.sensitivity ?? analog.rapidTriggerSensitivity;
    const secondarySensitivity = overrideObject?.secondarySensitivity ?? sensitivity;
    const strict = overrideObject?.strictActuationRange ?? analog.rapidTriggerStrictActuationRange;
    travel.key_mode = enabled ? (strict === false ? 2 : 1) : 0;
    if (Number.isFinite(Number(sensitivity))) travel.rt_press = wootingDistanceToHundredths(sensitivity, maximum, sourceTravel);
    if (Number.isFinite(Number(secondarySensitivity))) travel.rt_release = wootingDistanceToHundredths(secondarySensitivity, maximum, sourceTravel);
    travel.priority = 0;
  });

  const claimedAdvancedHosts = new Set();
  const importedAdvanced = [];
  let advancedSkipped = 0;
  const actionCandidates = [
    ...(Array.isArray(source.akc) ? source.akc : []),
    ...(Array.isArray(source.dks) ? source.dks.map((entry) => ({ keyIndex: entry?.keyIndex ?? entry?.index, layer: entry?.layer ?? 0, dks: entry?.dks ?? entry })) : []),
  ];
  actionCandidates.forEach((item) => {
    const layer = Number(item?.layer ?? 0);
    const coordinate = wootingCoordinate(item?.keyIndex ?? item?.index);
    const index = targetByCoordinate.get(coordinate);
    if (!Number.isInteger(layer) || layer < 0 || layer >= layerCount || index === undefined) { advancedSkipped += 1; return; }
    const hostKey = `${layer}:${index}`;
    const baseMapping = JSON.parse(JSON.stringify(result.userKeys[layer][index]));
    let converted = null;
    if (item.modTap) {
      const tap = decodeWootingMapping(item.modTap.tapKey, targetProfileIndex, layer);
      const hold = decodeWootingMapping(item.modTap.holdKey, targetProfileIndex, layer);
      if (tap && hold) converted = { type: "mt", layer, index1: index, baseMapping, mtClickKey: tap, mtDownKey: hold, mtTime: clamp(item.modTap.holdDuration || 200, 10, 2550) };
    } else if (item.toggleKey) {
      const output = decodeWootingMapping(item.toggleKey.keybind ?? item.toggleKey.key, targetProfileIndex, layer);
      if (output) converted = { type: "tgl", layer, index1: index, baseMapping, tglKey: output };
    } else if (item.rappySnappy || item.socd) {
      const pairConfig = item.rappySnappy || item.socd;
      const pairCoordinate = wootingCoordinate(pairConfig.secondaryKey ?? pairConfig.keyIndex ?? pairConfig.index);
      const index2 = targetByCoordinate.get(pairCoordinate);
      const pairHostKey = `${layer}:${index2}`;
      if (index2 !== undefined && !claimedAdvancedHosts.has(pairHostKey)) {
        const key1 = JSON.parse(JSON.stringify(result.userKeys[layer][index]));
        const key2 = JSON.parse(JSON.stringify(result.userKeys[layer][index2]));
        const baseTravel1 = JSON.parse(JSON.stringify(result.travelKeys[index]));
        const baseTravel2 = JSON.parse(JSON.stringify(result.travelKeys[index2]));
        const priority = item.socd ? ({ 0: 3, 4: 0 })[Number(pairConfig.socd)] : 0;
        if (!item.socd || priority !== undefined) {
          converted = { type: item.socd ? "socd" : "rs", layer, index1: index, index2, baseMapping, baseMapping2: key2, baseTravel1, baseTravel2, key1, key2, option: { actuation: baseTravel1.key_actuation, press: baseTravel1.rt_press, release: baseTravel1.rt_release, priority: priority || 0 } };
        }
      }
    } else if (item.dks) {
      const sourceActuation = customActuations.get(coordinate) ?? analog.actPoint ?? 1638;
      converted = convertWootingDks(item, layer, index, baseMapping, sourceActuation, targetProfileIndex, switchTravel.forCoordinate(coordinate));
    }
    if (!converted || claimedAdvancedHosts.has(hostKey)) { advancedSkipped += 1; return; }
    const tentative = [...result.advancedKeys, ...importedAdvanced, converted];
    try { compileAdvanced({ ...result, advancedKeys: tentative }); } catch (_) { advancedSkipped += 1; return; }
    importedAdvanced.push(converted);
    claimedAdvancedHosts.add(hostKey);
    if (converted.index2 !== undefined) claimedAdvancedHosts.add(`${layer}:${converted.index2}`);
  });
  result.advancedKeys.push(...importedAdvanced);

  const rgb = source.rgb && typeof source.rgb === "object" ? source.rgb : null;
  const hasDynamicRgb = Array.isArray(rgb?.effects?.layers) && rgb.effects.layers.length > 0;
  const staticRgb = Array.isArray(rgb?.kbdArray) && rgb.kbdArray.some(Array.isArray) && !hasDynamicRgb;
  let colorsCopied = 0;
  let firstImportedColor = null;
  if (staticRgb) {
    const copyColor = ([index, row, column]) => {
      const coordinate = `${row}:${column}`;
      if (!allCoordinates.has(coordinate)) return;
      const color = wootingRgbColor(rgb.kbdArray?.[row]?.[column]);
      if (!color) return;
      result.colorKeys[index] = color;
      firstImportedColor ||= color;
      colorsCopied += 1;
    };
    coordinateRows.forEach(copyColor);
    if (!hasFunctionRow) {
      [
        [29, 1, 0], [30, 1, 1], [31, 1, 2], [32, 1, 3],
        [33, 1, 4], [34, 1, 5], [35, 1, 6],
      ].forEach(copyColor);
    }
    if (colorsCopied) {
      result.light.effect = 0;
      result.light.brightness = clamp(Math.round((clamp(rgb.brightness ?? 255, 0, 255) / 255) * 100), 0, 100);
      result.light.singleColor = false;
      if (firstImportedColor) result.light.color = firstImportedColor;
    }
  }

  const sourceTravelValues = coordinateRows
    .map(([, row, column]) => `${row}:${column}`)
    .filter((coordinate) => allCoordinates.has(coordinate))
    .map((coordinate) => switchTravel.forCoordinate(coordinate));
  const minimumSourceTravel = sourceTravelValues.length ? Math.min(...sourceTravelValues) : switchTravel.defaultTravel;
  const maximumSourceTravel = sourceTravelValues.length ? Math.max(...sourceTravelValues) : switchTravel.defaultTravel;

  if (!hasFunctionRow) warnings.push("This compact Wooting layout has no dedicated Grave or F1–F6 positions; those seven HE30 keys were preserved.");
  if (!switchTravel.detected) warnings.push("Wooting share profiles do not include device Switch Selector assignments; Hall distances used Wooting's standard 4.00 mm source range.");
  if (!hasFunctionRow && staticRgb && colorsCopied) warnings.push("On compact Wooting profiles, Preset colors for Grave and F1–F6 mirror Wooting's Esc and 1–6 positions because those physical keys do not exist.");
  if (staticRgb && colorsCopied && colorsCopied < 36) warnings.push(`Static RGB was copied for ${colorsCopied} HE30 keys; remaining key colors were preserved.`);
  if (rgb && !staticRgb) warnings.push("The Wooting main-layer lighting is not a Static color preset, so HE30 Preset Config lighting was preserved.");
  if (unsupportedMappings) warnings.push(`${unsupportedMappings} Wooting mapping${unsupportedMappings === 1 ? " was" : "s were"} unsupported and preserved on HE30.`);
  if (advancedSkipped) warnings.push(`${advancedSkipped} advanced action${advancedSkipped === 1 ? " was" : "s were"} outside the matched keys or not representable on HE30.`);
  if (importedAdvanced.some((item) => item.type === "dks")) warnings.push("DKS transition points were translated to the closest HE30 stages; review them before applying.");
  const sections = ["keymap", "hall"];
  if (removedActions.length || importedAdvanced.length) sections.push("advanced");
  if (colorsCopied) sections.push("lighting", "colors");
  result._workspaceSections = [...new Set([...(result._workspaceSections || []), ...sections])];
  return {
    profile: result,
    summary: {
      name: String(source.name || "Wooting profile"), version: Number(source.version) || 0,
      layerCount, matchedKeyCount: mappedPhysicalIndexes.size, mappingsCopied,
      hallKeysCopied: mappedPhysicalIndexes.size, advancedImported: importedAdvanced.length,
      advancedRemoved: removedActions.length, advancedSkipped, unsupportedMappings,
      hasFunctionRow, layoutKind: hasFunctionRow ? "function-row" : "compact",
      targetDevice: Number(source.target?.device), targetLayout: Number(source.target?.layout),
      staticLightingImported: colorsCopied > 0, colorsCopied,
      brightness: colorsCopied ? result.light.brightness : null,
      switchTravelDetected: switchTravel.detected,
      minimumSourceTravel, maximumSourceTravel,
      sections, warnings,
    },
  };
}
