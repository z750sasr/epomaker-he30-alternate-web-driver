import { VARIANTS, VID, identify, filter, hex, bytes, infoReport, bootReport,
  versionFromReply, sendApplicationReport } from "./protocol.js";

const ui = Object.fromEntries(["select", "info", "enter", "check", "device", "status", "log", "save"]
  .map(id => [id, document.getElementById(id)]));
const hid = navigator.hid;
const applications = Object.keys(VARIANTS).map(Number);
let device;
let transition;
let busy = false;
let entries = [];

const usbId = device => `${hex(device.vendorId)}:${hex(device.productId)}`;
function log(message, evidence) {
  entries.push({ at: new Date().toISOString(), message, ...(evidence && { evidence }) });
  ui.log.textContent += `[${entries.at(-1).at}] ${message}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}
function refresh() {
  const normal = identify(device ?? {})?.mode === "application";
  const available = Boolean(hid) && !busy;
  ui.select.disabled = !available;
  ui.info.disabled = !available || !normal || Boolean(transition);
  ui.enter.disabled = ui.info.disabled;
  ui.check.disabled = !available;
}
function act(callback) {
  return async () => {
    if (busy) return;
    busy = true;
    refresh();
    try {
      await callback();
    } catch (error) {
      ui.status.textContent = error.message;
      log(error.message);
    } finally {
      busy = false;
      refresh();
    }
  };
}
function describe(selected) {
  const identity = identify(selected);
  if (!identity) throw new Error("The selected device is outside the supported HE30 USB IDs.");
  ui.device.textContent = `${selected.productName || "HE30"} · ${usbId(selected)} · ${identity.mode}`;
  log(`Observed ${usbId(selected)} in ${identity.mode} mode.`, { collections: selected.collections });
}
function observeBoot(selected) {
  const identity = identify(selected);
  if (identity?.mode !== "bootloader") return;
  describe(selected);
  const match = transition?.boot === selected.productId;
  if (match) transition.observed = true;
  ui.status.textContent = match
    ? `Expected bootloader ${usbId(selected)} observed. ${transition.disconnected
      ? "Application disconnect also observed."
      : "Application disconnect has not been observed."}`
    : `Bootloader ${usbId(selected)} observed. No matching boot request in this session.`;
}
function readVersion(selected) {
  return new Promise((resolve, reject) => {
    function finish(error, version) {
      clearTimeout(timer);
      selected.removeEventListener("inputreport", onReport);
      if (error) reject(error);
      else resolve(version);
    }
    function onReport(event) {
      const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      const version = versionFromReply(event.reportId, data);
      if (version === null) {
        if (data[0] === 0xaa) log("Ignored reply with unexpected header or length.", { reportId: event.reportId, data: bytes(data) });
        return;
      }
      log(`Received version reply: ${bytes(data.slice(0, 10))} …`, { reportId: event.reportId, data: bytes(data) });
      finish(null, version);
    }
    const timer = setTimeout(() => finish(new Error("No matching version reply received within 3 seconds.")), 3000);
    selected.addEventListener("inputreport", onReport);
    const report = infoReport();
    log("Requesting firmware version.", { reportId: 0, data: bytes(report) });
    sendApplicationReport(selected, report).catch(error => finish(error));
  });
}

ui.select.onclick = act(async () => {
  const selected = await hid.requestDevice({ filters: applications.map(filter) });
  if (selected.length === 0) return;
  if (selected.length !== 1) throw new Error("Choose exactly one HE30.");
  if (device && device !== selected[0] && device.opened) await device.close();
  device = selected[0];
  transition = undefined;
  describe(device);
  ui.status.textContent = "HE30 application selected.";
});
ui.info.onclick = act(async () => {
  const version = await readVersion(device);
  ui.status.textContent = `Firmware field: 0x${hex(version)}`;
  log(ui.status.textContent);
});
ui.enter.onclick = act(async () => {
  const selected = device;
  const identity = identify(selected ?? {});
  if (identity?.mode !== "application" || transition) return;
  if (!confirm(`Send boot entry to ${usbId(selected)}? Expected updater: ${hex(VID)}:${hex(identity.boot)}. Related firmware writes a persistent boot flag. Unplugging may not restore typing, and a matching HE30 recovery image is unavailable.`)) return;
  const authorized = await hid.getDevices();
  if (authorized.some(candidate => candidate.productId === identity.boot && candidate.vendorId === VID)) {
    throw new Error("The expected bootloader is already visible. Disconnect the other HE30 before testing.");
  }
  const attempt = transition = { application: selected, boot: identity.boot, observed: false, disconnected: false };
  const report = bootReport();
  ui.status.textContent = `Waiting for ${hex(VID)}:${hex(attempt.boot)}. Use “Select bootloader to confirm” if needed.`;
  log(`Sending boot-entry request to ${usbId(selected)}.`, { reportId: 0, data: bytes(report) });
  setTimeout(() => {
    if (transition === attempt && !attempt.observed) {
      ui.status.textContent = "No expected bootloader seen yet. Check Device Manager or select the bootloader to grant browser access.";
      log(ui.status.textContent);
    }
  }, 12000);
  try {
    await sendApplicationReport(selected, report);
  } catch (error) {
    log(`Boot request ended with: ${error.message}. Check USB identity before retrying.`);
  }
});
ui.check.onclick = act(async () => {
  const ids = transition ? [transition.boot] : Object.values(VARIANTS);
  const selected = await hid.requestDevice({ filters: ids.map(filter) });
  if (selected.length === 0) return;
  if (selected.length !== 1) throw new Error("Choose exactly one HE30 bootloader.");
  observeBoot(selected[0]);
});
ui.save.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "he30-usb-session.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
hid?.addEventListener("disconnect", event => {
  if (!identify(event.device)) return;
  log(`Disconnected ${usbId(event.device)}.`);
  if (event.device === device) {
    if (transition?.application === event.device) {
      transition.disconnected = true;
      if (transition.observed) ui.status.textContent = "Application disconnected and expected bootloader observed.";
    }
    device = undefined;
    if (!transition?.observed) ui.device.textContent = "HE30 application disconnected.";
    refresh();
  }
});
hid?.addEventListener("connect", event => {
  if (identify(event.device)?.mode === "bootloader") observeBoot(event.device);
});
if (!hid) ui.status.textContent = "Open this tool in desktop Chrome or Edge over localhost to use WebHID.";
refresh();
