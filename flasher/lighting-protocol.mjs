// v0.6 RGB extension. It shares the foundation client's transaction queue.
import {FN_RGB_PRODUCTS,DESKTOP_PRODUCTS,MEDIA_PRODUCTS} from './keyboard-protocol.mjs';
export const LED_ORDER=['Esc','F1','F2','F3','F4','F5','F6','6','5','4','3','2','1','Grave','Tab','Q','W','E','R','T','G','F','D','S','A','Caps','LShift','Z','X','C','V','B','Space','Alt','Fn','Ctrl'];
export const LED_TO_KEY=[23,0,1,2,3,4,5,12,18,19,21,20,22,6,13,14,15,16,17,35,24,30,31,33,32,34,25,26,27,28,29,11,7,9,8,10];
const byte=(v,max,label)=>{if(!Number.isInteger(v)||v<0||v>max)throw new Error(`${label} must be an integer from0 to${max}.`);return v;};
export function encodeFnLighting(value){
  if(typeof value?.enabled!=='boolean'||!Array.isArray(value.palette)||value.palette.length!==36)
    throw new Error('A layer needs an enable flag and 36 RGB colors.');
  const data=new Uint8Array(73),view=new DataView(data.buffer);
  data[0]=Number(value.enabled);
  value.palette.forEach((color,i)=>{
    if(!Array.isArray(color)||color.length!==3)throw new Error('Each key needs three color channels.');
    const [r,g,b]=color.map(v=>byte(v,32,'Color channel'));
    view.setUint16(1+2*i,(33*r+g)*33+b,true);
  });
  return data;
}
function decodeFnLighting(data){
  if(data.length!==73||data[0]>1)throw new Error('Invalid Fn lighting response.');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const palette=Array.from({length:36},(_,i)=>{
    const packed=byte(view.getUint16(1+2*i,true),33**3-1,'Packed color');
    return [Math.floor(packed/(33*33)),Math.floor(packed/33)%33,packed%33];
  });
  return {enabled:!!data[0],palette};
}
const fnAddress=(profile,layer)=>128*(2*byte(profile,3,'Profile')+(byte(layer,2,'Fn layer')===2?1:0));
export function encodeLightingPreferences(value){
  const speed=byte(value.speed,100,'Animation speed'),sleep=byte(value.sleep,65535,'Idle timeout');
  if(typeof value.keepBar!=='boolean')throw new Error('Choose whether the lightbar stays on.');
  return Uint8Array.of(speed,Number(value.keepBar),sleep&255,sleep>>8);
}
function decodeLightingPreferences(data){
  if(data.length!==4||data[0]>100||data[1]>1)throw new Error('Invalid RGB animation settings.');
  return {speed:data[0],keepBar:!!data[1],sleep:data[2]|data[3]<<8};
}
export function encodeLighting(value){
  if(!value||value.version!==1)throw new Error('Choose a version1 lighting profile.');
  const out=new Uint8Array(128);out.set([1,byte(value.mode,5,'Mode'),byte(value.order,1,'Order'),byte(value.rate,1,'Rate'),byte(value.barCount,64,'Bar count')]);
  out[2]|=(100-byte(value.keyBrightness??100,100,'Keyboard brightness'))<<1;
  out[3]|=(100-byte(value.barBrightness??100,100,'Light strip brightness'))<<1;
  const barOptions=byte(value.barMode??0,3,'Lightbar effect')<<3|
    (value.barRainbow?32:0)|(value.barReverse?64:0);
  if(barOptions)out[4]=128|barOptions|byte(value.barCount,5,'Lightbar count');
  if(typeof value.barEnabled!=='boolean'||value.barEnabled&&!value.barCount)throw new Error('An enabled light bar needs at least one LED.');out[5]=Number(value.barEnabled);
  if(value.pointerSpeed!==undefined){
    if(value.pointerSpeed<1)throw new Error('Pointer speed starts at 1.');
    out[5]|=(byte(value.pointerSpeed,32,'Pointer speed')-1)<<1;
  }
  for(const [offset,colors] of [[6,value.color],[9,value.barColor]]){if(!Array.isArray(colors)||colors.length!==3)throw new Error('Colors must contain3 channels.');out.set(colors.map(v=>byte(v,32,'Color channel')),offset);}
  if(!Array.isArray(value.palette)||value.palette.length!==36)throw new Error('Per-key palette must contain36 colors.');
  value.palette.forEach((colors,i)=>{if(!Array.isArray(colors)||colors.length!==3)throw new Error('Each key needs3 color channels.');out.set(colors.map(v=>byte(v,32,'Key channel')),12+i*3);});return out;
}
export function decodeLighting(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==128||bytes.slice(120).some(Boolean)||bytes[5]>63)throw new Error('Invalid128-byte lighting configuration.');
  const options=bytes[4]&128;
  const value={version:bytes[0],mode:bytes[1],order:bytes[2]&1,rate:bytes[3]&1,barCount:options?bytes[4]&7:bytes[4],barEnabled:!!(bytes[5]&1),color:Array.from(bytes.slice(6,9)),barColor:Array.from(bytes.slice(9,12)),palette:Array.from({length:36},(_,i)=>Array.from(bytes.slice(12+i*3,15+i*3)))};
  if(options)Object.assign(value,{barMode:(bytes[4]>>3)&3,barRainbow:!!(bytes[4]&32),barReverse:!!(bytes[4]&64)});
  if(bytes[5]>>1)value.pointerSpeed=1+(bytes[5]>>1);
  if(bytes[2]>>1)value.keyBrightness=100-(bytes[2]>>1);
  if(bytes[3]>>1)value.barBrightness=100-(bytes[3]>>1);
  encodeLighting(value);return value;
}
export function decodeLightingStatus(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==160||![0x48,0x33,0x4c,0x31].every((v,i)=>bytes[i]===v)||
     ![1,2,3,4].includes(bytes[4])||bytes[5]>3||bytes[7]>3)throw new Error('H3L1 RGB status was not found.');
  const format=bytes[4];
  const controls=format===4||format===1&&bytes.slice(144,153).some(Boolean);
  if(controls){
    if(bytes[6]>3||bytes[144]>15||bytes[145]>1||bytes[146]>1||bytes[147]>1||
       bytes[148]>15||bytes[149]>1||bytes[150]>1||bytes[151]>4||bytes[152]>8||bytes.slice(153).some(Boolean))
      throw new Error('Invalid RGB GPIO status.');
  }else if(bytes[6]>2||bytes.slice(format>=2?146:144).some(Boolean)||
           format>=2&&(bytes[144]>(format===3?1:2)||bytes[145]>1)){
    throw new Error('Invalid RGB status fields.');
  }
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return{signature:'H3L1',error:bytes[5],state:bytes[6],pending:bytes[7],keyFrames:v.getUint32(8,true),barFrames:v.getUint32(12,true),config:decodeLighting(bytes.slice(16,144)),...(bytes[4]>=2&&bytes[4]<=3?{power:{mode:bytes[144],digitalHigh:!!bytes[145]}}:{})};
}
export function lightingPacket(operation,data=new Uint8Array(),offset=0,length=data.length){
  byte(operation,12,'Lighting command');if(!(data instanceof Uint8Array)||data.length>56||!Number.isInteger(offset)||offset<0||offset>1023)throw new Error('Invalid lighting packet.');
  if(operation===8)throw new Error('Use the Pro reader for live RGB.');
  if(operation===9||operation===10){
    const position=offset%128;
    if(!Number.isInteger(length)||length<1||length>56||position+length>73||
       (operation===9?data.length!==0:length!==data.length||!(position===0&&length===55||position===55&&length===18)))
      throw new Error('Invalid Fn lighting packet.');
  }
  else if(operation===11||operation===12){
    if(offset>3||length!==4||data.length!==(operation===11?0:4))throw new Error('Invalid lighting preferences packet.');
  }
  else if(operation===0){if(data.length||length<0||length>56||!Number.isInteger(length)||offset+length>160)throw new Error('Read exceeds lighting status.');}
  else if(offset||length!==data.length||(operation===1?length!==12:operation===2?!length||length%4:[3,7].includes(operation)?length!==1:length!==0))throw new Error('Invalid lighting control payload.');
  if(operation===2)for(let i=0;i<data.length;i+=4){if(data[i]>=36&&data[i]!==255||data.slice(i+1,i+4).some(v=>v>32))throw new Error('Invalid key/color entry.');}
  if(operation===3&&data[0]>=36&&data[0]!==255)throw new Error('Choose a physical key to identify.');
  if(operation===7&&data[0]>2)throw new Error('PA10 supports release, weak pull-down or weak pull-up only.');
  const out=new Uint8Array(64);out.set([0x55,0xd1,operation,0,length,offset&255,offset>>>8,0]);out.set(data,8);out[3]=out.slice(4,8+length).reduce((a,b)=>(a+b)&255,0);return out;
}
export class LightingClient{
  constructor(foundation){this.foundation=foundation;this.transport=foundation.transport;this.check();}
  get supportsBrightness(){return ['H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(this.transport.device.productName);}
  get supportsFnLighting(){return FN_RGB_PRODUCTS.includes(this.transport.device.productName);}
  get supportsPreferences(){return MEDIA_PRODUCTS.includes(this.transport.device.productName);}
  checkBrightness(config){
    if(!this.supportsBrightness&&((config.keyBrightness??100)!==100||(config.barBrightness??100)!==100))
      throw new Error('Install HE30 Pro v0.13 to save independent RGB brightness.');
    if(!DESKTOP_PRODUCTS.includes(this.transport.device.productName)&&(config.barMode||config.barRainbow||config.barReverse||(config.pointerSpeed??1)!==1))
      throw new Error('Lightbar animations and pointer speed require HE30 Pro v0.25.');
  }
  check(){const d=this.transport.device;if(d.vendorId!==0x19f5||d.productId!==0xfb4c||!['H3K06','H3K07','H3K08','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(d.productName))throw new Error('RGB controls require HE30 custom firmware v0.6 or later.');}
  async request(op,data=new Uint8Array(),offset=0,length=data.length){
    this.check();
    if(op>=9&&!this.supportsFnLighting)throw new Error('Fn lighting requires HE30 Pro v0.22.');
    if(op>=11&&!this.supportsPreferences)throw new Error('Animation speed and RGB sleep require HE30 Pro v0.26.');
    const response=await this.transport.request(lightingPacket(op,data,offset,length),{kind:'lighting'});
    if(!(response instanceof Uint8Array)||response.length!==64||response[0]!==0xaa||response[1]!==0xd1||response[7]||response[4]>56||response.slice(8+response[4]).some(Boolean)||response[3]!==response.slice(4,8+response[4]).reduce((a,b)=>(a+b)&255,0))throw new Error('Malformed RGB reply.');
    if(response[2])throw new Error(`RGB command rejected (${response[2]}).`);
    const read=op===0||op===9||op===11;
    if(response[4]!==(read?length:0)||(response[5]|response[6]<<8)!==(read?offset:0))throw new Error('RGB reply does not match the request.');return response.slice(8,8+response[4]);
  }
  async attest(){const b=await this.request(0,new Uint8Array(),0,8);if(![0x48,0x33,0x4c,0x31,{H3K06:1,H3K07:2,H3K08:3,H3K09:4,H3K10:4,H3K11:4,H3K12:4,H3K13:4,H3K14:4,H3K15:4,H3K16:4,H3K17:4,H3K18:4,H3K19:4,H3K20:4,H3K21:4,H3K22:4,H3K23:4,H3K24:4,H3K25:4,H3K26:4,H3K27:4}[this.transport.device.productName]].every((v,i)=>b[i]===v))throw new Error('H3L1 signature missing. No RGB control was sent.');}
  async read(){const bytes=new Uint8Array(160);for(let off=0;off<160;off+=56)bytes.set(await this.request(0,new Uint8Array(),off,Math.min(56,160-off)),off);return decodeLightingStatus(bytes);}
  readStatus(){return this.foundation.transaction(async()=>{await this.attest();return this.read();});}
  readPreferences(profile){
    return this.foundation.transaction(async()=>decodeLightingPreferences(await this.request(11,new Uint8Array(),profile,4)));
  }
  applyPreferences(profile,value){
    const data=encodeLightingPreferences(value);
    return this.foundation.transaction(async()=>{
      await this.attest();await this.request(12,data,profile);
      const saved=await this.request(11,new Uint8Array(),profile,4);
      if(saved.some((v,i)=>v!==data[i]))throw new Error('RGB animation settings did not match the readback.');
      return decodeLightingPreferences(saved);
    });
  }
  async readFnPalette(offset){
    const data=new Uint8Array(73);
    data.set(await this.request(9,new Uint8Array(),offset,55));
    data.set(await this.request(9,new Uint8Array(),offset+55,18),55);
    return data;
  }
  readFn(profile){
    return this.foundation.transaction(async()=>{
      const result=[];
      for(const layer of [1,2])result.push(decodeFnLighting(await this.readFnPalette(fnAddress(profile,layer))));
      return result;
    });
  }
  applyFn(profile,layer,value){
    if(layer!==1&&layer!==2)throw new Error('Choose Fn1 or Fn2.');
    const data=encodeFnLighting(value),offset=fnAddress(profile,layer);
    return this.foundation.transaction(async()=>{
      await this.attest();
      await this.request(10,data.subarray(0,55),offset);
      await this.request(10,data.subarray(55),offset+55);
      const saved=await this.readFnPalette(offset);
      if(saved.some((v,i)=>v!==data[i]))throw new Error('Fn lighting readback differs.');
      return decodeFnLighting(saved);
    });
  }
  apply(config){
    this.check();
    this.checkBrightness(config);
    const pro=['H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27'].includes(this.transport.device.productName);
    const bytes=encodeLighting(config);
    if(!pro&&config.mode>3)throw new Error('This effect requires HE30 Pro firmware.');
    if(pro&&config.barCount>5)throw new Error('The HE30 Pro bar has five LEDs.');
    return this.foundation.transaction(async()=>{
    await this.attest();await this.request(1,bytes.slice(0,12));
    for(let start=0;start<36;start+=14){const data=[];for(let i=start;i<Math.min(36,start+14);i++)data.push(i,...bytes.slice(12+i*3,15+i*3));await this.request(2,Uint8Array.from(data));}
    const status=await this.read();if(!encodeLighting(status.config).every((v,i)=>v===bytes[i]))throw new Error('RGB settings readback differs. RAM may be partially changed; read settings before saving.');return status;
  });}
  identify(index){byte(index,35,'Physical key');return this.foundation.transaction(async()=>{await this.attest();await this.request(3,Uint8Array.of(index));});}
  powerTest(mode){byte(mode,2,'PA10 test');if(this.transport.device.productName!=='H3K07')throw new Error('PA10 testing requires v0.7 H3K07.');return this.foundation.transaction(async()=>{await this.attest();await this.request(7,Uint8Array.of(mode));return this.read();});}
  setPower(enabled){if(typeof enabled!=='boolean')throw new Error('Power must be on or off.');if(this.transport.device.productName!=='H3K08')throw new Error('Supply switching requires v0.8 H3K08.');return this.foundation.transaction(async()=>{await this.attest();await this.request(7,Uint8Array.of(Number(enabled)));return this.read();});}
  control(operation){if(![4,5,6].includes(operation))throw new Error('Unknown RGB control.');return this.foundation.transaction(async()=>{await this.attest();await this.request(operation);return this.read();});}
}
export function exportLighting(config){return{format:'he30-lighting-profile-v1',product:'H3K06',lighting:decodeLighting(encodeLighting(config))};}
export function importLighting(profile){if(profile?.format!=='he30-lighting-profile-v1'||profile.product!=='H3K06')throw new Error('Choose an exported v0.6 lighting profile.');return decodeLighting(encodeLighting(profile.lighting));}
