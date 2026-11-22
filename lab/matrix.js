import { bytes, filter, requireApplication } from "./protocol.js";

// Physical layout and software slots from the alternate HE30 driver's HE30_LAYOUT.
const rows = [
  [["Esc", 0], ["F1", 30], ["F2", 31], ["F3", 32], ["F4", 33], ["F5", 34], ["F6", 35]],
  [["`", 29], ["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6]],
  [["Tab", 7], ["Q", 8], ["W", 9], ["E", 10], ["R", 11], ["T", 12]],
  [["Caps", 13], ["A", 14], ["S", 15], ["D", 16], ["F", 17], ["G", 18]],
  [["Shift", 19], ["Z", 20], ["X", 21], ["C", 22], ["V", 23], ["B", 24]],
  [["Ctrl", 25], ["Fn", 26], ["Alt", 27], ["Space", 28]],
];

const ui = Object.fromEntries(["listen", "close", "status", "keys", "selection", "commit", "export", "sample"]
  .map(id => [id, document.getElementById(id)]));
const hid = navigator.hid;
const saved = new Map();
let device;
let selection;
let signatures = new Map();
let frameCount = 0;
let busy = false;
let updatePending = false;
const keyButtons = [];

function refresh() {
  ui.listen.disabled = !hid || busy || Boolean(device);
  ui.close.disabled = busy || !device;
  ui.commit.disabled = !device || !selection || !signatures.size;
  ui.export.disabled = !saved.size;
  ui.status.textContent = device
    ? `Listening to 19F5:FB4C. Received ${frameCount} Hall reports. Saved ${saved.size} of 36 samples.`
    : hid ? "No device open." : "WebHID is unavailable. Open in desktop Chrome or Edge.";
  for (const { button, slot, label } of keyButtons) {
    button.disabled = !device || busy;
    button.setAttribute("aria-pressed", String(selection?.slot === slot));
    button.firstChild.textContent = saved.has(slot) ? `${label} ✓` : label;
  }
  ui.selection.textContent = selection
    ? `Press and release ${selection.label} alone, then save. Driver slot ${selection.slot}.`
    : "Select a physical key to start a sample.";
  ui.sample.textContent = Array.from(signatures.values(), item =>
    `${item.id}   raw travel ${item.minimum}–${item.maximum}   ${item.count} reports`
  ).join("\n");
}

function onReport(event) {
  const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
  if (event.reportId !== 0 || data.length !== 64 || data[0] !== 0xa0) return;
  frameCount++;
  if (selection) {
    const id = bytes(data.slice(1, 4));
    const raw = (data[6] << 8) | data[7];
    const item = signatures.get(id);
    if (item) {
      item.count++;
      item.minimum = Math.min(item.minimum, raw);
      if (raw > item.maximum) {
        item.maximum = raw;
        item.peakReport = bytes(data);
      }
    } else if (signatures.size < 128) {
      signatures.set(id, { id, count: 1, minimum: raw, maximum: raw, peakReport: bytes(data) });
    }
  }
  if (!updatePending) {
    updatePending = true;
    requestAnimationFrame(() => {
      updatePending = false;
      refresh();
    });
  }
}

for (const [row, keys] of rows.entries()) {
  const line = document.createElement("div");
  line.className = "row";
  ui.keys.append(line);
  for (const [column, [label, slot]] of keys.entries()) {
    const button = document.createElement("button");
    const detail = document.createElement("small");
    detail.textContent = `Slot ${slot}`;
    button.append(label, detail);
    button.onclick = () => {
      selection = { label, slot, physicalRow: row + 1, physicalColumn: column + 1 };
      signatures = new Map();
      button.blur();
      refresh();
    };
    line.append(button);
    keyButtons.push({ button, slot, label });
  }
}
// Pressing Space or a function key during a sample should not activate the page.
for (const eventName of ["keydown", "keyup"]) {
  window.addEventListener(eventName, event => {
    if (selection) event.preventDefault();
  }, true);
}

ui.listen.onclick = async () => {
  busy = true;
  refresh();
  let error;
  try {
    const devices = await hid.requestDevice({ filters: [filter(0xfb4c)] });
    if (!devices.length) return;
    if (devices.length !== 1 || devices[0].productId !== 0xfb4c) throw new Error("Choose one FB4C HE30.");
    const selected = devices[0];
    requireApplication(selected);
    await selected.open();
    device = selected;
    device.addEventListener("inputreport", onReport);
    frameCount = 0;
  } catch (failure) {
    error = failure.message;
  } finally {
    busy = false;
    refresh();
    if (error) ui.status.textContent = error;
  }
};

function detach() {
  const previous = device;
  previous?.removeEventListener("inputreport", onReport);
  device = undefined;
  selection = undefined;
  signatures = new Map();
  refresh();
  return previous;
}

ui.close.onclick = async () => {
  const previous = detach();
  try {
    if (previous?.opened) await previous.close();
  } catch (error) {
    ui.status.textContent = error.message;
  }
};
hid?.addEventListener("disconnect", event => {
  if (event.device === device) detach();
});

ui.commit.onclick = () => {
  if (!selection || !signatures.size) return;
  saved.set(selection.slot, { ...selection, hallReports: Array.from(signatures.values()) });
  selection = undefined;
  signatures = new Map();
  refresh();
};

ui.export.onclick = () => {
  const content = { format: "he30-hall-key-samples-v1", usbId: "19F5:FB4C", samples: [...saved.values()] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "he30-hall-key-map.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
refresh();
