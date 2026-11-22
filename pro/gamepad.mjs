export const GAMEPAD_BYTES = 292;
export const GAMEPAD_TRAVEL = 10000;
export const GAMEPAD_NONE = 255;
export const GAMEPAD_MODES = ['Off', 'Controller assignments only', 'Keyboard and controller'];
export const GAMEPAD_OPPOSITION = ['Depth difference', 'Neutral when both are pressed', 'Deeper key wins'];

const analogLabels = [
  'Left stick left', 'Left stick right', 'Left stick up', 'Left stick down',
  'Right stick left', 'Right stick right', 'Right stick up', 'Right stick down',
  'Left trigger', 'Right trigger'
];
const digitalLabels = [
  'A', 'B', 'X', 'Y', 'Left bumper', 'Right bumper', 'Back', 'Start',
  'Left stick click', 'Right stick click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'
];
export const GAMEPAD_ACTIONS = [...analogLabels, ...digitalLabels].map((label, action) => ({
  id: label.toLowerCase().replaceAll(' ', '-'),
  label,
  kind: action < 10 ? 'analog' : 'digital',
  index: action < 10 ? action : action - 10
}));

export function defaultGamepad() {
  return {
    version: 1,
    mode: 0,
    analog: Array.from({length: 10}, () => ({
      key: GAMEPAD_NONE,
      start: 0,
      end: GAMEPAD_TRAVEL,
      curve: {x: [0, 3333, 6667, GAMEPAD_TRAVEL], y: [0, 3333, 6667, GAMEPAD_TRAVEL]}
    })),
    digital: Array.from({length: 14}, () => ({key: GAMEPAD_NONE, press: 5000, release: 3000})),
    sticks: Array.from({length: 2}, () => ({
      radialDeadzone: 0, circular: true, oppositionX: 0, oppositionY: 0
    }))
  };
}

function integer(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(field + ' must be a whole number from ' + min + ' to ' + max + '.');
  }
}

function array(value, length, field) {
  if (!Array.isArray(value) || value.length !== length) throw new Error('Invalid ' + field + ' array.');
}

export function validateGamepad(config) {
  if (!config || config.version !== 1) throw new Error('Unsupported gamepad settings version.');
  integer(config.mode, 0, 2, 'Gamepad mode');
  array(config.analog, 10, 'analog binding');
  array(config.digital, 14, 'digital binding');
  array(config.sticks, 2, 'stick');
  const used = new Set();
  for (const binding of [...config.analog, ...config.digital]) {
    if (!binding) throw new Error('Missing controller binding.');
    if (binding.key !== GAMEPAD_NONE) {
      integer(binding.key, 0, 35, 'Physical key');
      if (used.has(binding.key)) throw new Error('A physical key can have only one controller assignment.');
      used.add(binding.key);
    }
  }
  for (const binding of config.analog) {
    integer(binding.start, 0, GAMEPAD_TRAVEL - 1, 'Analog start');
    integer(binding.end, binding.start + 1, GAMEPAD_TRAVEL, 'Analog end');
    if (!binding.curve) throw new Error('Missing analog response curve.');
    array(binding.curve.x, 4, 'curve travel');
    array(binding.curve.y, 4, 'curve output');
    for (let point = 0; point < 4; point++) {
      integer(binding.curve.x[point], point ? binding.curve.x[point - 1] + 1 : 0, GAMEPAD_TRAVEL, 'Curve travel');
      integer(binding.curve.y[point], 0, GAMEPAD_TRAVEL, 'Curve output');
    }
  }
  for (const binding of config.digital) {
    integer(binding.release, 0, GAMEPAD_TRAVEL - 1, 'Button release');
    integer(binding.press, binding.release + 1, GAMEPAD_TRAVEL, 'Button press');
  }
  for (const stick of config.sticks) {
    if (!stick || typeof stick.circular !== 'boolean') throw new Error('Invalid stick shape.');
    integer(stick.radialDeadzone, 0, GAMEPAD_TRAVEL - 1, 'Radial dead zone');
    if (!stick.circular && stick.radialDeadzone) throw new Error('A square stick requires a zero radial dead zone.');
    integer(stick.oppositionX, 0, 2, 'Horizontal opposition');
    integer(stick.oppositionY, 0, 2, 'Vertical opposition');
  }
  return config;
}

// Packed wire layout. Analog records start at 2 with stride 21, digital
// records at 212 with stride 5, and stick settings at 282 with stride 5.
export function encodeGamepad(config) {
  validateGamepad(config);
  const bytes = new Uint8Array(GAMEPAD_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = config.version;
  bytes[1] = config.mode;
  for (let i = 0; i < 10; i++) {
    const offset = 2 + i * 21;
    const binding = config.analog[i];
    bytes[offset] = binding.key;
    view.setUint16(offset + 1, binding.start, true);
    view.setUint16(offset + 3, binding.end, true);
    for (let point = 0; point < 4; point++) {
      view.setUint16(offset + 5 + point * 2, binding.curve.x[point], true);
      view.setUint16(offset + 13 + point * 2, binding.curve.y[point], true);
    }
  }
  for (let i = 0; i < 14; i++) {
    const offset = 212 + i * 5;
    const binding = config.digital[i];
    bytes[offset] = binding.key;
    view.setUint16(offset + 1, binding.press, true);
    view.setUint16(offset + 3, binding.release, true);
  }
  for (let i = 0; i < 2; i++) {
    const offset = 282 + i * 5;
    const stick = config.sticks[i];
    view.setUint16(offset, stick.radialDeadzone, true);
    bytes[offset + 2] = Number(stick.circular);
    bytes[offset + 3] = stick.oppositionX;
    bytes[offset + 4] = stick.oppositionY;
  }
  return bytes;
}

export function decodeGamepad(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== GAMEPAD_BYTES) {
    throw new Error('Gamepad settings must contain exactly ' + GAMEPAD_BYTES + ' bytes.');
  }
  const config = defaultGamepad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  config.version = bytes[0];
  config.mode = bytes[1];
  for (let i = 0; i < 10; i++) {
    const offset = 2 + i * 21;
    const binding = config.analog[i];
    binding.key = bytes[offset];
    binding.start = view.getUint16(offset + 1, true);
    binding.end = view.getUint16(offset + 3, true);
    for (let point = 0; point < 4; point++) {
      binding.curve.x[point] = view.getUint16(offset + 5 + point * 2, true);
      binding.curve.y[point] = view.getUint16(offset + 13 + point * 2, true);
    }
  }
  for (let i = 0; i < 14; i++) {
    const offset = 212 + i * 5;
    const binding = config.digital[i];
    binding.key = bytes[offset];
    binding.press = view.getUint16(offset + 1, true);
    binding.release = view.getUint16(offset + 3, true);
  }
  for (let i = 0; i < 2; i++) {
    const offset = 282 + i * 5;
    const circular = bytes[offset + 2];
    if (circular > 1) throw new Error('Invalid stick shape byte.');
    Object.assign(config.sticks[i], {
      radialDeadzone: view.getUint16(offset, true), circular: !!circular,
      oppositionX: bytes[offset + 3], oppositionY: bytes[offset + 4]
    });
  }
  return validateGamepad(config);
}

export function gamepadActionForKey(config, key) {
  integer(key, 0, 35, 'Physical key');
  const bindings = [...config.analog, ...config.digital];
  const index = bindings.findIndex(binding => binding.key === key);
  return index < 0 ? null : index;
}

export function gamepadBindingForKey(config, key) {
  const action = gamepadActionForKey(config, key);
  if (action === null) return null;
  return action < 10 ? config.analog[action] : config.digital[action - 10];
}

export function assignGamepad(config, key, action) {
  validateGamepad(config);
  integer(key, 0, 35, 'Physical key');
  if (action !== null) integer(action, 0, 23, 'Controller action');
  const next = structuredClone(config);
  const bindings = [...next.analog, ...next.digital];
  for (const binding of bindings) if (binding.key === key) binding.key = GAMEPAD_NONE;
  if (action !== null) bindings[action].key = key;
  return next;
}

export function migrateLegacyGamepad(bindings, {mode = 1} = {}) {
  array(bindings, 36, 'legacy controller binding');
  integer(mode, 0, 2, 'Gamepad mode');
  const config = defaultGamepad();
  config.mode = mode;
  const targets = [...config.analog, ...config.digital];
  const warnings = [];
  bindings.forEach((binding, key) => {
    integer(binding, 0, 26, 'Legacy controller binding');
    if (!binding) return;
    if (binding > 20) {
      warnings.push('Physical key ' + key + ' used legacy Button ' + (binding - 10) + ', which has no Xbox equivalent.');
    } else if (targets[binding - 1].key !== GAMEPAD_NONE) {
      warnings.push('Physical key ' + key + ' shares a legacy controller action. Its first physical assignment was retained.');
    } else targets[binding - 1].key = key;
  });
  return {config, warnings};
}
