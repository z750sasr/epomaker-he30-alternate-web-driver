import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {HIDTransport,inspectImage,readHardwareSnapshot,runHardwareTest} from './protocol.mjs';
const base=new URL('../firmware/custom/he30-v0.4/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const fixtures=JSON.parse(readFileSync(new URL('protocol-fixtures.json',base),'utf8'));
export class HardwareDevice extends EventTarget {
  constructor(){super();this.vendorId=0x19f5;this.productId=0xfb4c;this.productName='H3M04';this.phase='boot';this.sent=[];this.collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];}
  async open(){this.opened=true;}async close(){this.opened=false;}
  async sendReport(id,data){
    assert.equal(id,0);this.sent.push(new Uint8Array(data));
    if(data[1]===0xdd)this.phase=data[12]===1?'passive':data[12]===2?'banked':data[12]===3?'rgb':'off';
    const row=fixtures.fixtures.find(f=>f.phase===this.phase&&f.request===Buffer.from(data).toString('hex'));
    assert.ok(row,`Request absent from executed firmware fixtures: ${Buffer.from(data).subarray(0,20).toString('hex')}`);
    const response=Uint8Array.from(Buffer.from(row.response,'hex'));
    if(this.phase==='banked'&&data[1]===0xdb&&Number.isInteger(this.pressedSlot)){
      const absolute=80+this.pressedSlot*2,offset=data[5],length=data[4];
      if(absolute>=offset&&absolute+2<=offset+length){const i=8+absolute-offset,value=(response[i]|response[i+1]<<8)+200;response[i]=value&255;response[i+1]=value>>8;}
    }
    if(this.actionError&&(!this.errorPhase||this.errorPhase===this.phase)){
      if(data[1]===0xdd){response[2]=this.actionError;response[15]=this.actionError;}
      if(data[1]===0xdb&&data[5]===56)response[23]=this.actionError;
    }
    response[3]=response.slice(4,8+response[4]).reduce((n,b)=>(n+b)&255,0);
    if(this.badSignature&&data[1]===0xdb&&data[5]===64){response[8]=0;response[3]=response.slice(4,8+response[4]).reduce((n,b)=>(n+b)&255,0);}
    if(this.badChecksum)response[3]^=1;
    const event=new Event('inputreport');event.reportId=id;event.data=new DataView(response.buffer);this.dispatchEvent(event);
  }
}
test('v0.4 identity remains experimental and browser API decodes executed firmware fixtures',async()=>{
  const info=await inspectImage(new Uint8Array(readFileSync(new URL(manifest.name,base))),webcrypto);
  assert.equal(info.sha256,manifest.sha256);assert.equal(fixtures.sha256,manifest.sha256);
  assert.equal(info.diagnosticProduct,'H3M04');assert.equal(info.identities[0].release,0x0400);assert.equal(info.experimental,true);
  const d=new HardwareDevice(),t=new HIDTransport(d);await t.open();
  const initial=await readHardwareSnapshot(t);assert.equal(initial.mode,0);assert.equal(initial.signature,'H3M1');assert.ok(d.sent.every(b=>b[1]===0xdb));
  assert.equal((await runHardwareTest(t,1)).error,0);const passive=await readHardwareSnapshot(t);
  assert.equal(passive.mode,1);assert.equal(passive.adcFrames,1);assert.equal(passive.values.filter(n=>n!==65535).length,12);
  assert.equal((await runHardwareTest(t,2)).error,0);const banked=await readHardwareSnapshot(t);
  assert.equal(banked.mode,2);assert.equal(banked.adcFrames,2);assert.equal(banked.values.filter(n=>n!==65535).length,36);assert.equal(banked.values[12]-banked.values[0],500);
  assert.equal((await runHardwareTest(t,3,{path:1,index:255,r:12})).error,0);assert.equal((await readHardwareSnapshot(t)).rgbFrames,1);
  assert.equal((await runHardwareTest(t,4,{path:1,index:255})).error,0);assert.equal((await readHardwareSnapshot(t)).rgbFrames,2);
  const writes=d.sent.filter(b=>b[1]===0xdd);assert.equal(writes.length,4);
  assert.ok(writes.every(b=>Buffer.from(b.subarray(8,12)).toString()==='TEST'));await t.close();
});
test('hardware API rejects bad parameters before IO and wrong signatures before control',async()=>{
  const d=new HardwareDevice(),t=new HIDTransport(d);await t.open();
  for(const args of [[0],[1,{path:1}],[3,{path:0}],[3,{path:1,index:64}],[3,{path:1,r:17}],[3,{path:1,rate:2}]])await assert.rejects(runHardwareTest(t,...args));
  assert.equal(d.sent.length,0);
  d.badSignature=true;await assert.rejects(runHardwareTest(t,2),/signature/);assert.equal(d.sent.length,1);assert.equal(d.sent[0][1],0xdb);
  d.badSignature=false;d.badChecksum=true;await assert.rejects(readHardwareSnapshot(t),/checksum/);await t.close();
  for(const product of ['HE30','H3D02','H3B03']){
    const d=new HardwareDevice();d.productName=product;const t=new HIDTransport(d);await t.open();
    await assert.rejects(runHardwareTest(t,2),/H3M04/);assert.equal(d.sent.length,0);await t.close();
  }
});

test('hardware page automatically captures, guides press/release mapping, saves and restores results',async()=>{
  class Element {
    constructor(){this.textContent='';this.disabled=false;this.checked=false;this.value='';this.children=[];this.classList={toggle(){}};}
    append(...items){this.children.push(...items);}click(){this.onclick?.();}
  }
  const nodes=new Map();const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();}};
  const hid=new EventTarget(),device=new HardwareDevice();hid.requestDevice=async()=>[device];
  const saved={document:globalThis.document,window:globalThis.window,localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const stored=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}});
  const until=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Automatic UI did not reach expected state');};
  let exported;
  globalThis.document=document;globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
  URL.createObjectURL=blob=>{exported=blob;return'blob:test';};URL.revokeObjectURL=()=>{};
  try{
    await import(`./hardware.mjs?ui=${Date.now()}`);
    for(const [id,value] of Object.entries({physical:'Esc',path:'1',pixel:'0',rate:'0',order:'GRB'}))document.getElementById(id).value=value;
    document.getElementById('all').checked=true;
    assert.equal(nodes.get('physical').children.length,36);
    await nodes.get('connect').onclick();
    await until(()=>nodes.get('guide').textContent.includes('Press and hold Esc'));
    assert.equal(JSON.parse(nodes.get('details').textContent).mode,2);
    assert.equal(device.sent.filter(b=>b[1]===0xdd)[0][12],1,'Passive capture comes first');
    assert.ok(device.sent.filter(b=>b[1]===0xdd).slice(1).every(b=>b[12]===2));
    device.pressedSlot=3;
    await until(()=>nodes.get('guide').textContent.includes('Release Esc completely'));
    device.pressedSlot=null;
    await until(()=>nodes.get('mapping')?.textContent.includes('Esc → #3'));
    assert.equal(nodes.get('physical').value,'1');
    device.pressedSlot=4;
    await until(()=>nodes.get('guide').textContent.includes('Release 1 completely'));
    device.pressedSlot=null;
    await until(()=>nodes.get('mapping')?.textContent.includes('1 → #4'));
    await nodes.get('stop').onclick();
    nodes.get('physical').value='Esc';
    const before=device.sent.length;nodes.get('samples').children[14].onclick();nodes.get('assign').onclick();
    assert.match(nodes.get('mapping').textContent,/Esc → #14/);assert.equal(device.sent.length,before,'Annotating a mapping sends nothing');
    await nodes.get('red').onclick();assert.match(nodes.get('status').textContent,/frame sent/);
    document.getElementById('observation').value='Esc key lit red';nodes.get('record').onclick();nodes.get('save').onclick();
    const report=JSON.parse(await exported.text());assert.equal(report.physicalMapping.Esc,14);assert.equal(report.rgbObservations[0].note,'Esc key lit red');
    const actions=device.sent.filter(b=>b[1]===0xdd).map(b=>b[12]);assert.equal(actions[0],1);assert.ok(actions.slice(1,-1).every(a=>a===2));assert.equal(actions.at(-1),3);
    assert.ok(device.sent.every(b=>b[0]===0x55&&[0xdb,0xdd].includes(b[1])));
    assert.equal(JSON.parse(stored.get('he30-v04-hardware-results')).physicalMapping.Esc,14);
    const count=device.sent.length;globalThis.window.dispatchEvent(new Event('pagehide'));nodes.clear();globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});
    await import(`./hardware.mjs?restore=${Date.now()}`);
    assert.match(nodes.get('mapping').textContent,/Esc → #14/);assert.match(nodes.get('autosave').textContent,/restored/);assert.equal(nodes.get('save').disabled,false);
    assert.equal(device.sent.length,count,'Reload restores notes without starting device tests');
    device.actionError=2;device.errorPhase='passive';
    const beforeFailure=device.sent.filter(b=>b[1]===0xdd).length;await nodes.get('connect').onclick();
    assert.match(nodes.get('status').textContent,/Automatic tests stopped/);
    await new Promise(r=>setTimeout(r,180));
    assert.deepEqual(device.sent.filter(b=>b[1]===0xdd).slice(beforeFailure).map(b=>b[12]),[1],'Passive failure prevents banked startup and retries');
    device.errorPhase='banked';const beforeBankFailure=device.sent.filter(b=>b[1]===0xdd).length;
    await nodes.get('connect').onclick();await until(()=>nodes.get('status').textContent.includes('Automatic tests stopped'));
    await new Promise(r=>setTimeout(r,180));
    assert.deepEqual(device.sent.filter(b=>b[1]===0xdd).slice(beforeBankFailure).map(b=>b[12]),[1,2],'Banked failure stops without automatic retries');
    device.actionError=0;await nodes.get('connect').onclick();
    await until(()=>device.phase==='banked');
    const disconnected=new Event('disconnect');disconnected.device=device;hid.dispatchEvent(disconnected);
    const beforeDisconnect=device.sent.filter(b=>b[1]===0xdd).length;
    await new Promise(r=>setTimeout(r,180));
    assert.equal(device.sent.filter(b=>b[1]===0xdd).length,beforeDisconnect,'Disconnect ends automatic capture');
  }finally{
    await nodes.get('stop')?.onclick?.();globalThis.document=saved.document;globalThis.window=saved.window;if(saved.localStorage)Object.defineProperty(globalThis,'localStorage',saved.localStorage);else delete globalThis.localStorage;if(saved.navigator)Object.defineProperty(globalThis,'navigator',saved.navigator);else delete globalThis.navigator;
    URL.createObjectURL=saved.create;URL.revokeObjectURL=saved.revoke;
  }
});
