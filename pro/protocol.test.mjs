import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {HIDTransport,inspectImage} from '../flasher/protocol.mjs';
import {ProDevice,actionBytes,bindingCode} from './protocol.mjs';
const base=new URL('../firmware/custom/he30-v0.9/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const fixture=JSON.parse(readFileSync(new URL('protocol-fixtures.json',base),'utf8'));

class Device extends EventTarget{
  vendorId=0x19f5;productId=0xfb4c;productName='H3K09';sent=[];
  collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  async open(){this.opened=true;}
  async close(){this.opened=false;}
  async sendReport(id,bytes){
    this.sent.push(bytes);
    const row=fixture.fixtures.find(row=>row.request===Buffer.from(bytes).toString('hex'));
    assert.ok(row,'packet matches a compiled response fixture');
    const reply=Uint8Array.from(Buffer.from(row.response,'hex'));
    const event=new Event('inputreport');
    event.reportId=id;event.data=new DataView(reply.buffer);
    this.dispatchEvent(event);
  }
}
test('H3K09 firmware identity and WebHID clients match compiled status and profile bytes',async()=>{
  const image=new Uint8Array(readFileSync(new URL(manifest.name,base)));
  const check=await inspectImage(image);
  assert.equal(check.sha256,manifest.sha256);
  assert.equal(check.sha256,fixture.sha256);
  assert.equal(check.diagnosticProduct,'H3K09');
  assert.equal(check.identities[0].release,0x0900);
  assert.equal(check.experimental,true);
  const transport=new HIDTransport(new Device());
  await transport.open();
  const pro=new ProDevice(transport);
  const [info,profile,status,config,lighting,frame]=await Promise.all([
    pro.capabilities(),pro.profile(),pro.foundation.readStatus(),pro.foundation.readConfig(),pro.lighting.readStatus(),pro.liveRGB()
  ]);
  assert.deepEqual(info.names,['Profile 1','Profile 2','Profile 3','Profile 4']);
  assert.equal(info.active,0);assert.equal(info.rate,3);assert.equal(info.gamepadAttached,false);
  assert.equal(profile.fn2.length,36);assert.equal(profile.fn2[8],254);
  assert.equal(profile.actions.length,8); assert.equal(profile.travel[32],4000);assert.equal(profile.coefficient[32],0);
  assert.ok(profile.gamepad.every(n=>n===0));
  assert.equal(status.missingKeys,36);assert.deepEqual(config.groupOutputs,[2,0,1]);
  assert.equal(lighting.signature,'H3L1');assert.equal(lighting.config.barEnabled,true);
  assert.equal(frame.length,123);
  assert.ok(transport.device.sent.every(p=>p[2]<=1||p[1]===0xd1&&p[2]===8));
  await transport.close();
});
test('advanced payloads keep the three depth words and reject ambiguous pairs before sending',()=>{
  const action={kind:8,key:32,other:1,mode:0,usage:[4,5,6,0],depth:[200,500,800]};
  assert.equal(Buffer.from(actionBytes(action)).toString('hex'),'0820010004050600c800f4012003');
  assert.throws(()=>actionBytes({...action,depth:[200,500,300]}),/Depth 3/);
  assert.throws(()=>actionBytes({...action,kind:1,other:32}),/different/);
  assert.equal(bindingCode('Fn1',0),255);assert.equal(bindingCode('Fn2',0),253);
  assert.equal(bindingCode('Transparent',2),254);
  assert.throws(()=>bindingCode('Transparent',0));
});
