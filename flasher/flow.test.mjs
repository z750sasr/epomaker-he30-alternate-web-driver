import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class Element extends EventTarget {
  constructor() { super(); this.textContent = ''; this.disabled = false; this.hidden = false; this.checked = false; this.style = {}; this.files = []; }
  replaceChildren() {} append() {} showModal() { this.visible = true; } click() { this.onclick?.(); }
}
class Device extends EventTarget {
  constructor(pid, hid) {
    super(); this.vendorId = 0x19f5; this.productId = pid; this.productName = 'Simulated HE30'; this.hid = hid; this.sent = [];
    this.collections = [{ usagePage: pid === 0xaf22 ? 0xff00 : 1, usage: pid === 0xaf22 ? 1 : 0, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: pid === 0xaf22 ? 512 : 64 }] }] }];
  }
  async open() { this.opened = true; } async close() { this.opened = false; }
  async sendReport(reportId, data) {
    this.sent.push(new Uint8Array(data));
    if (data[0] === 0x5f) {
      this.hid.devices = [];
      if (!this.omitRecoveryDisconnect) {
        const e = new Event('disconnect'); e.device = this; this.hid.dispatchEvent(e);
      }
      if (this.hid.automatic) setImmediate(() => {
        this.hid.devices = [this.hid.boot];
        const connected = new Event('connect'); connected.device = this.hid.boot; this.hid.dispatchEvent(connected);
      });
      if(this.recoveryTransferError)throw new Error('Transfer interrupted by reset');
      return;
    }
    if (this.ignoreVersion&&data[0]===0x55&&data[1]===3) return;
    const b = new Uint8Array(this.productId === 0xaf22 ? 512 : 64);
    if (data[0] === 0x55 && this.productName === 'H3B03' && data[1] === 0xdc) {
      const fixtures = JSON.parse(readFileSync(new URL('../firmware/custom/he30-v0.3/status-fixtures.json', import.meta.url), 'utf8')).fixtures;
      const match = fixtures.find(f => f.request === Buffer.from(data).toString('hex'));
      assert.ok(match); b.set(Buffer.from(match.response, 'hex'));
    } else if (data[0] === 0x55 && ['H3K05','H3K06','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15'].includes(this.productName) && [0xd0,0xd1].includes(data[1])) {
      const fixtures = JSON.parse(readFileSync(new URL(`../firmware/custom/he30-v0.${Number(this.productName.slice(-2))}/protocol-fixtures.json`, import.meta.url),'utf8')).fixtures;
      const match = fixtures.find(f=>f.phase==='default'&&f.request===Buffer.from(data).toString('hex'));
      assert.ok(match);b.set(Buffer.from(match.response,'hex'));
    } else if (data[0] === 0x55) { b[0] = 0xaa; b[1] = 3; b[8] = ['H3B03','H3K05','H3K06','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15'].includes(this.productName) ? 0 : 9; b[9] = this.productName.startsWith('H3K') ? Number.parseInt(this.productName.slice(-2),16) : this.productName === 'H3B03' ? 3 : 1; }
    const e = new Event('inputreport'); e.reportId = reportId; e.data = new DataView(b.buffer); this.dispatchEvent(e);
  }
}
const tick = () => new Promise(r => setImmediate(r));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await tick(); } throw new Error('Simulated UI did not reach expected state.'); }

for (const scenario of ['permission', 'automatic', 'cancel', 'startup','foundation','rgb','pro','reset-during-transfer','missing-disconnect','missing-version']) test(`applicationâ†’recovery flow: ${scenario}`, async () => {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement() { return new Element(); } };
  const hid = new EventTarget(); hid.devices = [];
  hid.getDevices = async () => hid.devices;
  hid.requestDevice = async () => hid.devices;
  const normal = new Device(0xfb4c, hid), boot = new Device(0xaf22, hid);
  hid.boot = boot; hid.automatic = ['automatic', 'startup','foundation','rgb','pro','reset-during-transfer','missing-disconnect','missing-version'].includes(scenario);
  hid.devices = [normal];
  normal.ignoreVersion=scenario==='missing-version';
  normal.recoveryTransferError=scenario==='reset-during-transfer';
  normal.omitRecoveryDisconnect = scenario === 'missing-disconnect';
  const savedGlobals = { document: globalThis.document, window: globalThis.window, indexedDB: globalThis.indexedDB, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), setTimeout: globalThis.setTimeout,fetch:globalThis.fetch };
  const timers = [];
  globalThis.document = document;
  globalThis.window = Object.assign(new EventTarget(), { isSecureContext: true });
  globalThis.indexedDB = { open() { throw new Error('Storage deliberately unavailable in this test.'); } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hid } });
  globalThis.setTimeout = (fn, ms, ...args) => { const timer = savedGlobals.setTimeout(fn, scenario==='missing-version'&&ms===2500?0:ms, ...args); timers.push(timer); return timer; };
  try {
    await import(`./app.mjs?flow=${scenario}-${Date.now()}`);
    await until(() => nodes.get('status')?.textContent.includes(scenario==='missing-version'?'You can enter recovery':'Keyboard connected'));
    assert.equal(boot.sent.length, 0);
    let bytes = new Uint8Array(256); const v = new DataView(bytes.buffer);
    v.setUint32(0, 0x6f, true); v.setUint32(4, 0x13, true); v.setUint32(0x38, 0x5000, true);
    bytes.set([18, 1, 0, 2, 0, 0, 0, 64, 0xf5, 0x19, 0x4c, 0xfb, 9, 1, 1, 2, 3, 1], 80);
    if (scenario === 'startup') bytes = new Uint8Array(readFileSync(new URL('../firmware/custom/he30-v0.3/Epomaker-HE30-EXPERIMENTAL-v0.3-USB-startup.bin', import.meta.url)));
    if(scenario==='foundation')bytes=new Uint8Array(readFileSync(new URL('../firmware/custom/he30-v0.5/Epomaker-HE30-EXPERIMENTAL-v0.5-Foundation.bin',import.meta.url)));
    if(scenario==='rgb')bytes=new Uint8Array(readFileSync(new URL('../firmware/custom/he30-v0.6/Epomaker-HE30-EXPERIMENTAL-v0.6-RGB.bin',import.meta.url)));
    if(scenario==='pro'){
      const manifest=JSON.parse(readFileSync(new URL('../firmware/custom/he30-v0.15/manifest.json',import.meta.url),'utf8'));
      bytes=new Uint8Array(readFileSync(new URL(`../firmware/custom/he30-v0.15/${manifest.name}`,import.meta.url)));
      globalThis.fetch=async url=>{assert.ok(String(url).startsWith('../firmware/custom/he30-v0.15/'));return new Response(readFileSync(new URL(url,import.meta.url)));};
      document.getElementById('imagePolling').value='6';document.getElementById('imageScanner').value='2';
      await nodes.get('loadCustom').onclick();assert.ok(nodes.get('status').textContent.includes('v0.15 HE30 Pro loaded'));
    }else{
      nodes.get('file').files = [{ name: 'simulated.bin', arrayBuffer: async () => bytes.buffer }];
      await nodes.get('file').onchange();
    }
    if (['startup','foundation','rgb','pro'].includes(scenario)) {
      assert.equal(nodes.get('start').disabled, true, 'FB4C test image still requires experimental review');
      nodes.get('experimental').checked = true; nodes.get('experimental').onchange();
    }
    assert.equal(nodes.get('start').disabled, false);
    assert.equal(normal.sent.filter(x => x[0] === 0x81).length, 0);
    nodes.get('start').onclick();
    assert.equal(nodes.get('review').visible, true);
    nodes.get('review').returnValue = 'flash'; nodes.get('review').dispatchEvent(new Event('close'));
    await until(() => normal.sent.some(x => x[0] === 0x5f));
    await tick();
    if (scenario === 'missing-disconnect') {
      await until(() => nodes.get('status').textContent.includes('disconnect was not reported'));
      assert.equal(boot.sent.length, 0);
      assert.equal(nodes.get('start').disabled, false, 'Review is available for the now-selected updater');
      return;
    }
    if (!hid.automatic) {
      assert.equal(boot.sent.length, 0, 'No permission, so no boot writes');
      if (scenario === 'cancel') nodes.get('cancel').onclick();
      hid.devices = [boot];
      // This is the only extra user gesture: permission, not file reselection.
      await nodes.get('authorize').onclick();
      if (scenario === 'cancel') { assert.equal(boot.sent.length, 0, 'Cancelling before erase must disarm reconnect automation'); return; }
    }
    await until(() => boot.sent.some(x => x[0] === 0x84));
    assert.equal(boot.sent.filter(x => x[0] === 0x81).length, 1);
    assert.equal(boot.sent.filter(x => x[0] === 0x80).length, Math.ceil(bytes.length / 32));
    assert.equal(boot.sent.filter(x => x[0] === 0x82).length, Math.ceil(bytes.length / 32));
    if(scenario==='pro'){
      const header=boot.sent.find(x=>x[0]===0x80&&x[2]===0&&x[3]===0x90&&x[4]===1);
      assert.deepEqual(Array.from(header.slice(6+17,6+19)),[6,2]);
    }
    const e = new Event('connect'); e.device = boot; hid.dispatchEvent(e);
    await tick(); await tick();
    assert.equal(boot.sent.filter(x => x[0] === 0x81).length, 1, 'Repeated USB events must not reflash');
    if (scenario === 'startup') {
      await until(() => !nodes.get('connect').disabled);
      const disconnected = new Event('disconnect'); disconnected.device = boot; hid.dispatchEvent(disconnected);
      const diagnostic = new Device(0xfb4c, hid); diagnostic.productName = 'H3B03'; hid.devices = [diagnostic];
      const connected = new Event('connect'); connected.device = diagnostic; hid.dispatchEvent(connected);
      await until(() => nodes.get('status').textContent.includes('v0.3 USB startup diagnostic is responding'));
      assert.equal(nodes.get('progress').value, 100);
      assert.deepEqual(diagnostic.sent.map(b => [b[0], b[1]]), [[0x55,3],[0x55,0xdc],[0x55,0xdc]]);
      assert.ok(!nodes.get('status').textContent.includes('recalibrate'));
    }
    if(['foundation','rgb','pro'].includes(scenario)){
      await until(()=>!nodes.get('connect').disabled);
      const disconnected=new Event('disconnect');disconnected.device=boot;hid.dispatchEvent(disconnected);
      const keyboard=new Device(0xfb4c,hid);keyboard.productName=scenario==='pro'?'H3K15':scenario==='rgb'?'H3K06':'H3K05';hid.devices=[keyboard];
      const connected=new Event('connect');connected.device=keyboard;hid.dispatchEvent(connected);
      await until(()=>nodes.get('status').textContent.includes(scenario==='pro'?'H3K15 is responding':scenario==='rgb'?'v0.6 foundation USB, H3K1 and H3L1 are responding':'v0.5 foundation USB and H3K1 are responding'));
      assert.equal(nodes.get('progress').value,100);assert.equal(keyboard.sent.length,scenario==='foundation'?6:10);
      assert.ok(keyboard.sent.every(b=>b[0]===0x55&&(b[1]===3||[0xd0,0xd1].includes(b[1])&&b[2]===0)),'Post-flash check cannot calibrate/enable/save');
    }
  } finally {
    timers.forEach(clearTimeout);
    globalThis.setTimeout = savedGlobals.setTimeout;
    globalThis.document = savedGlobals.document; globalThis.window = savedGlobals.window; globalThis.indexedDB = savedGlobals.indexedDB;globalThis.fetch=savedGlobals.fetch;
    if (savedGlobals.navigator) Object.defineProperty(globalThis, 'navigator', savedGlobals.navigator); else delete globalThis.navigator;
  }
});

for(const scenario of ['composite','multiple','cancel','already-recovery','unsupported'])test(`standalone recovery button: ${scenario}`,async()=>{
  const nodes=new Map(),document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();}};
  const hid=new EventTarget(),config=new Device(0xfb4c,hid),other=new Device(0xfb4c,hid),input=new Device(0xfb4c,hid),boot=new Device(0xaf22,hid);
  config.productName=other.productName='H3K05';input.collections=[{usagePage:1,usage:6,inputReports:[{reportId:0}],outputReports:[]}];
  hid.devices=scenario==='composite'?[input,config]:scenario==='already-recovery'?[boot]:[config,other];
  hid.getDevices=async()=>hid.devices;const choices=[];hid.requestDevice=async options=>{choices.push(options);return scenario==='cancel'?[]:[input,config];};
  const saved={document:globalThis.document,window:globalThis.window,indexedDB:globalThis.indexedDB,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),setTimeout:globalThis.setTimeout};
  const timers=[];globalThis.document=document;globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});
  globalThis.indexedDB={open(){throw new Error('No storage');}};Object.defineProperty(globalThis,'navigator',{configurable:true,value:scenario==='unsupported'?{}:{hid}});
  globalThis.setTimeout=(fn,ms,...args)=>{const t=saved.setTimeout(fn,ms,...args);timers.push(t);return t;};
  try{
    await import(`./app.mjs?standalone=${scenario}-${Date.now()}`);
    if(scenario==='unsupported'){await tick();assert.equal(nodes.get('recover').disabled,true);return;}
    await until(()=>scenario==='composite'?nodes.get('status')?.textContent.includes('H3K05 connected'):scenario==='already-recovery'?nodes.get('status')?.textContent.includes('HE30 recovery is connected'):nodes.get('status')?.textContent.includes('Several configuration-capable'));
    if(scenario==='already-recovery'){assert.equal(nodes.get('recover').disabled,true);assert.equal(nodes.get('recover').textContent,'Already in recovery');return;}
    assert.equal(nodes.get('recover').disabled,false,'Recovery stays available without a firmware image');
    assert.equal(nodes.get('start').disabled,true);assert.ok(!config.sent.some(p=>p[0]===0x5f),'Discovery cannot enter recovery');
    if(scenario==='composite'){
      assert.equal(input.opened,undefined);assert.equal(other.opened,undefined);assert.equal(nodes.get('recover').textContent,'Enter recovery only');
    }else{
      assert.equal(config.opened,undefined);assert.equal(other.opened,undefined);assert.equal(nodes.get('recover').textContent,'Connect & enter recovery');
    }
    await nodes.get('recover').onclick();
    if(scenario==='cancel'){assert.equal(config.sent.length,0);assert.ok(nodes.get('status').textContent.includes('no recovery command was sent'));assert.equal(nodes.get('recover').disabled,false);return;}
    assert.equal(config.sent.filter(p=>p[0]===0x5f).length,1);assert.equal(input.sent.length,0);assert.equal(other.sent.length,0);
    assert.equal(nodes.get('authorize').hidden,false,'Standalone entry exposes updater authorization');
    assert.ok(![...config.sent,...boot.sent].some(p=>[0x80,0x81,0x82,0x83,0x84].includes(p[0])),'Standalone recovery must never erase/write/finalize');
    if(scenario==='multiple')assert.deepEqual(choices[0],{filters:[{vendorId:0x19f5,productId:0xfb4c}]});
  }finally{
    await tick();
    timers.forEach(clearTimeout);globalThis.setTimeout=saved.setTimeout;globalThis.document=saved.document;globalThis.window=saved.window;globalThis.indexedDB=saved.indexedDB;
    if(saved.navigator)Object.defineProperty(globalThis,'navigator',saved.navigator);else delete globalThis.navigator;
  }
});
