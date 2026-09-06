"use strict";

/**
 * Optional MongoDB-backed profile storage.
 *
 * The browser sends the serial only to the configured HTTPS API. The server
 * turns it into a keyed hash and never stores the raw serial. A passphrase is
 * required because a hardware serial identifies a board but is not a secret.
 */

function connectedSerialNumber() {
  return String(state.driver?.device?.serialNumber || state.identity?.serialNumber || "").trim();
}

function maskedSerialNumber(serial = connectedSerialNumber()) {
  if (!serial) return "Unavailable";
  const tail = serial.slice(-4);
  return `${"•".repeat(Math.max(4, Math.min(8, serial.length - tail.length)))}${tail}`;
}

function cloudProfileHtml() {
  const connected = state.source === "device" && Boolean(state.driver);
  const serial = connectedSerialNumber();
  const ready = connected && Boolean(serial) && Boolean(CLOUD_CONFIG_API_URL);
  const setup = CLOUD_CONFIG_API_URL
    ? (serial ? "The connected keyboard serial will be converted to a private database key by the server." : "This HID interface did not provide a serial number, so cloud storage cannot identify the keyboard.")
    : "Cloud storage is not deployed yet. Deploy server/, then set the he30-cloud-api meta tag in index.html to its HTTPS URL.";
  const content = `<div class="profile-share-grid cloud-profile-grid">
      <section class="panel panel-pad share-card cloud-identity-card"><div class="share-card-heading"><div><h3>Keyboard identity</h3><p>The serial selects this keyboard's database record. It is masked here and is never used as a password.</p></div><span class="chip ${ready ? "" : "caution-chip"}">${ready ? "READY" : "SETUP"}</span></div><div class="cloud-device-key"><span>Connected serial</span><strong>${esc(maskedSerialNumber(serial))}</strong><small>${esc(setup)}</small></div></section>
      <section class="panel panel-pad share-card"><div class="share-card-heading"><div><h3>Private profile backup</h3><p>Upload the complete staged JSON profile, or download the saved copy and stage it for review.</p></div></div><label class="field"><span>Backup passphrase</span><input id="cloudPassphrase" type="password" minlength="10" maxlength="128" autocomplete="off" placeholder="At least 10 characters" value="${esc(state.cloudPassphrase)}" /><small>The server stores a slow password hash. This passphrase cannot be recovered.</small></label><div class="cloud-actions"><button class="button primary compact" id="cloudUploadProfile" type="button"${!ready || state.cloudBusy ? " disabled" : ""}>${state.cloudBusy ? "Working…" : "Upload current profile"}</button><button class="button secondary compact" id="cloudRestoreProfile" type="button"${!ready || state.cloudBusy ? " disabled" : ""}>Download and stage</button></div></section>
    </div>${state.cloudStatus ? `<div class="share-validation cloud-validation ${state.cloudError ? "error" : "valid"}">${esc(state.cloudStatus)}</div>` : ""}<div class="callout cloud-privacy-note"><b>Privacy and safety:</b> MongoDB credentials stay on the backend. The database key is an HMAC of the normalized serial, the passphrase protects reads and overwrites, and a downloaded profile remains staged until you use Apply to Keyboard.</div>`;
  return profileDisclosureHtml("cloud", "Private cloud backup", "Store one complete JSON profile under the connected keyboard's serial identity.", "MONGODB", content);
}

function cloudPassphrase() {
  const value = String($("#cloudPassphrase")?.value || state.cloudPassphrase || "");
  state.cloudPassphrase = value;
  if (value.length < 10) throw new Error("Enter a backup passphrase with at least 10 characters.");
  return value;
}

async function cloudRequest(path, payload) {
  if (!CLOUD_CONFIG_API_URL) throw new Error("The cloud API URL has not been configured.");
  const response = await fetch(`${CLOUD_CONFIG_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* handled by status below */ }
  if (!response.ok) throw new Error(body.error || `Cloud API returned HTTP ${response.status}.`);
  return body;
}

async function uploadCloudProfile() {
  if (state.cloudBusy || !state.profile) return;
  try {
    const serialNumber = connectedSerialNumber();
    if (!serialNumber) throw new Error("The connected HID device did not expose a serial number.");
    const passphrase = cloudPassphrase();
    state.cloudBusy = true;
    state.cloudError = false;
    state.cloudStatus = "Uploading the complete profile…";
    renderPage();
    const result = await cloudRequest("/api/configs/upload", { serialNumber, passphrase, config: state.profile });
    state.cloudStatus = `Profile ${state.profile.profileIndex + 1} uploaded securely. Saved ${new Date(result.updatedAt).toLocaleString()}.`;
    log("info", `Uploaded Profile ${state.profile.profileIndex + 1} to private cloud storage`);
    showToast("Private cloud backup uploaded.");
  } catch (error) {
    state.cloudError = true;
    state.cloudStatus = error.message;
    log("warning", "Cloud profile upload failed", error.message);
  } finally {
    state.cloudBusy = false;
    renderPage();
  }
}

async function restoreCloudProfile() {
  if (state.cloudBusy || !state.profile) return;
  try {
    const serialNumber = connectedSerialNumber();
    if (!serialNumber) throw new Error("The connected HID device did not expose a serial number.");
    const passphrase = cloudPassphrase();
    state.cloudBusy = true;
    state.cloudError = false;
    state.cloudStatus = "Downloading and validating the saved profile…";
    renderPage();
    const result = await cloudRequest("/api/configs/download", { serialNumber, passphrase });
    const downloaded = normalizeProfile(result.config);
    const replacement = normalizeProfile(API.retargetSharedProfile(downloaded, state.profile.profileIndex));
    API.compileAdvanced(replacement);
    state.profile = replacement;
    state.layer = 0;
    markDirty(...PROFILE_SHARE_SECTIONS);
    state.cloudStatus = `Cloud backup from ${new Date(result.updatedAt).toLocaleString()} is staged on Profile ${replacement.profileIndex + 1}. Review it, then Apply to Keyboard.`;
    log("change", `Downloaded and staged cloud backup on Profile ${replacement.profileIndex + 1}`);
    showToast("Cloud backup downloaded and staged. Nothing has been written yet.");
  } catch (error) {
    state.cloudError = true;
    state.cloudStatus = error.message;
    log("warning", "Cloud profile download failed", error.message);
  } finally {
    state.cloudBusy = false;
    renderPage();
    updateChrome();
  }
}
