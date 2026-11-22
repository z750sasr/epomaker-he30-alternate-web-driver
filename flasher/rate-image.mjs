import {crc32} from './keyboard-protocol.mjs';

// The HE30 Pro application starts at 0x5000. Its first journal sector is at 0x1e000.
export function imageWithRates(image, template, polling, scanner){
  if(!Number.isInteger(polling)||polling<0||polling>6||!Number.isInteger(scanner)||scanner<0||scanner>2)
    throw new Error('Choose a valid polling rate and scanner mode.');
  const first=image.subarray(0x19000,0x1a000);
  const seeded=first.every((byte,i)=>byte===template[i]);
  const empty=first.every(byte=>byte===255);
  if(image.length!==155056||(!empty&&!seeded)||!image.subarray(0x1a000,0x1b000).every(byte=>byte===255)||template.length!==4096)
    throw new Error('The firmware settings area does not match its factory template.');
  const record=Uint8Array.from(template),header=new DataView(record.buffer,record.byteOffset,record.byteLength);
  const payload=new Uint8Array(4084);
  const checksum=()=>{
    payload.set(record.subarray(4,12));
    payload.set(record.subarray(16,4092),8);
    return crc32(payload);
  };
  if(header.getUint32(0,true)!==0x39435048||!(header.getUint32(4,true)===5||seeded&&header.getUint32(4,true)===6)||
     header.getUint32(4092,true)!==0x5ac3d17e||header.getUint32(12,true)!==checksum())
    throw new Error('The factory settings record failed verification.');
  record[17]=polling;record[18]=scanner;
  header.setUint32(12,checksum(),true);
  const result=Uint8Array.from(image);
  result.set(record,0x19000);
  return result;
}
