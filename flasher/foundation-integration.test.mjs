import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {HIDTransport,inspectImage} from './protocol.mjs';
import {FoundationClient,encodeConfig,crc32} from './keyboard-protocol.mjs';
const base=new URL('../firmware/custom/he30-v0.5/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const fixtures=JSON.parse(readFileSync(new URL('protocol-fixtures.json',base),'utf8'));
class CompiledDevice extends EventTarget{
  constructor(phase){super();this.phase=phase;this.vendorId=0x19f5;this.productId=0xfb4c;this.productName='H3K05';this.sent=[];this.collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];}
  async open(){this.opened=true;}async close(){this.opened=false;}
  emit(bytes){const e=new Event('inputreport');e.reportId=0;e.data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.dispatchEvent(e);}
  async sendReport(id,data){
    assert.equal(id,0);this.sent.push(new Uint8Array(data));
    const row=fixtures.fixtures.find(f=>f.phase===this.phase&&f.request===Buffer.from(data).toString('hex'));
    assert.ok(row,'Request must match the compiled firmware packet fixtures');
    // An unrelated late diagnostic/version packet cannot resolve this request.
    for(const command of [3,0xdb,0xdc,0xdd]){const wrong=new Uint8Array(64);wrong.set([0xaa,command]);this.emit(wrong);}
    this.emit(Uint8Array.from(Buffer.from(row.response,'hex')));
  }
}
test('v0.5 identity/hash and shared transport decode actual compiled firmware responses',async()=>{
  const inspection=await inspectImage(new Uint8Array(readFileSync(new URL(manifest.name,base))),webcrypto);
  assert.equal(inspection.sha256,manifest.sha256);assert.equal(fixtures.sha256,manifest.sha256);
  assert.equal(inspection.experimental,true);assert.equal(inspection.diagnosticProduct,'H3K05');assert.equal(inspection.identities[0].release,0x0500);
  for(const phase of ['default','calibrated','fn-pressed']){
    const device=new CompiledDevice(phase),transport=new HIDTransport(device);await transport.open();const client=new FoundationClient(transport);
    const config=await client.readConfig(),status=await client.readStatus();
    assert.equal(status.signature,'H3K1');assert.deepEqual(config.groupOutputs,[2,0,1]);assert.equal(config.bankVerified,true);
    assert.equal(status.configCRC,crc32(encodeConfig(config)));assert.equal(status.missingKeys,phase==='default'?36:0);
    assert.equal(status.typingEnabled,phase!=='default');assert.equal(status.fnHeld,phase==='fn-pressed');
    if(phase==='fn-pressed'){assert.equal(status.report[2],0x40);assert.ok(status.pressed[0]&&status.pressed[8]);}
    assert.ok(device.sent.every(p=>p[0]===0x55&&p[1]===0xd0&&p[2]<=1));await transport.close();
  }
});
