import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {HIDTransport,inspectImage} from './protocol.mjs';
import {FoundationClient,KEY_NAMES} from './keyboard-protocol.mjs';
import {LightingClient,decodeLighting,encodeLighting,decodeLightingStatus,LED_ORDER,LED_TO_KEY,exportLighting,importLighting} from './lighting-protocol.mjs';
import {createLightingUI} from './lighting-ui.mjs';
const base=new URL('../firmware/custom/he30-v0.6/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')),fixtures=JSON.parse(readFileSync(new URL('protocol-fixtures.json',base),'utf8'));
function region(command,size){const out=new Uint8Array(size);for(const row of fixtures.fixtures.filter(f=>f.phase==='default')){const p=Buffer.from(row.request,'hex'),r=Buffer.from(row.response,'hex');if(p[1]===command&&p[2]===0)out.set(r.subarray(8,8+r[4]),r[5]|r[6]<<8);}return out;}
const initial=region(0xd1,160),keyStatus=region(0xd0,208);
class Device extends EventTarget{
  constructor(){super();this.vendorId=0x19f5;this.productId=0xfb4c;this.productName='H3K06';this.sent=[];this.status=new Uint8Array(initial);this.collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];}
  async open(){this.opened=true;}async close(){this.opened=false;}
  emit(b){const e=new Event('inputreport');e.reportId=0;e.data=new DataView(b.buffer);this.dispatchEvent(e);}
  async sendReport(id,p){
    assert.equal(id,0);this.sent.push(new Uint8Array(p));assert.equal(p[3],p.slice(4,8+p[4]).reduce((a,b)=>(a+b)&255,0));
    const r=new Uint8Array(64);r.set([0xaa,p[1],0,0,0,0,0,0]);const op=p[2],n=p[4],off=p[5]|p[6]<<8;
    if(op===0){r.set([n,p[5],p[6]],4);r.set((p[1]===0xd1?this.status:keyStatus).slice(off,off+n),8);}
    else{assert.equal(p[1],0xd1);if(op===1)this.status.set(p.slice(8,20),16);
      else if(op===2){for(let i=8;i<8+n;i+=4)for(let k=0;k<36;k++)if(p[i]===k||p[i]===255)this.status.set(p.slice(i+1,i+4),28+k*3);}
      else if(op===3)this.identified=p[8];
      else if(op===4){this.status[17]=0;this.status[21]=0;}
      else if(op===5)this.status[5]=0;
      else if(op===6)this.status.set(initial.slice(16,144),16);
      decodeLighting(this.status.slice(16,144));
    }
    r[3]=r.slice(4,8+r[4]).reduce((a,b)=>(a+b)&255,0);
    const wrong=new Uint8Array(64);wrong.set([0xaa,p[1]===0xd1?0xd0:0xd1]);this.emit(wrong);
    if(this.badSignature&&p[1]===0xd1&&op===0){r[8]=0;r[3]=r.slice(4,8+r[4]).reduce((a,b)=>(a+b)&255,0);}
    this.emit(r);
  }
}
async function connect(){const d=new Device(),t=new HIDTransport(d);await t.open();const foundation=new FoundationClient(t);return{d,t,foundation,client:new LightingClient(foundation)};}
test('v0.6 compiled RGB fixtures, identity and owner physical order agree with browser codec',async()=>{
  assert.equal(fixtures.sha256,manifest.sha256);const info=await inspectImage(new Uint8Array(readFileSync(new URL(manifest.name,base))),webcrypto);
  assert.equal(info.sha256,manifest.sha256);assert.equal(info.diagnosticProduct,'H3K06');assert.equal(info.identities[0].release,0x0600);assert.equal(info.experimental,true);
  assert.deepEqual(LED_TO_KEY.map(i=>KEY_NAMES[i]),LED_ORDER);assert.equal(new Set(LED_TO_KEY).size,36);
  const s=decodeLightingStatus(initial);assert.equal(s.config.barCount,5);assert.equal(s.config.barEnabled,true);assert.deepEqual(s.config.color,[16,16,16]);assert.equal(s.config.mode,1);
  assert.deepEqual(encodeLighting(decodeLighting(initial.slice(16,144))),initial.slice(16,144));
});
test('RGB and keyboard transactions serialize on one queue; apply sends bounded batches and reads back',async()=>{
  const {d,t,foundation,client}=await connect();const [k,l]=await Promise.all([foundation.readStatus(),client.readStatus()]);assert.equal(k.signature,'H3K1');assert.equal(l.signature,'H3L1');assert.ok(d.sent.every(p=>p[2]===0));
  const draft=structuredClone(l.config);draft.mode=2;draft.barEnabled=true;draft.palette[32]=[12,3,1];
  const result=await client.apply(draft);assert.deepEqual(result.config,draft);assert.deepEqual(d.sent.filter(p=>p[2]===2).map(p=>p[4]),[56,56,32]);
  await client.identify(32);assert.equal(d.identified,32);assert.equal(d.sent.at(-1)[4],1);assert.equal(d.sent.at(-1)[8],32);await client.control(4);assert.equal(d.status[17],0);assert.equal(d.status[21],0);await t.close();
});
test('RGB invalid drafts, profiles and failed attestation cannot write hardware',async()=>{
  const {d,t,client}=await connect();const config=decodeLighting(initial.slice(16,144));
  for(const mutate of [v=>v.palette[0]=[33,0,0],v=>v.barCount=65,v=>v.mode=4,v=>v.barEnabled='yes',v=>v.order=2]){const v=structuredClone(config);mutate(v);assert.throws(()=>client.apply(v));}assert.equal(d.sent.length,0);
  assert.deepEqual(importLighting(exportLighting(config)),config);assert.equal(d.sent.length,0);assert.throws(()=>importLighting({format:'stock'}));
  d.badSignature=true;await assert.rejects(client.identify(0),/signature/);assert.ok(d.sent.every(p=>p[2]===0));
  d.productName='H3K05';assert.throws(()=>new LightingClient(new FoundationClient(t)),/v0.6/);await t.close();
});
test('RGB page connect is read-only, selected-key edits stay drafts and explicit Apply/identify work',async()=>{
  class Element extends EventTarget{constructor(){super();this.value='';this.checked=false;this.disabled=false;this.files=[];this.textContent='';this.classList={toggle(){}};}}
  const old=globalThis.document,nodes=new Map();globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
  const {d,t,foundation}=await connect();let selected=32;
  try{
    const ui=createLightingUI({runAction:async fn=>fn(),getSelected:()=>selected,keyNames:KEY_NAMES,onDirty(){}});await ui.reset(foundation);ui.controls(true);
    assert.ok(d.sent.every(p=>p[2]===0));assert.equal(nodes.get('barCount').value,'5');assert.ok(nodes.get('lightSelected').textContent.includes('A · serial LED25'));
    nodes.get('lightMode').value='2';nodes.get('keyColor').value='#ff0000';nodes.get('keyLevel').value='12';nodes.get('keyColor').dispatchEvent(new Event('input'));assert.equal(ui.dirty,true);assert.ok(d.sent.every(p=>p[2]===0));
    await nodes.get('lightApply').onclick();assert.equal(ui.dirty,false);assert.deepEqual(Array.from(d.status.slice(28+32*3,31+32*3)),[12,0,0]);
    await nodes.get('lightIdentify').onclick();assert.equal(d.identified,32);selected=23;ui.select();assert.ok(nodes.get('lightSelected').textContent.includes('Esc · serial LED1'));
    const before=d.sent.length;nodes.get('lightImport').files=[{size:100,text:async()=>JSON.stringify(exportLighting(decodeLighting(initial.slice(16,144))))}];await nodes.get('lightImport').onchange();assert.equal(d.sent.length,before);assert.equal(ui.dirty,true);
  }finally{globalThis.document=old;await t.close();}
});
