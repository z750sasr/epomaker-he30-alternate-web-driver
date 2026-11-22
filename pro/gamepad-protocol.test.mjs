import assert from 'node:assert/strict';
import test from 'node:test';
import {HIDTransport} from '../flasher/protocol.mjs';
import {crc32} from '../flasher/keyboard-protocol.mjs';
import {ProDevice} from './protocol.mjs';
import {GAMEPAD_BYTES,defaultGamepad,encodeGamepad,assignGamepad} from './gamepad.mjs';

class ControllerDevice extends EventTarget {
  vendorId=0x19f5;
  productId=0xfb4c;
  productName='H3K11';
  collections=[{usagePage:1,usage:0,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  sent=[];
  config=encodeGamepad(defaultGamepad());
  staged=new Uint8Array(GAMEPAD_BYTES);
  coverage=new Set();
  attached=true;
  corrupt=false;
  async open(){this.opened=true;}
  async close(){this.opened=false;}
  async sendReport(id,bytes){
    assert.equal(id,0);
    assert.equal(bytes[1],0xd3);
    assert.equal(bytes[3],bytes.slice(4,8+bytes[4]).reduce((sum,value)=>(sum+value)&255,0));
    this.sent.push(new Uint8Array(bytes));
    const op=bytes[2],offset=bytes[5]|bytes[6]<<8,length=bytes[4];
    const reply=new Uint8Array(64);
    reply.set([0xaa,0xd3]);
    let payload=new Uint8Array();
    if(op===0){
      const status=new Uint8Array(40);
      status.set([0x48,0x33,0x47,0x31,1,Number(this.attached),Number(this.attached),this.config[1],0x24,1,36,24,1]);
      status[17]=20;
      new DataView(status.buffer).setUint32(36,crc32(this.config),true);
      payload=status.slice(offset,offset+length);
    }else if(op===1){
      payload=this.config.slice(offset,offset+length);
      if(this.corrupt&&offset===0)payload[1]=2;
    }else if(op===2){
      if(!offset)this.coverage.clear();
      this.staged.set(bytes.slice(8,8+length),offset);
      for(let index=offset;index<offset+length;index++)this.coverage.add(index);
    }else if(op===3){
      assert.equal(this.coverage.size,GAMEPAD_BYTES);
      assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(8,true),crc32(this.staged));
      this.config=new Uint8Array(this.staged);
    }else if(op===4){
      assert.equal(length,1);
      this.attached=!!bytes[8];
    }else assert.fail('Unexpected controller operation');
    if(op<=1){reply[4]=payload.length;reply[5]=offset&255;reply[6]=offset>>>8;reply.set(payload,8);}
    reply[3]=reply.slice(4,8+reply[4]).reduce((sum,value)=>(sum+value)&255,0);
    const event=new Event('inputreport');
    event.reportId=0;event.data=new DataView(reply.buffer);
    this.dispatchEvent(event);
  }
}

async function connect(){
  const device=new ControllerDevice();
  const transport=new HIDTransport(device);
  await transport.open();
  return {device,transport,pro:new ProDevice(transport)};
}

test('controller upload freezes a complete settings image and verifies its readback',async()=>{
  const {device,transport,pro}=await connect();
  let release;
  const gate=pro.foundation.transaction(()=>new Promise(resolve=>{release=resolve;}));
  await Promise.resolve();
  const config=assignGamepad(defaultGamepad(),15,2);
  config.mode=1;
  const expected=structuredClone(config);
  const pending=pro.applyGamepad(config);
  config.mode=2;
  config.analog[2].key=32;
  release();await gate;
  assert.deepEqual(await pending,expected);
  assert.deepEqual(device.sent.filter(packet=>packet[2]===2).map(packet=>[packet[5]|packet[6]<<8,packet[4]]),
    [[0,56],[56,56],[112,56],[168,56],[224,56],[280,12]]);
  assert.equal(device.sent.filter(packet=>packet[2]===3).length,1);
  const state=await pro.gamepadStatus();
  assert.equal(state.mode,1);
  assert.equal(state.usbAttached,true);
  assert.equal(state.crc,crc32(encodeGamepad(expected)));
  assert.equal(state.report.length,20);
  await transport.close();
});

test('a valid but differing readback rejects the controller upload',async()=>{
  const {device,transport,pro}=await connect();
  device.corrupt=true;
  await assert.rejects(pro.applyGamepad(defaultGamepad()),/did not match/);
  await transport.close();
});

test('USB visibility writes a bounded toggle and earlier firmware receives no new commands',async()=>{
  const {device,transport,pro}=await connect();
  await pro.gamepadUSB(false);
  assert.equal(device.sent.length,1);
  assert.equal(device.sent[0][2],4);
  assert.equal(device.sent[0][4],1);
  assert.equal(device.sent[0][8],0);
  assert.equal((await pro.gamepadStatus()).usbAttached,false);
  assert.throws(()=>pro.gamepadUSB(1),/enabled/);
  await transport.close();
  for(const productName of ['H3K09','H3K10']){
    const legacy=new ProDevice({device:{vendorId:0x19f5,productId:0xfb4c,productName}});
    assert.equal(legacy.supportsGamepad,false);
    assert.throws(()=>legacy.readGamepad(),/v0.11/);
    assert.throws(()=>legacy.applyGamepad(defaultGamepad()),/v0.11/);
    assert.throws(()=>legacy.gamepadUSB(true),/v0.11/);
  }
});
