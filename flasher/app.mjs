import {imageWithRates} from './rate-image.mjs';
import { VID, APP_PID, BOOT_PID, DONOR_PID, hex, usbId, modeOf, connectionCandidates, connectionFilters, HIDTransport, versionPacket, inspectImage, flashImage, readStartupStatus } from './protocol.mjs';
import { readKeyboardStatus } from './keyboard-protocol.mjs';
import {FoundationClient} from './keyboard-protocol.mjs';
import {LightingClient} from './lighting-protocol.mjs';
import {beginRecovery} from './recovery.mjs';
const $ = id => document.getElementById(id);
const state = { bytes: null, image: null, name: '', transport: null, armed: false, writing: false, preparing: false, stage: 'idle', awaitingApplication: false, log: [] };
let attaching = false;
let transition = null;
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
  document.documentElement?.toggleAttribute?.('data-driver-busy',busy||state.awaitingApplication);
  const mode = state.transport && modeOf(state.transport.device);
  $('mode').textContent = mode === 'recovery' ? 'Recovery · AF22' : mode === 'experimental' ? 'Experimental · FD50' : mode === 'application' ? 'Keyboard · FB4C' : 'Disconnected';
  $('start').disabled = !eligible() || !state.transport || busy;
  $('recover').disabled = !navigator.hid || !window.isSecureContext || mode === 'recovery' || busy || !!transition;
  $('recover').textContent = mode === 'recovery' ? 'Already in recovery' : mode ? 'Enter recovery only' : 'Connect & enter recovery';
  $('connect').disabled = state.writing || state.preparing || attaching || !!transition;
  $('authorize').disabled = state.writing || state.preparing || attaching;
  $('file').disabled = busy;
  $('loadCustom').disabled = busy;
  $('experimental').disabled = busy;
  $('donor').disabled = busy;
  $('cancel').disabled = !state.armed || state.writing;
  $('rescan').disabled = state.writing || state.preparing;
}
async function setImage(bytes, name) {
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
  log('Firmware inspected.', { name, ...info });
  render();
}
async function attach(device, { recoveryOnly = false, reprobe = false } = {}) {
  if (attaching || state.writing || !modeOf(device)) return;
  if (state.transport?.device === device && !state.transport.closed && !reprobe) { await maybeFlash(); return; }
  attaching = true;
  render();
  let transport;
  try {
    if (state.transport) await state.transport.close().catch(() => {});
    transport = new HIDTransport(device, log);
    await transport.open();
    state.transport = transport;
    $('authorize').hidden = true;
    $('device').textContent = `${device.productName || 'HE30'} · ${usbId(device)} · ${transport.shape.size}-byte output report`;
    log('Device opened.', { id: usbId(device), reportBytes: transport.shape.size });
    if (recoveryOnly) {
      status('HE30 configuration interface opened for recovery.');
    } else if (modeOf(device) !== 'recovery') {
      let reply;
      try {
        reply = await transport.request(versionPacket(), { kind: 'version' });
      } catch (error) {
        const result = state.awaitingApplication ? 'The application returned, but firmware verification is still pending.' : 'Firmware version unavailable. The version query does not write firmware.';
        if (!transport.closed && state.transport === transport) {
          status(`${result} ${error.message} You can enter recovery from this page.`);
        } else if (state.transport === transport) {
          await transport.close().catch(() => {});
          state.transport = null;
          status(`${result} ${error.message} Use Connect & enter recovery to open the recovery path directly.`);
        }
        return;
      }
      const version = reply[8] | reply[9] << 8;
      log(`Firmware field: 0x${hex(version)}`);
      let startup, foundation;
      if (['H3K05','H3K06','H3K07','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(device.productName)) {
        if (version !== {H3K05:0x0500,H3K06:0x0600,H3K07:0x0700,H3K09:0x0900,H3K10:0x1000,H3K11:0x1100,H3K12:0x1200,H3K13:0x1300,H3K14:0x1400,H3K15:0x1500,H3K16:0x1600,H3K17:0x1700,H3K18:0x1800,H3K19:0x1900,H3K20:0x2000,H3K21:0x2100,H3K22:0x2200,H3K23:0x2300,H3K24:0x2400,H3K25:0x2500,H3K26:0x2600,H3K27:0x2700}[device.productName]) throw new Error(`${device.productName} returned an unexpected firmware version.`);
        foundation = await readKeyboardStatus(transport);
        log('H3K1 foundation firmware confirmed.', foundation);
        if(['H3K06','H3K07','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(device.productName))log('H3L1 RGB extension confirmed.',await new LightingClient(new FoundationClient(transport)).readStatus());
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
        status(foundation ? ['H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(device.productName) ? device.productName+' is responding. Release all keys while the startup baseline is captured. Open HE30 Pro to configure the four profiles.' : device.productName==='H3K09' ? 'H3K09 is responding. Open HE30 Pro to calibrate and configure the four onboard profiles.' : device.productName==='H3K07' ? 'v0.7 PA10 power test USB, H3K1 and H3L1 are responding. Open Keyboard setup for the10-second weak pull-up/down tests. PA10 starts floating and RGB data is paused until a test.' : device.productName==='H3K06' ? 'v0.6 foundation USB, H3K1 and H3L1 are responding. Open Keyboard setup for calibration and the36-key/5-bar RGB controls. Calibrate, Enable typing and Save; physical behavior still needs testing.' : 'v0.5 foundation USB and H3K1 are responding. Open Keyboard setup, calibrate all36 keys, then Enable typing and Save. RGB is disabled. Physical key behavior still needs testing.' : startup ? device.productName === 'H3M04' ? 'v0.4 diagnostic USB is responding. Close this connection and open Mapping & RGB tests. Connecting there starts sensor capture automatically; RGB tests remain manual.' : 'v0.3 USB startup diagnostic is responding. Open Startup diagnostics to save its status. This test build does not type or scan keys.' : match ? 'Update sequence finished and the application identity/version matches the image. Test keys and recalibrate as needed.' : 'Application reconnected. Its identity/version was not confirmed against the image; check the log and test the keyboard.');
      } else if (!state.armed) status(['H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(device.productName) ? device.productName+' connected. Open HE30 Pro for configuration.' : foundation ? `${device.productName} connected and H3K1 confirmed. Open Keyboard setup for calibration, bindings and saved settings.${device.productName==='H3K07'?' PA10 power tests are available; the pin starts floating.':device.productName==='H3K06'?' RGB extension H3L1 confirmed.':' RGB is disabled.'}` : startup ? `${device.productName} diagnostic connected and H3B1 confirmed. Open ${device.productName === 'H3M04' ? 'Mapping & RGB tests' : 'Startup diagnostics'}; recovery entry remains experimental.` : 'Keyboard connected. Select an image, or enter recovery without flashing.');
    } else if (transition) {
      const disconnected = transition.disconnected;
      transition = null;
      state.stage = 'in-recovery';
      if (!disconnected) state.armed = false;
      status(disconnected ? 'Application disconnected and AF22 recovery is connected.' : 'AF22 recovery is connected. The application disconnect was not reported. Review the image before starting the flash.');
    } else if (!state.armed && state.awaitingApplication) {
      state.stage = 'returned-recovery';
      status('The loader returned to recovery after finalization. Application startup is not confirmed. Save the log; another flash will not start automatically.');
    } else if (!state.armed) status('HE30 recovery is connected. Review the selected image before flashing.');
  } catch (error) {
    await transport?.close().catch(() => {});
    state.transport = null;
    status(error.name==='HIDTimeoutError'&&modeOf(device)==='application'
      ? `${error.message} Application verification is incomplete. Select Check connected devices to read again, or Connect & enter recovery for recovery access.`
      : error.message);
  } finally { attaching = false; render(); }
  await maybeFlash();
}
async function scan({reprobe = false} = {}) {
  if (!navigator.hid || state.writing || attaching || (transition && !transition.sent)) return;
  const devices = await navigator.hid.getDevices();
  const candidates = connectionCandidates(devices, { includeDonor: $('donor').checked, recoveryOnly: state.armed || !!transition });
  if (!reprobe && !state.armed && state.transport && !state.transport.closed && candidates.includes(state.transport.device)) return;
  if (candidates.length === 1) return attach(candidates[0], {reprobe:reprobe&&modeOf(candidates[0])!=='recovery'});
  if (candidates.length > 1) { status('Several configuration-capable keyboards are authorized. Use Connect keyboard, or Connect & enter recovery, to select the intended keyboard.'); return; }
  if (state.armed || transition) {
    $('authorize').hidden = false;
    status('Waiting for recovery 19F5:AF22. If permission is needed, click Authorize recovery device; the image is retained.');
  }
}
async function choose(recovery = false, applicationOnly = false) {
  if (transition && (!recovery || !transition.sent)) return;
  try {
    const pids = recovery ? [BOOT_PID] : [APP_PID, ...(applicationOnly ? [] : [BOOT_PID]), ...($('donor').checked ? [DONOR_PID] : [])];
    const filters = applicationOnly || recovery ? pids.map(productId => ({ vendorId: VID, productId })) : connectionFilters(pids);
    const devices = await navigator.hid.requestDevice({ filters });
    const candidates = connectionCandidates(devices, { includeDonor: $('donor').checked, recoveryOnly: recovery, applicationOnly });
    if (candidates.length === 1) await attach(candidates[0], { recoveryOnly: applicationOnly });
    else status(candidates.length ? 'Several configuration interfaces were selected. Choose one keyboard to continue.' : 'No compatible configuration interface selected. Choose the HE30 configuration entry; no recovery command was sent.');
  } catch (error) { status(`Device selection did not complete: ${error.message}`); }
}
async function enterRecovery() {
  if (!state.transport) throw new Error('Connect the keyboard first.');
  const attempt = { application: state.transport.device, disconnected: false };
  transition = attempt;
  state.stage = 'waiting-recovery';
  $('authorize').hidden = false;
  status('Requesting recovery. The keyboard will disconnect and reappear as 19F5:AF22.');
  try {
    await beginRecovery(navigator.hid, state.transport, attempt, log);
  } catch (error) {
    if (transition === attempt) transition = null;
    $('authorize').hidden = true;
    throw error;
  }
  // Events can arrive before permissions are returned. Bounded scans also find
  // an already-authorized boot device without requiring a page refresh.
  for (const delay of [500, 1800, 4500, 9000]) setTimeout(() => {
    if (transition === attempt) scan().catch(e => status(e.message));
  }, delay);
  setTimeout(() => {
    if (transition !== attempt) return;
    transition = null;
    state.armed = false;
    status('AF22 was not confirmed. Select Authorize recovery device if it is visible, or check the keyboard’s USB mode before trying again.');
    render();
  }, 60000);
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
      lastStage = event.stage;
    });
    state.awaitingApplication = true;
    status('Device comparison and finalization completed. Waiting for application USB; if necessary, power-cycle the keyboard, then connect its application interface.');
  } catch (error) {
    state.stage = 'failed';
    status(`Update stopped: ${error.message} No automatic erase/write retry will occur. Preserve the log before restarting.`);
    await transport.close().catch(() => {});
    if (state.transport === transport) state.transport = null;
  } finally {
    state.writing = false; render();
    if (state.awaitingApplication) setTimeout(() => scan().catch(e => status(e.message)), 800);
  }
}
$('connect').onclick = () => choose();
$('authorize').onclick = () => choose(true);
$('rescan').onclick = () => scan({reprobe:true}).catch(e => status(e.message));
$('experimental').onchange = render;
$('donor').onchange = render;
const requestedRates=new URLSearchParams(globalThis.location?.search);
if(/^[0-6]$/.test(requestedRates.get('polling'))&&/^[0-2]$/.test(requestedRates.get('scanner'))){
  $('imagePolling').value=requestedRates.get('polling');
  $('imageScanner').value=requestedRates.get('scanner');
}
$('loadCustom').onclick = async () => {
  if (state.writing || state.armed || state.preparing) return;
  state.preparing = true; state.image = null; state.bytes = null; render();
  try {
    const base = '../firmware/custom/he30-v0.27/';
    const metadata = await fetch(`${base}manifest.json`, { cache: 'no-store' });
    if (!metadata.ok) throw new Error('Custom firmware manifest could not be loaded.');
    const manifest = await metadata.json();
    const response = await fetch(`${base}${encodeURIComponent(manifest.name)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Custom firmware image could not be loaded.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const inspection = await inspectImage(bytes);
    if (inspection.sha256 !== manifest.sha256) throw new Error('Custom image hash does not match its build manifest.');
    const polling=$('imagePolling').value, scanner=Number($('imageScanner').value||0);
    if((polling!=null&&polling!=='')||scanner!==0){
      const rate=polling===''?3:Number(polling);
      const template=await fetch(base+'factory-journal.bin',{cache:'no-store'});
      if(!template.ok)throw new Error('Could not load factory settings.');
      const configured=imageWithRates(bytes,new Uint8Array(await template.arrayBuffer()),rate,scanner);
      await setImage(configured,manifest.name.replace('.bin','-'+(125*(2**rate))+'Hz-scan'+scanner+'.bin'));
    }else await setImage(bytes, manifest.name);
    status('v0.27 HE30 Pro loaded. Review before flashing. Export your current profiles first if you want to keep them.');
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
    if (transition?.application === event.device) transition.disconnected = true;
    if (state.transport?.device !== event.device) return;
    state.transport.disconnected();
    state.transport = null;
    $('device').textContent = 'USB device disconnected.';
    log('USB disconnected.', { id: usbId(event.device) }); render();
  });
  scan().then(render).catch(e => status(e.message));
}
