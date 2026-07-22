"use strict";

/**
 * HE30 binary protocol module.
 *
 * Files in js/protocol are ordered classic scripts so the codec remains usable
 * directly from GitHub Pages without bundling. protocol.js is loaded last and
 * exposes the deliberately small public API as window.HE30Control.
 */
/**
 * Pure codecs for profile banks and compressed profile sharing.
 *
 * A codec converts friendly JavaScript objects to firmware bytes (encode) or
 * firmware bytes back to objects (decode). Keeping these functions pure makes
 * them safe to test without a keyboard attached.
 */

// ---------------------------------------------------------------------------
// Profile identity and fixed-size firmware bank codecs
// ---------------------------------------------------------------------------
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

// Each mapping occupies three bytes: type, code1, and code2. Friendly name,
// profile, and layer fields are metadata reconstructed after decoding.
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

// A Hall record occupies eight bytes. Bit masks below mirror the captured
// firmware layout; change them only with protocol evidence and round-trip tests.
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

// ---------------------------------------------------------------------------
// Advanced-action banks
// ---------------------------------------------------------------------------
// DKS, Mod-Tap/pairs, Toggle, and Macro use separate fixed-capacity banks. The
// compile step later assigns actions to slots and writes host mapping references.
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

// ---------------------------------------------------------------------------
// Shared 64-byte config, lighting, and RGB banks
// ---------------------------------------------------------------------------
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

/** Patch known bits into a copy, preserving undocumented bytes and flags. */
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

// ---------------------------------------------------------------------------
// Portable compressed profile sharing
// ---------------------------------------------------------------------------
// The HE30P1 string is gzip(JSON), base64url-encoded with a prefix and checksum.
// Browser CompressionStream is preferred; Node's zlib fallback supports tests.
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

/** Validate untrusted share data before allocating full 128-entry banks. */
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

/** Move only Fn references that pointed inside the source profile's own layers. */
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

// ---------------------------------------------------------------------------
// Friendly Advanced actions <-> firmware banks
// ---------------------------------------------------------------------------
/**
 * Allocate bank slots and replace each host key with the firmware reference that
 * invokes its action. A cloned workspace is returned so staging data is not
 * mutated merely by previewing or validating a write.
 */
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

/** Rebuild editor-friendly action objects from host mappings and action banks. */
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
