// v0.6 RGB extension. It shares the foundation client's transaction queue.
export const LED_ORDER=['Esc','F1','F2','F3','F4','F5','F6','6','5','4','3','2','1','Grave','Tab','Q','W','E','R','T','G','F','D','S','A','Caps','LShift','Z','X','C','V','B','Space','Alt','Fn','Ctrl'];
export const LED_TO_KEY=[23,0,1,2,3,4,5,12,18,19,21,20,22,6,13,14,15,16,17,35,24,30,31,33,32,34,25,26,27,28,29,11,7,9,8,10];
const byte=(v,max,label)=>{if(!Number.isInteger(v)||v<0||v>max)throw new Error(`${label} must be an integer from0 to${max}.`);return v;};
export function encodeLighting(value){
  if(!value||value.version!==1)throw new Error('Choose a version1 lighting profile.');
  const out=new Uint8Array(128);out.set([1,byte(value.mode,3,'Mode'),byte(value.order,1,'Order'),byte(value.rate,1,'Rate'),byte(value.barCount,64,'Bar count')]);
  if(typeof value.barEnabled!=='boolean'||value.barEnabled&&!value.barCount)throw new Error('An enabled light bar needs at least one LED.');out[5]=Number(value.barEnabled);
  for(const [offset,colors] of [[6,value.color],[9,value.barColor]]){if(!Array.isArray(colors)||colors.length!==3)throw new Error('Colors must contain3 channels.');out.set(colors.map(v=>byte(v,32,'Color channel')),offset);}
  if(!Array.isArray(value.palette)||value.palette.length!==36)throw new Error('Per-key palette must contain36 colors.');
  value.palette.forEach((colors,i)=>{if(!Array.isArray(colors)||colors.length!==3)throw new Error('Each key needs3 color channels.');out.set(colors.map(v=>byte(v,32,'Key channel')),12+i*3);});return out;
}
export function decodeLighting(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==128||bytes.slice(120).some(Boolean)||bytes[5]>1)throw new Error('Invalid128-byte lighting configuration.');
  const value={version:bytes[0],mode:bytes[1],order:bytes[2],rate:bytes[3],barCount:bytes[4],barEnabled:!!bytes[5],color:Array.from(bytes.slice(6,9)),barColor:Array.from(bytes.slice(9,12)),palette:Array.from({length:36},(_,i)=>Array.from(bytes.slice(12+i*3,15+i*3)))};encodeLighting(value);return value;
}
export function decodeLightingStatus(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==160||![0x48,0x33,0x4c,0x31].every((v,i)=>bytes[i]===v)||![1,2,3].includes(bytes[4])||bytes[5]>2||bytes[6]>2||bytes[7]>3||bytes.slice(bytes[4]>=2?146:144).some(Boolean)||bytes[4]>=2&&(bytes[144]>(bytes[4]===3?1:2)||bytes[145]>1))throw new Error('H3L1 RGB status was not found.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return{signature:'H3L1',error:bytes[5],state:bytes[6],pending:bytes[7],keyFrames:v.getUint32(8,true),barFrames:v.getUint32(12,true),config:decodeLighting(bytes.slice(16,144)),...(bytes[4]>=2?{power:{mode:bytes[144],digitalHigh:!!bytes[145]}}:{})};
}
export function lightingPacket(operation,data=new Uint8Array(),offset=0,length=data.length){
  byte(operation,7,'Lighting command');if(!(data instanceof Uint8Array)||data.length>56||!Number.isInteger(offset)||offset<0||offset>159)throw new Error('Invalid lighting packet.');
  if(operation===0){if(data.length||length<0||length>56||!Number.isInteger(length)||offset+length>160)throw new Error('Read exceeds lighting status.');}
  else if(offset||length!==data.length||(operation===1?length!==12:operation===2?!length||length%4:[3,7].includes(operation)?length!==1:length!==0))throw new Error('Invalid lighting control payload.');
  if(operation===2)for(let i=0;i<data.length;i+=4){if(data[i]>=36&&data[i]!==255||data.slice(i+1,i+4).some(v=>v>32))throw new Error('Invalid key/color entry.');}
  if(operation===3&&data[0]>=36&&data[0]!==255)throw new Error('Choose a physical key to identify.');
  if(operation===7&&data[0]>2)throw new Error('PA10 supports release, weak pull-down or weak pull-up only.');
  const out=new Uint8Array(64);out.set([0x55,0xd1,operation,0,length,offset,0,0]);out.set(data,8);out[3]=out.slice(4,8+length).reduce((a,b)=>(a+b)&255,0);return out;
}
export class LightingClient{
  constructor(foundation){this.foundation=foundation;this.transport=foundation.transport;this.check();}
  check(){const d=this.transport.device;if(d.vendorId!==0x19f5||d.productId!==0xfb4c||!['H3K06','H3K07','H3K08'].includes(d.productName))throw new Error('RGB controls require v0.6 H3K06, v0.7 H3K07 or v0.8 H3K08.');}
  async request(op,data=new Uint8Array(),offset=0,length=data.length){
    this.check();const response=await this.transport.request(lightingPacket(op,data,offset,length),{kind:'lighting'});
    if(!(response instanceof Uint8Array)||response.length!==64||response[0]!==0xaa||response[1]!==0xd1||response[7]||response[4]>56||response.slice(8+response[4]).some(Boolean)||response[3]!==response.slice(4,8+response[4]).reduce((a,b)=>(a+b)&255,0))throw new Error('Malformed RGB reply.');
    if(response[2])throw new Error(`RGB command rejected (${response[2]}).`);
    if(response[4]!==(!op?length:0)||(response[5]|response[6]<<8)!==(!op?offset:0))throw new Error('RGB reply does not match the request.');return response.slice(8,8+response[4]);
  }
  async attest(){const b=await this.request(0,new Uint8Array(),0,8);if(![0x48,0x33,0x4c,0x31,{H3K06:1,H3K07:2,H3K08:3}[this.transport.device.productName]].every((v,i)=>b[i]===v))throw new Error('H3L1 signature missing. No RGB control was sent.');}
  async read(){const bytes=new Uint8Array(160);for(let off=0;off<160;off+=56)bytes.set(await this.request(0,new Uint8Array(),off,Math.min(56,160-off)),off);return decodeLightingStatus(bytes);}
  readStatus(){return this.foundation.transaction(async()=>{await this.attest();return this.read();});}
  apply(config){const bytes=encodeLighting(config);return this.foundation.transaction(async()=>{
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
