export const VID = 0x19f5;
export const APP_PID = 0xfb4c;
export const BOOT_PID = 0xaf22;
export const DONOR_PID = 0xfd50;
export const MAX_IMAGE = 512 * 1024;
export const hex = (n, width = 4) => n.toString(16).toUpperCase().padStart(width, '0');
export const usbId = d => `${hex(d.vendorId)}:${hex(d.productId)}`;

export function modeOf(d) {
  if (d.vendorId !== VID) return null;
  return d.productId === APP_PID ? 'application' : d.productId === BOOT_PID ? 'recovery' : d.productId === DONOR_PID ? 'experimental' : null;
}
export function packet(command, body = [], length = 64) {
  if (body.length + 1 > length) throw new Error('Command exceeds the HID report length.');
  const data = new Uint8Array(length);
  data.set([command, ...body]);
  return data;
}
export const versionPacket = () => packet(0x55, [3, 0, 32, 32]);
export const recoveryPacket = () => packet(0x5f, [6, 0, 0x52, 1, 0, 0, 0, 0x51]);
export function dataPacket(command, offset, bytes) {
  if (![0x80, 0x82].includes(command) || !bytes.length || bytes.length > 32 || offset < 0 || offset > MAX_IMAGE) throw new Error('Invalid update block.');
  return packet(command, [bytes.length, offset & 255, (offset >>> 8) & 255, (offset >>> 16) & 255, (offset >>> 24) & 255, ...bytes]);
}
export function reportShape(device) {
  const mode = modeOf(device);
  const found = [];
  function walk(collections, inherited = false) {
    for (const c of collections || []) {
      const relevant = inherited || (mode === 'recovery' ? c.usagePage === 0xff00 && c.usage === 1 : c.usagePage === 1 && c.usage === 0);
      if (relevant) for (const r of c.outputReports || []) {
        const bits = (r.items || []).reduce((n, item) => n + item.reportSize * item.reportCount, 0);
        if (r.reportId === 0 && bits % 8 === 0) found.push(bits / 8);
      }
      walk(c.children, relevant);
    }
  }
  walk(device.collections);
  const size = found.find(n => mode === 'recovery' ? n >= 64 && n <= 4096 : n === 64);
  if (!mode || !size) throw new Error('Expected HE30 configuration/recovery report ID 0 was not found.');
  return { reportId: 0, size };
}
// WebHID can return several logical interfaces for one composite keyboard.
// Keep only the configuration/recovery interface; USB VID/PID alone is not
// sufficient. Do not merge distinct devices merely because names/IDs match.
export function connectionCandidates(devices, { includeDonor = false, recoveryOnly = false, applicationOnly = false } = {}) {
  return [...new Set(devices)].filter(device => {
    const mode = modeOf(device);
    if (!mode || device.productId === DONOR_PID && !includeDonor || recoveryOnly && mode !== 'recovery' || applicationOnly && mode === 'recovery') return false;
    try { reportShape(device); return true; } catch { return false; }
  });
}
export function connectionFilters(pids) {
  return pids.map(productId => ({ vendorId: VID, productId, usagePage: productId === BOOT_PID ? 0xff00 : 1, usage: productId === BOOT_PID ? 1 : 0 }));
}
export function checkBootAck(bytes) {
  // The native OEM updater tests its two status bytes. Do not treat AA alone,
  // a timeout, or a disconnect as verification success.
  if (bytes.length < 2 || bytes[0] !== 0 || bytes[1] !== 0) {
    throw new Error(`Recovery command rejected: ${Array.from(bytes.slice(0, 8), n => hex(n, 2)).join(' ') || 'empty reply'}`);
  }
}
export async function inspectImage(bytes, cryptoProvider = globalThis.crypto) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 64 || bytes.length > MAX_IMAGE) throw new Error('Choose a raw .bin image between 64 bytes and 512 KiB.');
  if (bytes.length % 4) throw new Error('The image must have a whole number of 32-bit words. Rebuild/export it with correct padding.');
  if (bytes.every(n => n === 0) || bytes.every(n => n === 255)) throw new Error('The file contains only padding.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stack = view.getUint32(0, true), reset = view.getUint32(4, true);
  if (stack >= 0x20000000 && stack < 0x30000000 && reset >= 0x08000000 && reset < 0x09000000 && (reset & 1)) throw new Error('This looks like ARM firmware. The connected Epomaker HE30 uses RISC-V.');
  const recognizable = (stack & 0x7f) === 0x6f && reset === 0x13 && view.getUint32(0x38, true) === 0x5000;
  const identities = [];
  for (let i = 0; i <= bytes.length - 18; i++) {
    if (bytes[i] !== 18 || bytes[i + 1] !== 1 || ![8, 16, 32, 64].includes(bytes[i + 7]) || bytes[i + 17] !== 1) continue;
    const vid = view.getUint16(i + 8, true), pid = view.getUint16(i + 10, true);
    if (vid !== VID) continue;
    const release = view.getUint16(i + 12, true);
    if (!identities.some(x => x.vid === vid && x.pid === pid && x.release === release)) identities.push({ vid, pid, release, offset: i });
  }
  const exactIdentity = identities.length === 1 && identities[0].pid === APP_PID;
  const diagnosticProduct = ['H3D02', 'H3B03', 'H3M04', 'H3K05', 'H3K06', 'H3K07', 'H3K08', 'H3K09', 'H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].find(name => {
    const descriptor = [12, 3, ...Array.from(name).flatMap(c => [c.charCodeAt(0), 0])];
    return bytes.some((_, i) => descriptor.every((v, j) => bytes[i + j] === v));
  }) || null;
  const sha256 = Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', bytes)), n => hex(n, 2).toLowerCase()).join('');
  return { bytes: bytes.length, sha256, recognizable, identities, diagnosticProduct, experimental: !recognizable || !exactIdentity || !!diagnosticProduct };
}

const closingDevices = new WeakMap();
const openingDevices = new WeakMap();
function withDeadline(pending, timeout, error) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(error), timeout); });
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}

export class HIDTransport {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.shape = reportShape(device);
    this.waiter = null;
    this.closed = false;
    this.received = event => {
      if (event.reportId !== 0 || !this.waiter) return;
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (this.waiter.kind === 'version' && !(bytes[0] === 0xaa && bytes[1] === 3)) return;
      if (this.waiter.kind === 'raw' && !(bytes[0] === 0xaa && bytes[1] === 0xdb)) return;
      if (this.waiter.kind === 'startup' && !(bytes[0] === 0xaa && bytes[1] === 0xdc)) return;
      if (this.waiter.kind === 'matrix' && !(bytes[0] === 0xaa && bytes[1] === 0xdb)) return;
      if (this.waiter.kind === 'control' && !(bytes[0] === 0xaa && bytes[1] === 0xdd)) return;
      if (this.waiter.kind === 'keyboard' && !(bytes[0] === 0xaa && bytes[1] === 0xd0)) return;
      const request=this.waiter.request;
      if(this.waiter.kind==='keyboard'&&bytes[2]===0&&
         (request[2]<=1?(bytes[4]!==request[4]||bytes[5]!==request[5]||bytes[6]!==request[6]):bytes[4]!==0))return;
      if (this.waiter.kind === 'gamepad' && !(bytes[0] === 0xaa && bytes[1] === 0xd3)) return;
      if (this.waiter.kind === 'profiles' && !(bytes[0] === 0xaa && bytes[1] === 0xd2)) return;
      if (this.waiter.kind === 'lighting' && !(bytes[0] === 0xaa && bytes[1] === 0xd1)) return;
      if (this.waiter.kind === 'boot' && [0xa0, 0xa1].includes(bytes[0])) return;
      this.waiter.resolve(new Uint8Array(bytes));
    };
  }
  async open() {
    const closing = closingDevices.get(this.device);
    if (closing) await withDeadline(closing, 2000, new Error('The previous USB connection is still closing. Unplug and reconnect the keyboard if it stays busy.'));
    if (!this.device.opened || openingDevices.has(this.device)) {
      if (!openingDevices.has(this.device)) {
        const opening = Promise.resolve().then(() => this.device.open()).finally(() => openingDevices.delete(this.device));
        openingDevices.set(this.device, opening);
      }
      await withDeadline(openingDevices.get(this.device), 2500, new Error('USB connection timed out. Unplug and reconnect the keyboard, then try again.'));
    }
    if (this.closed) throw new Error('Connection closed.');
    this.device.addEventListener('inputreport', this.received);
  }
  disconnected() {
    this.closed = true;
    this.device.removeEventListener('inputreport', this.received);
    if (this.waiter?.allowDisconnect) {
      this.waiter.disconnected = true;
      if (this.waiter.sent) this.waiter.resolve(null);
    }
    else this.waiter?.reject(new Error('Keyboard disconnected during a command. Update stopped.'));
  }
  async close() {
    this.closed = true;
    this.device.removeEventListener('inputreport', this.received);
    this.waiter?.reject(new Error('Connection closed.'));
    const opening = openingDevices.get(this.device);
    if (!closingDevices.has(this.device) && (this.device.opened || opening)) {
      const closing = Promise.resolve(opening).catch(() => {}).then(() => {
        if (this.device.opened) return this.device.close();
      }).finally(() => closingDevices.delete(this.device));
      closingDevices.set(this.device, closing);
    }
    const closing = closingDevices.get(this.device);
    if (closing) await withDeadline(closing, 2000, new Error('USB disconnect timed out. Unplug and reconnect the keyboard if it stays busy.'));
  }
  async request(bytes, { kind = 'boot', timeout = 2500, allowDisconnect = false } = {}) {
    if (this.closed || this.waiter) throw new Error('Connection is closed or a command is already running.');
    const full = new Uint8Array(this.shape.size);
    if (bytes.length > full.length) throw new Error('Report is larger than the selected interface permits.');
    full.set(bytes);
    const response = new Promise(resolve => {
      this.waiter = { kind, request:bytes, allowDisconnect, sent: false, resolve };
    });
    const waiter = this.waiter;
    const cancelled = new Promise((_, reject) => { waiter.reject = reject; });
    const sent = Promise.resolve().then(() => {
      if (this.closed) throw new Error('Connection closed.');
      return this.device.sendReport(0, full);
    }).then(() => {
      waiter.sent = true;
      if (allowDisconnect && waiter.disconnected) waiter.resolve(null);
    });
    const operation = kind === 'version' ? 'firmware version query (0x55/0x03)' : `command 0x${hex(bytes[0], 2)}${bytes[0] === 0x55 ? '/0x'+hex(bytes[1],2) : ''}`;
    const detail=kind==='keyboard'?` (operation ${bytes[2]}, offset ${bytes[5]|bytes[6]<<8})`:'';
    const timeoutError=new Error(`No acknowledgement for ${operation}${detail}.`);
    timeoutError.name='HIDTimeoutError';
    try {
      const [, reply] = await withDeadline(Promise.race([Promise.all([sent, response]), cancelled]), timeout,
        timeoutError);
      if (kind === 'boot' && reply) checkBootAck(reply);
      return reply;
    } finally {
      this.waiter = null;
      if (!waiter.sent) this.closed = true;
    }
  }
  async enterRecovery() {
    if (!['application', 'experimental'].includes(modeOf(this.device))) throw new Error('Select the keyboard in application mode first.');
    // Entry normally disconnects before replying. It is not an image write.
    await withDeadline(this.device.sendReport(0, recoveryPacket()), 2500, new Error('USB recovery request timed out.'));
  }
}

export async function readRawSamples(transport) {
  if (modeOf(transport.device) !== 'experimental' && !(modeOf(transport.device) === 'application' && transport.device.productName === 'H3D02')) throw new Error('Select the H3D02 custom application, not stock firmware or recovery.');
  async function read(offset, length) {
    const checksum = (length + (offset & 255) + (offset >>> 8)) & 255;
    const response = await transport.request(packet(0x55, [0xdb, 0, checksum, length, offset & 255, offset >>> 8]), { kind: 'raw' });
    if (!response || response.length < length + 8 || response[2] !== 0 || response[4] !== length || response[5] !== offset || response[6] !== 0) throw new Error('Custom diagnostic read was rejected or malformed.');
    const sum = response.slice(4, length + 8).reduce((n, b) => (n + b) & 255, 0);
    if (response[3] !== sum) throw new Error('Custom diagnostic response checksum failed.');
    return response.slice(8, length + 8);
  }
  const signature = await read(0, 8);
  if (!Uint8Array.of(0x48, 0x33, 0x44, 0x31, 36, 3, 12, 1).every((v, i) => signature[i] === v)) throw new Error('H3D1 diagnostic firmware signature not found.');
  const bytes = new Uint8Array(72);
  bytes.set(await read(8, 56)); bytes.set(await read(64, 16), 56);
  const view = new DataView(bytes.buffer);
  return Array.from({ length: 36 }, (_, i) => view.getUint16(i * 2, true));
}

export async function readStartupStatus(transport) {
  if (modeOf(transport.device) !== 'application' || !['H3B03', 'H3M04'].includes(transport.device.productName)) throw new Error('Select H3B03 or H3M04 diagnostic firmware. HE30 Upgrader and stock firmware cannot provide startup status.');
  async function read(offset, length) {
    const response = await transport.request(packet(0x55, [0xdc, 0, (length + offset) & 255, length, offset, 0]), { kind: 'startup' });
    if (!response || response.length < length + 8 || response[0] !== 0xaa || response[1] !== 0xdc || response[2] !== 0 || response[4] !== length || response[5] !== offset || response[6] !== 0 || response[7] !== 0) throw new Error('Startup diagnostic response is malformed or rejected.');
    if (response[3] !== response.slice(4, length + 8).reduce((n, b) => (n + b) & 255, 0)) throw new Error('Startup diagnostic checksum failed.');
    return response.slice(8, length + 8);
  }
  const signature = [0x48, 0x33, 0x42, 0x31, 1];
  const header = await read(0, 8);
  if (!signature.every((v, i) => header[i] === v)) throw new Error('H3B1 startup signature was not found.');
  const data = await read(0, 56);
  if (!signature.every((v, i) => data[i] === v)) throw new Error('Startup diagnostic signature changed during the read.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { signature: 'H3B1', format: data[4], stage: data[5], flags: data[6], lastCommand: data[7],
    loopCounter: view.getUint32(8, true), requests: view.getUint32(12, true), resetFlags: view.getUint32(16, true),
    clockControl: view.getUint32(20, true), clockConfig: view.getUint32(24, true), usbControl: view.getUint32(28, true),
    coreClock: view.getUint32(32, true), cause: view.getUint32(36, true), faultPC: view.getUint32(40, true),
    machineStatus: view.getUint32(44, true), previousStage: view.getUint32(48, true) };
}

async function hardwareRead(transport, offset, length) {
  if (modeOf(transport.device) !== 'application' || transport.device.productName !== 'H3M04') throw new Error('Select v0.4 H3M04 before using mapping/RGB diagnostics.');
  const response = await transport.request(packet(0x55, [0xdb, 0, (offset + length) & 255, length, offset, 0]), { kind: 'matrix' });
  validateHardwareReply(response, 0xdb, length, offset);
  if (response[2]) throw new Error('Snapshot read was rejected.');
  return response.slice(8, 8 + length);
}
function validateHardwareReply(response, command, length, offset) {
  if (!response || response.length !== 64 || response[0] !== 0xaa || response[1] !== command || response[4] !== length || response[5] !== offset || response[6] || response[7]) throw new Error('Mapping/RGB response has an invalid shape.');
  if (response[3] !== response.slice(4, 8 + length).reduce((n,b)=>(n+b)&255,0)) throw new Error('Mapping/RGB response checksum failed.');
}
function attestHardware(data) {
  if (![0x48,0x33,0x4d,0x31,1].every((v,i)=>data[i]===v)) throw new Error('H3M1 v0.4 diagnostic signature was not found.');
}
export async function readHardwareSnapshot(transport) {
  attestHardware(await hardwareRead(transport,64,8));
  const bytes=new Uint8Array(160);
  for(const [offset,length] of [[0,56],[56,56],[112,48]]) bytes.set(await hardwareRead(transport,offset,length),offset);
  attestHardware(bytes.slice(64,72));
  const view=new DataView(bytes.buffer);
  return { signature:'H3M1', product:'H3M04', stage:bytes[5], mode:bytes[69], rgbPath:bytes[70], error:bytes[71],
    loopCounter:view.getUint32(8,true), requests:view.getUint32(12,true), coreClock:view.getUint32(32,true),
    adcFrames:view.getUint32(72,true), lastAction:view.getUint32(76,true), rgbFrames:view.getUint32(152,true), dmaStatus:view.getUint32(156,true),
    values:Array.from({length:36},(_,i)=>view.getUint16(80+i*2,true)) };
}
export async function runHardwareTest(transport, action, { path=0, index=0, r=0, g=0, b=0, rate=0 }={}) {
  if(![1,2,3,4].includes(action))throw new Error('Unknown hardware test.');
  if([1,2].includes(action)) {
    if([path,index,r,g,b,rate].some(v=>v!==0))throw new Error('ADC tests do not accept RGB options.');
  } else if(![1,2].includes(path)||!Number.isInteger(index)||!(index>=0&&index<64||index===255)||![r,g,b].every(v=>Number.isInteger(v)&&v>=0&&v<=16)||![0,1].includes(rate)) throw new Error('Choose an RGB path, LED0–63 or255, brightness0–16 and a supported rate.');
  // Attest before every state-changing command, including calls outside the UI.
  attestHardware(await hardwareRead(transport,64,8));
  const payload=[...new TextEncoder().encode('TEST'),action,path,index,r,g,b,rate,0];
  const checksum=(12+payload.reduce((a,b)=>a+b,0))&255;
  const response=await transport.request(packet(0x55,[0xdd,0,checksum,12,0,0,0,...payload]),{kind:'control'});
  validateHardwareReply(response,0xdd,8,0);attestHardware(response.slice(8,16));
  if(response[2]!==response[15]||response[2]>5)throw new Error('Hardware test returned inconsistent error fields.');
  return {error:response[2],mode:response[13],rgbPath:response[14]};
}

export async function flashImage(transport, bytes, update = () => {}) {
  if (transport.device.vendorId !== VID || transport.device.productId !== BOOT_PID) throw new Error('Only Epomaker recovery 19F5:AF22 may receive an image.');
  if (!(bytes instanceof Uint8Array) || bytes.length < 64 || bytes.length > MAX_IMAGE) throw new Error('Invalid image length.');
  if (bytes.length % 4) throw new Error('Image length is not word-aligned.');
  update({ stage: 'erase', progress: 0 });
  await transport.request(packet(0x81, [7, 0xf5, 0x19, 0x22, 0xaf, 0]), { timeout: 20000 });
  for (const [command, stage, start] of [[0x80, 'write', 2], [0x82, 'compare', 49]]) {
    for (let offset = 0; offset < bytes.length; offset += 32) {
      const chunk = bytes.subarray(offset, offset + 32);
      await transport.request(dataPacket(command, offset, chunk));
      update({ stage, offset: offset + chunk.length, total: bytes.length, progress: start + 47 * (offset + chunk.length) / bytes.length });
    }
  }
  update({ stage: 'finalize', progress: 97 });
  await transport.request(packet(0x83, [1, 0, 0, 0]));
  await transport.request(packet(0x84, [1, 0, 0, 0]), { allowDisconnect: true });
  update({ stage: 'await-application', progress: 99 });
}
