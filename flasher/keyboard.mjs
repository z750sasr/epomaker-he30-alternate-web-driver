import {VID,APP_PID,HIDTransport} from './protocol.mjs';
import {FoundationClient,KEY_NAMES,CHANNELS,OUTPUTS,USAGE_NAMES,usageLabel,parseUsage,encodeConfig,exportProfile,importProfile} from './keyboard-protocol.mjs';
import {createLightingUI} from './lighting-ui.mjs';
const $=id=>document.getElementById(id),supported=!!navigator.hid&&window.isSecureContext;
let transport,client,status,draft,selected=0,localEdits=false,busy=false,polling=false,pollTimer,pollTask,pollFault=false,session=0;
const editIds=['group1','group2','group3','settle','verified','startup','normal','fn','actuation','hysteresis','rtPress','rtRelease','top','bottom','rapid','keyDisabled'];
const lightingUI=createLightingUI({runAction:action,getSelected:()=>selected,keyNames:KEY_NAMES,onDirty:()=>controls()});
for(const id of ['group1','group2','group3'])OUTPUTS.forEach((name,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=name;$(id).append(option);});
for(const [code,name] of USAGE_NAMES){const option=document.createElement('option');option.value=name;option.label=`0x${code.toString(16).toUpperCase().padStart(2,'0')}`;$('usageNames').append(option);}
const cards=KEY_NAMES.map((name,index)=>{
  const card=document.createElement('button');card.type='button';card.className='key';card.disabled=true;
  const title=document.createElement('strong');title.textContent=name;const route=document.createElement('span');route.textContent=`Group ${Math.floor(index/12)+1} · ADC${CHANNELS[index%12]}`;
  const values=document.createElement('span');values.textContent='No reading';const learned=document.createElement('span');learned.textContent='Not calibrated';card.append(title,route,values,learned);$('keys').append(card);
  card.onclick=()=>{if(!draft||busy)return;captureEditor();selected=index;renderEditor();renderCards();lightingUI.select();};return{card,values,learned};
});
function tell(message,error=false){$('message').textContent=message;$('message').classList.toggle('warning',error);}
function controls(){
  $('connect').disabled=!supported||busy;
  const ready=!!client&&!busy,editable=ready&&!!draft&&!(status?.calibrationPhase>0);
  for(const id of editIds)$(id).disabled=!editable;
  for(const {card} of cards)card.disabled=!editable;
  for(const id of ['read','disable','retry'])$(id).disabled=!ready;
  for(const id of ['apply','applyKeys','copyTuning','export','import'])$(id).disabled=!editable;
  const idle=status?.calibrationPhase===0;
  $('calibrate').disabled=!ready||!draft||localEdits||!idle||!!status?.adcError;
  $('finish').disabled=!ready||status?.calibrationPhase!==2||!status?.calibrated.every(Boolean);
  $('abort').disabled=!ready||idle||!status;
  $('enable').disabled=!ready||!idle||!!status?.typingEnabled||!!status?.adcError||!status?.calibrated.every(Boolean)||!(status?.configFlags&1)||localEdits;
  $('save').disabled=!ready||!idle||localEdits||lightingUI.dirty||!status?.dirty;
  $('reload').disabled=!ready||!idle||!status?.savedValid;
  $('defaults').disabled=!ready||!idle;
  $('draftState').textContent=!draft?'No settings loaded.':localEdits?'Page has unapplied edits. Apply them before calibration or saving.':'Page matches the last configuration read from the keyboard.';
  lightingUI.controls(ready);
}
function renderEditor(){
  if(!draft)return;const key=draft.keys[selected];$('editorTitle').textContent=`${KEY_NAMES[selected]} · key settings`;
  $('normal').value=usageLabel(key.normalUsage);$('fn').value=usageLabel(key.fnUsage);
  for(const id of ['actuation','hysteresis','rtPress','rtRelease'])$(id).value=Number.isFinite(key[id])?String(key[id]/10):'';
  $('top').value=String(key.topDeadzone);$('bottom').value=String(key.bottomDeadzone);$('rapid').checked=key.rapidTrigger;$('keyDisabled').checked=key.disabled;
}
function captureEditor(){
  if(!draft)return;
  // Invalid partial edits remain on screen and are rejected by Apply/Export.
  const key=draft.keys[selected];
  try{key.normalUsage=parseUsage($('normal').value);}catch{key.normalUsage=NaN;}
  try{key.fnUsage=parseUsage($('fn').value,true);}catch{key.fnUsage=NaN;}
  for(const id of ['actuation','hysteresis','rtPress','rtRelease']){
    const value=$(id).value.trim()===''?NaN:Number($(id).value)*10;
    key[id]=Math.abs(value-Math.round(value))<1e-8?Math.round(value):value;
  }
  key.topDeadzone=$('top').value.trim()===''?NaN:Number($('top').value);key.bottomDeadzone=$('bottom').value.trim()===''?NaN:Number($('bottom').value);
  key.rapidTrigger=$('rapid').checked;key.disabled=$('keyDisabled').checked;
}
function captureDraft(){
  captureEditor();draft.groupOutputs=['group1','group2','group3'].map(id=>Number($(id).value));draft.settleLoops=Number($('settle').value);draft.bankVerified=$('verified').checked;draft.startupTyping=$('startup').checked;encodeConfig(draft);return draft;
}
function showDraft(config){
  draft=config;localEdits=false;draft.groupOutputs.forEach((value,i)=>$(`group${i+1}`).value=String(value));$('settle').value=String(draft.settleLoops);$('verified').checked=draft.bankVerified;$('startup').checked=draft.startupTyping;renderEditor();controls();
}
function renderCards(){
  cards.forEach(({card,values,learned},i)=>{card.classList.toggle('selected',i===selected);card.classList.toggle('pressed',!!status?.pressed[i]);card.classList.toggle('learned',!!status?.calibrated[i]);values.textContent=status?`Raw ${status.raw[i]} · ${(status.positions[i]/10).toFixed(1)}%`:'No reading';learned.textContent=status?.calibrated[i]?'Range learned':'Range not learned';});
}
function showStatus(value){
  status=value;const count=value.calibrated.filter(Boolean).length;
  $('typingState').textContent=value.adcError?`ADC error ${value.adcError}`:!value.usbReady?'USB not ready':value.releaseInterlock?'Release all keys':value.typingEnabled?'Enabled':'Disabled';
  $('learnedState').textContent=`${count}/36 ranges`; $('savedState').textContent=value.dirty?'Unsaved RAM changes':value.savedValid?`Saved record ${value.savedSequence}`:'No saved record';
  $('calibrationProgress').value=count;
  $('calibrationState').textContent=value.calibrationPhase===1?`Keep every key released. Collecting released frames: ${value.restFrames}/32.`:value.calibrationPhase===2?`Press every key fully, then release it. ${count}/36 ranges learned. Finish after all keys are released.`:count===36?'All 36 ranges available. Release all keys, then enable typing.':`Calibration idle. ${36-count} keys still need a valid learned range.`;
  $('rawStatus').textContent=JSON.stringify(value,null,2);renderCards();controls();
}
function schedule(){clearTimeout(pollTimer);if(client&&!busy&&!pollFault)pollTimer=setTimeout(poll,150);}
async function poll(){
  if(!client||busy||polling)return;polling=true;const current=client,generation=session;
  pollTask=(async()=>{try{const value=await current.readStatus();if(client===current&&generation===session){showStatus(value);await lightingUI.poll();}}catch(error){if(generation===session){pollFault=true;tell(`Status polling stopped: ${error.message} Use Read device settings or reconnect.`,true);}}finally{polling=false;schedule();}})();await pollTask;
}
async function action(work){
  if(busy)return;busy=true;clearTimeout(pollTimer);controls();
  try{await pollTask?.catch(()=>{});await work();pollFault=false;}catch(error){tell(error.message,true);}finally{busy=false;controls();schedule();}
}
async function refreshConfig(){const current=client;const config=await current.readConfig();const value=await current.readStatus();if(client===current){showDraft(config);showStatus(value);await lightingUI.refresh();}}
$('connect').onclick=()=>action(async()=>{
  const devices=await navigator.hid.requestDevice({filters:[{vendorId:VID,productId:APP_PID,usagePage:1,usage:0}]});if(!devices[0])return;
  if(!['H3K05','H3K06','H3K07','H3K08'].includes(devices[0].productName))throw new Error('Choose H3K05, H3K06 or H3K07 foundation firmware. The stock driver and earlier diagnostics use different protocols.');
  await transport?.close().catch(()=>{});session++;client=null;status=null;transport=new HIDTransport(devices[0]);await transport.open();client=new FoundationClient(transport);await lightingUI.reset(client);await refreshConfig();tell('H3K1 confirmed. Settings and status read; no configuration, calibration or typing command was sent.');
});
$('read').onclick=()=>action(async()=>{await refreshConfig();tell('Device settings read. The page draft now matches the keyboard.');});
for(const id of editIds)$(id).addEventListener('input',()=>{localEdits=true;controls();});
async function apply(){const config=captureDraft();showDraft(await client.applyConfig(config));showStatus(await client.readStatus());tell('Settings applied to RAM and read back. Release all keys before typing resumes. Use Save to make them persistent.');}
for(const id of ['apply','applyKeys'])$(id).onclick=()=>action(apply);
$('copyTuning').onclick=()=>{try{captureEditor();const from=draft.keys[selected];for(const key of draft.keys)for(const field of ['actuation','hysteresis','rtPress','rtRelease','rapidTrigger','topDeadzone','bottomDeadzone'])key[field]=from[field];localEdits=true;controls();tell('Tuning copied to all keys in the page draft. Bindings and disabled states were preserved. Apply to send it.');}catch(error){tell(error.message,true);}};
const controlActions={calibrate:[4,'Calibration started. Keep every key released for the initial 32 frames.'],finish:[5,'Calibration finished. Enable typing explicitly, then save when ready.'],enable:[6,'Typing enabled. Release all keys to clear the interlock.'],disable:[7,'Typing disabled and release requested.'],save:[8,'Custom settings and calibration saved to the keyboard journal.'],defaults:[9,'Custom RAM settings reset. This did not restore manufacturer firmware or erase saved custom records.'],retry:[10,'Scanner retry requested.'],abort:[11,'Calibration aborted. Typing remains disabled.'],reload:[12,'Saved custom settings loaded. Release all keys before typing resumes.']};
for(const [id,[operation,message]] of Object.entries(controlActions))$(id).onclick=()=>action(async()=>{await client.control(operation);await refreshConfig();tell(message);});
$('export').onclick=()=>{try{const profile=exportProfile(captureDraft());const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`he30-foundation-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('Profile exported, including current draft bindings, tuning and calibration.');}catch(error){tell(error.message,true);}};
$('import').onchange=async()=>{const file=$('import').files[0];if(!file||busy)return;try{if(file.size>1000000)throw new Error('Profile is too large. Choose an exported foundation JSON profile.');const config=importProfile(JSON.parse(await file.text()));showDraft(config);localEdits=true;controls();tell('Profile loaded into the page for review. No device write occurred. Verify groups/calibration, then Apply and Save if wanted.');}catch(error){tell(error.message,true);}finally{$('import').value='';}};
navigator.hid?.addEventListener('disconnect',event=>{if(transport?.device===event.device){session++;clearTimeout(pollTimer);transport.disconnected();transport=null;client=null;pollFault=true;status=null;renderCards();controls();$('typingState').textContent='Disconnected';tell('Keyboard disconnected. The page draft remains available, but it has not been saved automatically.');}});
window.addEventListener('pagehide',()=>{session++;clearTimeout(pollTimer);client=null;transport?.close().catch(()=>{});});
if(!supported)tell('Use Chrome or Edge on localhost or HTTPS. WebHID is unavailable here.',true);controls();renderCards();
