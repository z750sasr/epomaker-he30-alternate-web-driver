// The v0.5 foundation protocol is deliberately separate from the stock codec.
export const CONFIG_BYTES=664, STATUS_BYTES=208, PRODUCT='H3K05';
export const KEY_NAMES=['F1','F2','F3','F4','F5','F6','Grave','Space','Fn','Alt','Ctrl','B','6','Tab','Q','W','E','R','5','4','2','3','1','Esc','G','LShift','Z','X','C','V','F','D','A','S','Caps','T'];
export const CHANNELS=[6,7,14,15,8,9,5,4,12,13,11,10];
export const OUTPUTS=['PC13','PC14','PB10'];
export const ERROR_TEXT=['Success','Bad packet','Value outside the supported range','Operation is not available in this state','Configuration checksum mismatch','Configuration staging is incomplete','Verify the group wiring before enabling typing','Calibrate every key before continuing','Release all keys before continuing','Custom settings flash save/load failed','ADC fault; retry the scanner'];
export class KeyboardProtocolError extends Error {
  constructor(code){super(ERROR_TEXT[code]||`Firmware rejected the command (${code}).`);this.name='KeyboardProtocolError';this.code=code;}
}
const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw new Error(`${label} must be an integer from ${min} to ${max}.`);return v;};
const array=(v,n,label)=>{if(!Array.isArray(v)||v.length!==n)throw new Error(`${label} must contain ${n} entries.`);return v;};
export const hasBit=(lo,hi,index)=>index<32?!!((lo>>>index)&1):!!((hi>>>(index-32))&1);
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
export const PROFILE_KEY_MODEL='H3K20';
export const NKRO_MODEL='H3K21';
export const FN_RGB_MODEL='H3K22';
export const ADC_RGB_FIX_MODEL='H3K23';
export const CALIBRATION_QOL_MODEL='H3K24';
export const DESKTOP_KEYS_MODEL='H3K25';
export const MEDIA_MODEL='H3K26';
export const MEDIA_PRODUCTS=[MEDIA_MODEL,'H3K27','H3K28'];
export const DESKTOP_PRODUCTS=[DESKTOP_KEYS_MODEL,...MEDIA_PRODUCTS];
export const FN_RGB_PRODUCTS=[FN_RGB_MODEL,ADC_RGB_FIX_MODEL,CALIBRATION_QOL_MODEL,...DESKTOP_PRODUCTS];
export const DESKTOP_USAGES=new Map([
  [0xf4,'Next profile'],[0xf5,'Keyboard brightness +1%'],[0xf6,'Keyboard brightness −1%'],
  ...['Mouse left click','Mouse right click','Mouse middle click','Mouse Back (4)','Mouse Forward (5)',
    'Mouse scroll up','Mouse scroll down','Move pointer left','Move pointer right','Move pointer up','Move pointer down']
    .map((name,index)=>[0xb0+index,name])
]);
export const isDesktopUsage=code=>DESKTOP_USAGES.has(code);
export const MEDIA_USAGES=new Map(['Play / pause','Previous track','Next track','Stop playback','Mute volume','Volume up','Volume down',
  'Display brightness up','Display brightness down','Search / Spotlight','Browser home','Browser back','Browser forward',
  'Calculator','Apps / Launchpad (macOS)','Mission Control (macOS)'].map((name,index)=>[0xc0+index,name]));
export const isMediaUsage=code=>MEDIA_USAGES.has(code);
export const supportsProfileKeys=product=>product===PROFILE_KEY_MODEL||product===NKRO_MODEL||FN_RGB_PRODUCTS.includes(product);
export const isProfileUsage=value=>Number.isInteger(value)&&value>=0xf0&&value<=0xf3;
export function validUsage(value,fnLayer=false){return Number.isInteger(value)&&(value===0||(value>=4&&value<=0xa4)||(value>=0xe0&&value<=0xe7)||isProfileUsage(value)||isDesktopUsage(value)||isMediaUsage(value)||value===0xff||value===0xfd||(fnLayer&&value===0xfe));}
const zoneUnits=(value,label)=>{
  const units=Math.round(value*10);
  if(!Number.isFinite(value)||Math.abs(value*10-units)>1e-8)throw new Error(`${label} must use 0.1% increments.`);
  return integer(units,0,400,label);
};
export function validateConfig(config){
  if(!config||config.version!==1)throw new Error('Choose a version1 foundation configuration.');
  const groupOutputs=array(config.groupOutputs,3,'Group outputs').map((v,i)=>integer(v,0,2,`Group ${i+1} output`));
  if(new Set(groupOutputs).size!==3)throw new Error('Each group must use a different output: PC13, PC14 and PB10.');
  integer(config.settleLoops,100,32000,'Settling loops');
  if(typeof config.bankVerified!=='boolean'||typeof config.startupTyping!=='boolean')throw new Error('Group verification and startup typing must be true or false.');
  const calibrated=array(config.calibrated,36,'Calibration flags');
  const released=array(config.released,36,'Released readings');
  const pressed=array(config.pressed,36,'Pressed readings');
  const keys=array(config.keys,36,'Key settings');
  keys.forEach((key,i)=>{
    if(!key||typeof key!=='object')throw new Error(`Missing settings for ${KEY_NAMES[i]}.`);
    integer(key.actuation,10,990,`${KEY_NAMES[i]} actuation`);integer(key.hysteresis,1,500,`${KEY_NAMES[i]} hysteresis`);
    integer(key.rtPress,5,1000,`${KEY_NAMES[i]} RT press`);integer(key.rtRelease,5,1000,`${KEY_NAMES[i]} RT release`);
    if(!validUsage(key.normalUsage)||!validUsage(key.fnUsage,true))throw new Error(`Invalid normal/Fn key code for ${KEY_NAMES[i]}.`);
    if(typeof key.rapidTrigger!=='boolean'||typeof key.disabled!=='boolean')throw new Error(`Invalid key options for ${KEY_NAMES[i]}.`);
    zoneUnits(key.topDeadzone,`${KEY_NAMES[i]} top dead zone`);zoneUnits(key.bottomDeadzone,`${KEY_NAMES[i]} bottom dead zone`);
    if(typeof calibrated[i]!=='boolean')throw new Error(`Invalid calibration flag for ${KEY_NAMES[i]}.`);
    integer(released[i],0,4095,`${KEY_NAMES[i]} released reading`);integer(pressed[i],0,4095,`${KEY_NAMES[i]} pressed reading`);
    if(calibrated[i]&&Math.abs(released[i]-pressed[i])<64)throw new Error(`${KEY_NAMES[i]} has an insufficient calibration range.`);
  });
  return config;
}
export function encodeConfig(config){
  validateConfig(config);const bytes=new Uint8Array(CONFIG_BYTES),view=new DataView(bytes.buffer);
  bytes[0]=1;bytes.set(config.groupOutputs,1);view.setUint16(4,config.settleLoops,true);view.setUint16(6,(config.bankVerified?1:0)|(config.startupTyping?2:0),true);
  let lo=0,hi=0;config.calibrated.forEach((value,i)=>{if(value){if(i<32)lo=(lo|(1<<i))>>>0;else hi|=1<<(i-32);}});
  view.setUint32(8,lo,true);view.setUint32(12,hi,true);
  config.keys.forEach((key,i)=>{
    view.setUint16(16+i*2,config.released[i],true);view.setUint16(88+i*2,config.pressed[i],true);
    const offset=160+i*14;['actuation','hysteresis','rtPress','rtRelease'].forEach((name,j)=>view.setUint16(offset+j*2,key[name],true));
    let flags=(key.rapidTrigger?1:0)|(key.disabled?2:0);
    let top=key.topDeadzone,bottom=key.bottomDeadzone;
    if(!Number.isInteger(top)||!Number.isInteger(bottom)){
      top=Math.round(top*10);bottom=Math.round(bottom*10);
      flags|=16|((top>>>8)<<2)|((bottom>>>8)<<3);
    }
    bytes.set([key.normalUsage,key.fnUsage,flags,top&255,bottom&255,0],offset+8);
  });return bytes;
}
export function decodeConfig(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==CONFIG_BYTES)throw new Error('Configuration must contain exactly664 bytes.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),flags=view.getUint16(6,true),lo=view.getUint32(8,true),hi=view.getUint32(12,true);
  if(flags&~3||hi&~15)throw new Error('Configuration has unsupported flag bits.');
  const config={version:bytes[0],groupOutputs:Array.from(bytes.slice(1,4)),settleLoops:view.getUint16(4,true),bankVerified:!!(flags&1),startupTyping:!!(flags&2),calibrated:[],released:[],pressed:[],keys:[]};
  for(let i=0;i<36;i++){
    const offset=160+i*14,keyFlags=bytes[offset+10],fine=Boolean(keyFlags&16);
    if(keyFlags&~(fine?31:3)||bytes[offset+13])throw new Error('Key configuration has unsupported flags or reserved data.');
    config.calibrated.push(hasBit(lo,hi,i));config.released.push(view.getUint16(16+i*2,true));config.pressed.push(view.getUint16(88+i*2,true));
    const top=bytes[offset+11],bottom=bytes[offset+12];
    config.keys.push({actuation:view.getUint16(offset,true),hysteresis:view.getUint16(offset+2,true),rtPress:view.getUint16(offset+4,true),rtRelease:view.getUint16(offset+6,true),normalUsage:bytes[offset+8],fnUsage:bytes[offset+9],rapidTrigger:!!(keyFlags&1),disabled:!!(keyFlags&2),topDeadzone:fine?(top|((keyFlags&4)<<6))/10:top,bottomDeadzone:fine?(bottom|((keyFlags&8)<<5))/10:bottom});
  }return validateConfig(config);
}
export function decodeStatus(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==STATUS_BYTES||![0x48,0x33,0x4b,0x31,1].every((v,i)=>bytes[i]===v)||bytes[201]!==36)throw new Error('H3K1 foundation status was not found or has an invalid format.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),lo=view.getUint32(16,true),hi=view.getUint32(20,true),pLo=view.getUint32(176,true),pHi=view.getUint32(180,true);
  if(hi&~15||pHi&~15)throw new Error('Status has invalid key-mask bits.');
  return{signature:'H3K1',typingEnabled:!!bytes[5],calibrationPhase:bytes[6],adcError:bytes[7],frames:view.getUint32(8,true),savedSequence:view.getUint32(12,true),calibrated:KEY_NAMES.map((_,i)=>hasBit(lo,hi,i)),groupOutputs:Array.from(bytes.slice(24,27)),configFlags:bytes[27],dirty:!!bytes[28],storeStatus:bytes[29],releaseInterlock:!!bytes[30],usbReady:!!bytes[31],raw:KEY_NAMES.map((_,i)=>view.getUint16(32+i*2,true)),positions:KEY_NAMES.map((_,i)=>view.getUint16(104+i*2,true)),pressed:KEY_NAMES.map((_,i)=>hasBit(pLo,pHi,i)),fnHeld:!!bytes[184],rollover:!!(bytes[185]&1),nkro:!!(bytes[185]&2),restFrames:bytes[186],activeProfile:bytes[187],acceptedReports:view.getUint32(188,true),report:Array.from(bytes.slice(192,200)),missingKeys:bytes[200],keyCount:bytes[201],savedValid:!!bytes[202],startupBaseline:bytes[203],configCRC:view.getUint32(204,true)};
}
export function encodeRequest(operation,{length=0,offset=0,data=new Uint8Array()}={}){
  integer(operation,0,12,'Operation');integer(length,0,56,'Request length');integer(offset,0,65535,'Request offset');
  if(!(data instanceof Uint8Array))throw new Error('Request payload must be bytes.');
  if(operation<=1){if(data.length||offset+length>(operation?CONFIG_BYTES:STATUS_BYTES))throw new Error('Read exceeds its bounded region.');}
  else if(operation===2){if(!length||data.length!==length||offset+length>CONFIG_BYTES)throw new Error('Invalid staged configuration block.');}
  else if(operation===3){if(length!==4||data.length!==4||offset)throw new Error('Apply requires a four-byte CRC32.');}
  else if(length||offset||data.length)throw new Error('This control has no payload.');
  const packet=new Uint8Array(64);packet.set([0x55,0xd0,operation,0,length,offset&255,offset>>>8,0]);packet.set(data,8);
  packet[3]=packet.slice(4,8+length).reduce((n,b)=>(n+b)&255,0);return packet;
}
function checkReply(response,length,offset){
  if(!(response instanceof Uint8Array)||response.length!==64||response[0]!==0xaa||response[1]!==0xd0||response[7])throw new Error('Invalid foundation reply.');
  const n=response[4];if(n>56||response[3]!==response.slice(4,8+n).reduce((sum,b)=>(sum+b)&255,0))throw new Error('Foundation reply checksum failed.');
  if(response[2]){if(n||response[5]||response[6])throw new Error('Malformed foundation error response.');throw new KeyboardProtocolError(response[2]);}
  if(n!==length||(response[5]|response[6]<<8)!==offset)throw new Error('Foundation reply does not match the request.');
  return response.slice(8,8+n);
}
function checkDevice(transport){if(transport?.device?.vendorId!==0x19f5||transport.device.productId!==0xfb4c||!['H3K05','H3K06','H3K07','H3K08','H3K09','H3K10','H3K11','H3K12','H3K13','H3K14','H3K15','H3K16','H3K17','H3K18','H3K19','H3K20','H3K21','H3K22','H3K23','H3K24','H3K25','H3K26','H3K27','H3K28'].includes(transport.device.productName))throw new Error('Select an HE30 running supported foundation firmware.');}
export class FoundationClient {
  constructor(transport){checkDevice(transport);this.transport=transport;this.queue=Promise.resolve();}
  transaction(action){const pending=this.queue.then(action);this.queue=pending.catch(()=>{});return pending;}
  async request(operation,options={},timeout=2500){checkDevice(this.transport);const response=await this.transport.request(encodeRequest(operation,options),{kind:'keyboard',timeout});return checkReply(response,operation<=1?options.length:0,operation<=1?options.offset:0);}
  async attest(){
    const read=()=>this.request(0,{length:8,offset:0});
    let bytes;
    try{bytes=await read();}
    catch(error){
      if(error.name!=='HIDTimeoutError'||this.transport.closed)throw error;
      bytes=await read();
    }
    if(![0x48,0x33,0x4b,0x31,1].every((v,i)=>bytes[i]===v))throw new Error('H3K1 foundation signature was not found. No control command was sent.');
  }
  async readRegion(operation,total){const bytes=new Uint8Array(total);for(let offset=0;offset<total;offset+=56){const length=Math.min(56,total-offset);bytes.set(await this.request(operation,{length,offset}),offset);}return bytes;}
  readStatus(){return this.transaction(async()=>{await this.attest();return decodeStatus(await this.readRegion(0,STATUS_BYTES));});}
  readTravel(){
    return this.transaction(async()=>{
      // Positions and the pressed mask occupy 80 adjacent bytes of H3K1.
      const first=await this.request(0,{length:56,offset:104},500);
      const last=await this.request(0,{length:24,offset:160},500);
      const bytes=new Uint8Array(80);
      bytes.set(first);
      bytes.set(last,56);
      const view=new DataView(bytes.buffer),lo=view.getUint32(72,true),hi=view.getUint32(76,true);
      if(hi&~15)throw new Error('Live travel has invalid key-mask bits.');
      const positions=KEY_NAMES.map((_,i)=>view.getUint16(i*2,true));
      if(positions.some(value=>value>1000))throw new Error('Live travel is outside the supported range.');
      return {positions,pressed:KEY_NAMES.map((_,i)=>hasBit(lo,hi,i))};
    });
  }
  readConfig(){return this.transaction(async()=>{await this.attest();return decodeConfig(await this.readRegion(1,CONFIG_BYTES));});}
  applyConfig(config){
    if(!MEDIA_PRODUCTS.includes(this.transport.device.productName)&&config.keys?.some(key=>isMediaUsage(key.normalUsage)||isMediaUsage(key.fnUsage)))
      return Promise.reject(new Error('Media mappings require HE30 Pro v0.26.'));
    if(!DESKTOP_PRODUCTS.includes(this.transport.device.productName)&&config.keys?.some(key=>isDesktopUsage(key.normalUsage)||isDesktopUsage(key.fnUsage)))
      return Promise.reject(new Error('Mouse, brightness and Next profile mappings require HE30 Pro v0.25.'));
    if(!supportsProfileKeys(this.transport.device.productName)&&config.keys?.some(key=>
      isProfileUsage(key.normalUsage)||isProfileUsage(key.fnUsage)||
      !Number.isInteger(key.topDeadzone)||!Number.isInteger(key.bottomDeadzone)))
      return Promise.reject(new Error('Profile keys and fine dead zones require HE30 Pro v0.20.'));
    // Freeze validated bytes before queueing, so a later editor change cannot
    // alter the transaction after its checksum was calculated.
    const bytes=encodeConfig(config),checksum=new Uint8Array(4);new DataView(checksum.buffer).setUint32(0,crc32(bytes),true);
    return this.transaction(async()=>{await this.attest();for(let offset=0;offset<bytes.length;offset+=56){const data=bytes.slice(offset,offset+56);await this.request(2,{length:data.length,offset,data});}await this.request(3,{length:4,offset:0,data:checksum});return decodeConfig(await this.readRegion(1,CONFIG_BYTES));});
  }
  control(operation){integer(operation,4,12,'Control operation');return this.transaction(async()=>{await this.attest();await this.request(operation,{},operation===8?8000:2500);});}
}
export const readKeyboardStatus=transport=>new FoundationClient(transport).readStatus();
export function exportProfile(config){return{format:'he30-foundation-profile-v1',product:PRODUCT,layout:'epomaker-he30-36',created:new Date().toISOString(),config:decodeConfig(encodeConfig(config))};}
export function importProfile(profile){if(!profile||profile.format!=='he30-foundation-profile-v1'||profile.product!==PRODUCT||profile.layout!=='epomaker-he30-36')throw new Error('Choose a v0.5 HE30 foundation profile, not a stock-driver or diagnostic report.');return decodeConfig(encodeConfig(profile.config));}
export const USAGE_NAMES=new Map([[0,'None'],[0x28,'Enter'],[0x29,'Esc'],[0x2a,'Backspace'],[0x2b,'Tab'],[0x2c,'Space'],[0x2d,'Minus'],[0x2e,'Equal'],[0x2f,'Left bracket'],[0x30,'Right bracket'],[0x31,'Backslash'],[0x33,'Semicolon'],[0x34,'Quote'],[0x35,'Grave'],[0x36,'Comma'],[0x37,'Period'],[0x38,'Slash'],[0x39,'Caps Lock'],[0x49,'Insert'],[0x4a,'Home'],[0x4b,'Page Up'],[0x4c,'Delete'],[0x4d,'End'],[0x4e,'Page Down'],[0x4f,'Right'],[0x50,'Left'],[0x51,'Down'],[0x52,'Up'],[0xe0,'Left Ctrl'],[0xe1,'Left Shift'],[0xe2,'Left Alt'],[0xe3,'Left GUI'],[0xe4,'Right Ctrl'],[0xe5,'Right Shift'],[0xe6,'Right Alt'],[0xe7,'Right GUI'],[0xfe,'Transparent'],[0xff,'Fn']]);
for(let i=0;i<26;i++)USAGE_NAMES.set(4+i,String.fromCharCode(65+i));
for(let i=0;i<10;i++)USAGE_NAMES.set(0x1e+i,String((i+1)%10));
for(let i=0;i<12;i++)USAGE_NAMES.set(0x3a+i,`F${i+1}`);
for(const [code,name] of DESKTOP_USAGES)USAGE_NAMES.set(code,name);
for(const [code,name] of MEDIA_USAGES)USAGE_NAMES.set(code,name);
export function usageLabel(code){return USAGE_NAMES.get(code)||(Number.isInteger(code)?`0x${code.toString(16).toUpperCase().padStart(2,'0')}`:'');}
export function parseUsage(text,fnLayer=false){
  const value=String(text).trim();const named=Array.from(USAGE_NAMES).find(([,name])=>name.toLowerCase()===value.toLowerCase());
  const code=named?named[0]:/^0x[0-9a-f]{1,2}$/i.test(value)?Number.parseInt(value.slice(2),16):NaN;
  if(!validUsage(code,fnLayer))throw new Error('Choose a named key or a supported hexadecimal usage. Transparent is available only in the Fn layer.');return code;
}
