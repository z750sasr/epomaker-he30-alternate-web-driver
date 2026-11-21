import { APP_PID, BOOT_PID, DONOR_PID, hex, usbId, modeOf, connectionCandidates, connectionFilters, HIDTransport, versionPacket, inspectImage, flashImage, readStartupStatus } from './protocol.mjs';
import { readKeyboardStatus } from './keyboard-protocol.mjs';
import {FoundationClient} from './keyboard-protocol.mjs';
import {LightingClient} from './lighting-protocol.mjs';
const $ = id => document.getElementById(id);
const state = { bytes: null, image: null, name: '', transport: null, armed: false, writing: false, preparing: false, stage: 'idle', awaitingApplication: false, log: [] };
let attaching = false;
let database;
function log(message, details) {
  state.log.push({ time: new Date().toISOString(), message, ...(details ? { details } : {}) });
  if (state.log.length > 1500) state.log.shift();
  $('log').textContent = state.log.slice(-100).map(x => `[${x.time}] ${x.message}${x.details ? ` ${JSON.stringify(x.details)}` : ''}`).join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}
function status(message) { $('status').textContent = message; log(message); }
function eligible() { return state.image && (!state.image.experimental || $('experimental').checked); }
function render() {
  const busy = state.writing || state.preparing || state.armed || attaching;
  const mode = state.transport && modeOf(state.transport.device);
  $('mode').textContent = mode === 'recovery' ? 'Recovery · AF22' : mode === 'experimental' ? 'Experimental · FD50' : mode === 'application' ? 'Keyboard · FB4C' : 'Disconnected';
  $('start').disabled = !eligible() || !state.transport || busy;
  $('recover').disabled = !navigator.hid || !window.isSecureContext || mode === 'recovery' || busy;
  $('recover').textContent = mode === 'recovery' ? 'Already in recovery' : mode ? 'Enter recovery only' : 'Connect & enter recovery';
  $('connect').disabled = state.writing || state.preparing || attaching;
  $('authorize').disabled = state.writing || state.preparing || attaching;
  $('file').disabled = busy;
  $('loadCustom').disabled = busy;
  $('experimental').disabled = busy;
  $('donor').disabled = busy;
  $('cancel').disabled = !state.armed || state.writing;
  $('rescan').disabled = state.writing || state.preparing;
}
async function db() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const r = indexedDB.open('he30-firmware-workspace', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('session');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return database;
}
async function cache() {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const t = d.transaction('session', 'readwrite');
      t.objectStore('session').put({ name: state.name, bytes: state.bytes, stage: state.stage, sha256: state.image.sha256, time: Date.now() }, 'pending');
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } catch (error) { log('Browser storage unavailable; keep this page open to retain the image.', { error: error.message }); }
}
async function setImage(bytes, name, restored = false) {
  const info = await inspectImage(bytes);
  state.bytes = bytes; state.image = info; state.name = name;
  $('image').replaceChildren();
  const title = document.createElement('strong'); title.textContent = name;
  const meta = document.createElement('p'); meta.textContent = `${info.bytes.toLocaleString()} bytes · ${info.recognizable ? 'RISC-V / 0x5000 image convention' : 'Unrecognized raw image format'} · USB: ${info.identities.map(d => `${hex(d.vid)}:${hex(d.pid)} / ${hex(d.release)}`).join(', ') || 'not identified'}`;
  const hash = document.createElement('p'); hash.className = 'hash'; hash.textContent = `SHA-256 ${info.sha256}`;
  $('image').append(title, meta, hash);
  $('experimentalLabel').hidden = !info.experimental;
  $('experimental').checked = false;
  if (info.identities.some(d => d.pid === DONOR_PID)) $('donor').checked = true;
  log(restored ? 'Recovered the selected firmware from browser storage.' : 'Firmware inspected.', { name, ...info });
  await cache(); render();
}
async function attach(device) {
  if (attaching || state.writing || !modeOf(device)) return;
  if (state.transport?.device === device && !state.transport.closed) { await maybeFlash(); return; }
  attaching = true;
  render();
  try {
    if (state.transport) await state.transport.close().catch(() => {});
    const transport = new HIDTransport(device, log);
    await transport.open();
    state.transport = transport;
    $('authorize').hidden = true;
    $('device').textContent = `${device.productName || 'HE30'} · ${usbId(device)} · ${transport.shape.size}-byte output report`;
    log('Device opened.', { id: usbId(device), reportBytes: transport.shape.size });
    if (modeOf(device) !== 'recovery') {
      const reply = await transport.request(versionPacket(), { kind: 'version' });
      const version = reply[8] | reply[9] << 8;
      log(`Firmware field: 0x${hex(version)}`);
      let startup, foundation;
      if (['H3K05','H3K06','H3K07','H3K09'].includes(device.productName)) {
        if (version !== {H3K05:0x0500,H3K06:0x0600,H3K07:0x0700,H3K09:0x0900}[device.productName]) throw new Error(`${device.productName} returned an unexpected firmware version.`);
        foundation = await readKeyboardStatus(transport);
        log('H3K1 foundation firmware confirmed.', foundation);
        if(['H3K06','H3K07','H3K09'].includes(device.productName))log('H3L1 RGB extension confirmed.',await new LightingClient(new FoundationClient(transport)).readStatus());
      }
      if (['H3B03', 'H3M04'].includes(device.productName)) {
        startup = await readStartupStatus(transport);
        log('H3B1 startup diagnostic signature confirmed.', startup);
      }
      if (state.awaitingApplication) {
        const expected = state.image?.identities || [];
        const match = expected.some(x => x.pid === device.productId && x.release === version);
        state.awaitingApplication = false; state.stage = 'returned';
        $('progress').value = 100;
        status(foundation ? device.productName==='H3K09' ? 'H3K09 is responding. Open HE30 Pro to calibrate and configure the four onboard profiles.' : device.productName==='H3K07' ? 'v0.7 PA10 power test USB, H3K1 and H3L1 are responding. Open Keyboard setup for the10-second weak pull-up/down tests. PA10 starts floating and RGB data is paused until a test.' : device.productName==='H3K06' ? 'v0.6 foundation USB, H3K1 and H3L1 are responding. Open Keyboard setup for calibration and the36-key/5-bar RGB controls. Calibrate, Enable typing and Save; physical behavior still needs testing.' : 'v0.5 foundation USB and H3K1 are responding. Open Keyboard setup, calibrate all36 keys, then Enable typing and Save. RGB is disabled. Physical key behavior still needs testing.' : startup ? device.productName === 'H3M04' ? 'v0.4 diagnostic USB is responding. Close this connection and open Mapping & RGB tests. Connecting there starts sensor capture automatically; RGB tests remain manual.' : 'v0.3 USB startup diagnostic is responding. Open Startup diagnostics to save its status. This test build does not type or scan keys.' : match ? 'Update sequence finished and the application identity/version matches the image. Test keys and recalibrate as needed.' : 'Application reconnected. Its identity/version was not confirmed against the image; check the log and test the keyboard.');
        await cache();
      } else if (!state.armed) status(device.productName==='H3K09' ? 'H3K09 connected. Open HE30 Pro for configuration.' : foundation ? `${device.productName} connected and H3K1 confirmed. Open Keyboard setup for calibration, bindings and saved settings.${device.productName==='H3K07'?' PA10 power tests are available; the pin starts floating.':device.productName==='H3K06'?' RGB extension H3L1 confirmed.':' RGB is disabled.'}` : startup ? `${device.productName} diagnostic connected and H3B1 confirmed. Open ${device.productName === 'H3M04' ? 'Mapping & RGB tests' : 'Startup diagnostics'}; recovery entry remains experimental.` : 'Keyboard connected. Select an image, or enter recovery without flashing.');
    } else if (!state.armed && state.awaitingApplication) {
      state.stage = 'returned-recovery';
      status('The loader returned to recovery after finalization. Application startup is not confirmed. Save the log; another flash will not start automatically.');
      await cache();
    } else if (!state.armed) status('HE30 recovery is connected. Review the selected image before flashing.');
  } catch (error) {
    await state.transport?.close().catch(() => {});
    state.transport = null;
    status(error.message);
  } finally { attaching = false; render(); }
  await maybeFlash();
}
async function scan() {
  if (!navigator.hid || state.writing || attaching) return;
  const devices = await navigator.hid.getDevices();
  const candidates = connectionCandidates(devices, { includeDonor: $('donor').checked, recoveryOnly: state.armed });
  if (!state.armed && state.transport && !state.transport.closed && candidates.includes(state.transport.device)) return;
  if (candidates.length === 1) return attach(candidates[0]);
  if (candidates.length > 1) { status('Several configuration-capable keyboards are authorized. Use Connect keyboard, or Connect & enter recovery, to select the intended keyboard.'); return; }
  if (state.armed) {
    $('authorize').hidden = false;
    status('Waiting for recovery 19F5:AF22. If permission is needed, click Authorize recovery device; the image is retained.');
  }
}
async function choose(recovery = false, applicationOnly = false) {
  try {
    const pids = recovery ? [BOOT_PID] : [APP_PID, ...(applicationOnly ? [] : [BOOT_PID]), ...($('donor').checked ? [DONOR_PID] : [])];
    const devices = await navigator.hid.requestDevice({ filters: connectionFilters(pids) });
    const candidates = connectionCandidates(devices, { includeDonor: $('donor').checked, recoveryOnly: recovery, applicationOnly });
    if (candidates.length === 1) await attach(candidates[0]);
    else status(candidates.length ? 'Several configuration interfaces were selected. Choose one keyboard to continue.' : 'No compatible configuration interface selected. Choose the HE30 configuration entry; no recovery command was sent.');
  } catch (error) { status(`Device selection did not complete: ${error.message}`); }
}
async function enterRecovery() {
  if (!state.transport) throw new Error('Connect the keyboard first.');
  state.stage = 'waiting-recovery';
  status('Requesting recovery. The keyboard will disconnect and reappear as 19F5:AF22.');
  await state.transport.enterRecovery();
  // Events can arrive before permissions are returned. Bounded scans also find
  // an already-authorized boot device without requiring a page refresh.
  for (const delay of [500, 1800, 4500, 9000]) setTimeout(() => scan().catch(e => status(e.message)), delay);
}
async function maybeFlash() {
  if (!state.armed || state.writing || state.preparing || modeOf(state.transport?.device || {}) !== 'recovery') return;
  if (!eligible()) { state.armed = false; render(); return; }
  state.writing = true; state.armed = false;
  const transport = state.transport;
  let lastStage, lastBlock = -1;
  render();
  try {
    await flashImage(transport, state.bytes, event => {
      state.stage = event.stage;
      $('progress').value = event.progress;
      const block = Math.floor((event.offset || 0) / 8192);
      const text = { erase: 'Erasing application…', write: 'Writing firmware…', compare: 'Comparing firmware on device…', finalize: 'Finalizing update…', 'await-application': 'Device comparison acknowledged. Waiting for the application to reconnect…' }[event.stage];
      $('status').textContent = `${text}${event.total ? ` ${event.offset.toLocaleString()} / ${event.total.toLocaleString()} bytes` : ''}`;
      if (lastStage !== event.stage || lastBlock !== block) { log($('status').textContent); lastBlock = block; }
      if (lastStage !== event.stage) cache().catch(() => {});
      lastStage = event.stage;
    });
    state.awaitingApplication = true;
    await cache();
    status('Device comparison and finalization completed. Waiting for application USB; if necessary, power-cycle the keyboard, then connect its application interface.');
  } catch (error) {
    state.stage = 'failed';
    status(`Update stopped: ${error.message} No automatic erase/write retry will occur. Preserve the log before restarting.`);
    await transport.close().catch(() => {});
    if (state.transport === transport) state.transport = null;
    await cache();
  } finally {
    state.writing = false; render();
    if (state.awaitingApplication) setTimeout(() => scan().catch(e => status(e.message)), 800);
  }
}
$('connect').onclick = () => choose();
$('authorize').onclick = () => choose(true);
$('rescan').onclick = () => scan().catch(e => status(e.message));
$('experimental').onchange = render;
$('donor').onchange = render;
$('loadCustom').onclick = async () => {
  if (state.writing || state.armed || state.preparing) return;
  state.preparing = true; state.image = null; state.bytes = null; render();
  try {
    const base = '../firmware/custom/he30-v0.9/';
    const metadata = await fetch(`${base}manifest.json`, { cache: 'no-store' });
    if (!metadata.ok) throw new Error('Custom firmware manifest could not be loaded.');
    const manifest = await metadata.json();
    const response = await fetch(`${base}${encodeURIComponent(manifest.name)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Custom firmware image could not be loaded.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const inspection = await inspectImage(bytes);
    if (inspection.sha256 !== manifest.sha256) throw new Error('Custom image hash does not match its build manifest.');
    await setImage(bytes, manifest.name);
    status('v0.9 HE30 Pro loaded. Review before flashing. Export your current settings first if you want to keep them.');
  } catch (error) { state.image = null; state.bytes = null; $('image').textContent = error.message; status(error.message); }
  finally { state.preparing = false; render(); }
};
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file || state.writing || state.armed) return;
  state.preparing = true; state.bytes = null; state.image = null; render();
  try {
    if (!/\.bin$/i.test(file.name)) throw new Error('Choose an extracted .bin image. Windows .exe updaters cannot be sent to the keyboard.');
    await setImage(new Uint8Array(await file.arrayBuffer()), file.name);
    status('Firmware ready for review. No keyboard data has been written.');
  } catch (error) { $('image').textContent = error.message; $('experimentalLabel').hidden = true; status(error.message); }
  finally { state.preparing = false; render(); }
};
$('recover').onclick = async () => {
  if (state.preparing || state.writing || state.armed || attaching) return;
  state.preparing = true; render();
  try {
    if (!state.transport) await choose(false, true);
    if (state.transport) await enterRecovery();
  } catch (error) { status(error.message); }
  finally { state.preparing = false; render(); }
};
$('start').onclick = () => {
  if (!eligible() || !state.transport || state.writing) return;
  $('reviewDetails').textContent = `${state.name} · ${state.image.bytes.toLocaleString()} bytes\nSHA-256 ${state.image.sha256}\nSelected: ${usbId(state.transport.device)}\nWrite target: 19F5:AF22${state.image.experimental ? '\nExperimental cross-model or unrecognized image selected.' : ''}`;
  $('reviewDetails').style.whiteSpace = 'pre-wrap'; $('reviewDetails').style.overflowWrap = 'anywhere';
  $('review').showModal();
};
$('review').addEventListener('close', async () => {
  if ($('review').returnValue !== 'flash' || !eligible() || !state.transport || state.writing || state.armed) return;
  state.preparing = true; render();
  try {
    // Re-hash precisely the reviewed bytes before approving any erase.
    const check = await inspectImage(state.bytes);
    if (check.sha256 !== state.image.sha256) throw new Error('The selected image changed after review.');
    state.armed = true;
    await cache();
    if (modeOf(state.transport.device) !== 'recovery') await enterRecovery();
  } catch (error) { state.armed = false; status(error.message); }
  finally { state.preparing = false; render(); }
  await maybeFlash();
});
$('cancel').onclick = () => { state.armed = false; status('Pending update cancelled before erasing. Recovery mode may still require a USB power cycle to exit.'); render(); };
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ image: state.image, file: state.name, stage: state.stage, events: state.log }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `he30-flash-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('beforeunload', event => { if (state.writing || state.armed) { event.preventDefault(); event.returnValue = ''; } });
if (!navigator.hid || !window.isSecureContext) {
  $('support').textContent = 'Use Chrome or Edge on HTTPS or localhost. WebHID is unavailable in this browser/context.';
  $('support').className = 'warning';
  render();
  $('connect').disabled = true;
} else {
  navigator.hid.addEventListener('connect', () => { if (!state.writing) scan().catch(e => status(e.message)); });
  navigator.hid.addEventListener('disconnect', event => {
    if (state.transport?.device !== event.device) return;
    state.transport.disconnected();
    state.transport = null;
    $('device').textContent = 'USB device disconnected.';
    log('USB disconnected.', { id: usbId(event.device) }); render();
  });
  (async () => {
    try {
      const d = await db();
      const saved = await new Promise((resolve, reject) => { const r = d.transaction('session').objectStore('session').get('pending'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      if (saved?.bytes) {
        const info = await inspectImage(new Uint8Array(saved.bytes));
        if (info.sha256 !== saved.sha256) throw new Error('Cached image checksum mismatch. Choose the file again.');
        await setImage(new Uint8Array(saved.bytes), saved.name, true);
        status(`Selected image restored. Previous stage: ${saved.stage}. Review again to restart; reloading never automatically erases or resumes a partial write.`);
      }
    } catch (error) { log('No restorable browser session.', { error: error.message }); }
    await scan(); render();
  })().catch(e => status(e.message));
}
