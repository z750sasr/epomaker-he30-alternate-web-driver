import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {HIDTransport,inspectImage} from './protocol.mjs';
import {FoundationClient,KEY_NAMES} from './keyboard-protocol.mjs';
import {LightingClient,decodeLightingStatus} from './lighting-protocol.mjs';
import {createLightingUI} from './lighting-ui.mjs';
const base=new URL('../firmware/custom/he30-v0.7/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')),fixtures=JSON.parse(readFileSync(new URL('protocol-fixtures.json',base),'utf8'));
const initial=new Uint8Array(160);
for(const row of fixtures.fixtures.filter(f=>f.phase==='default')){const p=Buffer.from(row.request,'hex'),r=Buffer.from(row.response,'hex');if(p[1]===0xd1)initial.set(r.subarray(8,8+r[4]),p[5]);}
class Device extends EventTarget{
  constructor(){super();this.vendorId=0x19f5;this.productId=0xfb4c;this.productName='H3K07';this.status=new Uint8Array(initial);this.sent=[];this.collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];}
  async open(){this.opened=true;}async close(){this.opened=false;}
  async sendReport(id,p){
    assert.equal(id,0);assert.equal(p[1],0xd1);this.sent.push(new Uint8Array(p));const r=new Uint8Array(64);r.set([0xaa,0xd1,0]);
    if(p[2]===0){r.set([p[4],p[5],0],4);r.set(this.status.slice(p[5],p[5]+p[4]),8);}
    else{assert.equal(p[2],7);assert.equal(p[4],1);assert.equal(p[5],0);assert.ok(p[8]<=2);this.status[144]=p[8];this.status[145]=Number(p[8]===2);}
    r[3]=r.slice(4,8+r[4]).reduce((a,b)=>(a+b)&255,0);const event=new Event('inputreport');event.reportId=0;event.data=new DataView(r.buffer);this.dispatchEvent(event);
  }
}
async function connect(){const device=new Device(),transport=new HIDTransport(device);await transport.open();const foundation=new FoundationClient(transport);return{device,transport,foundation,client:new LightingClient(foundation)};}
test('v0.7 compiled status attests floating PA10 and firmware identity',async()=>{
  assert.equal(fixtures.sha256,manifest.sha256);const info=await inspectImage(new Uint8Array(readFileSync(new URL(manifest.name,base))),webcrypto);
  assert.equal(info.sha256,manifest.sha256);assert.equal(info.diagnosticProduct,'H3K07');assert.equal(info.identities[0].release,0x0700);
  assert.deepEqual(decodeLightingStatus(initial).power,{mode:0,digitalHigh:false});
  const bad=new Uint8Array(initial);bad[144]=3;assert.throws(()=>decodeLightingStatus(bad));
});
test('power controls allow only07 weak modes after attestation and never save',async()=>{
  const {device,transport,client}=await connect();const status=await client.readStatus();assert.equal(status.power.mode,0);assert.ok(device.sent.every(p=>p[2]===0));
  assert.throws(()=>client.powerTest(3));for(const mode of [2,1,0])assert.equal((await client.powerTest(mode)).power.mode,mode);
  assert.deepEqual(device.sent.filter(p=>p[2]!==0).map(p=>[p[1],p[2],p[4],p[8]]),[[0xd1,7,1,2],[0xd1,7,1,1],[0xd1,7,1,0]]);
  device.productName='H3K06';assert.throws(()=>client.powerTest(2),/v0.7/);await transport.close();
});
test('power UI connects without drive and buttons issue explicit weak/release commands',async()=>{
  class Element extends EventTarget{constructor(){super();this.value='';this.checked=false;this.disabled=false;this.files=[];this.classList={toggle(){}};}}
  const previous=globalThis.document,nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
  const {device,transport,foundation}=await connect();
  try{
    const ui=createLightingUI({runAction:async fn=>fn(),getSelected:()=>0,keyNames:KEY_NAMES,onDirty(){}});await ui.reset(foundation);ui.controls(true);
    assert.equal(nodes.get('powerPanel').hidden,false);assert.equal(nodes.get('powerUp').disabled,false);assert.ok(device.sent.every(p=>p[2]===0));
    await nodes.get('powerUp').onclick();assert.equal(device.status[144],2);assert.ok(nodes.get('lightMessage').textContent.includes('ten seconds'));assert.ok(nodes.get('powerStatus').textContent.includes('digital input high'));
    await nodes.get('powerRelease').onclick();assert.equal(device.status[144],0);assert.ok(nodes.get('powerStatus').textContent.includes('RGB data paused'));
  }finally{await transport.close();globalThis.document=previous;}
});
