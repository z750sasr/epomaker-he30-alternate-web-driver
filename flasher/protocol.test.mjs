import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HIDTransport, inspectImage, flashImage, reportShape, connectionCandidates, connectionFilters, dataPacket, recoveryPacket, checkBootAck, readRawSamples, readStartupStatus } from './protocol.mjs';

function image(pid = 0xfb4c) {
  const b = new Uint8Array(256), v = new DataView(b.buffer);
  v.setUint32(0, 0x6f, true); v.setUint32(4, 0x13, true); v.setUint32(0x38, 0x5000, true);
  b.set([18, 1, 0, 2, 0, 0, 0, 64, 0xf5, 0x19, pid & 255, pid >> 8, 9, 1, 1, 2, 3, 1], 80);
  return b;
}
class FakeDevice extends EventTarget {
  constructor({ pid = 0xaf22, size = 512, badAt = -1, timeoutAt = -1, detachFinal = false } = {}) {
    super(); this.vendorId = 0x19f5; this.productId = pid; this.opened = false; this.sent = []; this.badAt = badAt; this.timeoutAt = timeoutAt; this.detachFinal = detachFinal;
    this.collections = [{ usagePage: pid === 0xaf22 ? 0xff00 : 1, usage: pid === 0xaf22 ? 1 : 0, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: size }] }] }];
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport(id, data) {
    assert.equal(id, 0); this.sent.push(new Uint8Array(data));
    if (data[0] === 0x84 && this.detachFinal) { this.detach?.(); return; }
    if (this.sent.length === this.timeoutAt) return;
    const reply = new Uint8Array(512);
    if (this.sent.length === this.badAt) reply[0] = 1;
    // Deliberately emit synchronously: real replies can beat sendReport's promise.
    const event = new Event('inputreport'); event.reportId = 0; event.data = new DataView(reply.buffer); this.dispatchEvent(event);
  }
}
test('image identity and format checks distinguish HE30, donor, ARM and bad input', async () => {
  const good = await inspectImage(image(), webcrypto);
  assert.equal(good.experimental, false); assert.equal(good.sha256.length, 64);
  const donor = await inspectImage(image(0xfd50), webcrypto); assert.equal(donor.experimental, true);
  await assert.rejects(inspectImage(new Uint8Array(256), webcrypto), /padding/);
  const arm = image(); new DataView(arm.buffer).setUint32(0, 0x20001000, true); new DataView(arm.buffer).setUint32(4, 0x0800822d, true);
  await assert.rejects(inspectImage(arm, webcrypto), /ARM/);
  await assert.rejects(inspectImage(new Uint8Array(257), webcrypto), /32-bit/);
});
test('recovery packet is the observed HE30 request; report padding follows descriptor', async () => {
  assert.deepEqual(Array.from(recoveryPacket().slice(0, 9)), [0x5f, 6, 0, 0x52, 1, 0, 0, 0, 0x51]);
  const d = new FakeDevice({ pid: 0xfb4c, size: 64 }); const t = new HIDTransport(d); await t.open(); await t.enterRecovery();
  assert.equal(d.sent.length, 1); assert.equal(d.sent[0].length, 64);
  assert.equal(reportShape(new FakeDevice()).size, 512);
  assert.throws(() => reportShape(new FakeDevice({ size: 32 })), /not found/);
});

test('connection discovery ignores composite input interfaces and keeps distinct matching keyboards ambiguous', () => {
  const config = new FakeDevice({pid:0xfb4c,size:64});config.productName='H3K05';
  const keyboard = new FakeDevice({pid:0xfb4c,size:64});keyboard.collections=[{usagePage:1,usage:6,inputReports:[{reportId:0}],outputReports:[]}];
  const media = new FakeDevice({pid:0xfb4c,size:64});media.collections=[{usagePage:12,usage:1,inputReports:[{reportId:0}]}];
  const other = new FakeDevice({pid:0xfb4c,size:64});other.productName='H3K05';
  const boot = new FakeDevice(),donor = new FakeDevice({pid:0xfd50,size:64});
  assert.deepEqual(connectionCandidates([keyboard,media,config,config]),[config]);
  assert.deepEqual(connectionCandidates([config,other]),[config,other],'identical names/IDs must not merge real keyboards');
  assert.deepEqual(connectionCandidates([keyboard,config,boot,donor]),[config,boot]);
  assert.deepEqual(connectionCandidates([config,boot,donor],{recoveryOnly:true}),[boot]);
  assert.deepEqual(connectionCandidates([config,boot,donor],{applicationOnly:true,includeDonor:true}),[config,donor]);
  assert.deepEqual(connectionFilters([0xfb4c,0xaf22,0xfd50]),[
    {vendorId:0x19f5,productId:0xfb4c,usagePage:1,usage:0},
    {vendorId:0x19f5,productId:0xaf22,usagePage:0xff00,usage:1},
    {vendorId:0x19f5,productId:0xfd50,usagePage:1,usage:0}
  ]);
});
test('full OEM order, all bytes and final short aligned block are preserved', async () => {
  const d = new FakeDevice(), t = new HIDTransport(d); await t.open();
  const bytes = Uint8Array.from({ length: 68 }, (_, i) => i + 1);
  const stages = []; await flashImage(t, bytes, e => stages.push(e.stage));
  assert.deepEqual(d.sent.map(b => b[0]), [0x81, 0x80, 0x80, 0x80, 0x82, 0x82, 0x82, 0x83, 0x84]);
  assert.deepEqual(Array.from(d.sent[0].slice(0, 7)), [0x81, 7, 0xf5, 0x19, 0x22, 0xaf, 0]);
  for (let i = 0; i < 3; i++) {
    assert.equal(d.sent[1 + i].length, 512);
    assert.deepEqual(d.sent[1 + i].slice(1), d.sent[4 + i].slice(1));
    assert.deepEqual(d.sent[1 + i].slice(6, 6 + d.sent[1 + i][1]), bytes.slice(i * 32, i * 32 + 32));
  }
  assert.equal(d.sent[3][1], 4); assert.equal(d.sent[3][2], 64);
  assert.equal(stages.at(-1), 'await-application'); await t.close();
});
test('wrong target never receives erase; compare failure prevents finalization', async () => {
  const other = new FakeDevice({ pid: 0xff30 });
  await assert.rejects(flashImage({ device: other }, image()), /AF22/); assert.equal(other.sent.length, 0);
  const d = new FakeDevice({ badAt: 4 }), t = new HIDTransport(d); await t.open();
  await assert.rejects(flashImage(t, image().slice(0, 64)), /rejected/);
  assert.deepEqual(d.sent.map(b => b[0]), [0x81, 0x80, 0x80, 0x82]); await t.close();
});
test('missing replies stop commands; zero statuses pass but AA is not accepted as success', async () => {
  const d = new FakeDevice({ timeoutAt: 1 }), t = new HIDTransport(d); await t.open();
  await assert.rejects(t.request(dataPacket(0x82, 0, new Uint8Array(4)), { timeout: 15 }), /No acknowledgement/);
  assert.equal(t.waiter, null); assert.equal(d.sent.length, 1); await t.close();
  checkBootAck(new Uint8Array(512)); assert.throws(() => checkBootAck(Uint8Array.of(0xaa, 0)), /rejected/);
});
test('only final reboot may disconnect, including before sendReport resolves', async () => {
  const d = new FakeDevice({ detachFinal: true }), t = new HIDTransport(d); d.detach = () => t.disconnected(); await t.open();
  await flashImage(t, image().slice(0, 64)); assert.equal(d.sent.at(-1)[0], 0x84);
  const early = new FakeDevice({ timeoutAt: 1 }), e = new HIDTransport(early); await e.open();
  const pending = e.request(dataPacket(0x80, 0, new Uint8Array(4))); e.disconnected();
  await assert.rejects(pending, /disconnected/); await e.close();
});

test('raw diagnostics attest custom firmware and read all36 words without writes', async () => {
  class RawDevice extends FakeDevice {
    constructor(signature = true, pid = 0xfd50) { super({ pid, size: 64 }); this.signature = signature; this.productName = 'H3D02'; }
    async sendReport(id, request) {
      this.sent.push(new Uint8Array(request));
      assert.equal(request[0], 0x55); assert.equal(request[1], 0xdb);
      const bytes = new Uint8Array(80); bytes.set([0x48,0x33,0x44,0x31,36,3,12,1]);
      if (!this.signature) bytes[0]=0;
      const view = new DataView(bytes.buffer);
      for (let i=0;i<36;i++) view.setUint16(8+i*2,1000+i*79,true);
      const offset = request[5] | request[6]<<8, length=request[4];
      assert.ok(offset+length<=80 && length<=56);
      const response = new Uint8Array(64); response.set([0xaa,0xdb,0,0,length,offset,0,0]); response.set(bytes.slice(offset,offset+length),8);
      response[3]=response.slice(4,length+8).reduce((a,b)=>(a+b)&255,0);
      const event=new Event('inputreport'); event.reportId=id; event.data=new DataView(response.buffer); this.dispatchEvent(event);
    }
  }
  const good = new RawDevice(), t=new HIDTransport(good); await t.open();
  assert.deepEqual(await readRawSamples(t),Array.from({length:36},(_,i)=>1000+i*79));
  assert.deepEqual(good.sent.map(b=>[b[4],b[5]]),[[8,0],[56,8],[16,64]]); await t.close();
  const identityVariant = new RawDevice(true, 0xfb4c), variantTransport = new HIDTransport(identityVariant); await variantTransport.open();
  assert.deepEqual(await readRawSamples(variantTransport),Array.from({length:36},(_,i)=>1000+i*79)); await variantTransport.close();
  const stock = new RawDevice(true, 0xfb4c); stock.productName = 'HE30';
  const stockTransport = new HIDTransport(stock); await stockTransport.open();
  await assert.rejects(readRawSamples(stockTransport),/not stock/); assert.equal(stock.sent.length,0); await stockTransport.close();
  const wrong = new RawDevice(false), w=new HIDTransport(wrong); await w.open();
  await assert.rejects(readRawSamples(w),/signature/); assert.equal(wrong.sent.length,1); await w.close();
});

test('v0.3 image is experimental despite FB4C and its startup replies decode actual instruction-model output', async () => {
  const base = new URL('../firmware/custom/he30-v0.3/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  const fixtures = JSON.parse(readFileSync(new URL('status-fixtures.json', base), 'utf8'));
  const image = new Uint8Array(readFileSync(new URL(manifest.name, base)));
  const info = await inspectImage(image, webcrypto);
  assert.equal(info.sha256, manifest.sha256); assert.equal(fixtures.sha256, manifest.sha256);
  assert.equal(info.recognizable, true); assert.equal(info.experimental, true);
  assert.equal(info.diagnosticProduct, 'H3B03'); assert.equal(info.identities[0].release, 0x0300);
  class StartupDevice extends FakeDevice {
    constructor({ badChecksum = false, badSignature = false } = {}) { super({ pid: 0xfb4c, size: 64 }); this.productName = 'H3B03'; this.badChecksum = badChecksum; this.badSignature = badSignature; }
    async sendReport(reportId, data) {
      this.sent.push(new Uint8Array(data));
      const f = fixtures.fixtures[this.sent.length - 1];
      assert.equal(Buffer.from(data).toString('hex'), f.request);
      // A stale raw-scan reply must not satisfy a startup command.
      const stale = new Event('inputreport'); stale.reportId = reportId; stale.data = new DataView(Uint8Array.of(0xaa, 0xdb, 0, 0).buffer); this.dispatchEvent(stale);
      const bytes = new Uint8Array(Buffer.from(f.response, 'hex'));
      if (this.badSignature) { bytes[8] = 0; bytes[3] = bytes.slice(4, 8 + bytes[4]).reduce((n,b)=>(n+b)&255,0); }
      if (this.badChecksum) bytes[3] ^= 1;
      const event = new Event('inputreport'); event.reportId = reportId; event.data = new DataView(bytes.buffer); this.dispatchEvent(event);
    }
  }
  const good = new StartupDevice(), transport = new HIDTransport(good); await transport.open();
  const status = await readStartupStatus(transport);
  assert.equal(status.signature, 'H3B1'); assert.equal(status.stage, 48); assert.equal(status.flags, 15);
  assert.equal(status.coreClock, 144000000); assert.equal(status.requests, 1);
  assert.equal(good.sent.length, 2); assert.ok(good.sent.every(b => b[0] === 0x55 && b[1] === 0xdc)); await transport.close();
  for (const mode of ['badChecksum', 'badSignature']) {
    const device = new StartupDevice({ [mode]: true }), t = new HIDTransport(device); await t.open();
    await assert.rejects(readStartupStatus(t), mode === 'badChecksum' ? /checksum/ : /signature/);
    assert.equal(device.sent.length, 1); await t.close();
  }
  for (const product of ['HE30', 'H3D02']) {
    const d = new StartupDevice(); d.productName = product;
    const t = new HIDTransport(d); await t.open(); await assert.rejects(readStartupStatus(t), /H3B03/);
    assert.equal(d.sent.length, 0); await t.close();
  }
});
