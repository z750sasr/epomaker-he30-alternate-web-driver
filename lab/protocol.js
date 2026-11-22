export const VID = 0x19f5;
export const VARIANTS = Object.freeze({ 0xfb27: 0xff8a, 0xfb4c: 0xaf22 });
export const hex = (number, width = 4) => number.toString(16).toUpperCase().padStart(width, "0");
export const bytes = data => Array.from(data, byte => hex(byte, 2)).join(" ");

export function identify(device) {
  if (device.vendorId !== VID) return null;
  if (Object.hasOwn(VARIANTS, device.productId)) {
    return { mode: "application", application: device.productId, boot: VARIANTS[device.productId] };
  }
  for (const [application, boot] of Object.entries(VARIANTS)) {
    if (device.productId === boot) return { mode: "bootloader", application: Number(application), boot };
  }
  return null;
}

export function filter(productId) {
  const identity = identify({ vendorId: VID, productId });
  if (!identity) throw new Error("Unknown HE30 USB ID.");
  const application = identity.mode === "application";
  return { vendorId: VID, productId, usagePage: application ? 1 : 0xff00, usage: application ? 0 : 1 };
}

function packet(prefix) {
  const report = new Uint8Array(64);
  report.set(prefix);
  return report;
}

export const infoReport = () => packet([0x55, 0x03, 0, 0x20, 0x20]);
export const bootReport = () => packet([0x5f, 0x06, 0, 0x52, 1, 0, 0, 0, 0x51]);

export function versionFromReply(reportId, data) {
  if (reportId !== 0 || data.byteLength !== 64 || data[0] !== 0xaa || data[1] !== 0x03) return null;
  return data[8] | data[9] << 8;
}

export function requireApplication(device) {
  if (identify(device)?.mode !== "application") throw new Error("Select a supported HE30 in normal mode.");
  const { usagePage, usage } = filter(device.productId);
  const collection = device.collections.find(item => item.usagePage === usagePage && item.usage === usage);
  const output = collection?.outputReports.find(report => report.reportId === 0);
  const bits = output?.items.reduce((sum, item) => sum + item.reportSize * item.reportCount, 0);
  if (bits !== 512) throw new Error("Expected a 64-byte report ID 0 on the HE30 configuration collection.");
}

// Bootloader devices are accepted for inspection only.
export async function sendApplicationReport(device, report) {
  requireApplication(device);
  const expected = report[0] === 0x55 ? infoReport() : bootReport();
  if (report.length !== expected.length || !expected.every((byte, index) => byte === report[index])) {
    throw new Error("This tool only sends the version request and boot-entry request.");
  }
  if (!device.opened) await device.open();
  return device.sendReport(0, report);
}
