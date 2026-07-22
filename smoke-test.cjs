const fs = require("fs");
const vm = require("vm");

const root = __dirname;
const protocolSource = fs.readFileSync(`${root}/protocol.js`, "utf8");
const appSource = fs.readFileSync(`${root}/app.js`, "utf8");
const htmlSource = fs.readFileSync(`${root}/index.html`, "utf8");
const jsonEditorHtml = fs.readFileSync(`${root}/json_editor/index.html`, "utf8");
const styleSource = fs.readFileSync(`${root}/styles.css`, "utf8");
const factoryProfile = JSON.parse(fs.readFileSync(`${root}/src/factory_config.json`, "utf8"));

async function main() {
new Function(protocolSource);
new Function(appSource);

const context = { window: { navigator: {}, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, btoa, atob }, Uint8Array, ArrayBuffer, DataView, Promise, Math, Number, String, Boolean, Object, Array, Set, Map, JSON, Error };
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
for (let switchType = 0; switchType < 4; switchType += 1) {
  if (API.encodeTravel([{ switch_type: switchType }])[0] !== (0xa0 | switchType)) throw new Error(`Switch type ${switchType} was not encoded in the Hall record's low nibble.`);
}
const travelRoundTrip = API.decodeTravel(travelBytes);
for (const field of ["switch_type", "key_mode", "priority", "key_actuation", "rt_press", "rt_release", "pressPrecision", "releasePrecision", "press_deadzone", "release_deadzone"]) {
  equal(travelRoundTrip.map((item) => item[field]), travel.map((item) => item[field]), `Hall field ${field} did not round-trip.`);
}

const documentedHallKey = {
  switch_type: 0,
  key_mode: 1,
  priority: 0,
  key_max_length: 4,
  key_actuation: 145,
  rt_press: 50,
  rt_release: 50,
  pressPrecision: 0,
  releasePrecision: 0,
  press_deadzone: 30,
  release_deadzone: 23,
  deadzone_status: true,
};
const documentedHallRoundTrip = API.decodeTravel(API.encodeTravel(Array.from({ length: 128 }, () => documentedHallKey)))[0];
for (const field of ["switch_type", "key_mode", "priority", "key_actuation", "rt_press", "rt_release", "pressPrecision", "releasePrecision", "press_deadzone", "release_deadzone", "deadzone_status"]) {
  equal(documentedHallRoundTrip[field], documentedHallKey[field], `Documented Hall example field ${field} did not round-trip.`);
}
const oneSidedInsurance = { ...documentedHallKey, release_deadzone: 0 };
if (API.decodeTravel(API.encodeTravel(Array.from({ length: 128 }, () => oneSidedInsurance)))[0].deadzone_status) throw new Error("Trigger Insurance must require both top and bottom zones, matching the original driver.");

const colorValues = Array.from({ length: 128 }, (_, index) => `#${(index * 123457 % 0x1000000).toString(16).padStart(6, "0")}`);
equal(API.decodeColors(API.encodeColors(colorValues)), colorValues, "Per-key RGB colors did not round-trip.");

if (API.normalizeWootingShareCode("c4be8f8508212554b1992b5d83a1adf79f29") !== "c4be8f8508212554b1992b5d83a1adf79f29") throw new Error("Wooting share-code validation rejected the captured code format.");
if (API.wootingDistanceToHundredths(8224) !== 201 || API.wootingDistanceToHundredths(835) !== 20) throw new Error("Wooting normalized travel did not convert to HE30 hundredths of a millimeter.");
const wootingTarget = {
  profileIndex: 0,
  userKeys: Object.fromEntries([0, 1, 2, 3].map((layer) => [layer, Array.from({ length: 128 }, () => API.makeMapping(255, 255, 255, 0, layer))])),
  travelKeys: Array.from({ length: 128 }, () => ({ switch_type: 0, key_mode: 0, key_actuation: 40, rt_press: 10, rt_release: 10 })),
  advancedKeys: [],
  light: { effect: 3, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2" },
  colorKeys: Array(128).fill("#66f7c2"),
};
wootingTarget.userKeys[0][26] = API.makeMapping(240, 255, 1, 0, 0);
wootingTarget.userKeys[2][1] = API.makeMapping(16, 0, 99, 0, 2);
const wootingRgbGrid = Array.from({ length: 6 }, (_, row) => Array.from({ length: 21 }, (_, column) => ({ red: row * 30, green: column * 20, blue: 100 })));
const wootingSource = {
  version: 15,
  name: "Synthetic Wooting profile",
  analog: { actPoint: 8224, rapidTrigger: true, rapidTriggerSensitivity: 835, rapidTriggerStrictActuationRange: false, perKeyRapidTrigger: [
    { index: { rowNr: 1, colNr: 0 }, value: false },
    { index: { rowNr: 1, colNr: 1 }, value: { sensitivity: 410, secondarySensitivity: 820, strictActuationRange: false } },
  ] },
  customActuations: [{ index: { rowNr: 1, colNr: 1 }, value: 4096 }],
  remap: [
    [{ index: { rowNr: 1, colNr: 0 }, value: 38 }, { index: { rowNr: 1, colNr: 1 }, value: 1 }, { index: { rowNr: 2, colNr: 0 }, value: 40 }, { index: { rowNr: 5, colNr: 1 }, value: 102 }],
    [{ index: { rowNr: 1, colNr: 1 }, value: 107 }],
  ],
  rgb: { brightness: 195, kbdArray: wootingRgbGrid, layers: [] },
  akc: [{ keyIndex: { rowNr: 1, colNr: 0 }, layer: 0, modTap: { tapKey: { byte: 38 }, holdKey: { byte: 50 } } }],
  dks: [],
};
const wootingConverted = API.convertWootingProfile(wootingSource, wootingTarget);
if (wootingConverted.summary.layerCount !== 2 || wootingConverted.summary.mappingsCopied !== 5 || wootingConverted.summary.matchedKeyCount !== 4) throw new Error("Wooting layer/key matching summary is incorrect.");
if (wootingConverted.profile.userKeys[0][1].code2 !== 4 || wootingConverted.profile.userKeys[1][1].code2 !== 104 || wootingConverted.profile.userKeys[2][1].code2 !== 99) throw new Error("Wooting mappings did not copy only the supplied layers.");
if (wootingConverted.profile.userKeys[0][26].type !== 16 || wootingConverted.profile.userKeys[0][26].code1 !== 8) throw new Error("The Wooting Windows-key position was not imported onto the HE30 Fn key.");
if (wootingConverted.profile.travelKeys[0].key_mode !== 0 || wootingConverted.profile.travelKeys[1].key_mode !== 2 || wootingConverted.profile.travelKeys[1].key_actuation !== 100 || wootingConverted.profile.travelKeys[1].rt_press !== 10 || wootingConverted.profile.travelKeys[1].rt_release !== 20) throw new Error("Wooting actuation or per-key Continuous Rapid Trigger conversion is incorrect.");
if (wootingConverted.profile.advancedKeys.length !== 1 || wootingConverted.profile.advancedKeys[0].type !== "mt" || wootingConverted.profile.advancedKeys[0].mtDownKey.code2 !== 53) throw new Error("Compatible Wooting advanced actions were not converted.");
if (!wootingConverted.summary.staticLightingImported || wootingConverted.summary.colorsCopied !== 6 || wootingConverted.profile.light.effect !== 0 || wootingConverted.profile.light.brightness !== 76 || wootingConverted.profile.light.singleColor !== false) throw new Error("Wooting Static lighting was not converted to HE30 Preset Config.");
if (wootingConverted.profile.colorKeys[26] !== "#961464" || !wootingConverted.summary.sections.includes("lighting") || !wootingConverted.summary.sections.includes("colors")) throw new Error("Wooting per-key colors or lighting sections were not staged correctly.");
if (wootingConverted.profile.colorKeys[30] !== "#1e1464") throw new Error("Compact Wooting Preset lighting did not mirror the number-row color onto the matching HE30 function key.");

const explicitTravelConverted = API.convertWootingProfile({
  ...wootingSource,
  switchSelector: { switches: [{ index: { rowNr: 1, colNr: 1 }, totalTravelMm: 3.5 }] },
}, wootingTarget);
if (!explicitTravelConverted.summary.switchTravelDetected || explicitTravelConverted.profile.travelKeys[1].key_actuation !== 88) throw new Error("Explicit Wooting Switch Selector travel did not rescale Hall settings.");

const dynamicRgbConverted = API.convertWootingProfile({
  ...wootingSource,
  rgb: { ...wootingSource.rgb, effects: { layers: [{}] } },
}, wootingTarget);
if (dynamicRgbConverted.summary.staticLightingImported || dynamicRgbConverted.profile.light.effect !== 3 || dynamicRgbConverted.summary.sections.includes("colors")) throw new Error("A dynamic Wooting effect was incorrectly imported as HE30 Preset lighting.");

const functionRowCoordinates = [
  [0, 0], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7],
  ...Array.from({ length: 7 }, (_, column) => [1, column]),
  ...Array.from({ length: 6 }, (_, column) => [2, column]),
  ...Array.from({ length: 6 }, (_, column) => [3, column]),
  [4, 0], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6],
  [5, 0], [5, 1], [5, 2], [5, 6],
];
const functionRowConverted = API.convertWootingProfile({
  ...wootingSource,
  remap: [functionRowCoordinates.map(([rowNr, colNr]) => ({ index: { rowNr, colNr }, value: 1 }))],
}, wootingTarget);
if (!functionRowConverted.summary.hasFunctionRow || functionRowConverted.summary.matchedKeyCount !== 36 || functionRowConverted.summary.colorsCopied !== 36) throw new Error("Function-row Wooting layouts did not map all 36 HE30 keys.");

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
    { type: "cb", layer: 0, index1: 7, modifiers: 3, modifierOrder: [2, 1], baseKey: API.makeMapping(16, 0, 7) },
    { type: "macro", layer: 0, index1: 8, macroRepeatCount: 1, actions: [{ action: "keydown", code: 4, delay: 0 }, { action: "keyup", code: 4, delay: 25 }] },
  ],
};
const compiled = API.compileAdvanced(profile);
if (compiled.banks.dks.length !== 1 || compiled.banks.mt.length !== 5 || compiled.banks.tgl.length !== 1 || compiled.banks.macros.length !== 1) throw new Error("Advanced actions did not compile into the expected banks.");
if (API.encodeDksBank(compiled.banks.dks).length !== 1024 || API.encodeMtBank(compiled.banks.mt).length !== 256 || API.encodeTglBank(compiled.banks.tgl).length !== 128 || API.encodeMacros(compiled.banks.macros).length !== 2048) throw new Error("An advanced bank has the wrong size.");
for (const [priority, expectedPair] of [[0, [0, 0]], [1, [1, 2]], [2, [2, 1]], [3, [3, 3]]]) {
  const socdModeProfile = {
    ...profile,
    advancedKeys: profile.advancedKeys.map((item) => item.type === "socd" ? { ...item, option: { ...item.option, priority } } : item),
  };
  const socdModeCompiled = API.compileAdvanced(socdModeProfile);
  equal([socdModeCompiled.travelKeys[5].priority, socdModeCompiled.travelKeys[6].priority], expectedPair, `SOCD mode ${priority} compiled to the wrong priority pair.`);
  const socdTravelRoundTrip = API.decodeTravel(API.encodeTravel(socdModeCompiled.travelKeys));
  equal([socdTravelRoundTrip[5].priority, socdTravelRoundTrip[6].priority], expectedPair, `SOCD mode ${priority} was not preserved by the Hall codec.`);
}
const shareReadyProfile = {
  ...profile,
  name: "Share-code smoke profile",
  travelKeys: travel.map((item) => ({ ...item, key_max_length: 4, deadzone_status: item.press_deadzone > 0 && item.release_deadzone > 0 })),
  light: { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2" },
  logoLight: { effect: 1, brightness: 80, speed: 2, direction: 0, singleColor: true, color: "#66f7c2" },
  colorKeys: Array(128).fill("#66f7c2"),
  deviceSettings: { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: false, checkMode: false, tachyonMode: true, systemMode: 0 },
  _rawConfig: Array(64).fill(0),
};
const shareCode = await API.encodeProfileShare(shareReadyProfile);
if (!shareCode.startsWith("HE30P1.") || shareCode.length >= JSON.stringify(shareReadyProfile).length) throw new Error("The profile share code was not versioned and compressed.");
const sharedRoundTrip = await API.decodeProfileShare(shareCode);
if (sharedRoundTrip.profileIndex !== 0 || sharedRoundTrip.userKeys[0].length !== 128 || sharedRoundTrip.travelKeys.length !== 128 || sharedRoundTrip.advancedKeys.length !== profile.advancedKeys.length || !sharedRoundTrip.deviceSettings.tachyonMode) throw new Error("The compressed profile share code did not round-trip all configuration sections.");
equal(sharedRoundTrip.advancedKeys.find((item) => item.type === "cb")?.modifierOrder, [2, 1], "Combination-key modifier order was not preserved by profile sharing.");
let rejectedCorruptShare = false;
try {
  const corruptIndex = Math.floor(shareCode.length / 2);
  await API.decodeProfileShare(shareCode.slice(0, corruptIndex) + (shareCode[corruptIndex] === "A" ? "B" : "A") + shareCode.slice(corruptIndex + 1));
} catch (_) { rejectedCorruptShare = true; }
if (!rejectedCorruptShare) throw new Error("A corrupted compressed profile share code was accepted.");

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
for (const mode of ["Last Input Priority", "Absolute 1st key", "Absolute 2nd key", "Neutral"]) {
  if (!appSource.includes(mode)) throw new Error(`SOCD mode is missing: ${mode}`);
}
if (appSource.includes("Neutral / last input")) throw new Error("Neutral and Last Input Priority must remain separate SOCD modes.");
for (const fragment of ["defaultMappingForPhysical", "restoreAdvancedHosts(item)", "preserveAdvancedUiMetadata", "mappingPickerField", "openAdvancedMappingPicker", "data-open-mapping-picker", "Advanced action · Layer 0", "advanced-pair-hosts", "modifierPickerHtml", "comboModifierOrder", "modifierOrder", "Layer 0 only."]) {
  if (!appSource.includes(fragment)) throw new Error(`Advanced-editor revamp is missing: ${fragment}`);
}
if (appSource.includes('id="advLayer"') || appSource.includes('Number($("#advLayer").value)')) throw new Error("Advanced actions must no longer expose or read a nonzero layer selector.");
const deleteAdvancedSource = appSource.match(/function deleteAdvanced\(index\) \{([\s\S]*?)\n  \}/)?.[1] || "";
if (!deleteAdvancedSource.includes("restoreAdvancedHosts(item)") || deleteAdvancedSource.includes("makeMapping(255")) throw new Error("Deleting an Advanced action must restore its saved or physical-default host mappings.");
for (const fragment of [".mapping-picker-control", ".modifier-options", ".modifier-order-item", ".advanced-pair-hosts"]) {
  if (!styleSource.includes(fragment)) throw new Error(`Advanced-editor styling is missing: ${fragment}`);
}
if (API.PROFILE_COUNT !== 3 || API.LAYER_COUNT !== 4 || API.TOTAL_LAYER_COUNT !== 12) throw new Error("The three-profile, twelve-layer topology is incorrect.");
equal([0, 1, 2].map(API.profileConfigOffset), [0, 64, 128], "Live telemetry config offsets must follow the active profile.");
equal(API.factoryResetPayload(0), [0xee, 0, 1, 1, 0, 0, 0, 0], "Profile 1 reset payload does not match the original driver.");
equal(API.factoryResetPayload(2), [0xee, 0, 3, 1, 0, 0, 0, 2], "Profile 3 reset payload does not match the original driver.");
equal(API.factoryResetAllPayload(), [0xee, 0, 0, 1, 0, 0, 0, 0xff], "All-profile reset payload does not match the original driver.");
let rejectedResetTarget = false;
try { API.factoryResetPayload(255); } catch (_) { rejectedResetTarget = true; }
if (!rejectedResetTarget) throw new Error("A current-profile reset must reject the all-profile sentinel.");
if (API.inferProfileIndex({ userKeys: { 0: [{ profile: 1, layer: 0 }] } }) !== 1) throw new Error("Embedded Profile 2 metadata was not inferred from a vendor backup.");
if (API.inferProfileIndex({ userKeys: { 0: [{ profile: 2, layer: 0 }] } }) !== 2) throw new Error("Embedded Profile 3 metadata was not inferred from a vendor backup.");
for (let layer = 0; layer < 12; layer += 1) {
  const expected = layer === 0 ? "FN" : `FN${layer}`;
  if (API.mappingName(240, 255, layer) !== expected) throw new Error(`Global Fn target ${expected} is missing.`);
}
if (API.mappingName(240, 8, 0) !== "Factory reset (hold 3s)") throw new Error("The factory Reset action still has a generic label.");
if (API.mappingName(240, 87, 0) !== "Open EPOMAKER web driver") throw new Error("The factory web-driver shortcut still has a generic label.");
equal([0, 1, 2].map((profileIndex) => API.translateFactoryFnLayer(1, profileIndex)), [1, 5, 9], "Factory FN1 targets were not translated per profile.");
equal([0, 1, 2].map((profileIndex) => API.translateFactoryFnLayer(3, profileIndex)), [3, 7, 11], "Factory FN3 targets were not translated per profile.");
for (let layer = 0; layer < API.LAYER_COUNT; layer += 1) {
  if (!Array.isArray(factoryProfile.userKeys?.[layer]) || factoryProfile.userKeys[layer].length !== API.KEY_COUNT) throw new Error(`Factory layer ${layer} is incomplete.`);
}
if (factoryProfile.travelKeys?.length !== API.KEY_COUNT || !Array.isArray(factoryProfile.advancedKeys) || !factoryProfile.light || !factoryProfile.logoLight) throw new Error("The bundled factory-profile schema is incomplete.");
const factoryFn1Space = factoryProfile.userKeys[1][28];
const factoryFn1Escape = factoryProfile.userKeys[1][0];
equal([factoryFn1Space.type, factoryFn1Space.code1, factoryFn1Space.code2], [240, 87, 0], "The factory Fn1+Space web-driver shortcut changed.");
equal([factoryFn1Escape.type, factoryFn1Escape.code1, factoryFn1Escape.code2], [240, 8, 0], "The factory Fn1+Escape reset action changed.");

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
for (const [source, label] of [[htmlSource, "live driver"], [jsonEditorHtml, "JSON editor"]]) {
  const diagnosticsPosition = source.indexOf('data-page="diagnostics"');
  const aboutPosition = source.indexOf('data-page="about"');
  if (aboutPosition < 0 || aboutPosition < diagnosticsPosition) throw new Error(`About me must appear below Diagnostics in the ${label} navigation.`);
}
for (const fragment of ["ABOUT_ME_HTML", "ABOUT ME: START CUSTOM HTML", "ABOUT ME: END CUSTOM HTML", "renderAboutMe", "about: renderAboutMe", '${ABOUT_ME_HTML}']) {
  if (!appSource.includes(fragment)) throw new Error(`Customizable About me page is missing: ${fragment}`);
}
if (!styleSource.includes(".about-me-page") || !styleSource.includes(".about-me-custom") || !styleSource.includes(".about-me-links")) throw new Error("About me page styling is missing.");
if (appSource.includes("Reconnect")) throw new Error("Reconnect UI must remain removed.");
for (const fragment of ["resetToLanding", "Returned to the connection screen", 'document.addEventListener("keydown"', "event.preventDefault()", "event.stopImmediatePropagation()"] ) {
  if (!appSource.includes(fragment)) throw new Error(`Connection or keyboard-capture behavior is missing: ${fragment}`);
}
if (!styleSource.includes("@media (max-width: 780px)")) throw new Error("Responsive layout rules are missing.");
if (!appSource.includes("bindHallDragSelection") || !appSource.includes("updateHallSelectionBox") || !appSource.includes("selectionAfterHallBox")) throw new Error("Hall box-selection support is missing.");
if (!styleSource.includes('data-keyboard-mode="hall"') || !styleSource.includes("touch-action: none") || !styleSource.includes("hall-selection-box")) throw new Error("Hall box-selection styles are missing.");
if (!appSource.includes('class="mapped primary-label"') || !appSource.includes("Physical:")) throw new Error("Mapped output must be the primary keycap label.");
for (const fragment of ['"tachyonMode"', "Tachyon / Berserker mode", "Hidden setting · use with caution", "original driver does not list it as a normal option"]) {
  if (!appSource.includes(fragment)) throw new Error(`The cautious Tachyon/Berserker setting is incomplete: ${fragment}`);
}
for (const fragment of ["factoryResetCardHtml", "FACTORY_PROFILE_URL", "validateFactoryProfileTemplate", "prepareFactoryProfile", "resetFromFactoryProfile", "FACTORY PROFILE READY", "translateFactoryFnLayer", "Device-performance settings and per-key RGB colors stay unchanged"]) {
  if (!appSource.includes(fragment) && !protocolSource.includes(fragment)) throw new Error(`Safe partial factory-reset support is missing: ${fragment}`);
}
for (const fragment of ["[102, 103, 104, 105]", '[0, "0.01 mm"]', '[1, "0.005 mm"]', '[2, "0.001 mm"]', "HIDDEN SETTING · USE WITH CAUTION", 'data-rt-sensitivity-preset="0.05"', 'data-rt-sensitivity-preset="0.10"']) {
  if (!appSource.includes(fragment)) throw new Error(`Precision compatibility rule is missing: ${fragment}`);
}
for (const fragment of ["hallRapidTrigger", "hallFullTravel", "hallIndependentRt", "hallInsurance", "hallTriggerBottom", "rtPrecisionMeta", "Continuous Rapid Trigger"]) {
  if (!appSource.includes(fragment)) throw new Error(`Original-driver Hall control is missing: ${fragment}`);
}
if (appSource.includes('id="hallMode"')) throw new Error("The ambiguous Hall mode dropdown must be replaced by explicit Rapid Trigger controls.");
const baseConfig = Array(64).fill(0);
baseConfig[7] = 1;
const preservedConfig = API.applyDeviceSettings(baseConfig, { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, systemMode: 0 });
if ((preservedConfig[7] & 1) !== 1) throw new Error("The hidden Tachyon/Berserk bit was not preserved.");
const tachyonEnabledConfig = API.applyDeviceSettings(new Array(64).fill(0), { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, tachyonMode: true, systemMode: 0 });
if ((tachyonEnabledConfig[7] & 1) !== 1 || !API.decodeDeviceSettings(tachyonEnabledConfig).tachyonMode) throw new Error("Tachyon/Berserker mode did not set firmware config byte 7 bit 0.");
const tachyonDisabledConfig = API.applyDeviceSettings(tachyonEnabledConfig, { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: 0, checkMode: false, tachyonMode: false, systemMode: 0 });
if ((tachyonDisabledConfig[7] & 1) !== 0 || API.decodeDeviceSettings(tachyonDisabledConfig).tachyonMode) throw new Error("Tachyon/Berserker mode did not clear firmware config byte 7 bit 0.");
const triggerBottomConfig = API.applyDeviceSettings(baseConfig, { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 1, debounce: 0, stabilityMode: true, checkMode: false, systemMode: 0 });
if ((triggerBottomConfig[7] & 2) !== 2) throw new Error("Trigger Bottom did not set the profile-wide stability-mode bit.");
const originalLevelConfig = API.applyDeviceSettings(baseConfig, { lockWin: false, lockAltTab: false, lockAltF4: false, reportRate: 1, tickRate: 2, debounce: 7, stabilityMode: false, checkMode: false, systemMode: 1 });
if (((originalLevelConfig[4] >> 4) & 15) !== 2) throw new Error("High tick rate must use the original driver's encoded value 2.");
if (((originalLevelConfig[7] >> 5) & 7) !== 7) throw new Error("High debounce must use the original driver's encoded value 7.");
if ((originalLevelConfig[1] & 15) !== 1) throw new Error("macOS mode must be written to the firmware OS-mode byte.");
equal(API.encodeMappings([{ type: 16, code1: 8, code2: 0 }]).slice(0, 3), [16, 8, 0], "Command/GUI modifier mapping must use the firmware modifier mask, not HID code 227 in code2.");
if (API.translateProfileFnLayer(5, 1, 2) !== 9 || API.translateProfileFnLayer(7, 1, 0) !== 3) throw new Error("Self-contained Fn targets were not moved with a shared profile.");
if (API.translateProfileFnLayer(2, 1, 2) !== 2) throw new Error("A deliberate cross-profile Fn target must remain unchanged during profile sharing.");
const sharedRetarget = API.retargetSharedProfile({
  profileIndex: 1,
  userKeys: Object.fromEntries([0, 1, 2, 3].map((layer) => [layer, [API.makeMapping(240, 255, layer === 0 ? 5 : 2, 1, layer)]])),
  advancedKeys: [{ type: "mt", layer: 0, index1: 0, mtClickKey: API.makeMapping(240, 255, 5), mtDownKey: API.makeMapping(240, 255, 2) }],
}, 2);
if (sharedRetarget.profileIndex !== 2 || sharedRetarget.userKeys[0][0].code2 !== 9 || sharedRetarget.userKeys[1][0].code2 !== 2 || sharedRetarget.advancedKeys[0].mtClickKey.code2 !== 9 || sharedRetarget.advancedKeys[0].mtDownKey.code2 !== 2) throw new Error("Shared-profile Fn retargeting did not cover mappings embedded in advanced actions.");
for (const fragment of ['[[0, "Low"], [1, "Medium"], [2, "High"]]', '[[0, "Close"], [1, "Low"], [4, "Medium"], [7, "High"]]', 'macName: "Left Command"', 'macOnly: true', '["Windows mode", 4, 0', '["macOS mode", 5, 0', '["Toggle Windows / macOS", 6, 0']) {
  if (!appSource.includes(fragment)) throw new Error(`Original-driver device setting or macOS mapping is missing: ${fragment}`);
}
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
let routedCalibration = null;
fakeDriver.calibrationActive = true;
fakeDriver.subscribeCalibration((event) => { routedCalibration = event; });
fakeDriver.onInputReport({ data: new DataView(telemetryBytes.buffer) });
if (routedCalibration?.keyCode !== 4 || routedCalibration?.rawTravel !== 300 || routedCalibration?.status !== 255 || fakeDriver.reportQueue.length !== 0) throw new Error("Calibration reports were not routed to the calibration session.");
fakeDriver.calibrationActive = false;
let routedProfileChange = null;
fakeDriver.subscribeProfileChange((event) => { routedProfileChange = event; });
const profileBytes = Uint8Array.from([0xa1, 2, 1]);
fakeDriver.onInputReport({ data: new DataView(profileBytes.buffer) });
if (routedProfileChange?.profileIndex !== 1 || routedProfileChange?.layer !== 2 || routedProfileChange?.globalLayer !== 6 || fakeDriver.reportQueue.length !== 0) throw new Error("Profile-change reports were not routed away from command responses.");
for (const fragment of ["startLiveTelemetry", "stopLiveTelemetry", "subscribeTelemetry"]) {
  if (!protocolSource.includes(fragment)) throw new Error(`Live telemetry driver support is missing: ${fragment}`);
}
for (const fragment of ["subscribeCalibration", "startCalibration", "endCalibration", "this.transact(REQUEST_PREFIX, [0xa8, 0, 0])", "this.transact(REQUEST_PREFIX, [0xa9, 0, 0])"]) {
  if (!protocolSource.includes(fragment)) throw new Error(`Original-driver calibration protocol is missing: ${fragment}`);
}
if (!protocolSource.includes("if (this.calibrationActive) throw new Error")) throw new Error("Calibration and live diagnostics must remain mutually exclusive.");
if (!protocolSource.includes("readLiveColors") || !protocolSource.includes("this.readBlock(0xde, 0, 384)")) throw new Error("Live RGB framebuffer command 0xDE is missing.");
if (!protocolSource.includes("readLiveStripSettings") || !protocolSource.includes("return decodeLighting(config).logoLight")) throw new Error("Live light-strip configuration reads are missing.");
for (const fragment of ["subscribeProfileChange", "handleHardwareProfileChange", "syncDeviceProfile", "preserveView: true"]) {
  if (!protocolSource.includes(fragment) && !appSource.includes(fragment)) throw new Error(`Live profile synchronization support is missing: ${fragment}`);
}
if (!appSource.includes("const activeLayer = profileChanged ? 0")) throw new Error("Completed profile switches must return the editor to the new profile's base layer.");
for (const fragment of ["Aurora Purple Switches", "Gateron Jade Pro HE", "Gateron Magnetic Jade Gaming HE", "Mount Tai GT HE", "hallSwitchType", "switch-type-indicator", "hall-switch-legend", "switch_type: Number($(\"#hallSwitchType\").value)"]) {
  if (!appSource.includes(fragment)) throw new Error(`Hall switch-type control or indicator is missing: ${fragment}`);
}
for (const fragment of ["SWITCH_COMPARISON_ROWS", "Compare all four switches", "Switch Comparision.xlsx", "data-switch-image-slot", "Magnetic-flux test basis", "3.5 mm or 3.4 ± 0.2 mm?"]) {
  if (!appSource.includes(fragment)) throw new Error(`Switch comparison content is missing: ${fragment}`);
}
for (const fragment of ["aurora_purple_1.png", "aurora_purple_2.png", "gateron_jade_pro_1.webp", "gateron_jade_pro_2.webp", "gateron_jade_gaming_1.webp", "gateron_jade_gaming_2.png", "mount_tai_gt_he_1.webp", "mount_tai_gt_he_2.png", "type.images.map", 'loading="lazy"', "appAssetUrl(image.src)"]) {
  if (!appSource.includes(fragment)) throw new Error(`Switch product image support is missing: ${fragment}`);
}
if ((appSource.match(/data-switch-image-slot=/g) || []).length !== 1 || !appSource.includes('${type.value}-${index + 1}')) throw new Error("Each switch must render its two configured product images.");
for (const fragment of ["SWITCH_SOURCE_LINKS", "gateron-magnetic-jade-pro-switch-set", "gateron-magnetic-jade-gaming-switch-set", "mchose-ace-68-turbo", "mchose-ace-68-air", 'target="_blank" rel="noopener noreferrer"']) {
  if (!appSource.includes(fragment)) throw new Error(`Clickable switch source is missing: ${fragment}`);
}
for (const fragment of ["hallWorkspaceView", "setHallWorkspaceView", "Actuation tuning", "Switch selector", 'data-hall-workspace="tuning"', 'data-hall-workspace="switches"', 'data-hall-workspace-pane="tuning"', 'data-hall-workspace-pane="switches"']) {
  if (!appSource.includes(fragment)) throw new Error(`Hall workspace toggle is missing: ${fragment}`);
}
if (!styleSource.includes(".keycap .key-dot") || !styleSource.includes("left: 7px") || !styleSource.includes(".keycap .switch-type-indicator") || !styleSource.includes("right: 6px")) throw new Error("Hall keycaps must keep the staged marker at top-left and show switch type at top-right.");
for (const fragment of [".switch-comparison", ".switch-image-grid", ".switch-image-frame img", ".switch-image-frame figcaption", ".switch-comparison-table-wrap", ".switch-source-links a", ".hall-workspace-toggle", ".hall-workspace-pane[hidden]"]) {
  if (!styleSource.includes(fragment)) throw new Error(`Switch comparison styling is missing: ${fragment}`);
}
for (const fragment of ["liveMonitorHtml", "handleLiveTelemetry", "Live press distance", "Dynamic Display diagnostic flag", "resumeLiveMonitor"]) {
  if (!appSource.includes(fragment)) throw new Error(`Live distance infographic support is missing: ${fragment}`);
}
if (!appSource.includes('value: 0, name: "Aurora Purple Switches"') || !appSource.includes("maxTravel: 3.4") || (appSource.match(/maxTravel: 3\.5/g) || []).length !== 3) throw new Error("Switch-specific 3.4/3.5 mm travel maxima are missing.");
if ((appSource.match(/switchTravelMaximum\(/g) || []).length < 6 || !appSource.includes('id="liveScaleMaximum"') || !appSource.includes('text("#liveScaleMaximum"')) throw new Error("Live travel scaling must use the installed switch model everywhere and update the axis endpoint.");
if (!styleSource.includes(".switch-infographic") || !styleSource.includes(".travel-fill")) throw new Error("Live distance animation styles are missing.");
for (const fragment of ["calibrationPanelHtml", "toggleCalibration", "handleCalibrationTelemetry", "calibrationStatus", "Stop calibration", "Press every physical key one at a time until it turns blue."]) {
  if (!appSource.includes(fragment)) throw new Error(`Calibration UI or behavior is missing: ${fragment}`);
}
for (const fragment of [".calibration-panel", ".calibration-progress", ".calibration-waiting", ".calibration-progress", ".calibration-complete", ".calibration-fill", ".calibration-locked"]) {
  if (!styleSource.includes(fragment)) throw new Error(`Calibration styling is missing: ${fragment}`);
}
for (const fragment of ["await stopCalibration(false)", "state.driver.endCalibration()", "state.calibrationUnsubscribe?.()"] ) {
  if (!appSource.includes(fragment)) throw new Error(`Calibration cleanup behavior is missing: ${fragment}`);
}
for (const fragment of ["calibrationOperationPromise", "if (state.calibrationOperationPromise) return state.calibrationOperationPromise", "await state.calibrationOperationPromise"]) {
  if (!appSource.includes(fragment)) throw new Error(`Calibration start/stop race protection is missing: ${fragment}`);
}
for (const fragment of ["const KEY_UNITS", "Tab: 1.5", "Caps: 1.75", "Shift: 2.25", "Ctrl: 1.25", "Fn: 1.25", "Alt: 1.25", "Space: 2.75", "keyWidth(keyItem)"]) {
  if (!appSource.includes(fragment)) throw new Error(`Physical keyboard unit sizing is missing: ${fragment}`);
}
for (const fragment of ["hall-primary-grid", "hall-selection-panel", "hall-live-panel", "keyboard-grid lighting-board", "--key-width"]) {
  if (!appSource.includes(fragment) && !styleSource.includes(fragment)) throw new Error(`Shared keyboard or Hall workbench layout is missing: ${fragment}`);
}
for (const fragment of ["keyWidth(keyItem, 74, 9)", "discardHallButton", "discardHallEdit", "Pending Hall edits discarded", ".hall-edit-actions"]) {
  if (!appSource.includes(fragment) && !styleSource.includes(fragment)) throw new Error(`Hall keyboard sizing or draft-discard behavior is missing: ${fragment}`);
}
if (styleSource.includes(".key-row:last-child .keycap:last-child") || styleSource.includes(".lighting-board-row:last-child")) throw new Error("Legacy stretched Space-key layout must not be used.");
for (const fragment of ["lightingKeyboardPreview", "configuredLightingColor", "data-lighting-board", "Light strip", "Select all 36", "previewSelectedKeyColor"]) {
  if (!appSource.includes(fragment)) throw new Error(`Lighting page feature is missing: ${fragment}`);
}
for (const fragment of ["PROFILE_SHARE_PREFIX", "encodeProfileShare", "decodeProfileShare", "retargetSharedProfile", "CompressionStream", "DecompressionStream", "HE30P1.", "validateProfileShareCode", "replaceProfileFromShare", "data-share-target"]) {
  if (!protocolSource.includes(fragment) && !appSource.includes(fragment)) throw new Error(`Compressed profile sharing is missing: ${fragment}`);
}
for (const fragment of ["position: sticky", ".work-header", ".profile-share-grid", ".share-code", ".share-target-grid"]) {
  if (!styleSource.includes(fragment)) throw new Error(`Sticky actions or profile-sharing styles are missing: ${fragment}`);
}
for (const fragment of ["convertWootingProfile", "normalizeWootingShareCode", "WOOTING_PROFILE_API_URL", "loadWootingShareCode", "analyzeWootingJson", "stageWootingImport", "Open source JSON", "Fn maps from Wooting's Windows-key position.", "Preset colors", "default source travel"]) {
  if (!protocolSource.includes(fragment) && !appSource.includes(fragment)) throw new Error(`Wooting profile import support is missing: ${fragment}`);
}
for (const fragment of [".wooting-code-input", ".wooting-preview", ".wooting-summary-grid"]) {
  if (!styleSource.includes(fragment)) throw new Error(`Wooting profile import styles are missing: ${fragment}`);
}
const mainEffectSource = appSource.match(/const MAIN_LIGHT_EFFECTS = Object\.freeze\(\[([\s\S]*?)\]\);\s*const LIGHT_STRIP_EFFECTS/)?.[1] || "";
const stripEffectSource = appSource.match(/const LIGHT_STRIP_EFFECTS = Object\.freeze\(\[([\s\S]*?)\]\);\s*const lightingEffects/)?.[1] || "";
equal([...mainEffectSource.matchAll(/\{ value: (\d+)/g)].map((match) => Number(match[1])), [...Array.from({ length: 22 }, (_, index) => index + 1), 255, 0], "The 24 main-light effect IDs or original-driver order changed.");
equal([...stripEffectSource.matchAll(/\{ value: (\d+)/g)].map((match) => Number(match[1])), [0, 1, 2, 3, 4], "The five light-strip effect IDs or original-driver order changed.");
for (const fragment of ["data-light-effect", "data-effect-value", "effectPicker", "lighting-effect-fields", "Hundred Flowers", "Always On Ripples", "Lights Off", "Preset", "Close", "Always on"]) {
  if (!appSource.includes(fragment)) throw new Error(`Original-driver lighting preset support is missing: ${fragment}`);
}
for (const fragment of ["startLiveLighting", "pollLiveLighting", "stopLiveLighting", "Live from keyboard", "readLiveColors", "readLiveStripSettings", "liveStripLight", "liveStripStatus"]) {
  if (!appSource.includes(fragment)) throw new Error(`Live lighting behavior is missing: ${fragment}`);
}
for (const fragment of ["LIVE_LIGHTING_SMOOTHING_MS", "liveLightingDisplayColors", "requestAnimationFrame(animateLiveLighting)", "blendLightingColor", "LIVE_STRIP_CONFIG_POLL_MS", "LIVE_STRIP_FRAME_START", "LIVE_STRIP_SEGMENT_COUNT", "liveStripFramebufferDetected", "stripFrameColors", "updateLiveStripUI", "spectrumLightingColor", "data-strip-segment"]) {
  if (!appSource.includes(fragment)) throw new Error(`Smooth live-lighting rendering is missing: ${fragment}`);
}
if (!appSource.includes('const delay = [0, 3, 255].includes(state.profile?.light?.effect) ? 500 : 50')) throw new Error("Live-lighting smoothing must not increase HID polling traffic.");
if (!styleSource.includes(".lighting-board-key") || !styleSource.includes(".light-strip") || !styleSource.includes(".light-strip i:first-child") || !styleSource.includes('[data-keyboard-mode="color"]')) throw new Error("The 36-key and live light-strip lighting previews are incomplete.");

const forbiddenFirmwareTokens = ["flashFirmware", "writeFirmware", "bootloaderCommand", "firmwareFileInput"];
for (const token of forbiddenFirmwareTokens) {
  if (protocolSource.includes(token) || appSource.includes(token) || htmlSource.includes(token) || jsonEditorHtml.includes(token)) throw new Error(`Firmware capability must remain absent: ${token}`);
}

console.log("Smoke test passed: codecs, feature surfaces, mappings, safety scope, and static assets verified.");
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
