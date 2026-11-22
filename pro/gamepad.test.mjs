import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAMEPAD_BYTES, GAMEPAD_NONE, GAMEPAD_ACTIONS, defaultGamepad, validateGamepad,
  encodeGamepad, decodeGamepad, assignGamepad, gamepadActionForKey,
  gamepadBindingForKey, migrateLegacyGamepad
} from './gamepad.mjs';

test('packed settings preserve ranges, all response points, buttons and stick behavior', () => {
  let config = assignGamepad(defaultGamepad(), 15, 2);
  config = assignGamepad(config, 32, 0);
  config = assignGamepad(config, 35, 8);
  config = assignGamepad(config, 7, 23);
  config.mode = 2;
  Object.assign(config.analog[2], {start: 800, end: 9200, curve: {x: [0, 2000, 7000, 10000], y: [0, 900, 8300, 10000]}});
  Object.assign(config.digital[13], {press: 4500, release: 2400});
  Object.assign(config.sticks[0], {radialDeadzone: 1200, oppositionX: 2, oppositionY: 1});
  const bytes = encodeGamepad(config);
  assert.equal(bytes.length, GAMEPAD_BYTES);
  assert.equal(Buffer.from(bytes.slice(44, 49)).toString('hex'), '0f2003f023');
  assert.equal(Buffer.from(bytes.slice(277, 282)).toString('hex'), '0794116009');
  assert.equal(Buffer.from(bytes.slice(282)).toString('hex'), 'b0040102010000010000');
  const framed = new Uint8Array(GAMEPAD_BYTES + 14);
  framed.set(bytes, 7);
  assert.deepEqual(decodeGamepad(framed.subarray(7, -7)), config);
  assert.equal(gamepadActionForKey(config, 15), 2);
  assert.equal(gamepadBindingForKey(config, 35), config.analog[8]);
});

test('new profiles have independent linear tuning and no selected controller assignments', () => {
  const one = defaultGamepad(), two = defaultGamepad();
  assert.equal(one.mode, 0);
  assert.ok([...one.analog, ...one.digital].every(binding => binding.key === GAMEPAD_NONE));
  assert.equal(gamepadActionForKey(one, 0), null);
  assert.equal(gamepadBindingForKey(one, 35), null);
  one.analog[0].curve.y[1] = 123;
  assert.equal(one.analog[1].curve.y[1], 3333);
  assert.equal(two.analog[0].curve.y[1], 3333);
  assert.equal(GAMEPAD_ACTIONS[23].label, 'D-pad right');
});

test('reassigning a physical key moves ownership while preserving target tuning', () => {
  let original = assignGamepad(defaultGamepad(), 15, 2);
  original.analog[8].start = 700;
  original = assignGamepad(original, 35, 8);
  const moved = assignGamepad(original, 15, 8);
  assert.equal(original.analog[2].key, 15);
  assert.equal(original.analog[8].key, 35);
  assert.equal(moved.analog[2].key, GAMEPAD_NONE);
  assert.equal(moved.analog[8].key, 15);
  assert.equal(moved.analog[8].start, 700);
  assert.equal(gamepadActionForKey(moved, 35), null);
  assert.equal(assignGamepad(moved, 15, null).analog[8].key, GAMEPAD_NONE);
});

test('invalid imports and device settings fail before a write can be sent', () => {
  const invalid = edit => {
    const config = defaultGamepad();
    edit(config);
    assert.throws(() => encodeGamepad(config));
  };
  invalid(c => {c.analog[0].start = c.analog[0].end;});
  invalid(c => {c.analog[1].curve.x[2] = c.analog[1].curve.x[1];});
  invalid(c => {c.analog[1].curve.y[3] = 10001;});
  invalid(c => {c.digital[0].press = c.digital[0].release;});
  invalid(c => {c.analog[0].key = c.digital[0].key = 15;});
  invalid(c => {c.sticks[0].circular = false;c.sticks[0].radialDeadzone = 1;});
  invalid(c => {c.sticks[1].oppositionY = 3;});
  invalid(c => {c.mode = NaN;});
  invalid(c => {c.digital[0].key = 36;});
  const bytes = encodeGamepad(defaultGamepad());
  assert.throws(() => decodeGamepad(bytes.subarray(1)), /exactly/);
  bytes[284] = 2;
  assert.throws(() => decodeGamepad(bytes), /shape/);
  assert.throws(() => assignGamepad(defaultGamepad(), 0, undefined));
  assert.throws(() => assignGamepad(defaultGamepad(), 36, null));
});

test('legacy imports identify unsupported buttons and duplicate action owners', () => {
  const bindings = Array(36).fill(0);
  bindings[15] = 3;
  bindings[32] = 1;
  bindings[35] = 9;
  bindings[17] = 9;
  bindings[7] = 26;
  const {config, warnings} = migrateLegacyGamepad(bindings, {mode: 2});
  assert.equal(config.mode, 2);
  assert.equal(config.analog[2].key, 15);
  assert.equal(config.analog[8].key, 17);
  assert.equal(gamepadActionForKey(config, 35), null);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some(text => text.includes('Button 16')));
  assert.ok(warnings.some(text => text.includes('shares')));
  assert.equal(validateGamepad(config), config);
});
