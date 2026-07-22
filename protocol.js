"use strict";

(function exposeHE30Protocol(global) {
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

  function hex(value, width = 2) {
    return Number(value).toString(16).toUpperCase().padStart(width, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function profileConfigOffset(profileIndex) {
    return 64 * clamp(profileIndex, 0, PROFILE_COUNT - 1);
  }

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

  function makeMapping(type, code1, code2, profile = 0, layer = 0) {
    const mapping = { type, code1, code2, code: -1, name: "", profile, layer };
    mapping.name = mappingName(mapping) === "Unassigned" ? "" : mappingName(mapping);
    return mapping;
  }

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

  function inferProfileIndex(profile) {
    const explicit = profile?.profileIndex ?? profile?.profile;
    if (explicit !== undefined && explicit !== null && Number.isFinite(Number(explicit))) {
      return clamp(Number(explicit), 0, PROFILE_COUNT - 1);
    }
    const layers = profile?.userKeys || {};
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      const mappings = layers[layer] || layers[String(layer)] || [];
      const embedded = mappings.find((mapping) => mapping && Number.isFinite(Number(mapping.profile)))?.profile;
      if (embedded !== undefined) return clamp(Number(embedded), 0, PROFILE_COUNT - 1);
    }
    return 0;
  }

  function decodeMappings(bytes, profile, layer) {
    const mappings = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      const [type = 255, code1 = 255, code2 = 255] = bytes.slice(index * 3, index * 3 + 3);
      mappings.push(makeMapping(type, code1, code2, profile, layer));
    }
    return mappings;
  }

  function encodeMappings(mappings) {
    const bytes = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      const mapping = mappings[index] || { type: 255, code1: 255, code2: 255 };
      bytes.push(mapping.type & 0xff, mapping.code1 & 0xff, mapping.code2 & 0xff);
    }
    return bytes;
  }

  function decodeTravel(bytes) {
    const keys = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      const data = bytes.slice(index * 8, index * 8 + 8);
      const pressDeadzone = (data[5] >> 1) & 0x7f;
      const releaseDeadzone = (data[7] >> 1) & 0x7f;
      keys.push({
        switch_type: data[0] & 0x0f,
        key_mode: data[1] & 0x0f,
        priority: (data[1] >> 4) & 0x0f,
        key_max_length: 4,
        key_actuation: readLittleEndian(data[2], data[3] & 1) + 1,
        rt_press: readLittleEndian(data[4], data[5] & 1) + 1,
        rt_release: readLittleEndian(data[6], data[7] & 1) + 1,
        pressPrecision: (data[3] >> 3) & 3,
        releasePrecision: (data[3] >> 1) & 3,
        press_deadzone: pressDeadzone,
        release_deadzone: releaseDeadzone,
        deadzone_status: pressDeadzone > 0 && releaseDeadzone > 0,
      });
    }
    return keys;
  }

  function encodeTravel(keys) {
    const bytes = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      const key = keys[index] || {};
      const data = new Array(8).fill(0);
      data[0] = 0xa0 | (clamp(key.switch_type, 0, 15) & 0x0f);
      data[1] = (clamp(key.key_mode, 0, 15) & 0x0f) | ((clamp(key.priority, 0, 15) & 0x0f) << 4);
      const actuation = littleEndian(Math.max(0, clamp(key.key_actuation || 1, 1, 511) - 1));
      const press = littleEndian(Math.max(0, clamp(key.rt_press || 1, 1, 511) - 1));
      const release = littleEndian(Math.max(0, clamp(key.rt_release || 1, 1, 511) - 1));
      data[2] = actuation[0];
      data[3] = (actuation[1] & 1) | ((clamp(key.pressPrecision, 0, 3) & 3) << 3) | ((clamp(key.releasePrecision, 0, 3) & 3) << 1);
      data[4] = press[0];
      data[5] = (press[1] & 1) | ((clamp(key.press_deadzone, 0, 127) & 0x7f) << 1);
      data[6] = release[0];
      data[7] = (release[1] & 1) | ((clamp(key.release_deadzone, 0, 127) & 0x7f) << 1);
      bytes.push(...data);
    }
    return bytes;
  }

  function dksStatusToBits(value) {
    const status = clamp(value, 0, 4);
    return (status > 0 ? 1 : 0) | ((status > 1 ? 1 : 0) << 1) | ((status > 2 ? 1 : 0) << 2);
  }

  function decodeDksStatuses(fields) {
    let downStart = 0;
    let downEnd = 0;
    let upStart = 0;
    let upEnd = 0;
    if (fields.action0 & 1) downStart = 1;
    if ((fields.action0 >> 1) & 1) downStart = 2;
    if ((fields.action0 >> 2) & 1) downStart = 3;
    if (fields.action1 & 1) downEnd = 1;
    if ((fields.action1 >> 1) & 1) downEnd = 2;
    if ((fields.action1 >> 2) & 1) downEnd = 3;
    if (fields.action2 & 1) upStart = 1;
    if ((fields.action2 >> 1) & 1) upStart = 2;
    if (fields.action3 & 1) upEnd = 1;
    if (downEnd === 3 && downStart === 3) {
      downStart = 4;
      downEnd = 0;
      if (upStart === 0) downStart = 3;
      else upStart = 0;
    }
    if (downEnd === 3 && upStart === 2) upStart = 0;
    return { downStart, downEnd, upStart, upEnd };
  }

  function decodeDksBank(bytes) {
    const entries = [];
    for (let index = 0; index < 32; index += 1) {
      const start = index * 24;
      const keys = [];
      for (let action = 0; action < 4; action += 1) {
        const offset = start + 4 + action * 5;
        const key = makeMapping(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
        const bits = readLittleEndian(bytes[offset + 3], bytes[offset + 4]);
        const statuses = decodeDksStatuses({
          action0: bits & 7,
          action1: (bits >> 3) & 7,
          action2: (bits >> 6) & 7,
          action3: (bits >> 9) & 1,
        });
        keys.push({ key, ...statuses });
      }
      entries.push({ dksPoint: bytes.slice(start, start + 4), dksKeys: keys });
    }
    return entries;
  }

  function encodeDksBank(items) {
    const bytes = new Array(1024).fill(0);
    items.slice(0, 32).forEach((item, index) => {
      const start = index * 24;
      const points = item.dksPoint || [10, 30, 30, 10];
      for (let point = 0; point < 4; point += 1) bytes[start + point] = clamp(points[point] || 10, 1, 255);
      (item.dksKeys || []).slice(0, 4).forEach((entry, action) => {
        const offset = start + 4 + action * 5;
        const key = entry.key || { type: 0, code1: 0, code2: 0 };
        bytes[offset] = key.type & 0xff;
        bytes[offset + 1] = key.code1 & 0xff;
        bytes[offset + 2] = key.code2 & 0xff;
        let downStart = entry.downStart || 0;
        let downEnd = entry.downEnd || 0;
        let upStart = entry.upStart || 0;
        const upEnd = entry.upEnd || 0;
        if (downStart === 4) {
          downStart = 3;
          downEnd = 3;
          upStart = 2;
        } else if (downStart === 3) {
          downStart = 3;
          downEnd = 2;
        }
        if (downEnd === 3) upStart = 2;
        const bits = (dksStatusToBits(downStart) & 7)
          | ((dksStatusToBits(downEnd) & 7) << 3)
          | ((dksStatusToBits(upStart) & 7) << 6)
          | ((dksStatusToBits(upEnd) & 1) << 9);
        const encoded = littleEndian(bits);
        bytes[offset + 3] = encoded[0];
        bytes[offset + 4] = encoded[1];
      });
    });
    return bytes;
  }

  function decodeMtBank(bytes) {
    const entries = [];
    for (let index = 0; index < 32; index += 1) {
      const offset = index * 6;
      entries.push({
        clickKey: makeMapping(bytes[offset], bytes[offset + 1], bytes[offset + 2]),
        downKey: makeMapping(bytes[offset + 3], bytes[offset + 4], bytes[offset + 5]),
      });
    }
    return entries;
  }

  function encodeMtBank(items) {
    const bytes = new Array(256).fill(0);
    items.slice(0, 32).forEach((item, index) => {
      const offset = index * 6;
      const click = item.mtClickKey || item.clickKey || { type: 0, code1: 0, code2: 0 };
      const down = item.mtDownKey || item.downKey || { type: 0, code1: 0, code2: 0 };
      bytes.splice(offset, 6, click.type & 0xff, click.code1 & 0xff, click.code2 & 0xff, down.type & 0xff, down.code1 & 0xff, down.code2 & 0xff);
    });
    return bytes;
  }

  function decodeTglBank(bytes) {
    const entries = [];
    for (let index = 0; index < 32; index += 1) {
      const offset = index * 3;
      entries.push(makeMapping(bytes[offset], bytes[offset + 1], bytes[offset + 2]));
    }
    return entries;
  }

  function encodeTglBank(items) {
    const bytes = new Array(128).fill(0);
    items.slice(0, 32).forEach((item, index) => {
      const key = item.tglKey || item || { type: 0, code1: 0, code2: 0 };
      bytes.splice(index * 3, 3, key.type & 0xff, key.code1 & 0xff, key.code2 & 0xff);
    });
    return bytes;
  }

  function decodeMacros(bytes) {
    const macros = [];
    const modifierCodes = [224, 225, 226, 227, 228, 229, 230, 231];
    for (let slot = 0; slot < 32; slot += 1) {
      let offset = readLittleEndian(bytes[slot * 2], bytes[slot * 2 + 1]);
      if (offset === 0 || offset === 64 || offset >= bytes.length) {
        macros.push([]);
        continue;
      }
      const actions = [];
      for (let guard = 0; guard < 512 && offset + 3 < bytes.length; guard += 1) {
        const delay = readLittleEndian(bytes[offset], bytes[offset + 1]);
        const flags = bytes[offset + 2];
        const payload = bytes[offset + 3];
        const kind = flags & 0x3f;
        const down = Boolean((flags >> 6) & 1);
        const last = Boolean((flags >> 7) & 1);
        let code = payload;
        if (kind === 1) {
          const bit = Math.log2(payload || 1);
          code = modifierCodes[Number.isFinite(bit) ? bit : 0];
        }
        actions.push({ action: down ? "keydown" : "keyup", code, delay, kind: kind === 3 ? "mouse" : "key" });
        offset += 4;
        if (last) break;
      }
      macros.push(actions);
    }
    return macros;
  }

  function encodeMacros(items) {
    const header = new Array(64).fill(0);
    const records = [];
    let offset = 68;
    for (let slot = 0; slot < 32; slot += 1) {
      const item = items[slot];
      const actions = item?.actions || item?.macroActions || [];
      if (!actions.length) {
        header[slot * 2] = 64;
        header[slot * 2 + 1] = 0;
        continue;
      }
      const encodedOffset = littleEndian(offset);
      header[slot * 2] = encodedOffset[0];
      header[slot * 2 + 1] = encodedOffset[1];
      actions.forEach((action, actionIndex) => {
        const delay = littleEndian(clamp(action.delay, 0, 65535));
        const code = clamp(action.code, 0, 255);
        const isModifier = code >= 224 && code <= 231;
        const isMouse = action.kind === "mouse" || /^mouse/.test(action.action || "");
        const kind = isModifier ? 1 : isMouse ? 3 : 2;
        const down = /down$/.test(action.action || "keydown") ? 1 : 0;
        const last = actionIndex === actions.length - 1 ? 1 : 0;
        const flags = kind | (down << 6) | (last << 7);
        const payload = isModifier ? 1 << (code & 15) : code;
        records.push(delay[0], delay[1], flags, payload & 0xff);
        offset += 4;
      });
    }
    return [...header, 0, 0, 128, 0, ...records, ...new Array(Math.max(0, 2048 - 68 - records.length)).fill(0)].slice(0, 2048);
  }

  function decodeDeviceSettings(config) {
    return {
      lockWin: Boolean(config[6] & 1),
      lockAltTab: Boolean((config[6] >> 1) & 1),
      lockAltF4: Boolean((config[6] >> 2) & 1),
      reportRate: config[4] & 0x0f,
      tickRate: (config[4] >> 4) & 0x0f,
      debounce: (config[7] >> 5) & 7,
      stabilityMode: (config[7] >> 1) & 1,
      checkMode: Boolean((config[7] >> 2) & 1),
      tachyonMode: Boolean(config[7] & 1),
      systemMode: config[1] & 0x0f,
    };
  }

  function applyDeviceSettings(configBytes, settings) {
    const config = Array.from(configBytes || new Array(64).fill(0));
    while (config.length < 64) config.push(0);
    const preservedTachyonBit = typeof settings.tachyonMode === "boolean" ? (settings.tachyonMode ? 1 : 0) : (config[7] & 1);
    config[6] = (config[6] & 0xf8)
      | (settings.lockWin ? 1 : 0)
      | (settings.lockAltTab ? 2 : 0)
      | (settings.lockAltF4 ? 4 : 0);
    config[4] = (clamp(settings.reportRate, 0, 15) & 0x0f) | ((clamp(settings.tickRate, 0, 15) & 0x0f) << 4);
    config[7] = (config[7] & 0x18)
      | ((clamp(settings.debounce, 0, 7) & 7) << 5)
      | (settings.stabilityMode ? 2 : 0)
      | (settings.checkMode ? 4 : 0)
      | preservedTachyonBit;
    config[1] = (config[1] & 0xf0) | (clamp(settings.systemMode, 0, 15) & 0x0f);
    return config;
  }

  function decodeLighting(config) {
    return {
      light: {
        effect: config[8], brightness: config[9], speed: 4 - config[10], direction: config[11],
        singleColor: config[12] === 0, color: rgbToHex(config[14], config[15], config[16]),
      },
      logoLight: {
        effect: config[24], brightness: config[25], speed: 4 - config[26], direction: config[27],
        singleColor: config[27] === 0, color: rgbToHex(config[29], config[30], config[31]),
      },
    };
  }

  function applyLighting(configBytes, light, logoLight) {
    const config = Array.from(configBytes || new Array(64).fill(0));
    while (config.length < 64) config.push(0);
    if (light) {
      const color = hexToRgb(light.color);
      config[8] = clamp(light.effect, 0, 255);
      config[9] = clamp(light.brightness, 0, 100);
      config[10] = clamp(4 - Number(light.speed || 0), 0, 4);
      config[11] = clamp(light.direction, 0, 255);
      config[12] = light.singleColor ? 0 : 1;
      config[14] = color.r; config[15] = color.g; config[16] = color.b;
    }
    if (logoLight) {
      const color = hexToRgb(logoLight.color);
      config[24] = clamp(logoLight.effect, 0, 255);
      config[25] = clamp(logoLight.brightness, 0, 100);
      config[26] = clamp(4 - Number(logoLight.speed || 0), 0, 4);
      config[27] = logoLight.singleColor ? 0 : clamp(logoLight.direction || 1, 1, 255);
      config[29] = color.r; config[30] = color.g; config[31] = color.b;
    }
    return config;
  }

  function decodeColors(bytes) {
    const colors = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      colors.push(rgbToHex(bytes[index * 3], bytes[index * 3 + 1], bytes[index * 3 + 2]));
    }
    return colors;
  }

  function encodeColors(colors) {
    const bytes = [];
    for (let index = 0; index < KEY_COUNT; index += 1) {
      const color = hexToRgb(colors[index] || "#000000");
      bytes.push(color.r, color.g, color.b);
    }
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    let binary;
    try { binary = global.atob(padded); } catch (_) { throw new Error("The profile share code contains invalid Base64 data."); }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function gzipTransform(bytes, decompress = false) {
    const Stream = decompress ? global.DecompressionStream : global.CompressionStream;
    if (!Stream || !global.Blob || !global.Response || !global.TextEncoder || !global.TextDecoder || !global.btoa || !global.atob) {
      throw new Error("Compressed profile sharing requires a current Chrome or Edge browser.");
    }
    const stream = new global.Blob([bytes]).stream().pipeThrough(new Stream("gzip"));
    if (decompress) {
      const reader = stream.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1048576) {
          await reader.cancel();
          throw new Error("The decompressed profile share code is too large.");
        }
        chunks.push(value);
      }
      const output = new Uint8Array(length);
      let offset = 0;
      chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; });
      return output;
    }
    return new Uint8Array(await new global.Response(stream).arrayBuffer());
  }

  function compactProfileForShare(profile) {
    const profileIndex = inferProfileIndex(profile);
    const keymaps = Array.from({ length: LAYER_COUNT }, (_, layer) => {
      const mappings = profile.userKeys?.[layer] || profile.userKeys?.[String(layer)] || [];
      if (mappings.length < KEY_COUNT) throw new Error(`Layer ${layer} does not contain ${KEY_COUNT} mappings.`);
      return mappings.slice(0, KEY_COUNT).map((mapping) => [Number(mapping.type), Number(mapping.code1), Number(mapping.code2)]);
    });
    if (!Array.isArray(profile.travelKeys) || profile.travelKeys.length < KEY_COUNT) throw new Error(`The profile does not contain ${KEY_COUNT} Hall records.`);
    return {
      n: String(profile.name || `Keyboard Profile ${profileIndex + 1}`).slice(0, 200),
      i: profileIndex,
      k: keymaps,
      t: profile.travelKeys.slice(0, KEY_COUNT).map((record) => TRAVEL_SHARE_FIELDS.map((field) => field === "deadzone_status" ? Boolean(record[field]) : Number(record[field]))),
      a: JSON.parse(JSON.stringify(profile.advancedKeys || [])),
      l: JSON.parse(JSON.stringify(profile.light || {})),
      s: JSON.parse(JSON.stringify(profile.logoLight || {})),
      c: Array.from(profile.colorKeys || []).slice(0, KEY_COUNT),
      d: JSON.parse(JSON.stringify(profile.deviceSettings || {})),
      r: Array.from(profile._rawConfig || []).slice(0, 64),
    };
  }

  function requireShareInteger(value, min, max, message) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(message);
    return value;
  }

  function expandProfileSharePayload(payload) {
    if (!payload || payload.f !== PROFILE_SHARE_FORMAT || payload.v !== 1 || !payload.p || typeof payload.p !== "object") {
      throw new Error("This is not a supported HE30 profile share code.");
    }
    const packed = payload.p;
    const profileIndex = requireShareInteger(packed.i, 0, PROFILE_COUNT - 1, "The shared source profile is invalid.");
    if (!Array.isArray(packed.k) || packed.k.length !== LAYER_COUNT) throw new Error("The shared profile must contain exactly four mapping layers.");
    const userKeys = {};
    packed.k.forEach((layerMappings, layer) => {
      if (!Array.isArray(layerMappings) || layerMappings.length !== KEY_COUNT) throw new Error(`Shared layer ${layer} must contain exactly ${KEY_COUNT} mappings.`);
      userKeys[layer] = layerMappings.map((triplet, index) => {
        if (!Array.isArray(triplet) || triplet.length !== 3) throw new Error(`Shared layer ${layer}, key ${index + 1} has an invalid mapping.`);
        const [type, code1, code2] = triplet.map(Number);
        requireShareInteger(type, 0, 255, `Shared layer ${layer}, key ${index + 1} has an invalid mapping type.`);
        requireShareInteger(code1, 0, 255, `Shared layer ${layer}, key ${index + 1} has an invalid mapping code.`);
        requireShareInteger(code2, 0, 255, `Shared layer ${layer}, key ${index + 1} has an invalid mapping code.`);
        return makeMapping(type, code1, code2, profileIndex, layer);
      });
    });
    if (!Array.isArray(packed.t) || packed.t.length !== KEY_COUNT) throw new Error(`The shared profile must contain exactly ${KEY_COUNT} Hall records.`);
    const travelLimits = [[0, 15], [0, 15], [0, 15], [0, 10], [1, 511], [1, 511], [1, 511], [0, 3], [0, 3], [0, 127], [0, 127]];
    const travelKeys = packed.t.map((values, index) => {
      if (!Array.isArray(values) || values.length !== TRAVEL_SHARE_FIELDS.length) throw new Error(`Shared Hall record ${index + 1} is incomplete.`);
      const record = {};
      TRAVEL_SHARE_FIELDS.forEach((field, fieldIndex) => {
        if (field === "deadzone_status") {
          if (typeof values[fieldIndex] !== "boolean") throw new Error(`Shared Hall record ${index + 1} has an invalid dead-zone state.`);
          record[field] = values[fieldIndex];
          return;
        }
        const [minimum, maximum] = travelLimits[fieldIndex];
        record[field] = requireShareInteger(Number(values[fieldIndex]), minimum, maximum, `Shared Hall record ${index + 1} has an invalid ${field} value.`);
      });
      return record;
    });
    if (!Array.isArray(packed.a) || packed.a.length > KEY_COUNT) throw new Error("The shared advanced-action list is invalid.");
    const allowedAdvancedTypes = new Set(["dks", "mt", "tgl", "rs", "socd", "cb", "macro"]);
    packed.a.forEach((item, index) => {
      if (!item || !allowedAdvancedTypes.has(item.type)) throw new Error(`Shared advanced action ${index + 1} has an unsupported type.`);
      requireShareInteger(Number(item.layer || 0), 0, LAYER_COUNT - 1, `Shared advanced action ${index + 1} has an invalid layer.`);
      requireShareInteger(Number(item.index1), 0, KEY_COUNT - 1, `Shared advanced action ${index + 1} has an invalid host key.`);
      if (item.type === "rs" || item.type === "socd") requireShareInteger(Number(item.index2), 0, KEY_COUNT - 1, `Shared advanced action ${index + 1} has an invalid paired key.`);
    });
    if (!packed.l || typeof packed.l !== "object" || !packed.s || typeof packed.s !== "object") throw new Error("The shared lighting settings are incomplete.");
    [packed.l, packed.s].forEach((lighting, index) => {
      const label = index ? "light-strip" : "main-key";
      requireShareInteger(Number(lighting.effect), 0, 255, `The shared ${label} lighting effect is invalid.`);
      requireShareInteger(Number(lighting.brightness), 0, 100, `The shared ${label} brightness is invalid.`);
      requireShareInteger(Number(lighting.speed), 0, 4, `The shared ${label} speed is invalid.`);
      requireShareInteger(Number(lighting.direction || 0), 0, 255, `The shared ${label} direction is invalid.`);
      if (typeof lighting.singleColor !== "boolean" || !/^#[0-9a-f]{6}$/i.test(String(lighting.color))) throw new Error(`The shared ${label} color settings are invalid.`);
    });
    if (!Array.isArray(packed.c) || packed.c.length !== KEY_COUNT || !packed.c.every((color) => /^#[0-9a-f]{6}$/i.test(String(color)))) throw new Error(`The shared profile must contain exactly ${KEY_COUNT} valid per-key colors.`);
    if (!packed.d || typeof packed.d !== "object" || Array.isArray(packed.d)) throw new Error("The shared device settings are invalid.");
    ["lockWin", "lockAltTab", "lockAltF4", "checkMode", "tachyonMode"].forEach((field) => {
      if (typeof packed.d[field] !== "boolean") throw new Error(`The shared device setting ${field} is invalid.`);
    });
    if (![false, true, 0, 1].includes(packed.d.stabilityMode)) throw new Error("The shared Trigger Bottom setting is invalid.");
    requireShareInteger(Number(packed.d.reportRate), 0, 15, "The shared polling-rate setting is invalid.");
    requireShareInteger(Number(packed.d.tickRate), 0, 15, "The shared tick-rate setting is invalid.");
    requireShareInteger(Number(packed.d.debounce), 0, 7, "The shared debounce setting is invalid.");
    requireShareInteger(Number(packed.d.systemMode), 0, 15, "The shared OS-mode setting is invalid.");
    if (!Array.isArray(packed.r) || packed.r.length !== 64) throw new Error("The shared raw profile configuration must contain exactly 64 bytes.");
    packed.r.forEach((value, index) => requireShareInteger(Number(value), 0, 255, `Raw configuration byte ${index} is invalid.`));
    const profile = {
      name: String(packed.n || `Shared Profile ${profileIndex + 1}`).slice(0, 200),
      active: true,
      profileIndex,
      userKeys,
      travelKeys,
      advancedKeys: JSON.parse(JSON.stringify(packed.a)),
      light: JSON.parse(JSON.stringify(packed.l)),
      logoLight: JSON.parse(JSON.stringify(packed.s)),
      colorKeys: packed.c.map((color) => normalizeHexColor(color)),
      deviceSettings: JSON.parse(JSON.stringify(packed.d)),
      _rawConfig: packed.r.map(Number),
      _hasRawConfig: true,
      _workspaceSections: ["keymap", "hall", "advanced", "settings", "lighting", "colors"],
    };
    const compiled = compileAdvanced(profile);
    encodeDksBank(compiled.banks.dks); encodeMtBank(compiled.banks.mt); encodeTglBank(compiled.banks.tgl); encodeMacros(compiled.banks.macros);
    encodeMappings(compiled.userKeys[0]); encodeTravel(compiled.travelKeys); encodeColors(profile.colorKeys);
    applyLighting(applyDeviceSettings(profile._rawConfig, profile.deviceSettings), profile.light, profile.logoLight);
    retargetSharedProfile(profile, profileIndex);
    return profile;
  }

  async function encodeProfileShare(profile) {
    const payload = { f: PROFILE_SHARE_FORMAT, v: 1, p: compactProfileForShare(profile) };
    const source = new global.TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzipTransform(source);
    return PROFILE_SHARE_PREFIX + bytesToBase64Url(compressed);
  }

  async function decodeProfileShare(value) {
    const code = String(value || "").replace(/\s+/g, "");
    if (!code.startsWith(PROFILE_SHARE_PREFIX)) throw new Error(`Profile codes must start with ${PROFILE_SHARE_PREFIX}`);
    if (code.length > PROFILE_SHARE_MAX_LENGTH) throw new Error("The profile share code is too large.");
    const compressed = base64UrlToBytes(code.slice(PROFILE_SHARE_PREFIX.length));
    let decompressed;
    try { decompressed = await gzipTransform(compressed, true); } catch (error) { throw new Error(`The profile share code could not be decompressed: ${error.message}`); }
    if (decompressed.length > 1048576) throw new Error("The decompressed profile share code is too large.");
    let payload;
    try { payload = JSON.parse(new global.TextDecoder().decode(decompressed)); } catch (_) { throw new Error("The profile share code does not contain valid JSON data."); }
    return expandProfileSharePayload(payload);
  }

  function retargetSharedProfile(profile, targetProfileIndex) {
    const source = inferProfileIndex(profile);
    const target = requireShareInteger(Number(targetProfileIndex), 0, PROFILE_COUNT - 1, "A valid target profile is required.");
    const retargeted = JSON.parse(JSON.stringify(profile));
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) value.forEach(visit);
      else Object.values(value).forEach(visit);
      if (Number(value.type) === 240 && Number(value.code1) === 255) {
        value.code2 = translateProfileFnLayer(Number(value.code2), source, target);
        value.name = mappingName(240, 255, value.code2);
        value.profile = target;
      }
    };
    visit(retargeted.userKeys);
    visit(retargeted.advancedKeys);
    retargeted.profileIndex = target;
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      (retargeted.userKeys?.[layer] || retargeted.userKeys?.[String(layer)] || []).forEach((mapping) => { mapping.profile = target; mapping.layer = layer; });
    }
    retargeted._workspaceSections = ["keymap", "hall", "advanced", "settings", "lighting", "colors"];
    return retargeted;
  }

  function expandAdvancedBanks(advancedKeys) {
    const dks = advancedKeys.filter((item) => item.type === "dks");
    const tgl = advancedKeys.filter((item) => item.type === "tgl");
    const mt = [];
    advancedKeys.forEach((item) => {
      if (item.type === "mt") mt.push(item);
      if (item.type === "rs" || item.type === "socd") {
        mt.push({ ...item, mtClickKey: item.key1, mtDownKey: item.key2, index1: item.index1, index2: item.index2 });
        mt.push({ ...item, mtClickKey: item.key2, mtDownKey: item.key1, index1: item.index2, index2: item.index1 });
      }
    });
    const macros = advancedKeys.filter((item) => item.type === "macro");
    if (dks.length > 32) throw new Error("The device supports at most 32 DKS entries per profile.");
    if (tgl.length > 32) throw new Error("The device supports at most 32 Toggle entries per profile.");
    if (mt.length > 32) throw new Error("Mod-Tap, Rappy Snappy, and SOCD use a shared 32-slot bank.");
    if (macros.length > 32) throw new Error("The device supports at most 32 macros per profile.");
    return { dks, tgl, mt, macros };
  }

  function compileAdvanced(profile) {
    const userKeys = {};
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      userKeys[layer] = (profile.userKeys?.[layer] || profile.userKeys?.[String(layer)] || []).map((mapping) => ({ ...mapping }));
      while (userKeys[layer].length < KEY_COUNT) userKeys[layer].push(makeMapping(255, 255, 255, profile.profileIndex || 0, layer));
    }
    const travelKeys = (profile.travelKeys || []).map((key) => ({ ...key }));
    while (travelKeys.length < KEY_COUNT) {
      travelKeys.push({ switch_type: 0, key_mode: 0, priority: 0, key_actuation: 150, rt_press: 10, rt_release: 10, pressPrecision: 0, releasePrecision: 0, press_deadzone: 0, release_deadzone: 0 });
    }
    const advancedKeys = profile.advancedKeys || [];
    const banks = expandAdvancedBanks(advancedKeys);

    banks.dks.forEach((item, slot) => {
      userKeys[item.layer || 0][item.index1] = makeMapping(144, slot, 0, profile.profileIndex || 0, item.layer || 0);
    });
    banks.tgl.forEach((item, slot) => {
      userKeys[item.layer || 0][item.index1] = makeMapping(145, slot, 0, profile.profileIndex || 0, item.layer || 0);
    });
    banks.mt.forEach((item, slot) => {
      const layer = item.layer || 0;
      let type = 146;
      let code2 = Math.floor(clamp(item.mtTime || 200, 10, 2550) / 10);
      if (item.type === "rs") { type = 147; code2 = item.index2 || 0; }
      if (item.type === "socd") { type = 148; code2 = item.index2 || 0; }
      userKeys[layer][item.index1] = makeMapping(type, slot, code2, profile.profileIndex || 0, layer);
    });
    banks.macros.forEach((item, slot) => {
      const layer = item.layer || 0;
      userKeys[layer][item.index1] = makeMapping(112, slot, clamp(item.macroRepeatCount || item.macroType || 1, 0, 255), profile.profileIndex || 0, layer);
    });
    advancedKeys.filter((item) => item.type === "cb").forEach((item) => {
      const layer = item.layer || 0;
      const modifiers = clamp(item.modifiers ?? item.key1?.code1 ?? 0, 0, 255);
      const base = clamp(item.baseKey?.code2 ?? item.key1?.code2 ?? 0, 0, 255);
      userKeys[layer][item.index1] = makeMapping(16, modifiers, base, profile.profileIndex || 0, layer);
    });
    advancedKeys.filter((item) => item.type === "rs" || item.type === "socd").forEach((item) => {
      const option = item.option || {};
      const first = travelKeys[item.index1];
      const second = travelKeys[item.index2];
      [first, second].forEach((key) => {
        key.key_mode = 1;
        key.key_actuation = option.actuation || key.key_actuation;
        key.rt_press = option.press || key.rt_press;
        key.rt_release = option.release || key.rt_release;
      });
      if (item.type === "socd") {
        first.priority = clamp(option.priority ?? 0, 0, 3);
        second.priority = first.priority === 1 ? 2 : first.priority === 2 ? 1 : first.priority;
      }
    });
    return { userKeys, travelKeys, banks };
  }

  function decodeAdvanced(userKeys, travelKeys, dksBytes, mtBytes, tglBytes, macroBytes) {
    const dksBank = decodeDksBank(dksBytes);
    const mtBank = decodeMtBank(mtBytes);
    const tglBank = decodeTglBank(tglBytes);
    const macroBank = decodeMacros(macroBytes);
    const result = [];
    const pairs = new Set();
    for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
      userKeys[layer].forEach((mapping, index) => {
        if (mapping.type === 144 && dksBank[mapping.code1]) result.push({ type: "dks", layer, index1: index, ...dksBank[mapping.code1] });
        if (mapping.type === 145 && tglBank[mapping.code1]) result.push({ type: "tgl", layer, index1: index, tglKey: tglBank[mapping.code1] });
        if (mapping.type === 146 && mtBank[mapping.code1]) result.push({ type: "mt", layer, index1: index, mtClickKey: mtBank[mapping.code1].clickKey, mtDownKey: mtBank[mapping.code1].downKey, mtTime: mapping.code2 * 10 });
        if (mapping.type === 147 || mapping.type === 148) {
          const pairKey = [layer, Math.min(index, mapping.code2), Math.max(index, mapping.code2), mapping.type].join(":");
          if (pairs.has(pairKey)) return;
          pairs.add(pairKey);
          const bank = mtBank[mapping.code1];
          if (!bank) return;
          const travel = travelKeys[index] || {};
          result.push({
            type: mapping.type === 147 ? "rs" : "socd", layer, index1: index, index2: mapping.code2,
            key1: bank.clickKey, key2: bank.downKey,
            option: { actuation: travel.key_actuation, press: travel.rt_press, release: travel.rt_release, priority: travel.priority || 0 },
          });
        }
        if (mapping.type === 16 && mapping.code1 > 0 && mapping.code2 > 0) {
          result.push({ type: "cb", layer, index1: index, modifiers: mapping.code1, baseKey: makeMapping(16, 0, mapping.code2) });
        }
        if (mapping.type === 112) {
          result.push({ type: "macro", layer, index1: index, macroId: mapping.code1, macroType: mapping.code2, macroRepeatCount: mapping.code2 || 1, actions: macroBank[mapping.code1] || [] });
        }
      });
    }
    return result;
  }

  class HE30Driver {
    static supported() {
      return Boolean(global.navigator?.hid);
    }

    static async request(log) {
      if (!HE30Driver.supported()) throw new Error("WebHID is unavailable. Use desktop Chrome on an HTTPS page.");
      const devices = await global.navigator.hid.requestDevice({ filters: DEVICE_FILTERS });
      if (!devices.length) throw new Error("No compatible keyboard was selected.");
      const driver = new HE30Driver(devices[0], log);
      await driver.open();
      return driver;
    }

    constructor(device, log) {
      this.device = device;
      this.log = typeof log === "function" ? log : () => {};
      this.reportQueue = [];
      this.waiters = [];
      this.commandQueue = Promise.resolve();
      this.closed = false;
      this.telemetryListeners = new Set();
      this.calibrationListeners = new Set();
      this.profileChangeListeners = new Set();
      this.telemetryActive = false;
      this.telemetryRestoreNeeded = false;
      this.telemetryProfile = 0;
      this.calibrationActive = false;
      const key = `${hex(device.vendorId, 4)}:${hex(device.productId, 4)}`.toLowerCase();
      this.model = DEVICE_MODELS[key] || { name: device.productName || "Compatible keyboard", type: 0, multiProfile: false };
      this.onInputReport = this.onInputReport.bind(this);
    }

    async open() {
      if (!this.device.opened) await this.device.open();
      this.device.addEventListener("inputreport", this.onInputReport);
      this.closed = false;
      this.log("info", "HID device opened", { vendorId: this.device.vendorId, productId: this.device.productId, productName: this.device.productName });
    }

    async close() {
      if (this.calibrationActive) {
        try { await this.endCalibration(); } catch (error) { this.log("warning", "Could not stop calibration before closing", error.message); }
      }
      if (this.telemetryActive || this.telemetryRestoreNeeded) {
        try { await this.stopLiveTelemetry(); } catch (error) { this.log("warning", "Could not restore the live-monitor flag before closing", error.message); }
      }
      this.closed = true;
      this.device.removeEventListener("inputreport", this.onInputReport);
      if (this.device.opened) await this.device.close();
      while (this.waiters.length) this.waiters.shift().reject(new Error("Device disconnected."));
      this.log("info", "HID device closed");
    }

    onInputReport(event) {
      const report = Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
      const telemetry = decodeTelemetryReport(report);
      if (telemetry) {
        if (this.telemetryActive) this.telemetryListeners.forEach((listener) => { try { listener(telemetry); } catch (error) { this.log("warning", "A telemetry listener failed", error.message); } });
        if (this.calibrationActive) this.calibrationListeners.forEach((listener) => { try { listener(telemetry); } catch (error) { this.log("warning", "A calibration listener failed", error.message); } });
        return;
      }
      const profileChange = decodeProfileChangeReport(report);
      if (profileChange) {
        this.log("event", `Active profile changed to ${profileChange.profileIndex + 1}, global layer ${profileChange.globalLayer}`, report);
        this.profileChangeListeners.forEach((listener) => { try { listener(profileChange); } catch (error) { this.log("warning", "A profile-change listener failed", error.message); } });
        return;
      }
      this.log("rx", `Received ${report.length} bytes`, report);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(report);
      else this.reportQueue.push(report);
    }

    nextReport(timeout = 1800) {
      if (this.reportQueue.length) return Promise.resolve(this.reportQueue.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        this.waiters.push(waiter);
        const timer = global.setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("The keyboard did not respond before the timeout."));
        }, timeout);
        waiter.resolve = (value) => { global.clearTimeout(timer); resolve(value); };
        waiter.reject = (error) => { global.clearTimeout(timer); reject(error); };
      });
    }

    transact(command, args = []) {
      const run = () => this.performTransaction(command, args);
      this.commandQueue = this.commandQueue.then(run, run);
      return this.commandQueue;
    }

    async performTransaction(command, args) {
      if (this.closed) throw new Error("The keyboard is disconnected.");
      if (!this.device.opened) await this.open();
      this.reportQueue = [];
      const payload = new Uint8Array(REPORT_SIZE);
      payload[0] = command & 0xff;
      args.slice(0, REPORT_SIZE - 1).forEach((value, index) => { payload[index + 1] = value & 0xff; });
      this.log("tx", `Command 0x${hex(command)} (${args.length} argument bytes)`, Array.from(payload));
      await this.device.sendReport(0, payload);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await this.nextReport();
        if (response[0] === RESPONSE_PREFIX) return response;
        this.log("event", `Ignored asynchronous report 0x${hex(response[0] || 0)}`, response);
      }
      throw new Error(`The keyboard did not acknowledge command 0x${hex(command)}.`);
    }

    async readBlock(command, offset, size) {
      const output = [];
      for (let cursor = offset; cursor < offset + size; cursor += CHUNK_SIZE) {
        const length = Math.min(CHUNK_SIZE, offset + size - cursor);
        const [low, high] = littleEndian(cursor);
        const response = await this.transact(REQUEST_PREFIX, [command, 0, sum8([low, high, length]), length, low, high]);
        output.push(...response.slice(8, 8 + length));
      }
      return output.slice(0, size);
    }

    async writeBlock(command, offset, bytes) {
      for (let cursor = 0; cursor < bytes.length; cursor += CHUNK_SIZE) {
        const data = bytes.slice(cursor, cursor + CHUNK_SIZE);
        const [low, high] = littleEndian(offset + cursor);
        const body = [data.length, low, high, 0, ...data];
        await this.transact(REQUEST_PREFIX, [command, 0, sum8(body), ...body]);
      }
    }

    async writeAndVerify(writeCommand, readCommand, offset, bytes, label) {
      await this.writeBlock(writeCommand, offset, bytes);
      const actual = await this.readBlock(readCommand, offset, bytes.length);
      if (!arraysEqual(bytes, actual)) throw new Error(`${label} verification failed after writing.`);
      this.log("verify", `${label} verified`, { bytes: bytes.length, offset });
    }

    async getInfo() {
      const response = await this.transact(REQUEST_PREFIX, [3, 0, 32, 32]);
      const data = response.slice(8);
      return { firmware: `${hex(data[1] || 0)}${hex(data[0] || 0)}`, raw: data };
    }

    async getActiveProfile() {
      const response = await this.transact(REQUEST_PREFIX, [4, 0, 32, 32]);
      return clamp(response[8] || 0, 0, PROFILE_COUNT - 1);
    }

    async setActiveProfile(profileIndex) {
      const profile = clamp(profileIndex, 0, PROFILE_COUNT - 1);
      await this.transact(REQUEST_PREFIX, [14, 0, (profile + 1) & 0xff, 1, 0, 0, 0, profile]);
    }

    async resetCurrentProfile(profileIndex) {
      await this.transact(REQUEST_PREFIX, factoryResetPayload(profileIndex));
    }

    async resetAllProfiles() {
      await this.transact(REQUEST_PREFIX, factoryResetAllPayload());
    }

    subscribeTelemetry(listener) {
      if (typeof listener !== "function") throw new Error("A telemetry listener function is required.");
      this.telemetryListeners.add(listener);
      return () => this.telemetryListeners.delete(listener);
    }

    subscribeCalibration(listener) {
      if (typeof listener !== "function") throw new Error("A calibration listener function is required.");
      this.calibrationListeners.add(listener);
      return () => this.calibrationListeners.delete(listener);
    }

    subscribeProfileChange(listener) {
      if (typeof listener !== "function") throw new Error("A profile-change listener function is required.");
      this.profileChangeListeners.add(listener);
      return () => this.profileChangeListeners.delete(listener);
    }

    async startLiveTelemetry(profileIndex = 0) {
      if (this.telemetryActive) return;
      if (this.calibrationActive) throw new Error("Stop switch calibration before starting live diagnostics.");
      const profile = clamp(profileIndex, 0, PROFILE_COUNT - 1);
      const offset = profileConfigOffset(profile);
      const config = await this.readBlock(5, offset, 64);
      this.telemetryRestoreNeeded = (config[7] & 8) === 0;
      this.telemetryProfile = profile;
      if (this.telemetryRestoreNeeded) {
        const enabled = [...config];
        enabled[7] |= 8;
        await this.writeAndVerify(6, 5, offset, enabled, "Live Hall monitor");
      }
      this.telemetryActive = true;
      this.log("info", "Dynamic Display diagnostics enabled", { profile, configOffset: offset, restoredAfterStop: this.telemetryRestoreNeeded });
    }

    async stopLiveTelemetry() {
      if (!this.telemetryActive && !this.telemetryRestoreNeeded) return;
      const restore = this.telemetryRestoreNeeded;
      const profile = this.telemetryProfile;
      this.telemetryActive = false;
      if (restore && !this.closed && this.device.opened) {
        const offset = profileConfigOffset(profile);
        const config = await this.readBlock(5, offset, 64);
        const disabled = [...config];
        disabled[7] &= 0xf7;
        await this.writeAndVerify(6, 5, offset, disabled, "Live Hall monitor restoration");
      }
      this.telemetryRestoreNeeded = false;
      this.log("info", "Dynamic Display diagnostics disabled", { profile, restored: restore });
    }

    async startCalibration() {
      if (this.calibrationActive) return;
      if (this.telemetryActive || this.telemetryRestoreNeeded) throw new Error("Stop live diagnostics before starting switch calibration.");
      try {
        await this.transact(REQUEST_PREFIX, [0xa8, 0, 0]);
        this.calibrationActive = true;
        this.log("info", "Switch calibration started", { command: "0x55/0xA8" });
      } catch (error) {
        this.calibrationActive = false;
        throw error;
      }
    }

    async endCalibration() {
      if (!this.calibrationActive) return;
      try {
        await this.transact(REQUEST_PREFIX, [0xa9, 0, 0]);
        this.log("info", "Switch calibration stopped", { command: "0x55/0xA9" });
      } finally {
        this.calibrationActive = false;
      }
    }

    async readLiveColors() {
      const bytes = await this.readBlock(0xde, 0, 384);
      return decodeColors(bytes);
    }

    async readLiveStripSettings(profileIndex = 0) {
      const profile = clamp(profileIndex, 0, PROFILE_COUNT - 1);
      const config = await this.readBlock(5, profileConfigOffset(profile), 64);
      return decodeLighting(config).logoLight;
    }

    async readRawProfile(profileIndex = 0, progress = () => {}) {
      const profile = clamp(profileIndex, 0, PROFILE_COUNT - 1);
      const steps = 11;
      let completed = 0;
      const advance = (label) => { completed += 1; progress(Math.round((completed / steps) * 100), label); };
      const config = await this.readBlock(5, profileConfigOffset(profile), 64); advance("Device settings");
      const keymaps = {};
      for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
        keymaps[layer] = await this.readBlock(8, 2048 * profile + 512 * layer, 384);
        advance(`Layer ${profile * LAYER_COUNT + layer}`);
      }
      const travel = await this.readBlock(160, 1024 * profile, 1024); advance("Hall settings");
      const dks = await this.readBlock(162, 1024 * profile, 1024); advance("DKS bank");
      const mt = await this.readBlock(164, 256 * profile, 256); advance("Advanced bank");
      const tgl = await this.readBlock(166, 128 * profile, 128); advance("Toggle bank");
      const macros = await this.readBlock(12, 2048 * profile, 2048); advance("Macros");
      const colors = await this.readBlock(10, 512 * profile, 384); advance("Per-key colors");
      return { profile, config, keymaps, travel, dks, mt, tgl, macros, colors };
    }

    decodeRawProfile(raw) {
      const userKeys = {};
      for (let layer = 0; layer < LAYER_COUNT; layer += 1) userKeys[layer] = decodeMappings(raw.keymaps[layer], raw.profile, layer);
      const travelKeys = decodeTravel(raw.travel);
      const lighting = decodeLighting(raw.config);
      return {
        name: `${this.model.name} · Onboard ${raw.profile + 1}`,
        active: true,
        profileIndex: raw.profile,
        userKeys,
        travelKeys,
        advancedKeys: decodeAdvanced(userKeys, travelKeys, raw.dks, raw.mt, raw.tgl, raw.macros),
        light: lighting.light,
        logoLight: lighting.logoLight,
        colorKeys: decodeColors(raw.colors),
        deviceSettings: decodeDeviceSettings(raw.config),
        _rawConfig: raw.config,
      };
    }

    async readProfile(profileIndex = 0, progress = () => {}) {
      return this.decodeRawProfile(await this.readRawProfile(profileIndex, progress));
    }

    async writeProfile(profile, dirtySections, progress = () => {}) {
      const profileIndex = clamp(profile.profileIndex || 0, 0, PROFILE_COUNT - 1);
      const dirty = new Set(dirtySections || []);
      const compiled = compileAdvanced(profile);
      const tasks = [];
      if (dirty.has("advanced")) {
        tasks.push({ label: "DKS", write: 163, read: 162, offset: 1024 * profileIndex, data: encodeDksBank(compiled.banks.dks) });
        tasks.push({ label: "Mod-Tap / pair actions", write: 165, read: 164, offset: 256 * profileIndex, data: encodeMtBank(compiled.banks.mt) });
        tasks.push({ label: "Toggle actions", write: 167, read: 166, offset: 128 * profileIndex, data: encodeTglBank(compiled.banks.tgl) });
        tasks.push({ label: "Macros", write: 13, read: 12, offset: 2048 * profileIndex, data: encodeMacros(compiled.banks.macros) });
      }
      if (dirty.has("keymap") || dirty.has("advanced")) {
        for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
          tasks.push({ label: `Layer ${profileIndex * LAYER_COUNT + layer} mappings`, write: 9, read: 8, offset: 2048 * profileIndex + 512 * layer, data: encodeMappings(compiled.userKeys[layer]) });
        }
      }
      if (dirty.has("hall") || dirty.has("advanced")) {
        tasks.push({ label: "Hall settings", write: 161, read: 160, offset: 1024 * profileIndex, data: encodeTravel(compiled.travelKeys) });
      }
      if (dirty.has("settings") || dirty.has("lighting")) {
        let config = applyDeviceSettings(profile._rawConfig || new Array(64).fill(0), profile.deviceSettings || {});
        config = applyLighting(config, profile.light, profile.logoLight);
        tasks.push({ label: "Device and lighting settings", write: 6, read: 5, offset: 64 * profileIndex, data: config });
      }
      if (dirty.has("colors")) {
        tasks.push({ label: "Per-key colors", write: 11, read: 10, offset: 512 * profileIndex, data: encodeColors(profile.colorKeys) });
      }
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        progress(Math.round((index / Math.max(1, tasks.length)) * 100), `Writing ${task.label}`);
        await this.writeAndVerify(task.write, task.read, task.offset, task.data, task.label);
      }
      progress(100, "All changes verified");
      return this.readProfile(profileIndex);
    }

    get identity() {
      return {
        name: this.model.name,
        type: this.model.type,
        multiProfile: this.model.multiProfile,
        vendorId: this.device.vendorId,
        productId: this.device.productId,
        productName: this.device.productName,
        vidPid: `${hex(this.device.vendorId, 4)}:${hex(this.device.productId, 4)}`,
      };
    }
  }

  global.HE30Control = Object.freeze({
    HE30Driver,
    DEVICE_MODELS,
    KEY_NAMES,
    PROFILE_COUNT,
    LAYER_COUNT,
    TOTAL_LAYER_COUNT,
    KEY_COUNT,
    normalizeWootingShareCode,
    wootingDistanceToHundredths,
    decodeWootingMapping,
    convertWootingProfile,
    mappingName,
    makeMapping,
    inferProfileIndex,
    profileConfigOffset,
    translateFactoryFnLayer,
    translateProfileFnLayer,
    encodeProfileShare,
    decodeProfileShare,
    retargetSharedProfile,
    factoryResetPayload,
    factoryResetAllPayload,
    normalizeHexColor,
    decodeTravel,
    encodeTravel,
    compileAdvanced,
    encodeMappings,
    decodeMappings,
    decodeDeviceSettings,
    applyDeviceSettings,
    decodeLighting,
    applyLighting,
    decodeColors,
    encodeColors,
    encodeDksBank,
    encodeMtBank,
    encodeTglBank,
    encodeMacros,
    decodeTelemetryReport,
    decodeProfileChangeReport,
  });
})(window);
