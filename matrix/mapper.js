"use strict";

(() => {
  const API = window.HE30Control;
  const ui = Object.fromEntries(["connect", "start", "stop", "status", "label", "capture",
    "candidate", "save", "observed", "packet", "count", "mappings", "export"]
    .map(id => [id, document.getElementById(id)]));
  const hex = byte => byte.toString(16).toUpperCase().padStart(2, "0");
  const identity = event => [event.type, event.code1, event.code2].map(hex).join(" ");
  const distance = raw => `${(raw / 100).toFixed(2)} mm`;
  let driver;
  let target;
  let busy = false;
  let captureTimer;
  let captureLabel;
  let candidates = new Map();
  const mappings = new Map();

  function refresh() {
    const connected = driver?.device.opened;
    const monitoring = connected && driver.telemetryActive;
    const pendingRestore = driver?.telemetryRestoreNeeded;
    ui.connect.disabled = !API.HE30Driver.supported() || busy || Boolean(connected);
    ui.start.disabled = busy || !connected || monitoring || pendingRestore;
    ui.stop.disabled = busy || !connected || (!monitoring && !pendingRestore);
    ui.capture.disabled = busy || !monitoring || Boolean(captureTimer) || !ui.label.value.trim();
    ui.label.disabled = Boolean(captureTimer);
    ui.candidate.disabled = Boolean(captureTimer) || candidates.size === 0;
    ui.save.disabled = ui.candidate.disabled || !ui.candidate.value;
    ui.export.disabled = mappings.size === 0;
  }

  function run(operation) {
    return async () => {
      if (busy) return;
      busy = true;
      refresh();
      try {
        await operation();
      } catch (error) {
        const restore = driver?.telemetryRestoreNeeded ? " Stop & Restore is needed to restore the previous setting." : "";
        ui.status.textContent = error.message + restore;
      } finally {
        busy = false;
        refresh();
      }
    };
  }

  function collect(event) {
    if (!captureTimer || event.report.length !== 64 || event.rawTravel < 35) return;
    const id = identity(event);
    if ((candidates.get(id)?.rawTravel ?? 0) < event.rawTravel) candidates.set(id, event);
  }

  function showCandidate() {
    const event = candidates.get(ui.candidate.value);
    ui.packet.textContent = event
      ? `Peak ${distance(event.rawTravel)} · decoded usage ${event.keyCode} · raw report\n${event.report.map(hex).join(" ")}`
      : "";
    refresh();
  }

  function finishCapture() {
    clearTimeout(captureTimer);
    captureTimer = undefined;
    ui.candidate.replaceChildren(new Option("Choose identity", ""));
    const sorted = [...candidates].sort((a, b) => b[1].rawTravel - a[1].rawTravel);
    for (const [id, event] of sorted) ui.candidate.add(new Option(`${id} · ${distance(event.rawTravel)}`, id));
    if (sorted.length === 1) ui.candidate.value = sorted[0][0];
    ui.observed.textContent = sorted.length === 0
      ? "No travel above the threshold. Try a deeper press."
      : sorted.length === 1
        ? `One identity observed for “${captureLabel}”. Review it and add the mapping.`
        : `${sorted.length} identities observed. Press only one key and recapture, or select the correct report.`;
    showCandidate();
  }

  function renderMap() {
    ui.mappings.replaceChildren();
    for (const [id, entry] of mappings) {
      const row = ui.mappings.insertRow();
      for (const value of [entry.physicalLabel, id, distance(entry.peakTravelRaw)]) row.insertCell().textContent = value;
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${entry.physicalLabel}`);
      remove.onclick = () => {
        mappings.delete(id);
        renderMap();
      };
      row.insertCell().append(remove);
    }
    ui.count.textContent = `${mappings.size} of 36 physical keys mapped.`;
    refresh();
  }

  ui.connect.onclick = run(async () => {
    if (driver?.telemetryRestoreNeeded) {
      await driver.open();
      await driver.stopLiveTelemetry();
      ui.status.textContent = "Reconnected and restored Dynamic Display.";
      return;
    }
    if (driver) await driver.close();
    driver = await API.HE30Driver.request();
    if (driver.device.vendorId !== 0x19f5 || driver.device.productId !== 0xfb4c) {
      await driver.close();
      throw new Error("This mapper currently targets the 19F5:FB4C HE30.");
    }
    const { firmware } = await driver.getInfo();
    target = { usbId: "19F5:FB4C", firmware };
    driver.subscribeTelemetry(collect);
    ui.status.textContent = `Connected to HE30 ${target.usbId}, firmware 0x${firmware}.`;
  });
  ui.start.onclick = run(async () => {
    const profile = await driver.getActiveProfile();
    try {
      await driver.startLiveTelemetry(profile);
    } catch (error) {
      try {
        await driver.stopLiveTelemetry();
      } catch {
        // Keep the driver's pending restoration state for Stop & Restore.
      }
      throw error;
    }
    ui.status.textContent = `Monitoring profile ${profile + 1}. Enter a label and capture a key.`;
  });
  ui.stop.onclick = run(async () => {
    if (captureTimer) finishCapture();
    await driver.stopLiveTelemetry();
    ui.status.textContent = "Monitor stopped. Dynamic Display is back to its previous setting.";
  });
  ui.label.oninput = refresh;
  ui.candidate.onchange = showCandidate;
  ui.capture.onclick = () => {
    candidates = new Map();
    captureLabel = ui.label.value.trim();
    ui.candidate.replaceChildren();
    ui.packet.textContent = "";
    ui.observed.textContent = `Capturing “${captureLabel}”. Press and release it now.`;
    captureTimer = setTimeout(finishCapture, 4000);
    ui.capture.blur();
    refresh();
  };
  ui.save.onclick = () => {
    const id = ui.candidate.value;
    const event = candidates.get(id);
    if (!event) return;
    if (mappings.has(id) && mappings.get(id).physicalLabel !== captureLabel) {
      ui.observed.textContent = `Identity ${id} already belongs to “${mappings.get(id).physicalLabel}”. Check the capture before assigning it again.`;
      return;
    }
    if ([...mappings].some(([otherId, entry]) => otherId !== id && entry.physicalLabel === captureLabel)) {
      ui.observed.textContent = "That physical label is already mapped. Remove the previous entry before replacing it.";
      return;
    }
    mappings.set(id, {
      physicalLabel: captureLabel, type: event.type, code1: event.code1, code2: event.code2,
      decodedUsage: event.keyCode, peakTravelRaw: event.rawTravel, reportHex: event.report.map(hex).join(" "),
    });
    ui.observed.textContent = `Mapped “${captureLabel}” to ${id}.`;
    ui.label.value = "";
    ui.candidate.value = "";
    showCandidate();
    renderMap();
  };
  ui.export.onclick = () => {
    const data = { format: "he30-telemetry-map-v1", device: target, keys: [...mappings.values()] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "he30-sensor-map.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  navigator.hid?.addEventListener("disconnect", event => {
    if (event.device !== driver?.device) return;
    if (captureTimer) finishCapture();
    ui.status.textContent = driver.telemetryRestoreNeeded
      ? "Disconnected before restoring Dynamic Display. Replug the same HE30 and click Connect HE30 to restore it."
      : "HE30 disconnected.";
    refresh();
  });
  window.addEventListener("beforeunload", event => {
    if (driver?.telemetryRestoreNeeded) {
      event.preventDefault();
      event.returnValue = true;
    }
  });
  window.addEventListener("keydown", event => {
    if (captureTimer) event.preventDefault();
  }, true);
  if (!API.HE30Driver.supported()) ui.status.textContent = "Open in Chrome or Edge over HTTPS or localhost to use WebHID.";
  refresh();
})();
