"use strict";

/**
 * HE30 binary protocol module.
 *
 * Files in js/protocol are ordered classic scripts so the codec remains usable
 * directly from GitHub Pages without bundling. protocol.js is loaded last and
 * exposes the deliberately small public API as window.HE30Control.
 */
/**
 * WebHID transport and public protocol API.
 *
 * HE30Driver serializes commands, reads/writes firmware banks, verifies writes,
 * and converts raw banks with the codec helpers. The export at the bottom is the
 * only protocol surface application modules should use.
 */

/**
 * Stateful WebHID connection to one keyboard.
 *
 * The driver has three jobs:
 * 1. serialize commands so reports cannot cross;
 * 2. route asynchronous telemetry/profile events away from command responses;
 * 3. read, write, and byte-for-byte verify complete firmware banks.
 */
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

  /** Route an incoming report before a pending transaction is allowed to consume it. */
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

  /** Add one command to a promise chain; even callers in parallel execute in order. */
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

  /** Read an arbitrary bank region in protocol-sized chunks. */
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

  /** A write is successful only when an immediate reread exactly matches. */
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

  // Live telemetry requires a temporary config bit. stopLiveTelemetry restores
  // it only if this session was the code that enabled it.
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

  /** Read every bank first, without interpretation, to make capture/debug easier. */
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

  /** Convert one complete raw capture into the normalized workspace shape. */
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

  /**
   * Compile Advanced references, build tasks for dirty sections only, write and
   * verify each bank, then return a fresh device read as the new source of truth.
   */
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

// Deliberately expose helpers used by the UI/tests, not internal command details.
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
