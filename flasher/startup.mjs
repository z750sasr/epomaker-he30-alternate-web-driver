import { VID, APP_PID, HIDTransport, readStartupStatus } from './protocol.mjs';
const $ = id => document.getElementById(id);
const stages = {1:'Reset trampoline',2:'Before clock initialization',3:'Clock initialization returned',16:'Diagnostic main',17:'Clock and delay setup returned',18:'USB clock setup returned',19:'USB enable returned',48:'USB diagnostic loop',64:'Recovery requested',224:'Exception captured',226:'PLL ready timeout',227:'Clock switch timeout',228:'Recovery handler returned'};
let transport, busy = false;
const frames = [];
function buttons() { $('connect').disabled=busy; $('read').disabled=busy||!transport; $('save').disabled=!frames.length; }
function say(s) { $('status').textContent=s; }
async function read() {
  const value=await readStartupStatus(transport);
  const report={ time:new Date().toISOString(), product:transport.device.productName, ...value };
  frames.push(report); if(frames.length>120)frames.shift();
  $('stage').textContent=`Stage 0x${value.stage.toString(16).toUpperCase()}: ${stages[value.stage]||'Unknown stage'}`;
  $('details').textContent=JSON.stringify(report,null,2);
  say(value.stage===48?'H3B1 confirmed. The USB diagnostic loop is responding.':'H3B1 confirmed. Save the status for investigation.');
}
async function guarded(action) { if(busy)return; busy=true; buttons(); try{await action();}catch(error){say(error.message);}finally{busy=false;buttons();} }
$('connect').onclick=()=>guarded(async()=>{
  const devices=await navigator.hid.requestDevice({filters:[{vendorId:VID,productId:APP_PID,usagePage:1,usage:0}]});
  if(!devices[0])return;
  if(!['H3B03','H3M04'].includes(devices[0].productName))throw new Error('Choose H3B03 or H3M04. Stock HE30 and v0.2 are not these diagnostic applications.');
  await transport?.close(); transport=new HIDTransport(devices[0]); await transport.open(); await read();
});
$('read').onclick=()=>guarded(read);
$('save').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({diagnostic:'HE30 USB startup',frames},null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=`he30-startup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
navigator.hid?.addEventListener('disconnect',event=>{if(transport?.device===event.device){transport.disconnected();transport=null;say('Test application disconnected.');buttons();}});
window.addEventListener('pagehide',()=>transport?.close().catch(()=>{}));
if(!navigator.hid||!window.isSecureContext){say('Use Chrome or Edge on localhost or HTTPS. WebHID is unavailable here.');$('connect').disabled=true;}else buttons();
