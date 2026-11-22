import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG_BYTES,STATUS_BYTES,KEY_NAMES,crc32,encodeConfig,decodeConfig,decodeStatus,encodeRequest,FoundationClient,KeyboardProtocolError,parseUsage,usageLabel,exportProfile,importProfile} from './keyboard-protocol.mjs';

function configuration(){
  return{version:1,groupOutputs:[2,0,1],settleLoops:16000,bankVerified:true,startupTyping:false,calibrated:Array(36).fill(false),released:Array(36).fill(1000),pressed:Array(36).fill(1000),keys:KEY_NAMES.map((_,i)=>({actuation:500,hysteresis:50,rtPress:20,rtRelease:20,normalUsage:4+i,fnUsage:0xfe,rapidTrigger:false,disabled:false,topDeadzone:0,bottomDeadzone:0}))};
}
function statusBytes(){
  const bytes=new Uint8Array(STATUS_BYTES),view=new DataView(bytes.buffer);bytes.set([0x48,0x33,0x4b,0x31,1,0,0,0]);view.setUint32(8,54321,true);view.setUint32(12,6,true);view.setUint32(16,0x80000001,true);view.setUint32(20,9,true);bytes.set([2,0,1,1,1,0,1,1],24);
  view.setUint16(32,1543,true);view.setUint16(102,4000,true);view.setUint16(104,500,true);view.setUint16(174,999,true);view.setUint32(180,8,true);bytes[184]=1;bytes[186]=32;view.setUint32(188,1234,true);bytes.set([2,0,4,5,0,0,0,0],192);bytes[200]=32;bytes[201]=36;bytes[202]=1;view.setUint32(204,0x12345678,true);return bytes;
}
class DeviceTransport {
  constructor(){this.device={vendorId:0x19f5,productId:0xfb4c,productName:'H3K05'};this.config=encodeConfig(configuration());this.status=statusBytes();this.requests=[];this.active=0;this.maxActive=0;this.failOperation=-1;}
  async request(packet,options){
    this.active++;this.maxActive=Math.max(this.maxActive,this.active);
    try{
      assert.equal(packet.length,64);assert.deepEqual(Array.from(packet.slice(0,2)),[0x55,0xd0]);assert.equal(packet[7],0);assert.equal(options.kind,'keyboard');
      const operation=packet[2],length=packet[4],offset=packet[5]|packet[6]<<8;assert.equal(packet[3],packet.slice(4,8+length).reduce((n,b)=>(n+b)&255,0));
      this.requests.push({operation,length,offset,packet:new Uint8Array(packet),options});await new Promise(resolve=>setImmediate(resolve));
      const response=new Uint8Array(64);response.set([0xaa,0xd0,0,0,0,0,0,0]);
      if(operation===this.failOperation)response[2]=7;
      else if(operation<=1){const source=operation?this.config:this.status;response.set([length,offset&255,offset>>>8],4);response.set(source.slice(offset,offset+length),8);}
      else if(operation===2){if(offset===0){this.staged=new Uint8Array(CONFIG_BYTES);this.coverage=Array(CONFIG_BYTES).fill(false);}assert.ok(this.staged);this.staged.set(packet.slice(8,8+length),offset);this.coverage.fill(true,offset,offset+length);}
      else if(operation===3){assert.ok(this.coverage.every(Boolean));assert.equal(new DataView(packet.buffer,packet.byteOffset+8,4).getUint32(0,true),crc32(this.staged));decodeConfig(this.staged);this.config=new Uint8Array(this.staged);}
      response[3]=response.slice(4,8+response[4]).reduce((n,b)=>(n+b)&255,0);
      if(this.badChecksum)response[3]^=1;
      return response;
    }finally{this.active--;}
  }
}
test('foundation configuration has exact endian layout, masks and full round trip',()=>{
  const cfg=configuration();cfg.calibrated[0]=cfg.calibrated[35]=true;cfg.pressed[0]=1500;cfg.released[35]=3500;cfg.pressed[35]=2000;cfg.keys[0].rapidTrigger=true;cfg.keys[35].disabled=true;cfg.keys[35].normalUsage=0xe1;
  const bytes=encodeConfig(cfg),view=new DataView(bytes.buffer);assert.equal(bytes.length,664);assert.deepEqual(Array.from(bytes.slice(0,4)),[1,2,0,1]);assert.equal(view.getUint16(4,true),16000);assert.equal(view.getUint32(8,true),1);assert.equal(view.getUint32(12,true),8);
  assert.equal(view.getUint16(16+35*2,true),3500);assert.equal(view.getUint16(88,true),1500);assert.equal(bytes[160+35*14+8],0xe1);assert.equal(bytes[160+35*14+10],2);assert.equal(bytes[170],1);assert.equal(bytes[663],0);assert.deepEqual(decodeConfig(bytes),cfg);
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
test('foundation configuration rejects bad routing, ranges, flags and reserved data',()=>{
  for(const mutate of [c=>c.groupOutputs=[0,0,1],c=>c.settleLoops=99,c=>c.keys[0].actuation=1000,c=>c.keys[0].rtPress=4,c=>c.keys[0].topDeadzone=41,c=>c.keys[0].normalUsage=0xfe,c=>c.keys[0].fnUsage=3,c=>c.calibrated[0]=true,c=>c.released[0]=65535,c=>c.startupTyping='yes']){const c=configuration();mutate(c);assert.throws(()=>encodeConfig(c));}
  const bytes=encodeConfig(configuration());bytes[160+13]=1;assert.throws(()=>decodeConfig(bytes),/reserved/);bytes[173]=0;bytes[12]=0x80;assert.throws(()=>decodeConfig(bytes),/flag/);
  assert.equal(parseUsage('Left Shift'),0xe1);assert.equal(parseUsage('0x5F'),0x5f);assert.equal(parseUsage('transparent',true),0xfe);assert.equal(parseUsage('Fn'),0xff);assert.throws(()=>parseUsage('Transparent'));assert.equal(parseUsage(usageLabel(0x5f)),0x5f);
});
test('v0.20 profile keys and tenth-percent dead zones round-trip without writing to earlier firmware',async()=>{
  const config=configuration();
  Object.assign(config.keys[0],{normalUsage:0xf0,fnUsage:0xf3,rapidTrigger:true,topDeadzone:25.7,bottomDeadzone:39.9});
  Object.assign(config.keys[1],{topDeadzone:7,bottomDeadzone:12});
  const bytes=encodeConfig(config);
  assert.deepEqual([...bytes.slice(168,173)],[0xf0,0xf3,29,1,143]);
  assert.deepEqual([...bytes.slice(184,187)],[0,7,12]);
  assert.deepEqual(decodeConfig(bytes),config);
  const transport=new DeviceTransport();
  transport.device.productName='H3K19';
  const client=new FoundationClient(transport);
  await assert.rejects(client.applyConfig(config),/require HE30 Pro v0.20/);
  assert.equal(transport.requests.length,0);
  transport.device.productName='H3K20';
  assert.deepEqual(await client.applyConfig(config),config);
  transport.device.productName='H3K21';
  assert.deepEqual(await client.applyConfig(config),config);
});
test('foundation status decodes all36 raw/position slots and mask high bits',()=>{
  const decoded=decodeStatus(statusBytes());assert.equal(decoded.signature,'H3K1');assert.equal(decoded.frames,54321);assert.equal(decoded.savedSequence,6);assert.deepEqual(decoded.groupOutputs,[2,0,1]);assert.equal(decoded.raw[0],1543);assert.equal(decoded.raw[35],4000);assert.equal(decoded.positions[35],999);assert.deepEqual(decoded.calibrated.map((v,i)=>v?i:-1).filter(v=>v>=0),[0,31,32,35]);assert.equal(decoded.pressed[35],true);assert.equal(decoded.releaseInterlock,true);assert.equal(decoded.acceptedReports,1234);assert.equal(decoded.configCRC,0x12345678);
  const wrong=statusBytes();wrong[0]=0;assert.throws(()=>decodeStatus(wrong),/H3K1/);wrong[0]=0x48;wrong[201]=35;assert.throws(()=>decodeStatus(wrong));
  const protocol=statusBytes();
  protocol[185]=1;
  assert.equal(decodeStatus(protocol).rollover,true);
  assert.equal(decodeStatus(protocol).nkro,false);
  protocol[185]=2;
  assert.equal(decodeStatus(protocol).nkro,true);
  assert.equal(decodeStatus(protocol).rollover,false);
});
test('live travel reads positions and pressed keys in two reports and preserves device serialization',async()=>{
  const transport=new DeviceTransport(),client=new FoundationClient(transport);
  const [sample,status]=await Promise.all([client.readTravel(),client.readStatus()]);
  assert.deepEqual(sample.positions,status.positions);
  assert.deepEqual(sample.pressed,status.pressed);
  assert.deepEqual(transport.requests.slice(0,2).map(request=>[request.operation,request.offset,request.length]),[
    [0,104,56],[0,160,24]
  ]);
  assert.equal(transport.maxActive,1);
});
test('foundation request bounds, checksum and zero control payloads are exact',()=>{
  const packet=encodeRequest(2,{length:3,offset:512,data:Uint8Array.of(1,2,3)});assert.deepEqual(Array.from(packet.slice(0,11)),[0x55,0xd0,2,11,3,0,2,0,1,2,3]);assert.ok(packet.slice(11).every(n=>n===0));
  for(const args of [[0,{length:56,offset:200}],[1,{length:57}],[2,{length:1,data:new Uint8Array()}],[3,{length:0}],[8,{length:1}],[13]])assert.throws(()=>encodeRequest(...args));
});
test('foundation client stages all bytes, commits CRC, reads back and serializes whole operations',async()=>{
  const transport=new DeviceTransport(),client=new FoundationClient(transport),cfg=configuration();cfg.keys[35].actuation=640;
  const [status,applied,readback]=await Promise.all([client.readStatus(),client.applyConfig(cfg),client.readConfig()]);
  assert.equal(status.keyCount,36);assert.deepEqual(applied,cfg);assert.deepEqual(readback,cfg);assert.equal(transport.maxActive,1);
  const writes=transport.requests.filter(r=>r.operation===2);assert.equal(writes.length,12);assert.deepEqual(writes.map(r=>r.offset),Array.from({length:12},(_,i)=>i*56));assert.equal(writes.at(-1).length,48);
  const firstWrite=transport.requests.findIndex(r=>r.operation===2),commit=transport.requests.findIndex(r=>r.operation===3);assert.equal(commit-firstWrite,12);assert.ok(transport.requests.slice(firstWrite,commit).every(r=>r.operation===2));
  await client.control(8);assert.equal(transport.requests.at(-1).options.timeout,8000);
  assert.equal(transport.requests.at(-2).operation,0,'Every control begins with attestation');
});
test('foundation controls cannot touch stock firmware or pass failed attestation/acks',async()=>{
  const wrong=new DeviceTransport();wrong.device.productName='H3M04';assert.throws(()=>new FoundationClient(wrong),/supported foundation firmware/);assert.equal(wrong.requests.length,0);
  const transport=new DeviceTransport(),client=new FoundationClient(transport);transport.status[0]=0;await assert.rejects(client.control(6),/signature/);assert.deepEqual(transport.requests.map(r=>r.operation),[0]);
  transport.status=statusBytes();transport.failOperation=4;await assert.rejects(client.control(4),error=>error instanceof KeyboardProtocolError&&error.code===7);assert.equal(transport.requests.at(-1).operation,4);
  transport.failOperation=-1;transport.badChecksum=true;await assert.rejects(client.readStatus(),/checksum/);
  assert.throws(()=>client.control(3),/Control operation/);
});
test('foundation JSON profiles are versioned, validated drafts with no IO',()=>{
  const cfg=configuration(),profile=exportProfile(cfg);assert.equal(profile.format,'he30-foundation-profile-v1');assert.deepEqual(importProfile(JSON.parse(JSON.stringify(profile))),cfg);
  assert.throws(()=>importProfile({...profile,product:'HE30'}),/profile/);const malformed=JSON.parse(JSON.stringify(profile));malformed.config.keys[0].actuation=0;assert.throws(()=>importProfile(malformed),/actuation/);
});

test('browser connect only reads; invalid edits and profile import cannot write settings',async()=>{
  const html=await readFile(new URL('./keyboard.html',import.meta.url),'utf8');
  class Element {
    constructor(){this.value='';this.checked=false;this.disabled=false;this.children=[];this.files=[];this.listeners={};this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}
    addEventListener(name,callback){this.listeners[name]=callback;}
    click(){return this.onclick?.();}
  }
  const elements=new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g),match=>[match[1],new Element()]));
  const firmware=new DeviceTransport(),listeners=new Map(),windowEvents=new Map();
  const device={...firmware.device,opened:false,collections:[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}],
    async open(){this.opened=true;},async close(){this.opened=false;},
    addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name){listeners.delete(name);},
    async sendReport(reportId,packet){const response=await firmware.request(packet,{kind:'keyboard'});listeners.get('inputreport')?.({reportId,data:new DataView(response.buffer)});}
  };
  const originals=new Map(['document','navigator','window','setTimeout'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalTimeout=globalThis.setTimeout;
  try{
    Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>{assert.ok(elements.has(id),`Missing HTML element ${id}`);return elements.get(id);},createElement:()=>new Element()}});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid:{async requestDevice(){return[device];},addEventListener(){}}}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true,addEventListener:(name,callback)=>windowEvents.set(name,callback)}});
    // Keep USB acknowledgement timeouts real; suppress only background polling.
    Object.defineProperty(globalThis,'setTimeout',{configurable:true,value:(callback,delay,...args)=>delay===150?undefined:originalTimeout(callback,delay,...args)});
    await import(`./keyboard.mjs?test=${Date.now()}`);
    const get=id=>elements.get(id);
    await get('connect').click();
    assert.ok(firmware.requests.length>0);assert.ok(firmware.requests.every(r=>r.operation<=1),'Connect must not write, calibrate, enable or save');
    assert.equal(get('keys').children.length,36);assert.equal(get('verified').checked,true);assert.equal(get('startup').checked,false);
    assert.equal(get('calibrate').disabled,false);assert.equal(get('enable').disabled,true);
    const reads=firmware.requests.length;
    get('normal').value='not a binding';get('normal').listeners.input();await get('applyKeys').click();
    assert.equal(firmware.requests.length,reads,'Bad editor input must fail before even an attestation');assert.match(get('message').textContent,/Invalid normal\/Fn/);
    get('normal').value='Left Shift';get('actuation').value='36.7';await get('applyKeys').click();
    assert.equal(decodeConfig(firmware.config).keys[0].normalUsage,0xe1);assert.equal(decodeConfig(firmware.config).keys[0].actuation,367);
    assert.equal(firmware.requests.filter(r=>r.operation===3).length,1);assert.ok(!firmware.requests.some(r=>[4,6,8].includes(r.operation)));
    const beforeImport=firmware.requests.length,profile=exportProfile(configuration());profile.config.keys[0].normalUsage=0x04;
    get('import').files=[{size:1000,async text(){return JSON.stringify(profile);}}];await get('import').onchange();
    assert.equal(firmware.requests.length,beforeImport,'Import is a page draft only');assert.equal(get('normal').value,'A');assert.equal(get('calibrate').disabled,true);assert.equal(get('save').disabled,true);
    const staged=new Uint8Array(firmware.config);profile.config.keys[0].actuation=0;
    get('import').files=[{size:1000,async text(){return JSON.stringify(profile);}}];await get('import').onchange();
    assert.deepEqual(firmware.config,staged);assert.equal(firmware.requests.length,beforeImport);assert.match(get('message').textContent,/actuation/);
    windowEvents.get('pagehide')();
  }finally{
    windowEvents.get('pagehide')?.();
    for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  }
});
