const fs = require("fs");
const vm = require("vm");

const root = __dirname;
const protocolSource = fs.readFileSync(`${root}/protocol.js`, "utf8");
const appSource = fs.readFileSync(`${root}/app.js`, "utf8");
const htmlSource = fs.readFileSync(`${root}/index.html`, "utf8");
const jsonEditorHtml = fs.readFileSync(`${root}/json_editor/index.html`, "utf8");
const styleSource = fs.readFileSync(`${root}/styles.css`, "utf8");

new Function(protocolSource);
new Function(appSource);

const context = { window: { navigator: {} }, Uint8Array, ArrayBuffer, DataView, Promise, Math, Number, String, Boolean, Object, Array, Set, Map, JSON, Error };
vm.createContext(context);
vm.runInContext(protocolSource, context);
const API = context.window.HE30Control;
if (!API) throw new Error("Protocol API was not exposed.");

const equal = (left, right, message) => {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message);
};

const mappings = Array.from({ length: 128 }, (_, index) => API.makeMapping(16, index % 4, (index + 4) & 255, 0, 0));
const mappingBytes = API.encodeMappings(mappings);
if (mappingBytes.length !== 384) throw new Error("Mapping bank must be 384 bytes.");
const mappingRoundTrip = API.decodeMappings(mappingBytes, 0, 0);
equal(mappingRoundTrip.map((item) => [item.type, item.code1, item.code2]), mappings.map((item) => [item.type, item.code1, item.code2]), "Mapping codec did not round-trip.");

const travel = Array.from({ length: 128 }, (_, index) => ({
  switch_type: index % 4,
  key_mode: index % 3,
  priority: index % 3,
  key_actuation: 1 + (index * 3) % 400,
  rt_press: 1 + index,
  rt_release: 1 + index * 2,
  pressPrecision: index % 4,
  releasePrecision: (index + 1) % 4,
  press_deadzone: index % 128,
  release_deadzone: (index * 2) % 128,
}));
const travelBytes = API.encodeTravel(travel);
if (travelBytes.length !== 1024) throw new Error("Hall bank must be 1024 bytes.");
const travelRoundTrip = API.decodeTravel(travelBytes);
for (const field of ["switch_type", "key_mode", "priority", "key_actuation", "rt_press", "rt_release", "pressPrecision", "releasePrecision", "press_deadzone", "release_deadzone"]) {
  equal(travelRoundTrip.map((item) => item[field]), travel.map((item) => item[field]), `Hall field ${field} did not round-trip.`);
}

const profile = {
  profileIndex: 0,
  userKeys: Object.fromEntries([0, 1, 2, 3].map((layer) => [layer, Array.from({ length: 128 }, () => API.makeMapping(255, 255, 255, 0, layer))])),
  travelKeys: travel,
  advancedKeys: [
    { type: "dks", layer: 0, index1: 0, dksPoint: [10, 20, 30, 40], dksKeys: [] },
    { type: "mt", layer: 0, index1: 1, mtClickKey: API.makeMapping(16, 0, 4), mtDownKey: API.makeMapping(16, 0, 224), mtTime: 200 },
    { type: "tgl", layer: 0, index1: 2, tglKey: API.makeMapping(16, 0, 5) },
    { type: "rs", layer: 0, index1: 3, index2: 4, key1: API.makeMapping(16, 0, 4), key2: API.makeMapping(16, 0, 7), option: { actuation: 40, press: 10, release: 10 } },
    { type: "socd", layer: 0, index1: 5, index2: 6, key1: API.makeMapping(16, 0, 80), key2: API.makeMapping(16, 0, 79), option: { actuation: 40, press: 10, release: 10, priority: 1 } },
    { type: "cb", layer: 0, index1: 7, modifiers: 3, baseKey: API.makeMapping(16, 0, 7) },
    { type: "macro", layer: 0, index1: 8, macroRepeatCount: 1, actions: [{ action: "keydown", code: 4, delay: 0 }, { action: "keyup", code: 4, delay: 25 }] },
  ],
};
const compiled = API.compileAdvanced(profile);
if (compiled.banks.dks.length !== 1 || compiled.banks.mt.length !== 5 || compiled.banks.tgl.length !== 1 || compiled.banks.macros.length !== 1) throw new Error("Advanced actions did not compile into the expected banks.");
if (API.encodeDksBank(compiled.banks.dks).length !== 1024 || API.encodeMtBank(compiled.banks.mt).length !== 256 || API.encodeTglBank(compiled.banks.tgl).length !== 128 || API.encodeMacros(compiled.banks.macros).length !== 2048) throw new Error("An advanced bank has the wrong size.");

for (const fragment of [
  "Array.from({ length: 24 }",
  "number <= 12 ? number + 57 : number + 91",
  "fnLayerMappings",
  "API.TOTAL_LAYER_COUNT",
  "globalLayerLabel",
  "Hall effect",
  "Rappy Snappy",
  "SOCD",
  "Combination key",
  "Macro",
]) {
  if (!appSource.includes(fragment)) throw new Error(`Required application feature is missing: ${fragment}`);
}
if (API.PROFILE_COUNT !== 3 || API.LAYER_COUNT !== 4 || API.TOTAL_LAYER_COUNT !== 12) throw new Error("The three-profile, twelve-layer topology is incorrect.");
equal([0, 1, 2].map(API.profileConfigOffset), [0, 64, 128], "Live telemetry config offsets must follow the active profile.");
if (API.inferProfileIndex({ userKeys: { 0: [{ profile: 1, layer: 0 }] } }) !== 1) throw new Error("Embedded Profile 2 metadata was not inferred from a vendor backup.");
if (API.inferProfileIndex({ userKeys: { 0: [{ profile: 2, layer: 0 }] } }) !== 2) throw new Error("Embedded Profile 3 metadata was not inferred from a vendor backup.");
for (let layer = 0; layer < 12; layer += 1) {
  const expected = layer === 0 ? "FN" : `FN${layer}`;
  if (API.mappingName(240, 255, layer) !== expected) throw new Error(`Global Fn target ${expected} is missing.`);
}

for (const id of ["welcomeView", "workspaceView", "mappingDialog", "advancedDialog", "confirmDialog", "progressOverlay"]) {
  if (!htmlSource.includes(`id="${id}"`)) throw new Error(`Required UI surface is missing: ${id}`);
}
if (!htmlSource.includes('<script src="protocol.js"></script>') || !htmlSource.includes('<script src="app.js"></script>') || !htmlSource.includes('<link rel="stylesheet" href="styles.css"')) throw new Error("Static assets are not linked correctly.");
if (!htmlSource.includes('data-app-mode="live"') || !htmlSource.includes('href="json_editor/"')) throw new Error("The live route does not link to the dedicated JSON editor.");
for (const removedId of ['id="openFileButton"', 'id="welcomeFileButton"', 'id="demoButton"', 'id="fileInput"']) {
  if (htmlSource.includes(removedId)) throw new Error(`Offline control must not appear on the live landing page: ${removedId}`);
}
if (!jsonEditorHtml.includes('data-app-mode="json"') || !jsonEditorHtml.includes('id="openFileButton"') || !jsonEditorHtml.includes('id="fileInput"')) throw new Error("The dedicated JSON editor route is incomplete.");
if (!jsonEditorHtml.includes('<script src="../protocol.js"></script>') || !jsonEditorHtml.includes('<script src="../app.js"></script>') || !jsonEditorHtml.includes('<link rel="stylesheet" href="../styles.css"')) throw new Error("JSON editor assets are not linked correctly.");
if (appSource.includes("Reconnect")) throw new Error("Reconnect UI must remain removed.");
for (const fragment of ["resetToLanding", "Returned to the connection screen", 'document.addEventListener("keydown"', "event.preventDefault()", "event.stopImmediatePropagation()"] ) {
  if (!appSource.includes(fragment)) throw new Error(`Connection or keyboard-capture behavior is missing: ${fragment}`);
}
if (!styleSource.includes("@media (max-width: 780px)")) throw new Error("Responsive layout rules are missing.");
if (!appSource.includes("bindHallDragSelection") || !appSource.includes("pointermove") || !appSource.includes("elementFromPoint")) throw new Error("Hall drag-selection support is missing.");
if (!styleSource.includes('data-keyboard-mode="hall"') || !styleSource.includes("touch-action: none")) throw new Error("Hall touch drag-selection styles are missing.");
if (!appSource.includes('class="mapped primary-label"') || !appSource.includes("Physical:")) throw new Error("Mapped output must be the primary keycap label.");
if (appSource.includes('data-setting="tachyonMode"')) throw new Error("The capture-only Tachyon bit must not be exposed as a setting.");
for (const fragment of ["[102, 103, 105]", '[0, "0.01 mm"]', '[1, "0.005 mm"]', '[2, "0.001 mm"]']) {
  if (!appSource.includes(fragment)) throw new Error(`Precision compatibility rule is missing: ${fragment}`);
}
const baseConfig = Array(64).fill(0);
baseConfig[7] = 1;
const preservedConfig = API.applyDeviceSettings(baseConfig, { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, systemMode: 0 });
if ((preservedConfig[7] & 1) !== 1) throw new Error("The hidden Tachyon/Berserk bit was not preserved.");
const telemetry = API.decodeTelemetryReport([0xa0, 16, 0, 4, 0, 0, 1, 44, 0, 0, 255]);
if (!telemetry || telemetry.keyCode !== 4 || telemetry.rawTravel !== 300 || telemetry.status !== 255) throw new Error("Live Hall telemetry was not decoded correctly.");
const modifierTelemetry = API.decodeTelemetryReport([0xa0, 16, 2, 0, 0, 0, 0, 25, 0, 0, 1]);
if (modifierTelemetry.keyCode !== 225 || modifierTelemetry.rawTravel !== 25) throw new Error("Modifier telemetry key identity was not decoded correctly.");
const profileChange = API.decodeProfileChangeReport([0xa1, 11, 2]);
if (!profileChange || profileChange.layer !== 3 || profileChange.globalLayer !== 11 || profileChange.profileIndex !== 2) throw new Error("Global profile-change reports were not decoded correctly.");
const localProfileChange = API.decodeProfileChangeReport([0xa1, 3, 1]);
if (!localProfileChange || localProfileChange.layer !== 3 || localProfileChange.globalLayer !== 7 || localProfileChange.profileIndex !== 1) throw new Error("Local profile-change reports were not expanded to a global layer correctly.");
const crossProfileFnChange = API.decodeProfileChangeReport([0xa1, 7, 0]);
if (!crossProfileFnChange || crossProfileFnChange.layer !== 3 || crossProfileFnChange.globalLayer !== 7 || crossProfileFnChange.profileIndex !== 1) throw new Error("A global FN7 event did not resolve to Profile 2, Layer 7.");
const fakeDevice = { vendorId: 0x19f5, productId: 0xfb4c, productName: "Test HE30", opened: true, addEventListener() {}, removeEventListener() {} };
const fakeDriver = new API.HE30Driver(fakeDevice);
let routedTelemetry = null;
fakeDriver.telemetryActive = true;
fakeDriver.subscribeTelemetry((event) => { routedTelemetry = event; });
const telemetryBytes = Uint8Array.from([0xa0, 16, 0, 4, 0, 0, 1, 44, 0, 0, 255]);
fakeDriver.onInputReport({ data: new DataView(telemetryBytes.buffer) });
if (routedTelemetry?.rawTravel !== 300 || fakeDriver.reportQueue.length !== 0) throw new Error("Telemetry reports were not routed away from command responses.");
let routedProfileChange = null;
fakeDriver.subscribeProfileChange((event) => { routedProfileChange = event; });
const profileBytes = Uint8Array.from([0xa1, 2, 1]);
fakeDriver.onInputReport({ data: new DataView(profileBytes.buffer) });
if (routedProfileChange?.profileIndex !== 1 || routedProfileChange?.layer !== 2 || routedProfileChange?.globalLayer !== 6 || fakeDriver.reportQueue.length !== 0) throw new Error("Profile-change reports were not routed away from command responses.");
for (const fragment of ["startLiveTelemetry", "stopLiveTelemetry", "subscribeTelemetry"]) {
  if (!protocolSource.includes(fragment)) throw new Error(`Live telemetry driver support is missing: ${fragment}`);
}
for (const fragment of ["subscribeProfileChange", "handleHardwareProfileChange", "syncDeviceProfile", "preserveView: true"]) {
  if (!protocolSource.includes(fragment) && !appSource.includes(fragment)) throw new Error(`Live profile synchronization support is missing: ${fragment}`);
}
for (const fragment of ["liveMonitorHtml", "handleLiveTelemetry", "Live press distance", "Dynamic Display diagnostic flag", "resumeLiveMonitor"]) {
  if (!appSource.includes(fragment)) throw new Error(`Live distance infographic support is missing: ${fragment}`);
}
if (!styleSource.includes(".switch-infographic") || !styleSource.includes(".travel-fill")) throw new Error("Live distance animation styles are missing.");

const forbiddenFirmwareTokens = ["flashFirmware", "writeFirmware", "bootloaderCommand", "firmwareFileInput"];
for (const token of forbiddenFirmwareTokens) {
  if (protocolSource.includes(token) || appSource.includes(token) || htmlSource.includes(token) || jsonEditorHtml.includes(token)) throw new Error(`Firmware capability must remain absent: ${token}`);
}

console.log("Smoke test passed: codecs, feature surfaces, mappings, safety scope, and static assets verified.");
