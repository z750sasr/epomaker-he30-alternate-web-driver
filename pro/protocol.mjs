import {FoundationClient,decodeConfig,encodeConfig,KEY_NAMES,parseUsage,usageLabel,crc32,isProfileUsage,isDesktopUsage,DESKTOP_KEYS_MODEL,DESKTOP_USAGES,PROFILE_KEY_MODEL,NKRO_MODEL,ADC_RGB_FIX_MODEL,CALIBRATION_QOL_MODEL,FN_RGB_PRODUCTS,supportsProfileKeys} from '../flasher/keyboard-protocol.mjs';
import {HIDTransport,connectionCandidates} from '../flasher/protocol.mjs';
import {LightingClient,decodeLighting,encodeLighting} from '../flasher/lighting-protocol.mjs';
import {GAMEPAD_BYTES,encodeGamepad,decodeGamepad} from './gamepad.mjs';

export const MODEL='H3K15';
export const SAVE_DIAGNOSTICS_MODEL='H3K16';
export const LIVE_SAVE_TEST_MODEL='H3K17';
export const ONBOARD_SAVE_TEST_MODEL='H3K18';
export const FLASH_RESIDENT_SAVE_MODEL='H3K19';
export const PRO_PRODUCTS=['H3K09','H3K10','H3K11','H3K12','H3K13','H3K14',MODEL,SAVE_DIAGNOSTICS_MODEL,LIVE_SAVE_TEST_MODEL,ONBOARD_SAVE_TEST_MODEL,FLASH_RESIDENT_SAVE_MODEL,PROFILE_KEY_MODEL,NKRO_MODEL,...FN_RGB_PRODUCTS];
export const RATES=[125,250,500,1000,2000,4000,8000];
export const ACTIONS=['Disabled','SOCD','Rappy Snappy','Dynamic Keystroke','Mod Tap','Toggle','Key Combination','Macro','Multi-Point Trigger','End Key'];
export const GAMEPAD=['Unassigned','Left stick left','Left stick right','Left stick up','Left stick down','Right stick left','Right stick right','Right stick up','Right stick down','Left trigger','Right trigger',...Array.from({length:16},(_,i)=>'Button '+(i+1))];
export const ZUOYA=[
  {name:'Gateron Magnetic Jade',brand:'Zuoya V115 fit',travel:4000,coefficient:13770},
  {name:'Gateron Magnetic White',brand:'Zuoya V115 fit',travel:4000,coefficient:13596},
  {name:'Hejin',brand:'Zuoya V115 fit',travel:3320,coefficient:18457},
  {name:'Factory selector 5',brand:'Zuoya V115 fit',travel:3700,coefficient:23461}
];
const decoder=new TextDecoder(),encoder=new TextEncoder();
const u16=(data,offset)=>new DataView(data.buffer,data.byteOffset,data.byteLength).getUint16(offset,true);
function profileIndex(data){
  if(decoder.decode(data.slice(0,4))!=='H3P1'||data[4]!==1||data[5]>3)
    throw new Error('H3P1 profile protocol is unavailable.');
  return data[5];
}
const uint=(value,max,min=0)=>{
  if(!Number.isInteger(value)||value<min||value>max)throw new Error('Enter a whole number from '+min+' to '+max+'.');
  return value;
};
export const pack16=(...values)=>Uint8Array.from(values.flatMap(value=>[value&255,value>>>8]));
export function actionBytes(action){
  const {kind,key,other,mode,usage,depth}=action;
  uint(kind,9);uint(key,35);uint(other,35);uint(mode,3);
  if(kind&&kind<=2&&key===other)throw new Error('Choose two different physical keys.');
  if(usage.length!==4||depth.length!==3)throw new Error('Invalid action fields.');
  for(const n of usage)if(n>=0xfd||!(n===0||n>=4&&n<=0xa4||n>=0xe0&&n<=0xe7))throw new Error('Choose ordinary keyboard outputs for actions.');
  depth.forEach(n=>uint(n,1000));
  if([3,8].includes(kind)&&(!depth[0]||depth[0]>=depth[1]))throw new Error('Depth 2 must be deeper than depth 1.');
  if(kind===8&&usage[2]&&depth[2]<=depth[1])throw new Error('Depth 3 must be deeper than depth 2.');
  return Uint8Array.of(kind,key,other,mode,...usage,...pack16(...depth));
}
export function decodeProfile(data){
  if(data.byteLength!==976)throw new Error('Profile length differs from the HE30 Pro format.');
  return {
    lighting:decodeLighting(data.slice(504,632)),
    fn2:[...data.slice(632,668)],gamepad:[...data.slice(668,704)],
    name:decoder.decode(data.slice(704,720)).replace(/\0.*$/s,''),
    travel:Array.from({length:36},(_,i)=>u16(data,720+2*i)),
    coefficient:Array.from({length:36},(_,i)=>u16(data,904+2*i)),
    actions:Array.from({length:8},(_,i)=>{
      const o=792+14*i;
      return {kind:data[o],key:data[o+1],other:data[o+2],mode:data[o+3],usage:[...data.slice(o+4,o+8)],depth:[u16(data,o+8),u16(data,o+10),u16(data,o+12)]};
    })
  };
}
function packet(command,op,offset,length,data){
  const out=new Uint8Array(64);
  out.set([0x55,command,op,0,length,offset&255,offset>>>8,0]);
  out.set(data,8);
  out[3]=out.slice(4,length+8).reduce((sum,x)=>(sum+x)&255,0);
  return out;
}
export class ProDevice{
  constructor(transport){
    if(!PRO_PRODUCTS.includes(transport.device.productName))throw new Error('Choose the Epomaker HE30 running HE30 Pro firmware.');
    this.transport=transport;
    this.foundation=new FoundationClient(transport);
    this.lighting=new LightingClient(this.foundation);
    this.supportsProfileKeys=supportsProfileKeys(transport.device.productName);
    this.supportsDesktopKeys=transport.device.productName===DESKTOP_KEYS_MODEL;
    this.supportsGamepad=['H3K11','H3K12','H3K13','H3K14',MODEL,SAVE_DIAGNOSTICS_MODEL,LIVE_SAVE_TEST_MODEL,ONBOARD_SAVE_TEST_MODEL,FLASH_RESIDENT_SAVE_MODEL,PROFILE_KEY_MODEL,NKRO_MODEL,...FN_RGB_PRODUCTS].includes(transport.device.productName);
  }
  static async connect(authorizedProduct){
    if(!navigator.hid)throw new Error('Open this page in desktop Chrome or Edge on localhost or HTTPS.');
    const devices=authorizedProduct?(await navigator.hid.getDevices()).filter(d=>d.productName===authorizedProduct):
      await navigator.hid.requestDevice({filters:[{vendorId:0x19f5,productId:0xfb4c,usagePage:1,usage:0}]});
    if(!devices.length)return null;
    const candidates=connectionCandidates(devices,{applicationOnly:true}).filter(device=>PRO_PRODUCTS.includes(device.productName));
    if(candidates.length!==1)throw new Error('Choose one HE30 Pro configuration interface.');
    const transport=new HIDTransport(candidates[0]);
    try{
      const device=new ProDevice(transport);
      await transport.open();
      return device;
    }catch(error){
      await transport.close().catch(()=>{});
      throw error;
    }
  }
  static async reconnect(previous,enabled,{timeout=6000}={}){
    const deadline=Date.now()+timeout;
    // Let the acknowledged USB configuration change detach before reopening.
    await new Promise(resolve=>setTimeout(resolve,400));
    while(Date.now()<deadline){
      const devices=connectionCandidates(await navigator.hid.getDevices(),{applicationOnly:true})
        .filter(device=>device.productName===previous.productName&&
          (!previous.serialNumber||device.serialNumber===previous.serialNumber));
      if(devices.length===1){
        const [device]=devices;
        const transport=new HIDTransport(device);
        try{
          const next=new ProDevice(transport);
          await transport.open();
          const state=await next.gamepadStatus();
          if(state.usbRequested===enabled&&state.usbAttached===enabled)return next;
        }catch{}
        await transport.close().catch(()=>{});
      }
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    return null;
  }
  async exchange(command,op,offset,length,data=new Uint8Array()){
    uint(length,56);uint(offset,65535);
    const read=!(data.length)||command===0xd1;
    const response=await this.transport.request(packet(command,op,offset,length,data),{kind:command===0xd2?'profiles':command===0xd3?'gamepad':'lighting'});
    if(response?.length!==64||response[0]!==0xaa||response[1]!==command||response[7]||response[4]>56||
       response[3]!==response.slice(4,8+response[4]).reduce((sum,x)=>(sum+x)&255,0)||response.slice(8+response[4]).some(Boolean))
      throw new Error('Invalid device reply.');
    if(response[2])throw new Error('Keyboard rejected the operation (code '+response[2]+').');
    if(response[4]!== (read?length:0)||u16(response,5)!==(read?offset:0))throw new Error('Device reply did not match.');
    return response.slice(8,8+response[4]);
  }
  async region(command,op,size){
    const result=new Uint8Array(size);
    for(let i=0;i<size;i+=56)result.set(await this.exchange(command,op,i,Math.min(56,size-i)),i);
    return result;
  }
  capabilities(){
    return this.foundation.transaction(async()=>{
      const data=await this.region(0xd2,0,this.supportsDesktopKeys?89:88);
      const active=profileIndex(data);
      if(data[6]>6||data[11]!==8)throw new Error('H3P1 profile protocol is unavailable.');
      const v=new DataView(data.buffer);
      return {active,rate:data[6],scanMode:data[7],gamepad:!!data[8],runningRate:6-data[9],
        gamepadAttached:!!data[10],scanHz:u16(data,12),runningScanner:data[14],scanTrial:data[15],scanTicks:v.getUint32(16,true),scanWorst:v.getUint32(20,true),
        keyBrightness:data[88],names:Array.from({length:4},(_,i)=>decoder.decode(data.slice(24+i*16,40+i*16)).replace(/\0.*$/s,''))};
    });
  }
  activeProfile(){return this.foundation.transaction(async()=>profileIndex(await this.exchange(0xd2,0,0,8)));}
  profile(){return this.foundation.transaction(async()=>decodeProfile(await this.region(0xd2,1,976)));}
  checkGamepad(){
    if(!this.supportsGamepad)throw new Error('Install HE30 Pro v0.11 for Xbox controller settings.');
  }
  gamepadStatus(){
    this.checkGamepad();
    return this.foundation.transaction(async()=>{
      const data=await this.region(0xd3,0,40);
      if(decoder.decode(data.slice(0,4))!=='H3G1'||data[4]!==1||data[5]>1||data[6]>1||data[7]>2||
         u16(data,8)!==GAMEPAD_BYTES||data[10]!==36||data[11]!==24||data[12]>1)
        throw new Error('H3G1 gamepad protocol is unavailable.');
      const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
      return {usbRequested:!!data[5],usbAttached:!!data[6],mode:data[7],armed:!!data[12],
        digitalMask:u16(data,14),report:data.slice(16,36),crc:view.getUint32(36,true)};
    });
  }
  readGamepad(){
    this.checkGamepad();
    return this.foundation.transaction(async()=>decodeGamepad(await this.region(0xd3,1,GAMEPAD_BYTES)));
  }
  applyGamepad(config){
    this.checkGamepad();
    const bytes=encodeGamepad(config),checksum=new Uint8Array(4);
    new DataView(checksum.buffer).setUint32(0,crc32(bytes),true);
    return this.foundation.transaction(async()=>{
      for(let offset=0;offset<bytes.length;offset+=56){
        const data=bytes.slice(offset,offset+56);
        await this.exchange(0xd3,2,offset,data.length,data);
      }
      await this.exchange(0xd3,3,0,4,checksum);
      const actual=await this.region(0xd3,1,GAMEPAD_BYTES);
      if(actual.some((value,index)=>value!==bytes[index]))throw new Error('Controller settings did not match the keyboard readback.');
      return decodeGamepad(actual);
    });
  }
  gamepadUSB(enabled){
    this.checkGamepad();
    if(typeof enabled!=='boolean')throw new Error('Choose whether the USB controller is enabled.');
    return this.foundation.transaction(()=>this.exchange(0xd3,4,0,1,Uint8Array.of(Number(enabled))));
  }
  liveRGB(){
    return this.foundation.transaction(async()=>{
      const frame=new Uint8Array(123);
      for(const [offset,length] of [[0,54],[54,54],[108,15]]){
        frame.set(await this.exchange(0xd1,8,offset,length),offset);
      }
      return frame;
    });
  }
  write(op,offset,data){return this.foundation.transaction(()=>this.exchange(0xd2,op,offset,data.length,data));}
  select(index){return this.write(2,0,Uint8Array.of(uint(index,3)));}
  scanTrial(index){
    if(!FN_RGB_PRODUCTS.includes(this.transport.device.productName))throw new Error('ADC experiments require HE30 Pro v0.22 or later.');
    return this.write(9,0,Uint8Array.of(uint(index,6)));
  }
  rename(text){
    if(!/^[ -~]{1,15}$/.test(text))throw new Error('Use 1–15 printable ASCII characters.');
    const out=new Uint8Array(16);out.set(encoder.encode(text));
    return this.write(3,0,out);
  }
  fn2(key,value){
    if(isProfileUsage(value)&&!this.supportsProfileKeys)throw new Error('Profile keys require HE30 Pro v0.20.');
    if(isDesktopUsage(value)&&!this.supportsDesktopKeys)throw new Error('This mapping requires HE30 Pro v0.25.');
    return this.write(4,uint(key,35),Uint8Array.of(value));
  }
  action(slot,action){return this.write(5,uint(slot,7),actionBytes(action));}
  switch(key,travel,coefficient){return this.write(6,uint(key,35),pack16(uint(travel,6000,500),uint(coefficient,65535)));}
  mapping(key,binding){return this.write(7,uint(key,35),Uint8Array.of(uint(binding,26)));}
  deviceSettings(rate,scanMode,gamepad){return this.write(8,0,Uint8Array.of(uint(rate,6),uint(scanMode,2),Number(gamepad)));}
  pointerSpeed(speed){
    if(!this.supportsDesktopKeys)throw new Error('Pointer speed requires HE30 Pro v0.25.');
    return this.write(10,0,Uint8Array.of(uint(speed,32,1)));
  }
  cycleAll(key,layer){
    if(!this.supportsDesktopKeys)throw new Error('This mapping requires HE30 Pro v0.25.');
    return this.write(11,uint(key,35),Uint8Array.of(uint(layer,2)));
  }
}
export function bindingCode(value,layer){
  const profile=/^profile ([1-4])$/i.exec(value.trim());
  if(profile)return 0xef+Number(profile[1]);
  if(value.trim().toLowerCase()==='fn2')return 0xfd;
  if(value.trim().toLowerCase()==='fn1')return 0xff;
  return parseUsage(value,!!layer);
}
export const bindingLabel=code=>isProfileUsage(code)?'Profile '+(code-0xef):code===0xfd?'Fn2':code===0xff?'Fn1':usageLabel(code);
export {decodeConfig,encodeConfig,encodeLighting,KEY_NAMES,PROFILE_KEY_MODEL,NKRO_MODEL,ADC_RGB_FIX_MODEL,CALIBRATION_QOL_MODEL,FN_RGB_PRODUCTS,DESKTOP_KEYS_MODEL,DESKTOP_USAGES,isProfileUsage,isDesktopUsage};
