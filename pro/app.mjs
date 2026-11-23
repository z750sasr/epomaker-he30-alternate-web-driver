import {bindBoardSelection} from './board-selection.mjs';
import {liveTravelPanel,bindLiveTravelPanel,paintLiveTravel} from './live-travel.mjs';
import {renderRemap,bindRemap,layerTabs,remapKeyLegend} from './remap.mjs';
import {startGamepadTester} from './gamepad-tester.mjs';
import {openAdvancedKeyPicker} from './key-picker.mjs';
import {beginRecovery} from '../flasher/recovery.mjs';
import {ProDevice,SAVE_DIAGNOSTICS_MODEL,LIVE_SAVE_TEST_MODEL,ONBOARD_SAVE_TEST_MODEL,FLASH_RESIDENT_SAVE_MODEL,PROFILE_KEY_MODEL,NKRO_MODEL,ADC_RGB_FIX_MODEL,CALIBRATION_QOL_MODEL,DESKTOP_PRODUCTS,FN_RGB_PRODUCTS,GAMEPAD,RATES,ZUOYA,KEY_NAMES,actionBytes,bindingCode,bindingLabel,encodeConfig,encodeLighting,isProfileUsage,isDesktopUsage,isMediaUsage} from './protocol.mjs';
import {DISTANCE_MODES,distanceField,distanceLabel,storedDistance} from './tuning.mjs';
import {FEATURES,actionDepthFields,actionForFeature,actionKeys,renderAdvanced} from './advanced.mjs';
import {USAGE_NAMES,importProfile} from '../flasher/keyboard-protocol.mjs';
import {encodeFnLighting,encodeLightingPreferences,importLighting,LED_TO_KEY} from '../flasher/lighting-protocol.mjs';
import {
  GAMEPAD_ACTIONS,GAMEPAD_MODES,GAMEPAD_OPPOSITION,GAMEPAD_NONE,
  defaultGamepad,encodeGamepad,decodeGamepad,assignGamepad,
  gamepadActionForKey,migrateLegacyGamepad
} from './gamepad.mjs';
const byId=id=>document.getElementById(id);
const rows=[
  ['Esc','F1','F2','F3','F4','F5','F6'],
  ['Grave','1','2','3','4','5','6'],
  ['Tab','Q','W','E','R','T'],
  ['Caps','A','S','D','F','G'],
  ['LShift','Z','X','C','V','B'],
  ['Ctrl','Fn','Alt','Space']
].map(row=>row.map(k=>KEY_NAMES.indexOf(k)));
const codeFor=name=>bindingCode(name==='Caps'?'Caps Lock':name==='LShift'?'Left Shift':name==='Ctrl'?'Left Ctrl':name==='Alt'?'Left Alt':name,0);
const blankAction=()=>({kind:0,key:0,other:1,mode:0,usage:[0,0,0,0],depth:[250,650,900]});
const defaults=()=>({
  version:1,groupOutputs:[2,0,1],settleLoops:16000,bankVerified:true,startupTyping:true,
  calibrated:Array(36).fill(false),released:Array(36).fill(0),pressed:Array(36).fill(0),
  keys:KEY_NAMES.map(name=>({normalUsage:codeFor(name),fnUsage:254,actuation:500,hysteresis:50,rtPress:40,rtRelease:40,rapidTrigger:false,topDeadzone:0,bottomDeadzone:0,disabled:false}))
});
const blankFnLighting=()=>Array.from({length:2},()=>({enabled:false,palette:Array.from({length:36},()=>[0,0,0])}));
const defaultProfile=()=>({name:'Profile',fn2:Array(36).fill(254),fnLighting:blankFnLighting(),gamepad:Array(36).fill(0),travel:Array(36).fill(4000),coefficient:Array(36).fill(0),
  actions:Array.from({length:10},blankAction),lighting:{version:1,mode:1,order:0,rate:0,barCount:5,barEnabled:true,color:[16,16,16],barColor:[16,16,16],palette:Array.from({length:36},()=>[0,0,0])}});
const offline=Array.from({length:4},(_,i)=>({config:defaults(),profile:{...defaultProfile(),name:'Profile '+(i+1)}}));
let client=null,config=offline[0].config,profile=offline[0].profile;
let info={active:0,rate:3,scanMode:0,gamepad:false,mouse:true,names:offline.map(p=>p.profile.name)};
let status=null,rgb=null,slot=0,layer=0,key=0,page=new URLSearchParams(location.search).get('page')==='gamepad'?'gamepad':'performance',view='quick',busy=false,dirty=false,generation=0,pollPending=false;
let lightingDraft=null,barDraft=null,paletteEdited=false,lightingLayer=0;
let lightingArea='keyboard',controllerView='setup',showSwitchAdc=false;
let advancedKind=null;
let controller={...defaultGamepad(),mode:1},padState=null,padChoice=null,usbTransition=false;
let autoSaveTimer, recoveryPending=false;
let selectionOnlyDirty=false;
let selectedKeys=new Set([key]);
let selectionAnchor=key;
let distancePrecision=0,boardGauge=false,syncRapid=false;
let liveTravel=false, travelPanelPosition=null, travelSelectionOnly=true;
let lastFullStatus=0;
let lastProfileCheck=0;
const tuningPage=()=>page==='performance'&&['actuation','rapid'].includes(view);
const switchAdcVisible=()=>showSwitchAdc&&page==='performance'&&view==='switches';
const multiKeyPage=()=>tuningPage()||page==='lighting'&&lightingArea==='keyboard'||page==='keymap'||(page==='performance'&&view==='switches');
const editTargets=all=>all?KEY_NAMES.map((_,index)=>index):[...selectedKeys];
const selectionLabel=()=>selectedKeys.size===1?KEY_NAMES[key]:selectedKeys.size+' keys';
const visualKeyOrder=rows.flat();
function selectKeys(indices, mode='replace', preferred=key){
  const next=mode==='replace'?new Set():new Set(selectedKeys);
  for(const index of indices){
    if(mode==='remove'||mode==='toggle'&&next.has(index))next.delete(index);
    else next.add(index);
  }
  if(!next.size)next.add(preferred);
  selectedKeys=next;
  key=next.has(preferred)?preferred:[...next][0];
}
let catalog=[{name:'Linear / custom',brand:'Endpoint calibration',travel:4000,coefficient:0},...ZUOYA];
const esc=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const color=(values,scale=1)=>'#'+values.map(value=>Math.round(value*scale).toString(16).padStart(2,'0')).join('');
function channels(input){return input.slice(1).match(/../g).map(n=>Math.round(parseInt(n,16)*32/255));}
const select=(id,label,options,selected)=>'<label>'+label+'<select id="'+id+'">'+options.map((label,i)=>'<option value="'+i+'" '+(i===selected?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
const field=(id,label,value,min,max,step=1)=>'<label>'+label+'<input type="number" id="'+id+'" value="'+value+'" min="'+min+'" max="'+max+'" step="'+step+'"></label>';
const check=(id,text,value)=>'<label class="check"><input id="'+id+'" type="checkbox" '+(value?'checked':'')+'>'+text+'</label>';
const textField=(id,label,value,list='')=>'<label>'+label+'<input id="'+id+'" '+(list?'list="'+list+'"':'')+' value="'+esc(value)+'"></label>';
const bindingField=(id,label,value)=>'<div class="binding-field">'+textField(id,label,value,'keyCodes')+
  '<button type="button" class="button ghost" data-picker="'+id+'">Choose key</button></div>';
const btn=(label,action,disabled=false)=>'<button type="button" class="button ghost" data-action="'+action+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
const commands=(...items)=>'<div class="commands">'+items.join('')+'</div>';
const grid=(...items)=>'<div class="pro-grid">'+items.join('')+'</div>';
const brightness=(id,label,value=100)=>'<label class="rgb-brightness">'+label+
  '<input type="range" id="'+id+'" min="0" max="100" value="'+value+'"><output for="'+id+'">'+value+'%</output></label>';
const liveOnly=!navigator.hid;
const diagnosticSave=(active=client)=>[SAVE_DIAGNOSTICS_MODEL,LIVE_SAVE_TEST_MODEL,ONBOARD_SAVE_TEST_MODEL].includes(active?.transport.device.productName);
const recoverySave=(active=client)=>diagnosticSave(active)||['H3K13','H3K14','H3K15'].includes(active?.transport.device.productName);
const browserRates=()=>diagnosticSave()||client?.transport.device.productName==='H3K15';
const onboardRates=()=>[FLASH_RESIDENT_SAVE_MODEL,PROFILE_KEY_MODEL,NKRO_MODEL,...FN_RGB_PRODUCTS].includes(client?.transport.device.productName);
const adcProblem=()=>status?.adcError?'ADC stopped after an error.':status?.raw?.some(value=>value>4095)?'The scanner is returning invalid ADC values.':'';
const partialCalibration=()=>[CALIBRATION_QOL_MODEL,...DESKTOP_PRODUCTS].includes(client?.transport.device.productName);
const desktopKeys=()=>!client||client.supportsDesktopKeys;
const mediaKeys=()=>!client||client.supportsMedia;
const lightingPreferences=()=>profile.lightingPreferences??{speed:50,sleep:0,keepBar:false};
const calibrationAdviceShown=new Set();
let switchCalibrationAdvice=false,endpointDeviationSince=0,endpointDeviationKeys=[];
function maybeRecommendCalibration(){
  if(!client||!status||!status.frames||status.calibrationPhase||status.startupBaseline===1||adcProblem()||
     document.querySelector('dialog[open]')||byId('workspace').hidden)return;
  let reason,detail;
  if(switchCalibrationAdvice&&!calibrationAdviceShown.has('switch')){
    reason='switch';detail='The switch settings changed. If you installed different switches, calibrate the affected keys.';
  }else if(status.missingKeys&&!calibrationAdviceShown.has('missing')){
    reason='missing';detail=status.missingKeys+' of 36 keys are missing calibration. '+(partialCalibration()?'You can calibrate individual keys.':'This firmware calibrates all keys together.');
  }else if(!calibrationAdviceShown.has('deviation')){
    const outside=status.raw.flatMap((raw,i)=>{
      if(!config.calibrated[i])return [];
      const low=Math.min(config.released[i],config.pressed[i]),high=Math.max(config.released[i],config.pressed[i]);
      const margin=Math.max(96,(high-low)/4);
      return raw<low-margin||raw>high+margin?[i]:[];
    });
    const sustained=endpointDeviationKeys.filter(i=>outside.includes(i));
    if(!sustained.length){endpointDeviationKeys=outside;endpointDeviationSince=performance.now();return;}
    endpointDeviationKeys=sustained;
    if(performance.now()-endpointDeviationSince<1500)return;
    reason='deviation';detail='Readings for '+sustained.map(i=>KEY_NAMES[i]).join(', ')+' repeatedly fell outside their calibrated range. If you changed switches or the keys are behaving oddly, recalibrate those keys.';
  }
  if(!reason)return;
  calibrationAdviceShown.add(reason);
  byId('calibrationAdviceDetail').textContent=detail;
  const dialog=byId('calibrationAdvice');
  dialog.returnValue='';dialog.showModal();
}
const profileKeys=()=>!client||client.supportsProfileKeys;
const sessionRates=new Map();
const rememberedRatesKey=active=>active.transport.device.productName;
const rememberedRates=()=>sessionRates.get(rememberedRatesKey(client))??null;
const keepChanges=()=>recoverySave()?'Export this profile to keep a copy.':'Save changes to keep them after unplugging.';
const values=id=>Number(byId(id).value);
const checkbox=id=>byId(id).checked;
const named=id=>byId(id).value;
const num=(id,min,max)=>{
  const input=byId(id),n=Number(input.value);
  if(input.value===''||!Number.isFinite(n)||n<min||n>max)throw new Error('Check '+input.closest('label').firstChild.textContent+'.');
  return n;
};
function message(text,error=false){
  byId('status').textContent=text;
  byId('status').classList.toggle('error',error);
}
function acceptStatus(next,selectionChanged=false){
  // Existing firmware marks its journal dirty when only the active slot changes.
  const sameJournal=status&&next.savedSequence===status.savedSequence;
  const sameConfig=status&&next.configCRC===status.configCRC;
  selectionOnlyDirty=!!(next.dirty&&sameJournal&&!dirty&&(selectionChanged||selectionOnlyDirty&&sameConfig));
  status=next;
  dirty=next.dirty&&!selectionOnlyDirty;
}
async function refresh(isCurrent=()=>true){
  const current=client;
  if(!current)return false;
  const valid=()=>current===client&&isCurrent();
  for(let attempt=0;attempt<2&&valid();attempt++){
    const next=await current.capabilities(),nextConfig=await current.foundation.readConfig(),nextProfile=await current.profile();
    if(!valid())return false;
    const state=await current.foundation.readStatus();
    if(current.lighting.supportsFnLighting)nextProfile.fnLighting=await current.lighting.readFn(next.active);
    if(current.lighting.supportsPreferences)nextProfile.lightingPreferences=await current.lighting.readPreferences(next.active);
    const nextController=current.supportsGamepad?await current.readGamepad():null;
    const nextPadState=current.supportsGamepad?await current.gamepadStatus():null;
    const confirmed=await current.activeProfile();
    if(!valid())return false;
    if(confirmed!==next.active)continue;
    const switched=next.active!==info.active;
    if(switched){advancedKind=null;slot=0;rgb=null;}
    acceptStatus(state,switched);
    info=next;config=nextConfig;profile=nextProfile;
    if(!profile.fnLighting)lightingLayer=0;
    if(nextController)controller=nextController;
    padState=nextPadState;
    padChoice=fullGamepad()?gamepadActionForKey(controller,key):null;
    lastProfileCheck=lastFullStatus=performance.now();
    return true;
  }
  if(!valid())return false;
  throw new Error('The onboard profile changed while being read. Release the profile shortcut and try again.');
}
const fullGamepad=()=>!client||client.supportsGamepad;
function controllerLabel(index){
  if(!fullGamepad())return profile.gamepad[index]?GAMEPAD[profile.gamepad[index]]:'';
  const action=gamepadActionForKey(controller,index);
  return action===null?'':GAMEPAD_ACTIONS[action].label;
}
function controllerBindings(settings){
  const bindings=Array(36).fill(0);
  [...settings.analog,...settings.digital].forEach((binding,action)=>{
    if(binding.key!==GAMEPAD_NONE)bindings[binding.key]=action+1;
  });
  return bindings;
}
function controllerForBindings(bindings,settings=controller){
  const next=structuredClone(settings),targets=[...next.analog,...next.digital];
  targets.forEach(binding=>{binding.key=GAMEPAD_NONE;});
  bindings.forEach((action,index)=>{if(action)targets[action-1].key=index;});
  return decodeGamepad(encodeGamepad(next));
}
async function run(task){
  if(busy)return;
  busy=true;generation++;document.body.classList.add('working');
  document.documentElement.setAttribute('data-driver-busy','');
  byId('save').disabled=true;byId('activeProfile').disabled=true;
  try{await task();}
  catch(err){await reportDeviceError(err);}
  finally{busy=false;document.body.classList.remove('working');document.documentElement.removeAttribute('data-driver-busy');render();}
}
async function reportDeviceError(error){
  const failed=client;
  if(!failed||error.name!=='HIDTimeoutError'){message(error.message,true);return;}
  clearTimeout(autoSaveTimer);
  client=null;generation++;status=padState=rgb=null;
  render();
  message(error.message+' Connection released. Select Connect keyboard to read its current settings.',true);
  await failed.transport.close().catch(()=>{});
}
function mark(text='Changes applied. '+keepChanges()){
  selectionOnlyDirty=false;dirty=true;message(client?text:'Offline workspace updated.');queueAutoSave();
}
function selectedUsage(idx){
  return layer===2?profile.fn2[idx]:layer===1?config.keys[idx].fnUsage:config.keys[idx].normalUsage;
}
function readLightingEditor(scope='keyboard'){
  if(scope==='bar'){
    const next=structuredClone(profile.lighting);
    Object.assign(next,{rate:values('waveRate'),barColor:channels(named('barColor')),barEnabled:checkbox('barEnabled')});
    if(byId('barBrightness'))next.barBrightness=values('barBrightness');
    if(byId('barMode'))Object.assign(next,{barMode:values('barMode'),barRainbow:checkbox('barRainbow'),barReverse:!!values('barDirection')});
    return next;
  }
  if(lightingLayer){
    const next=structuredClone(profile.fnLighting[lightingLayer-1]);
    next.enabled=checkbox('fnRgbEnabled');
    if(paletteEdited){
      const keyColor=channels(named('perKey'));
      for(const index of selectedKeys)next.palette[index]=keyColor;
    }
    return next;
  }
  const next=structuredClone(profile.lighting);
  Object.assign(next,{mode:values('lightMode'),order:values('colorOrder'),color:channels(named('keyColor'))});
  if(byId('keyBrightness'))next.keyBrightness=values('keyBrightness');
  if(next.mode===2&&paletteEdited){
    const keyColor=channels(named('perKey'));
    for(const index of selectedKeys)next.palette[index]=keyColor;
  }
  return next;
}
function previewBarColor(light,index,time){
  if(!light.barEnabled||index>=light.barCount)return [0,0,0];
  let result=light.barColor;
  const mode=light.barMode??0;
  if(mode===3){
    const phase=(Math.floor(time*10/33)*0x010203)&0xffffff;
    result=[phase>>>16,(phase>>>8)&255,phase&255];
  }else if(mode){
    const pulse=time%256;
    const level=mode===1?Math.floor(Math.min(pulse,255-pulse)/4):32;
    if(mode===1&&!light.barRainbow)result=result.map(channel=>channel*level/32);
    else{
      const led=light.barReverse?4-index:index;
      const hue=(time*(mode===2?3:1)+(mode===2?112*led:0))%768;
      const sector=hue>>8,amount=(hue&255)*level>>8;
      result=[0,0,0];result[sector]=level-amount;result[(sector+1)%3]=amount;
    }
  }
  return result.map(channel=>Math.round(channel*(light.barBrightness??100)/100));
}
function paintBarControls(){
  if(!byId('barMode'))return;
  const mode=values('barMode');
  byId('barColor').closest('label').hidden=mode>=2||mode===1&&checkbox('barRainbow');
  byId('barRainbow').closest('label').hidden=mode!==1;
  byId('barDirection').closest('label').hidden=mode!==2;
}
const physicalLedIndex=KEY_NAMES.map((_,index)=>LED_TO_KEY.indexOf(index));
function previewKeyColor(light,index,animation){
  let channels=[0,0,0];
  const mode=light.mode;
  if(mode===1||mode===3&&status?.pressed[index])channels=light.color;
  if(mode===2)channels=light.palette[index];
  if(mode===4){
    const position=(animation+5*physicalLedIndex[index])%192;
    const segment=position>>6,amplitude=(position&63)>>2;
    channels[segment]=16-amplitude;channels[(segment+1)%3]=amplitude;
  }
  if(mode===5){
    const phase=animation%192,level=Math.min(phase,192-phase);
    channels=light.color.map(channel=>Math.floor(channel*level/96));
  }
  return channels.map(channel=>Math.round(channel*(light.keyBrightness??100)/100));
}
const keyWidths={Tab:1.5,Caps:1.75,LShift:2.25,Ctrl:1.25,Fn:1.25,Alt:1.25,Space:2.75};
function boardKey(index, mode){
  const name=KEY_NAMES[index], physical=name==='Grave'?'~':name;
  const tuning=config.keys[index],travel=profile.travel[index];
  const distance=(value,showMillimeters)=>distanceLabel(value,travel,distancePrecision,{showMillimeters});
  if(mode==='actuation')return {contents:`<b class="pro-key-value">${distance(tuning.actuation,false)}</b>`,title:`${name} · Actuation ${distance(tuning.actuation,true)}`};
  if(mode==='rapid'){
    if(!tuning.rapidTrigger)return {contents:'<b class="pro-key-value">—</b>',title:`${name} · Rapid Trigger off`};
    const {rtPress:press,rtRelease:release}=tuning;
    const values=press===release?distance(press,false):`<span>${distance(press,false)}</span><span class="pro-key-value-divider" aria-hidden="true">/</span><span>${distance(release,false)}</span>`;
    return {contents:`<b class="pro-key-value">${values}</b>`,title:`${name} · RT press ${distance(press,true)} · RT release ${distance(release,true)}`};
  }
  if(mode==='lighting')return {contents:'',title:`${name} LED`};
  const usage=selectedUsage(index);
  if(mode==='keymap')return {contents:`<b class="pro-key-mapping">${remapKeyLegend(usage)}</b><small class="pro-key-physical">${esc(physical)}</small>`,title:`${name} · ${bindingLabel(usage)}`};
  if(mode==='gamepad'){
    const label=controllerLabel(index);
    return {contents:`<span>${esc(physical)}</span><small class="pro-key-mapping">${esc(label)}</small>`,title:`${name} · ${label||'Unassigned'}`,bound:!!label};
  }
  const badges=`<span class="pro-key-ap" title="Actuation point">AP ${distance(tuning.actuation,true)}</span>${tuning.rapidTrigger?'<span class="pro-key-rt" title="Rapid Trigger">RT</span>':''}${tuning.topDeadzone||tuning.bottomDeadzone?'<span class="pro-key-dz" title="Dead zones">DZ</span>':''}`;
  return {contents:`<span>${esc(physical)}</span><small class="pro-key-mapping">${esc(bindingLabel(usage))}</small>${badges}`,title:`${name} · ${bindingLabel(usage)}`};
}
function renderBoard(){
  const board=byId('board');
  board.hidden=page==='firmware'||page==='settings'||page==='diagnostics';
  if(board.hidden)return;
  const mode=tuningPage()?view:page;
  const lightbarOnly=mode==='lighting'&&lightingArea==='bar';
  board.dataset.keyView=mode;
  board.classList.toggle('lightbar-only',lightbarOnly);
  const keyboard=rows.map(row=>'<div class="pro-row">'+row.map(index=>{
    const selected=multiKeyPage()?selectedKeys.has(index):index===key;
    const {contents,title,bound}=boardKey(index,mode);
    return `<button type="button" class="pro-key" data-key="${index}" aria-pressed="${selected}" data-selected="${selected}" data-controller="${!!bound}" style="--key-u:${keyWidths[KEY_NAMES[index]]||1}" aria-label="${esc(title)}" title="${esc(title)}">${contents}<span class="calibration-adc" hidden></span></button>`;
  }).join('')+'</div>').join('');
  const bar=mode==='lighting'?'<div class="pro-bar" role="img" aria-label="Five lightbar LEDs">'+Array(5).fill('<i></i>').join('')+'</div>':'';
  board.innerHTML=(lightbarOnly?bar:'<div class="pro-board">'+keyboard+bar+'</div>')+
    (page==='lighting'?'<p id="rgbPreviewStatus" class="rgb-preview-status"></p>':'')+
    (multiKeyPage()?'<div class="pro-selection-toolbar"><span>Drag to select. Shift selects a range. Ctrl/⌘ toggles keys. Alt removes keys.</span><strong>'+esc(selectionLabel())+
      '</strong><button type="button" class="button ghost small" data-action="selectAllKeys">Select all</button><button type="button" class="button ghost small" data-action="invertKeys">Invert</button><button type="button" class="button ghost small" data-action="singleKey">Primary only</button></div>':'');
}
function paintBoard(){
  const board=byId('board');
  const lighting=page==='lighting';
  const layerPalette=lighting&&lightingLayer?lightingDraft??profile.fnLighting?.[lightingLayer-1]:null;
  const light=layerPalette?{...profile.lighting,mode:2,palette:layerPalette.palette}:lightingDraft??profile.lighting;
  const frame=lighting&&!lightingLayer&&!lightingDraft?rgb:null;
  const animation=Math.floor(performance.now()*lightingPreferences().speed/500);
  const preview=byId('rgbPreviewStatus');
  if(preview){
    const text=lightingArea==='bar'?(barDraft?'Lightbar preview':rgb?'Live lightbar':'Lightbar preview'):
      layerPalette?`Fn${lightingLayer} palette preview · ${layerPalette.enabled?'enabled':'disabled'}`:
      lightingDraft?'Previewing lighting changes':frame?'Live keyboard and light strip':client?'Waiting for the keyboard’s RGB frame':'Offline lighting preview';
    if(preview.textContent!==text)preview.textContent=text;
  }
  const calibrating=!!client&&!!status?.calibrationPhase&&!lighting&&!tuningPage()&&page!=='keymap'&&page!=='gamepad';
  const adcVisible=!!client&&!!status?.raw&&(calibrating||switchAdcVisible());
  board.classList.toggle('calibration-active',calibrating);
  board.classList.toggle('show-adc-readings',adcVisible);
  board.classList.toggle('show-key-gauge',boardGauge&&page!=='lighting');
  for(const element of board.querySelectorAll('[data-key]')){
    const i=Number(element.dataset.key);
    const reading=element.querySelector('.calibration-adc');
    reading.hidden=!adcVisible;
    if(adcVisible){
      const raw=String(status.raw[i]);
      if(reading.textContent!==raw)reading.textContent=raw;
      element.setAttribute('aria-label',KEY_NAMES[i]+' · '+raw+' ADC'+(calibrating&&status.calibrated[i]?' · measured':''));
    }else if(element.getAttribute('aria-label')!==element.title)element.setAttribute('aria-label',element.title);
    if(calibrating){
      element.dataset.calibrated=status.calibrated[i];
      if(partialCalibration())element.dataset.calibrationState=status.calibrated[i]?'captured':config.calibrated[i]?'previous':'missing';
    }else{
      delete element.dataset.calibrated;
      delete element.dataset.calibrationState;
    }
    element.dataset.pressed=!!status?.pressed[i];
    if(boardGauge)element.style.setProperty('--depth',(status?.positions[i]||0)/10+'%');
    if(lighting){
      const actual=frame?Array.from(frame.subarray(3*i,3*i+3)):previewKeyColor(light,i,animation);
      element.style.setProperty('--key-rgb',color(actual,255/32));
    }
  }
  byId('board').querySelectorAll('.pro-bar i').forEach((led,i)=>{
    const bar=barDraft??profile.lighting;
    const actual=lighting&&rgb&&!barDraft?Array.from(rgb.subarray(108+3*i,111+3*i)):previewBarColor(bar,i,animation);
    led.style.setProperty('--bar-color',color(actual,bar.barMode===3?1:255/32));
  });
  paintTravelMonitor();
  paintRuleTravel();
  const rollover=byId('keyboardRollover');
  if(rollover)rollover.textContent=[NKRO_MODEL,...FN_RGB_PRODUCTS].includes(client?.transport.device.productName)&&status?.nkro?
    'NKRO active · 6KRO on host boot request':'6-key rollover plus modifiers';
  const pos=status?.positions[key];
  const travel=byId('travelReading');
  if(travel)travel.textContent=pos==null?'—':(pos*profile.travel[key]/1e6).toFixed(3)+' mm estimated · '+(pos/10).toFixed(1)+'%';
  const problem=adcProblem(),cal=byId('calState');
  if(cal){
    const n=status?.calibrated.filter(Boolean).length||0;
    cal.textContent=problem?problem+' Restart the scanner before calibrating.':status?.calibrationPhase===1?'Keep all keys released while baseline readings are collected.':status?.calibrationPhase===2?partialCalibration()?'Fully press and release the keys you want to calibrate. '+n+' captured.':'Fully press and release each key. '+n+' of 36 measured.':status?.startupBaseline===1?'Release all keys. Waiting for stable idle readings.':status?.startupBaseline===2?'Startup baseline active. Calibrate to measure full key travel.':n+' of 36 keys calibrated.';
    byId('calProgress').value=n;
    byId('finish').disabled=!client||!!problem||(partialCalibration()?n===0:n!==36)||status?.calibrationPhase!==2;
    byId('editor').querySelector('[data-action="begin"]').disabled=!client||!!problem||!!status?.calibrationPhase;
  }
  const diag=byId('scanStats');
  if(diag)diag.textContent=problem?problem+' Restart the scanner to resume live readings.':
    info.scanHz?info.scanHz.toLocaleString()+' Hz complete 36-key scans · '+(info.scanTicks/144).toFixed(1)+' µs ADC frame · '+(info.scanWorst/144).toFixed(1)+' µs worst ADC frame':'Awaiting a scan measurement';
  if(byId('rawData'))byId('rawData').textContent=status?.raw?KEY_NAMES.map((k,i)=>k.padEnd(7)+String(status.raw[i]).padStart(5)+' ADC   '+(status.positions[i]/10).toFixed(1)+'%').join('\n'):'';
  const running=byId('runningRates');
  if(running)running.textContent=client
    ? 'Active polling rate cap '+(RATES[info.runningRate]?.toLocaleString()||'—')+' Hz · Scan '+(problem?'check Diagnostics':info.scanHz?info.scanHz.toLocaleString()+' Hz':'measuring')
    : 'Connect the keyboard to read its active rates.';
  const pad=byId('controllerStatus');
  if(pad){const text=controllerStatus();if(pad.textContent!==text)pad.textContent=text;}
}
const headings={
  quick:['Quick Settings','Calibrate the sensors and set up the keyboard.'],
  actuation:['Actuation Point','Adjust the selected key’s press point, release hysteresis and dead zones.'],
  rapid:['Rapid Trigger','Set the minimum movement needed to press and release again.'],
  switches:['Magnetic Switches','Assign a switch curve and travel to the selected physical key.'],
  keymap:['Remap','Edit the current onboard profile’s Main, Fn1 and Fn2 layers.'],
  advanced:['Advanced Keys','Configure actions and pairs using physical key positions.'],
  gamepad:['Gamepad','Assign physical keys to Xbox controls and tune their analog response.'],
  lighting:['RGB Settings','Set the 36-key LEDs and the five-LED lightbar.'],
  settings:['Keyboard Settings','Choose the polling rate, scan rate and USB controller visibility.'],
  profiles:['My Profiles','Four onboard slots, each with its own keymap, tuning, actions, gamepad bindings and lighting.'],
  overview:['Device Overview','See the active profile and firmware capabilities.'],
  diagnostics:['Diagnostics','Monitor complete scan frames and inspect sensor readings.'],
  firmware:['Firmware','Load HE30 Pro firmware using the HE30 recovery page.']
};
function controllerStatus(){
  if(!client)return 'Offline workspace. Connect HE30 Pro v0.11 to read its controller settings.';
  if(!client.supportsGamepad)return 'Earlier firmware uses a generic HID controller. Update to v0.11 for Xbox controls.';
  if(!padState)return 'Reading controller status…';
  if(!padState.usbAttached)return 'Xbox interface disabled. Enable it to expose the controller to Windows.';
  if(!padState.mode)return 'Xbox interface enabled. Choose an input mode to start controller output.';
  if(status?.adcError)return 'The scanner reported an error. Open Diagnostics to check the keyboard.';
  if(status?.calibrationPhase)return 'Finish or stop calibration to resume controller input.';
  if(status?.startupBaseline===1)return 'Release all keys while the keyboard measures its startup baseline.';
  if(status&&!status.typingEnabled)return 'Enable typing in Quick Settings to resume key scanning for the controller.';
  if(!padState.armed)return 'Release the assigned keys to arm controller input.';
  const report=new DataView(padState.report.buffer,padState.report.byteOffset,padState.report.byteLength);
  const axis=offset=>(report.getInt16(offset,true)/32768).toFixed(2);
  return 'Firmware output · Left '+axis(6)+' / '+axis(8)+' · Right '+axis(10)+' / '+axis(12)+
    ' · Triggers '+Math.round(padState.report[4]*100/255)+'% / '+Math.round(padState.report[5]*100/255)+'%';
}
function controllerActionSelect(){
  const groups=[['Left stick',0,4],['Right stick',4,8],['Triggers',8,10],['Buttons',10,20],['D-pad',20,24]];
  return '<label>Controller action<select id="gamepadBind"><option value="0" '+(padChoice===null?'selected':'')+'>No assignment</option>'+
    groups.map(([label,start,end])=>'<optgroup label="'+label+'">'+GAMEPAD_ACTIONS.slice(start,end).map((action,index)=>
      '<option value="'+(start+index+1)+'" '+(padChoice===start+index?'selected':'')+'>'+action.label+'</option>').join('')+'</optgroup>').join('')+'</select></label>';
}
function controllerTuning(){
  if(padChoice===null)return '<p class="hint">Choose a controller action for this physical key. Assigned keys appear in the list.</p>';
  const depth=(id,label,value)=>travelField(id,label,value,0,10000,'',key,10000);
  if(padChoice>=10){
    const binding=controller.digital[padChoice-10];
    return grid(depth('padPress','Press depth',binding.press),depth('padRelease','Release depth',binding.release))+
      '<p class="hint">Release depth must be shallower than press depth.</p>';
  }
  const binding=controller.analog[padChoice];
  return grid(depth('padStart','Analog start',binding.start),depth('padEnd','Full output',binding.end))+
    '<h3>Response curve</h3><p class="hint">Travel and output use percentages of the analog range.</p>'+
    '<div class="controller-curve">'+binding.curve.x.map((value,index)=>'<div>'+field('curveX'+index,'Travel '+(index+1)+' · %',value/100,0,100,.01)+
      field('curveY'+index,'Output '+(index+1)+' · %',binding.curve.y[index]/100,0,100,.01)+'</div>').join('')+'</div>';
}
function renderGamepad(){
  if(!fullGamepad())return '<div class="controller-notice"><strong>Xbox controls need HE30 Pro v0.11</strong>'+
    '<p>This keyboard is running '+esc(client.transport.device.productName)+'. Its existing generic HID assignments remain available below.</p><a href="../flasher/">Open firmware updater</a></div>'+
    '<h2>'+esc(KEY_NAMES[key])+'</h2>'+grid(select('gamepadBind','Legacy controller binding',GAMEPAD,profile.gamepad[key]))+
    commands(btn('Apply controller binding','gamepad'),btn('Controller settings','settings'))+
    '<p>Save the controller visibility setting in Keyboard Settings, then reconnect USB to apply it.</p>';
  const assigned=[...controller.analog,...controller.digital].filter(binding=>binding.key!==GAMEPAD_NONE).length;
  const groups=[['Left stick',0,4],['Right stick',4,8],['Triggers',8,10],['Buttons',10,20],['D-pad',20,24]];
  const files=['14_left_stick_left','15_left_stick_right','12_left_stick_up','13_left_stick_down',
    '19_right_stick_left','20_right_stick_right','17_right_stick_up','18_right_stick_down','23_left_trigger','25_right_trigger',
    '01_button_a','02_button_b','03_button_x','04_button_y','22_left_bumper','24_right_bumper','06_back','05_start',
    '16_left_stick_press','21_right_stick_press','08_dpad_up','09_dpad_down','10_dpad_left','11_dpad_right'];
  const current=padChoice===null?null:GAMEPAD_ACTIONS[padChoice];
  return '<div class="gamepad-studio reloaded-gamepad">'+
    '<div id="controllerKeyboardSlot"><div class="keyboard-legend"><span><i class="legend-bound"></i>Assigned</span><span><i class="legend-selected"></i>Selected</span></div></div>'+
    '<nav class="reloaded-segments" aria-label="Gamepad sections">'+[['setup','Setup'],['configuration','Configuration'],['tester','Gamepad Tester']].map(([id,name])=>`<button type="button" data-controller-view="${id}" aria-pressed="${id===controllerView}">${name}</button>`).join('')+'</nav>'+
    '<div class="reloaded-gamepad-setup" data-controller-panel="setup" '+(controllerView==='setup'?'':'hidden')+'>'+
    '<section class="usb-device-control"><label class="usb-device-label" for="controllerUSB"><span><strong>Xbox controller device</strong><small>Show or hide the Xbox device in Windows.</small></span><input id="controllerUSB" type="checkbox" role="switch" '+(info.gamepad?'checked':'')+'></label>'+
    '<p>Changing this briefly reconnects the keyboard over USB. '+(recoverySave()?'The choice applies for this session.':'Save changes to keep this choice after power loss.')+'</p><p id="controllerStatus" class="readout" role="status">'+esc(controllerStatus())+'</p></section>'+
    '<section class="profilebar"><div class="profile-name"><span>ONBOARD PROFILE</span><strong>'+esc(profile.name)+'</strong></div>'+
    select('controllerMode','KEYBOARD OUTPUT',GAMEPAD_MODES,controller.mode)+
    '<label><span>CONTROLLER TYPE</span><strong>Xbox / XInput</strong></label></section>'+
    '<section class="card mapping-card"><div class="card-head"><div><h2>Controller mapping</h2><p>Select a physical key and choose a controller action, or drag an action onto a key.</p></div><span class="pill">'+assigned+' assigned</span></div>'+
    '<div class="assignment-head"><span>'+esc(KEY_NAMES[key])+'</span><div><strong>'+esc(current?.label||'Choose a controller action')+'</strong><small>Switch travel '+(profile.travel[key]/1000).toFixed(3)+' mm estimated</small></div>'+
    '<button class="remove-assignment" data-action="clearPad" '+(gamepadActionForKey(controller,key)===null?'disabled':'')+'>Remove assignment</button></div>'+
    '<div hidden>'+controllerActionSelect()+'</div><div class="control-picker">'+groups.map(([label,start,end])=>'<div class="control-group"><span>'+label+'</span>'+
      GAMEPAD_ACTIONS.slice(start,end).map((action,index)=>{
        const id=start+index,binding=id<10?controller.analog[id]:controller.digital[id-10];
        return '<button type="button" draggable="true" class="control-action '+(padChoice===id?'active':binding.key!==GAMEPAD_NONE?'assigned':'')+'" data-controller-action="'+id+'" aria-pressed="'+(padChoice===id)+'"><img draggable="false" class="controller-icon" src="assets/controller_icons/'+files[id]+'.png" alt="" aria-hidden="true"><span>'+action.label+'</span>'+(binding.key!==GAMEPAD_NONE?'<small>'+esc(KEY_NAMES[binding.key])+'</small>':'')+'</button>';
      }).join('')+'</div>').join('')+'</div>'+commands(btn('Apply to keyboard','gamepad'))+'</section></div>'+
    '<div class="reloaded-gamepad-config" data-controller-panel="configuration" '+(controllerView==='configuration'?'':'hidden')+'><section class="card tuning-card"><div class="card-head"><div><h2>Control response</h2><p>'+(current?'Adjust the response across the switch travel.':'Choose a controller action in Setup.')+'</p></div><span class="pill">'+esc(current?.label||'—')+'</span></div>'+
    controllerTuning()+(padChoice!==null&&padChoice<10?controllerCurveGraph():'')+
    '<div class="commands">'+btn('Apply to keyboard','gamepad')+'</div></section>'+
    '<section class="card stick-behavior-card"><div class="card-head"><div><h2>Stick behavior</h2><p>Choose the gate shape and how opposing keys combine.</p></div></div><div class="stick-settings">'+
    controller.sticks.map((stick,index)=>'<div class="stick-setting"><strong>'+(index?'Right':'Left')+' stick</strong>'+
      select('stickShape'+index,'Gate shape',['Square','Circular'],Number(stick.circular))+
      '<div class="setting-policy">'+select('stickOppX'+index,'Horizontal opposing keys',GAMEPAD_OPPOSITION,stick.oppositionX)+'</div>'+
      '<div class="setting-policy">'+select('stickOppY'+index,'Vertical opposing keys',GAMEPAD_OPPOSITION,stick.oppositionY)+'</div>'+
      '<div class="setting-deadzone">'+field('stickDeadzone'+index,'Radial dead zone · %',stick.radialDeadzone/100,0,99.99,.01)+'</div></div>').join('')+
    '</div><p class="hint">Tuning and output mode are shared across the four profiles. Each profile keeps its own physical assignments.</p></section></div>'+
    (controllerView==='tester'?'<section class="card gamepad-tester" id="gamepadTester"><h2>Test Gamepad</h2><p role="status">Press a mapped controller button or move a stick to show input.</p><div class="tester-signals"></div></section>':'')+'</div>';
}
function controllerCurveGraph(){
  return '<figure class="curve-figure"><svg id="curveGraph" viewBox="0 0 336 176" role="group" aria-label="Analog response curve">'+
    '<path d="M33 15H312V145H33Z M33 47.5H312 M33 80H312 M33 112.5H312 M102.75 15V145 M172.5 15V145 M242.25 15V145" class="chart-grid"/>'+
    '<polyline id="curveLine"/>'+[0,1,2,3].map(i=>'<circle data-curve-point="'+i+'" tabindex="0" role="slider" aria-label="Curve point '+(i+1)+'" r="5"/>').join('')+
    '<text x="25" y="18" text-anchor="end">100%</text><text x="25" y="148" text-anchor="end">0</text><text x="33" y="163">Travel 0%</text><text x="312" y="163" text-anchor="end">100%</text></svg></figure>'+
    '<div class="curve-presets"><button type="button" data-curve-preset="linear">Linear</button><button type="button" data-curve-preset="gentle">Gentle start</button><button type="button" data-curve-preset="fast">Fast start</button></div>';
}
function paintControllerCurve(){
  const graph=byId('curveGraph');
  if(!graph)return;
  const points=[0,1,2,3].map(i=>[values('curveX'+i),values('curveY'+i)]);
  byId('curveLine').setAttribute('points',points.map(([x,y])=>(33+x*2.79)+','+(145-y*1.3)).join(' '));
  graph.querySelectorAll('[data-curve-point]').forEach((node,i)=>{
    node.setAttribute('cx',33+points[i][0]*2.79);node.setAttribute('cy',145-points[i][1]*1.3);
    node.setAttribute('aria-valuetext',points[i][0]+'% travel, '+points[i][1]+'% output');
  });
}
function bindControllerCurve(){
  const graph=byId('curveGraph');
  if(!graph)return;
  paintControllerCurve();
  for(let i=0;i<4;i++)for(const axis of ['X','Y'])byId('curve'+axis+i).addEventListener('input',paintControllerCurve);
  graph.querySelectorAll('[data-curve-point]').forEach(node=>{
    const i=Number(node.dataset.curvePoint);
    const update=(x,y)=>{
      const low=i?values('curveX'+(i-1))+.01:0,high=i<3?values('curveX'+(i+1))-.01:100;
      byId('curveX'+i).value=Math.max(low,Math.min(high,x)).toFixed(2);
      byId('curveY'+i).value=Math.max(0,Math.min(100,y)).toFixed(2);
      paintControllerCurve();
    };
    node.addEventListener('pointerdown',event=>{if(busy)return;event.preventDefault();node.setPointerCapture(event.pointerId);});
    node.addEventListener('pointermove',event=>{
      if(!node.hasPointerCapture(event.pointerId)||busy)return;
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(graph.getScreenCTM().inverse());
      update((point.x-33)/2.79,(145-point.y)/1.3);
    });
    node.addEventListener('keydown',event=>{
      if(busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();
      update(values('curveX'+i)+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0),
        values('curveY'+i)+(event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0));
    });
  });
}
function paintTravelMonitor(){
  paintLiveTravel(byId('editor').querySelector('.live-press-panel'),{
    connected:!!client, labels:KEY_NAMES, primary:key, selection:[...selectedKeys],
    travel:profile.travel, settings:config.keys, sample:client?status:null
  });
}
function setLiveTravel(show){
  liveTravel=show;
  const button=byId('livePressDistanceToggle');
  if(!button)return;
  button.setAttribute('aria-pressed',String(show));
  button.textContent=show?'Hide live press distance':'Live press distance';
  const slot=byId('liveTravelSlot');
  slot.innerHTML=show?liveTravelPanel():'';
  if(!show)return;
  const panel=slot.firstElementChild;
  const scope=byId('liveTravelSelectionOnly');
  scope.checked=travelSelectionOnly;
  scope.addEventListener('change',()=>{
    travelSelectionOnly=scope.checked;
    paintTravelMonitor();
  });
  bindLiveTravelPanel(panel,{
    position:travelPanelPosition,
    onMove:position=>{travelPanelPosition=position;},
    onClose:()=>{setLiveTravel(false);button.focus();}
  });
  paintTravelMonitor();
}
function tuningRange(id,label,value,min,max,step,hint=''){
  return '<div class="tuning-distance"><label for="'+id+'">'+label+'</label>'+
    '<div class="tuning-range-inputs"><input type="range" data-distance-for="'+id+'" aria-label="'+label+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'">'+
    '<input type="number" id="'+id+'" aria-label="'+label+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"></div>'+
    (hint?'<small>'+hint+'</small>':'')+'</div>';
}
function travelField(id,label,value,min,max,hint='',index=key,scale=1000){
  const control=distanceField(value,profile.travel[index],distancePrecision,min,max,scale);
  return tuningRange(id,label+' · '+control.unit,control.value,control.min,control.max,control.step,hint);
}
function travelValue(id){
  const input=byId(id);
  return num(id,Number(input.min),Number(input.max));
}
const tuningPreferences=()=>select('distancePrecision','Distance resolution',DISTANCE_MODES,distancePrecision)+
  check('boardGauge','Live travel bars on keys',boardGauge);
function tuningToggle(id,label,hint,checked){
  return '<label class="switch-row"><span><b>'+label+'</b><small>'+hint+'</small></span>'+
    '<input id="'+id+'" class="toggle" type="checkbox" '+(checked?'checked':'')+'></label>';
}
function tuning(rapid){
  const k=config.keys[key],travel=profile.travel[key]/1000;
  const main=rapid
    ? tuningToggle('rapid','Rapid Trigger','Reactuate and reset based on switch movement.',k.rapidTrigger)+
      check('syncRapid','Sync RT press and release',syncRapid)+
      '<div class="rt-settings">'+travelField('rtPress','RT press',k.rtPress,5,1000,'Downstroke movement required to reactuate.')+
      travelField('rtRelease','RT release',syncRapid?k.rtPress:k.rtRelease,5,1000,'Upstroke movement required to reset.')+'</div>'
    : travelField('act','Actuation distance',k.actuation,10,990,'Depth of the first actuation.')+
      travelField('hys','Release hysteresis',k.hysteresis,1,500,'Travel back toward the top required to release.')+
      tuningToggle('disabled','Disable selected keys','Suppress input from these physical keys.',k.disabled);
  const zones='<div class="tuning-fields">'+
    travelField('top','Top dead zone',k.topDeadzone*10,0,400,'Ignored movement near the top.')+
    travelField('bottom','Bottom dead zone',k.bottomDeadzone*10,0,400,'Ignored movement near full travel.')+'</div>'+
    (profileKeys()?'':'<p class="hint">This firmware stores dead zones in 1% increments.</p>');
  return '<section class="performance-tuning"><div class="panel-head"><div><h2>'+(rapid?'Rapid Trigger tuning':'Actuation tuning')+
    '</h2></div><button type="button" id="livePressDistanceToggle" class="button ghost live-press-toggle" aria-pressed="false">Live press distance</button></div>'+
    '<div class="tuning-preferences">'+tuningPreferences()+'</div><div class="selected-key-card"><b>'+esc(KEY_NAMES[key])+'</b><span>'+esc(selectionLabel())+' selected<small>'+
    travel.toFixed(3)+' mm switch travel</small></span></div>'+
    '<div class="actuation-tuning-columns"><section class="tuning-column"><div class="tuning-column-head"><h3>'+(rapid?'Movement sensitivity':'Actuation & release')+
    '</h3></div>'+main+'</section><section class="tuning-column"><div class="tuning-column-head"><h3>Dead zones</h3></div>'+
    (rapid?'<p>Dead zones apply to both actuation and Rapid Trigger.</p>':'')+zones+'</section></div>'+
    commands(btn('Apply to selected keys',rapid?'rapid':'tune'),btn('Copy tuning to every key',rapid?'rapidAll':'tuneAll'))+
    '<div id="liveTravelSlot"></div></section>';
}
const scanModes=['Compatibility','DMA balanced','DMA fast'];
// Estimate using the default bank settling delays and a complete 36-key ADC scan.
const estimatedScanRates=[600,10000,15000];
function scanOptions(){
  const current=FN_RGB_PRODUCTS.includes(client?.transport.device.productName);
  return (current?['DMA stability','DMA balanced',partialCalibration()?'DMA fast · primed':'DMA fast · ADC6 tuned']:scanModes).map((name,mode)=>{
    const measured=mode===info.runningScanner&&info.scanHz&&!info.scanTrial&&!adcProblem();
    if(measured)return name+' · '+info.scanHz.toLocaleString()+' Hz measured';
    return current?name:name+' · ≈'+estimatedScanRates[mode].toLocaleString()+' Hz';
  });
}
const displayedAction=()=>advancedKind===null?profile.actions[slot]:
  actionForFeature(advancedKind,key,visualKeyOrder[(visualKeyOrder.indexOf(key)+1)%KEY_NAMES.length]);

function showRule(index){
  slot=index;
  advancedKind=null;
  const rule=profile.actions[index];
  if(rule.kind)selectKeys([rule.key],'replace',rule.key);
  render();
}

function chooseFeature(kind){
  const existing=profile.actions.findIndex(rule=>rule.kind===kind&&actionKeys(rule).includes(key));
  if(existing>=0){showRule(existing);return;}
  const available=profile.actions.findIndex(rule=>!rule.kind);
  if(available<0){message('All assignment slots are used. Remove a rule before adding another.',true);return;}
  slot=available;
  advancedKind=kind;
  render();
  byId('hostKey').focus();
}

function ruleDepths(rule,index){
  return rule.depth.map((depth,i)=>byId('depth'+i)?.closest('.tuning-distance')?
    storedDistance(travelValue('depth'+i),profile.travel[index],distancePrecision,0,1000):depth);
}

function paintRuleTravel(){
  const panel=byId('ruleTravel');
  if(!panel?.open)return;
  const index=values('hostKey'),travel=profile.travel[index];
  const toDepth=id=>storedDistance(byId(id).valueAsNumber,travel,distancePrecision,0,1000);
  const shallow=toDepth('depth0'),deep=toDepth('depth1');
  const position=client&&!status?.calibrationPhase?status?.positions[index]:null;
  const valid=shallow>0&&deep>shallow;
  panel.style.setProperty('--rule-shallow',valid?shallow/10+'%':'0%');
  panel.style.setProperty('--rule-deep',valid?deep/10+'%':'0%');
  panel.style.setProperty('--rule-position',(position??0)/10+'%');
  const stage=position>=deep?'Deep':position>=shallow?'Shallow':'Below shallow threshold';
  const label=!valid?'Set a shallow threshold above zero and a deeper second threshold.':
    position==null?'Connect and press the selected key to preview travel.':
    distanceLabel(position,travel,distancePrecision)+' · '+stage;
  const output=byId('ruleTravelStage');
  if(output.textContent!==label)output.textContent=label;
}
function renderEditor(which){
  const calibrating=!!status?.calibrationPhase;
  const calibrationLock=calibrating?'<p>Calibration is in progress. Finish it in Quick Settings or stop it here to change scanner and polling settings.</p>'+commands(btn('Stop calibration','abort')):'';
  if(which==='quick')return '<h2>Switch calibration</h2><p id="calState" aria-live="polite"></p><progress id="calProgress" max="36" value="0"></progress>'+
    '<div class="commands">'+btn('Begin calibration','begin',!client||!!status?.calibrationPhase)+'<button id="finish" class="button ghost" data-action="finish" disabled>Finish calibration</button>'+btn('Abort','abort',!client||!status?.calibrationPhase)+
    btn(status?.typingEnabled?'Disable typing':'Enable typing',status?.typingEnabled?'disable':'enable',!client||calibrating)+
    btn('Restart scanner','retry',!client||calibrating)+'</div><p>'+(partialCalibration()?'Red means uncalibrated, green means previously calibrated, and blue means captured in this session. Finish updates the blue keys.':'Begin with all keys released. The keyboard preview shows live ADC readings and highlights each key once its travel is measured.')+'</p>';
  if(which==='actuation'||which==='rapid')return tuning(which==='rapid');
  if(which==='keymap')return renderRemap(remapOptions());
  if(which==='switches'){
    const chosen=catalog.findIndex(x=>x.coefficient===profile.coefficient[key]&&x.travel===profile.travel[key]);
    return '<div class="switches-header"><h2>'+esc(KEY_NAMES[key])+'</h2>'+check('showSwitchAdc','Show raw ADC on keys',showSwitchAdc)+'</div>'+
      (showSwitchAdc&&!client?'<p class="hint">Connect the keyboard to read raw ADC values.</p>':'')+grid(select('switchModel','Switch',catalog.map(x=>x.brand+' · '+x.name),Math.max(0,chosen)),
      field('travel','Nominal travel · mm',profile.travel[key]/1000,.5,6,distancePrecision===0?.01:.005),field('coefficient','Hall curve coefficient',profile.coefficient[key],0,65535))+
      commands(btn('Apply to selected keys','switch'),btn('Apply to all keys','switchAll'))+
      '<p>Zuoya fits and AE64 catalog entries are starting curves. Calibrate the installed switches. Displayed millimeters are estimates.</p>';
  }
  if(which==='lighting'){
    const light=profile.lighting;
    const adjustable=!client||client.lighting.supportsBrightness;
    const layers=profile.fnLighting&&lightingArea==='keyboard'?layerTabs(lightingLayer,'lighting'):'';
    const toolbar='<div class="rgb-reloaded-toolbar"><nav class="reloaded-segments" aria-label="Lighting area">'+
      [['keyboard','Keyboard'],['bar','Lightbar']].map(([id,name])=>`<button type="button" data-lighting-area="${id}" aria-pressed="${id===lightingArea}">${name}</button>`).join('')+'</nav>'+layers+'</div>';
    const fn=lightingLayer?profile.fnLighting?.[lightingLayer-1]:null;
    const fixedKeyRate=[ADC_RGB_FIX_MODEL,CALIBRATION_QOL_MODEL,...DESKTOP_PRODUCTS].includes(client?.transport.device.productName);
    const keyboard=fn?'<h2>Key overrides</h2>'+grid(
      check('fnRgbEnabled','Use this palette while Fn is held',fn.enabled),
      '<label>Selected key color<input id="perKey" type="color" value="'+color(fn.palette[key],255/32)+'"></label>')+
      commands(btn('Apply Fn lighting','rgb')):
      '<h2>Colors</h2>'+grid(
        '<label>Keyboard color<input id="keyColor" type="color" value="'+color(light.color,255/32)+'"></label>',
        '<label>Selected key color<input id="perKey" type="color" value="'+color(light.palette[key],255/32)+'"></label>',
        adjustable?brightness('keyBrightness','Keyboard brightness',light.keyBrightness):'',
        select('colorOrder','Channel order',['GRB','RGB'],light.order))+
        commands(btn('Apply keyboard lighting','rgb'),btn('Identify selected LED','identify',!client||selectedKeys.size!==1));
    const bar='<h2>Lightbar</h2>'+grid(
      check('barEnabled','Enable lightbar',light.barEnabled),
      desktopKeys()?select('barMode','Effect',['Static','Breathing','Rainbow wave','Spectrum'],light.barMode??0):'',
      '<label>Lightbar color<input id="barColor" type="color" value="'+color(light.barColor,255/32)+'"></label>',
      desktopKeys()?check('barRainbow','Rainbow breathing',light.barRainbow):'',
      desktopKeys()?select('barDirection','Wave direction',['Top to bottom','Bottom to top'],Number(!!light.barReverse)):'',
      adjustable?brightness('barBrightness','Lightbar brightness',light.barBrightness):'',
      select('waveRate',fixedKeyRate?'Lightbar data rate':'LED data rate',['Original','Half rate'],light.rate))+
      commands(btn('Apply lightbar','rgbBar'));
    const preferences=lightingPreferences();
    const timing=mediaKeys()?'<section data-lighting-timing><h2>Animation and sleep</h2>'+grid(
      brightness('animationSpeed','Animation speed',preferences.speed),
      field('rgbSleepMinutes','Idle minutes',Math.floor(preferences.sleep/60),0,1092),
      field('rgbSleepSeconds','Idle seconds',preferences.sleep%60,0,59),
      check('rgbKeepBar','Keep lightbar on while keyboard LEDs sleep',preferences.keepBar))+
      '<p>Set both idle fields to zero to keep the LEDs on.</p>'+commands(btn('Apply animation and sleep','lightingTiming'))+'</section>':'';
    const effects=['Off','Solid','Per key','Reactive','Color wave','Breathing'];
    const modes='<section class="rgb-effects"><h2>Keyboard effects</h2><div hidden>'+select('lightMode','Keyboard effect',effects,light.mode)+'</div><div class="rgb-effect-list">'+
      effects.map((name,i)=>`<button type="button" data-light-mode="${i}" aria-pressed="${i===light.mode}"><i></i>${name}</button>`).join('')+'</div></section>';
    return toolbar+'<div class="lighting-settings rgb-reloaded-editors">'+
      (lightingArea==='bar'?'<section data-lightbar>'+bar+'</section>':(fn?'':modes)+'<section>'+keyboard+'</section>')+timing+'</div>';
  }
  if(which==='gamepad')return renderGamepad();
  if(which==='advanced')return '<div class="tuning-preferences">'+tuningPreferences()+'</div>'+renderAdvanced({action:displayedAction(),rules:profile.actions,slot,creating:advancedKind!==null,
    select,field,travelField,bindingField,esc});
  if(which==='settings'||which==='profiles')return '<h2>'+(which==='profiles'?'Onboard profiles':'USB and scanner')+'</h2>'+
    (which==='settings'?grid(select('polling','Polling rate',RATES.map(rate=>rate+' Hz'),info.rate),
      select('scan','Scan rate',scanOptions(),info.scanMode),
      tuningPreferences(),
      desktopKeys()?field('pointerSpeed','Pointer speed · counts per report',profile.lighting.pointerSpeed??1,1,32):'',
      (!client||client.supportsMouseSwitch)?check('mouseUSB','Enable USB mouse',info.mouse):'',
      fullGamepad()?'<p class="hint">Xbox controller visibility is available on the Gamepad page.</p>':check('enablePad','Expose USB gamepad after reconnect',info.gamepad))+
      (browserRates()||onboardRates()
        ? commands(btn('Apply polling rate','applyPolling',!!status?.calibrationPhase),btn('Apply scan mode','applyScanner',!!status?.calibrationPhase),
          onboardRates()?btn('Apply and save device settings','device',!!status?.calibrationPhase):btn('Remember active rates','rememberRates',!!status?.calibrationPhase),
          onboardRates()?'':btn('Forget remembered rates','forgetRates',!rememberedRates()),
          browserRates()&&!diagnosticSave()?btn('Install startup rates via recovery','rateImage',!!status?.calibrationPhase):'')
        : commands(btn('Apply for this session','sessionRates',!!status?.calibrationPhase),(recoverySave()?btn('Install startup rates via recovery','rateImage',!!status?.calibrationPhase):btn('Apply and save device settings','device',!!status?.calibrationPhase)),btn('Restart scanner','retry',!client||!!status?.calibrationPhase)))+
      (desktopKeys()?commands(btn('Apply pointer speed','pointerSpeed',calibrating)):'')+
      calibrationLock+'<p id="runningRates"></p><p>'+(onboardRates()
        ? 'Polling applies immediately. Changing scan mode restarts Hall scanning. Save changes keeps pending settings on the keyboard.'
        : browserRates()
        ? 'Polling applies immediately. Changing scan mode restarts Hall scanning. Remember active rates keeps your settings until you close or reload this tab. '+(diagnosticSave()?'Export profiles to keep a copy of other edits.':'Recovery installs rates on the keyboard and clears profiles and calibration.')
        : recoverySave()?'Recovery installs the selected startup rates with factory profiles and clears calibration. Export profiles first.':'Apply and save writes all pending changes to the keyboard.')+' Scan rates describe complete 36-key scans and vary with device activity.</p>':
      grid(textField('profileName','Current profile name',profile.name))+commands(btn('Rename profile','renameProfile'),btn('Export current profile','exportProfile'))+
      '<label>Restore profile or earlier HE30 settings<input type="file" id="restoreProfile" accept="application/json,.json"></label>');
  if(which==='firmware')return '<h2>Firmware & recovery</h2><p>The recovery page checks the firmware hash and tracks the USB transition.</p>'+
    commands(btn('Enter recovery','recovery',!client||recoveryPending),'<a href="../flasher/" class="button ghost linked-button">Open flasher</a>');
  if(which==='diagnostics')return '<h2>Scan diagnostics</h2><p id="scanStats">Awaiting a scan measurement</p>'+
    calibrationLock+commands(btn('Restart scanner','retry',!client||calibrating))+
    (FN_RGB_PRODUCTS.includes(client?.transport.device.productName)?
      grid(select('scanTrial','ADC experiment',[
        'Use configured scanner','A · Original fast','B · Longer ADC6 acquisition','C · ADC6 last',
        'D · Add 2 µs per bank','E · Discard first conversion','F · ADC6 last, longer acquisition'
      ],info.scanTrial))+commands(btn('Apply ADC experiment','scanTrial',!!status?.calibrationPhase))+
      '<p>Experiments are temporary. Compare the measured scan rate and raw ADC values below.</p>':'')+
    '<p id="travelReading"></p><pre id="rawData"></pre>';
  return '<h2>Epomaker HE30</h2><p>'+(client?client.transport.device.productName+' connected':'Offline workspace')+' · 36 Hall sensors · 4 onboard profiles · 3 layers</p>'+
    '<p>Current profile '+esc(profile.name)+'. USB gamepad '+(info.gamepadAttached?'enabled':'disabled')+'.</p>'+
    (client?'<p id="keyboardRollover"></p>':'')+
    '<div class="controller-selected"><h3>Selected key · '+esc(KEY_NAMES[key])+'</h3><p>Keyboard '+esc(bindingLabel(selectedUsage(key)))+
    ' · Controller '+esc(controllerLabel(key)||'Unassigned')+'</p></div><p id="scanStats"></p>'+commands(btn('Calibration','quick'));
}
function paintSaveState(){
  byId('save').disabled=!client||busy||usbTransition||recoveryPending||!dirty||!!status?.calibrationPhase;
  byId('revert').disabled=!client||busy||usbTransition||!status?.savedValid||!dirty||recoveryPending||!!status?.calibrationPhase;
  byId('dirtyStatus').textContent=dirty?(recoverySave()?'Changes applied for this session':'Changes pending save'):'No pending changes';
}
function render(){
  const which=page==='performance'?view:page==='settings'&&view==='profiles'?'profiles':page;
  const [title,description]=headings[which]||headings.overview;
  byId('pageTitle').innerHTML='<h1>'+title+'</h1><p>'+description+'</p>';
  lightingDraft=barDraft=null;paletteEdited=false;
  if(page!=='lighting')rgb=null;
  const board=byId('board');
  board.ondragover=board.ondrop=null;
  byId('editor').before(board);
  byId('editor').innerHTML=renderEditor(which);
  document.querySelector('.pro-content').dataset.page=page;
  byId('activeProfile').replaceChildren(...info.names.map((name,i)=>{
    const o=document.createElement('option');o.value=String(i);o.textContent=name||'Profile '+(i+1);o.selected=i===info.active;return o;
  }));
  byId('activeProfile').disabled=busy||!!status?.calibrationPhase;
  byId('save').textContent=recoverySave()?'Export profile':'Save changes';
  paintSaveState();
  byId('connect').textContent=client?'Disconnect':'Connect keyboard';
  byId('autoApplyToggle').disabled=!client||recoverySave()||recoveryPending||usbTransition;
  byId('autoApplyToggle').title=recoverySave()?'Live flash saves can stop this firmware from responding.':'';
  if(byId('controllerUSB'))byId('controllerUSB').disabled=busy||usbTransition||!!status?.calibrationPhase;
  if(byId('mouseUSB'))byId('mouseUSB').disabled=busy||usbTransition||!!status?.calibrationPhase;
  byId('connectionStatus').textContent=client?'Connected':'Offline';
  byId('connect').disabled=busy||liveOnly;
  byId('connectionLabel').textContent=client?client.transport.device.productName+' connected':'Offline workspace';
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page&&(!el.dataset.view||el.dataset.view===view)));
  renderBoard();
  paintBoard();
  byId('ruleTravel')?.addEventListener('toggle',paintRuleTravel);
  if(byId('controllerKeyboardSlot'))byId('controllerKeyboardSlot').prepend(board);
  if(which==='gamepad'&&fullGamepad())bindGamepadDrag(board);
  startGamepadTester(byId('gamepadTester'));
  bindControllerCurve();
  if(tuningPage())setLiveTravel(liveTravel);
  if(which==='keymap'){
    byId('editor').querySelector('.remap-board').append(byId('board'));
    bindRemap(remapOptions());
  }
  if(which==='lighting'){
    byId('editor').querySelector('.rgb-reloaded-toolbar').after(byId('board'));
    paintBarControls();
  }
}
async function editConfig(edit){
  const next=structuredClone(config);edit(next);encodeConfig(next);
  if(client){await requireActiveProfile();config=await client.foundation.applyConfig(next);}
  else offline[info.active].config=config=next;
  mark();
}
async function applyRemap(code){
  if(isProfileUsage(code)&&!profileKeys())throw new Error('Profile keys require HE30 Pro v0.20.');
  const codes=code instanceof Map?code:new Map(editTargets(false).map(index=>[index,code]));
  if(!mediaKeys()&&[...codes.values()].some(isMediaUsage))throw new Error('Media mappings require HE30 Pro v0.26.');
  if(!desktopKeys()&&[...codes.values()].some(isDesktopUsage))throw new Error('This mapping requires HE30 Pro v0.25.');
  if(layer<2)await editConfig(next=>{
    for(const [index,value] of codes)next.keys[index][layer?'fnUsage':'normalUsage']=value;
  });
  else{
    for(const [index,value] of codes){
      if(client){await requireActiveProfile();await client.fn2(index,value);}
      profile.fn2[index]=value;
      if(client)dirty=true;
    }
    mark();
  }
}
async function requireActiveProfile(){
  if(!client)return;
  if((await client.activeProfile())!==info.active){
    await refresh();
    throw new Error('The onboard profile changed. Review the new profile before applying changes.');
  }
}
function remapOptions(){
  return {root:byId('editor'),keyName:selectionLabel(),layer,usage:selectedUsage(key),profileKeys:profileKeys(),desktopKeys:desktopKeys(),mediaKeys:mediaKeys(),
    onLayer:next=>{if(!busy){layer=next;render();}},
    onPick:code=>{if(!busy)run(()=>applyRemap(code));},
    onDrop:(index,code)=>{if(!busy)run(()=>applyRemap(new Map([[index,code]])));},
    onCycleAll:()=>run(async()=>{
      const targets=editTargets(false);
      await requireActiveProfile();
      if(client){
        for(const index of targets)await client.cycleAll(index,layer);
        await refresh();
      }else for(const slot of offline)for(const index of targets){
        if(layer===2)slot.profile.fn2[index]=244;
        else slot.config.keys[index][layer?'fnUsage':'normalUsage']=244;
      }
      mark('Next profile assigned in all four profiles. '+keepChanges());
    }),
    onReset:()=>{if(!busy)run(()=>applyRemap(new Map(editTargets(false).map(index=>[index,layer?254:codeFor(KEY_NAMES[index])]))));}};
}
function bindGamepadDrag(board){
  const type='application/x-he30-controller-action';
  byId('editor').querySelector('.control-picker').ondragstart=event=>{
    const action=event.target.closest('[data-controller-action]');
    if(action)event.dataTransfer.setData(type,action.dataset.controllerAction);
  };
  board.ondragover=event=>{
    if(!busy&&event.target.closest('[data-key]')&&event.dataTransfer.types.includes(type))event.preventDefault();
  };
  board.ondrop=event=>{
    const target=event.target.closest('[data-key]');
    if(!target||busy||!event.dataTransfer.types.includes(type))return;
    const value=event.dataTransfer.getData(type);
    if(!/^\d{1,2}$/.test(value)||Number(value)>=GAMEPAD_ACTIONS.length)return;
    event.preventDefault();
    run(async()=>{
      await requireActiveProfile();
      selectKeys([Number(target.dataset.key)],'replace',Number(target.dataset.key));
      const next=assignGamepad(controller,key,Number(value));
      controller=client?await client.applyGamepad(next):next;
      profile.gamepad=controllerBindings(controller);
      padChoice=Number(value);
      mark();
    });
  };
}
async function writeRule(index,rule){
  const requested=actionBytes(rule);
  if(client){
    await requireActiveProfile();
    await client.action(index,rule);
    const observed=(await client.profile()).actions[index];
    await requireActiveProfile();
    if(!actionBytes(observed).every((byte,i)=>byte===requested[i]))
      throw new Error('The keyboard returned different assignment data.');
  }
  profile.actions[index]=rule;
  mark();
}
const actions={
  async bind(){
    const code=bindingCode(named('binding'),layer);
    if(layer<2)await editConfig(next=>{next.keys[key][layer?'fnUsage':'normalUsage']=code;});
    else{if(client)await client.fn2(key,code);profile.fn2[key]=code;mark();}
  },
  async tune(all,rapid){
    const input=rapid?['rtPress','rtRelease']:['act','hys'];
    const requested=input.map(travelValue);
    if(rapid&&syncRapid)requested[1]=requested[0];
    const top=travelValue('top'),bottom=travelValue('bottom');
    const flag=checkbox(rapid?'rapid':'disabled');
    await editConfig(next=>{
      for(const i of editTargets(all)){
        const k=next.keys[i],norm=(n,minimum,maximum)=>storedDistance(n,profile.travel[i],distancePrecision,minimum,maximum);
        const zone=value=>profileKeys()?norm(value,0,400)/10:Math.round(norm(value,0,400)/10);
        Object.assign(k,{topDeadzone:zone(top),bottomDeadzone:zone(bottom)});
        if(rapid) Object.assign(k,{rtPress:norm(requested[0],5,1000),rtRelease:norm(requested[1],5,1000),rapidTrigger:flag});
        else Object.assign(k,{actuation:norm(requested[0],10,990),hysteresis:norm(requested[1],1,500),disabled:flag});
      }
    });
  },
  async switch(all){
    const travel=Math.round(num('travel',.5,6)*1000),coefficient=Math.round(num('coefficient',0,65535));
    for(const i of editTargets(all)){
      if(travel===profile.travel[i]&&coefficient===profile.coefficient[i])continue;
      if(client){await requireActiveProfile();await client.switch(i,travel,coefficient);}
      profile.travel[i]=travel;profile.coefficient[i]=coefficient;
      if(client){dirty=true;switchCalibrationAdvice=true;}
    }
    mark();
  },
  async rule(){
    const a=structuredClone(displayedAction()),feature=FEATURES[a.kind];
    a.key=values('hostKey');
    if(a.kind<=2){a.other=values('otherKey');a.mode=values('pairMode');}
    feature.outputs?.forEach((_,i)=>{a.usage[i]=bindingCode(named('output'+i),0);});
    if(feature.outputs&&!a.usage.some(Boolean))throw new Error('Choose at least one output for this feature.');
    a.depth=ruleDepths(a,a.key);
    if(feature.time)a.depth[0]=Math.round(travelValue('depth0'));
    await writeRule(slot,a);
    advancedKind=null;
    selectKeys([a.key],'replace',a.key);
  },
  async removeRule(index){
    await writeRule(index,blankAction());
    if(slot===index)advancedKind=null;
  },
  async rgb(scope='keyboard'){
    const next=readLightingEditor(scope);
    if(scope==='keyboard'&&lightingLayer){
      await requireActiveProfile();
      const applied=client?await client.lighting.applyFn(info.active,lightingLayer,next):next;
      profile.fnLighting[lightingLayer-1]=applied;
      mark('Fn'+lightingLayer+' palette applied. '+keepChanges());
      return;
    }
    encodeLighting(next);
    await requireActiveProfile();
    const applied=client?await client.lighting.apply(next):null;
    profile.lighting=applied?.config||next;rgb=null;
    mark(applied?.error?'Colors accepted. The keyboard reported an LED transfer error.':(scope==='bar'?'Lightbar':'Keyboard lighting')+' applied. '+keepChanges());
  },
  async gamepad(){
    await requireActiveProfile();
    if(!fullGamepad()){
      const binding=values('gamepadBind');
      await client.mapping(key,binding);
      profile.gamepad[key]=binding;mark();return;
    }
    const choice=values('gamepadBind')-1;
    const next=assignGamepad(controller,key,choice<0?null:choice);
    next.mode=values('controllerMode');
    for(let i=0;i<2;i++)Object.assign(next.sticks[i],{
      circular:!!values('stickShape'+i),radialDeadzone:Math.round(num('stickDeadzone'+i,0,99.99)*100),
      oppositionX:values('stickOppX'+i),oppositionY:values('stickOppY'+i)
    });
    const normalized=id=>storedDistance(travelValue(id),profile.travel[key],distancePrecision,0,10000,10000);
    if(choice>=0&&choice<10){
      const binding=next.analog[choice];
      binding.start=normalized('padStart');binding.end=normalized('padEnd');
      binding.curve={x:[],y:[]};
      for(let point=0;point<4;point++){
        binding.curve.x.push(Math.round(num('curveX'+point,0,100)*100));
        binding.curve.y.push(Math.round(num('curveY'+point,0,100)*100));
      }
    }else if(choice>=10){
      Object.assign(next.digital[choice-10],{press:normalized('padPress'),release:normalized('padRelease')});
    }
    encodeGamepad(next);
    controller=client?await client.applyGamepad(next):next;
    profile.gamepad=controllerBindings(controller);
    padChoice=gamepadActionForKey(controller,key);
    if(client)padState=await client.gamepadStatus();
    mark();
  },
  async clearPad(){
    await requireActiveProfile();
    const next=assignGamepad(controller,key,null);
    controller=client?await client.applyGamepad(next):next;
    profile.gamepad=controllerBindings(controller);padChoice=null;mark();
  },
  async applyRates(active,before,rate,scanMode,gamepad,scope='both'){
    const changed=before.rate!==rate||before.scanMode!==scanMode||before.gamepad!==gamepad;
    const restartScanner=scope!=='polling'&&(before.runningScanner!==scanMode||!!before.scanTrial||!!adcProblem());
    if(changed){
      await active.deviceSettings(rate,scanMode,gamepad);
      dirty=true;
    }
    if(restartScanner){
      try{await active.foundation.control(10);}
      catch(error){
        if(client===active&&error.name!=='HIDTimeoutError'&&!active.transport.closed){
          await active.deviceSettings(before.rate,before.scanMode,before.gamepad);
          await active.foundation.control(10);
        }
        throw error;
      }
    }
    const applied=changed||restartScanner?await active.capabilities():before;
    if(client!==active)throw new Error('Keyboard disconnected while applying rates.');
    if(applied.active!==info.active)await refresh();
    else info=applied;
    if(applied.rate!==rate||applied.scanMode!==scanMode||applied.gamepad!==gamepad||
       (scope!=='polling'&&applied.runningScanner!==scanMode)||
       (scope==='polling'&&applied.runningRate!==rate)){
      throw new Error('The keyboard did not confirm the requested rates.');
    }
    return applied;
  },
  async device(save=true,scope='both'){
    let rate=values('polling'),scanMode=values('scan');
    const active=client;
    if(!active){Object.assign(info,{rate,scanMode});mark();return;}
    if(status?.calibrationPhase)throw new Error('Finish or stop calibration before changing device settings.');
    clearTimeout(autoSaveTimer);
    const before=await active.capabilities();
    if(scope==='polling')scanMode=before.scanMode;
    if(scope==='scanner')rate=before.rate;
    const gamepad=fullGamepad()?before.gamepad:checkbox('enablePad');
    const applied=await actions.applyRates(active,before,rate,scanMode,gamepad,scope);
    if(!save||recoverySave(active)){
      message(scope==='polling'?'Polling rate applied.':scope==='scanner'?'Scanner mode applied.':'Rates applied for this session.');
      return;
    }
    await active.foundation.control(8);
    const saved=await active.foundation.readStatus();
    if(client!==active)return;
    acceptStatus(saved);
    if(!saved.savedValid||saved.dirty||saved.storeStatus===2){
      throw new Error('The keyboard did not confirm the save.');
    }
    message(info.runningRate===rate?'Polling and scan rates applied and saved.':'Rates saved. Reconnect USB to activate the polling rate on this firmware.');
  },
  async rememberRates(){
    const active=client;
    if(!active||!browserRates()||status?.calibrationPhase)return;
    const {runningRate:rate,runningScanner:scanMode}=await active.capabilities();
    if(client!==active)return;
    if(!RATES[rate]||scanMode<0||scanMode>2)throw new Error('The keyboard did not report valid active rates.');
    sessionRates.set(rememberedRatesKey(active),{rate,scanMode});
    message('Active rates remembered for this tab.');
  },
  forgetRates(){
    if(!browserRates())return;
    sessionRates.delete(rememberedRatesKey(client));
    message('Remembered rates cleared for this tab.');
  },
  async renameProfile(){
    const label=named('profileName').trim();
    if(!/^[ -~]{1,15}$/.test(label))throw new Error('Use 1–15 printable ASCII characters.');
    if(client){await requireActiveProfile();await client.rename(label);}
    profile.name=label;info.names[info.active]=label;mark();
  },
  async control(op,text){
    const active=client;
    if(!active)return;
    await active.foundation.control(op);
    if([5,6,7].includes(op))dirty=true;
    if([4,11].includes(op)){
      const next=await active.foundation.readStatus();
      if(client!==active)return;
      acceptStatus(next);
    }else await refresh();
    message(text);
    if(dirty&&!status?.calibrationPhase)queueAutoSave();
  }
};
async function saveChanges(){
  if(!client||recoveryPending||usbTransition||!dirty)return;
  if(recoverySave()){downloadProfile();return;}
  await client.foundation.control(8);
  await refresh();
  if(!status?.savedValid||status.dirty||status.storeStatus!==1)throw new Error('The keyboard did not confirm the save.');
  message('All four profile slots and device settings saved.');
}
function queueAutoSave(){
  clearTimeout(autoSaveTimer);
  if(client&&!recoverySave()&&dirty&&byId('autoApplyToggle').checked&&!recoveryPending&&!usbTransition){
    autoSaveTimer=setTimeout(()=>{
      if(busy){queueAutoSave();return;}
      if(!status?.calibrationPhase)run(saveChanges);
    },2500);
  }
}
async function setControllerUSB(enabled,deviceType='gamepad'){
  const label=deviceType==='mouse'?'USB mouse':'Xbox controller';
  if(!client){info[deviceType]=enabled;mark();return;}
  if(info[deviceType]===enabled&&info[deviceType+'Attached']===enabled)return;
  const previous=client;
  usbTransition=true;clearTimeout(autoSaveTimer);
  try{
    if(deviceType==='mouse')await previous.mouseUSB(enabled);
    else await previous.gamepadUSB(enabled);
    const device=previous.transport.device;
    client=null;generation++;status=padState=rgb=null;
    await previous.transport.close().catch(()=>{});
    info[deviceType]=enabled;dirty=true;
    message('Updating '+label+'. Waiting for the keyboard to reconnect…');
    const next=await ProDevice.reconnect(device,enabled,{deviceType});
    if(!next){message('USB setting accepted. Select Connect keyboard to confirm the new state.');return;}
    client=next;generation++;
    await refresh();
    message(label+' '+(enabled?'enabled':'disabled')+'.'+(dirty?' '+(recoverySave()?'The choice applies for this session.':'Save changes to keep this setting after power loss.') :''));
  }finally{usbTransition=false;queueAutoSave();}
}
async function recover(){
  const active=client;
  if(!active||recoveryPending)return;
  recoveryPending=true;
  clearTimeout(autoSaveTimer);
  const attempt={};
  try{
    await active.foundation.transaction(()=>beginRecovery(navigator.hid,active.transport,attempt,message));
    if(client===active)await active.transport.close().catch(()=>{});
    client=null;generation++;status=rgb=null;
    location.assign('../flasher/');
  }finally{recoveryPending=false;}
}
function showWorkspace(){
  byId('welcome').hidden=true;
  byId('workspace').classList.remove('hidden');
  render();
}
function showWelcome(){
  byId('welcome').hidden=false;
  byId('workspace').classList.add('hidden');
  byId('initializeDevice').hidden=true;
  byId('welcomeContent').hidden=false;
}
function openPicker(inputId){
  const input=byId(inputId);
  if(!input)return;
  const allowLayers=inputId==='binding';
  const codes=[...USAGE_NAMES.keys()].filter(code=>code>=4&&code<=0xa4);
  const groups=[{id:'basic',label:'Keyboard',codes},{id:'modifiers',label:'Modifiers',codes:[224,225,226,227,228,229,230,231]}];
  if(allowLayers)groups.push({id:'layers',label:'Layers',codes:[255,253,...(layer?[254]:[])]});
  let current=0;
  try{current=bindingCode(input.value,allowLayers?layer:0);}catch{}
  openAdvancedKeyPicker({title:'Choose key value',eyebrow:'Key picker',context:KEY_NAMES[key],
    description:allowLayers?'Select a binding for the selected layer.':'Select an output for this rule.',
    groups,current,allowClear:true,onSelect:code=>{input.value=bindingLabel(code);},onClear:()=>{input.value='None';}});
}
function downloadProfile(){
  const saved=fullGamepad()?{format:'he30-pro-profile-v2',config,profile,controller}:{format:'he30-pro-profile-v1',config,profile};
  const blob=new Blob([JSON.stringify(saved,null,2)],{type:'application/json'});
  const link=document.createElement('a');
  const url=URL.createObjectURL(blob);
  link.href=url;link.download='HE30-Pro-'+(info.active+1)+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function restoreProfile(file){
  if(!file)return;
  if(file.size>1000000)throw new Error('Choose a HE30 profile JSON under 1 MB.');
  const saved=JSON.parse(await file.text());
  if(saved.format==='he30-foundation-profile-v1'){
    const validated=importProfile(saved);
    if(client)config=await client.foundation.applyConfig(validated);
    else offline[info.active].config=config=validated;
    mark('Earlier keyboard settings restored to the current slot. '+keepChanges());
    return;
  }
  if(saved.format==='he30-lighting-profile-v1'){
    const validated=importLighting(saved);
    validated.barCount=Math.min(5,validated.barCount);
    if(client)await client.lighting.apply(validated);
    profile.lighting=validated;rgb=null;mark();return;
  }
  if(!['he30-pro-profile-v1','he30-pro-profile-v2'].includes(saved.format))throw new Error('Choose a HE30 profile JSON.');
  if(saved.format==='he30-pro-profile-v2'&&!fullGamepad())throw new Error('Update to HE30 Pro v0.11 before importing an Xbox controller profile.');
  const next=structuredClone(saved.profile),nextCfg=structuredClone(saved.config);
  if(next.fnLighting!==undefined){
    if(!Array.isArray(next.fnLighting)||next.fnLighting.length!==2)throw new Error('Expected two Fn lighting palettes.');
    const palettes=next.fnLighting.map(encodeFnLighting);
    if(client&&!client.lighting.supportsFnLighting){
      if(palettes.some(data=>data.some(Boolean)))throw new Error('Fn lighting requires HE30 Pro v0.22.');
      delete next.fnLighting;
    }
  }
  if(next.lightingPreferences){
    encodeLightingPreferences(next.lightingPreferences);
    if(client&&!client.lighting.supportsPreferences)throw new Error('This profile has RGB options that require HE30 Pro v0.26.');
  }
  encodeConfig(nextCfg);encodeLighting(next.lighting);
  client?.lighting.checkBrightness(next.lighting);
  if(!/^[ -~]{1,15}$/.test(next.name)||next.lighting.barCount>5||!Array.isArray(next.actions)||![8,10].includes(next.actions.length)||
     !['fn2','gamepad','travel','coefficient'].every(name=>Array.isArray(next[name])&&next[name].length===36))
    throw new Error('Invalid profile structure.');
  next.actions.forEach(actionBytes);
  const actionSlots=client?.actionSlots??10;
  if(next.actions.slice(actionSlots).some(rule=>rule.kind))throw new Error('This profile uses advanced slots that require HE30 Pro v0.28.');
  next.actions=Array.from({length:actionSlots},(_,i)=>next.actions[i]??blankAction());
  if(!mediaKeys()&&next.fn2.some(isMediaUsage))throw new Error('This profile uses media mappings that require HE30 Pro v0.26.');
  if(!desktopKeys()&&next.fn2.some(isDesktopUsage))throw new Error('This profile uses mappings that require HE30 Pro v0.25.');
  if(!profileKeys()&&next.fn2.some(isProfileUsage))throw new Error('This profile uses shortcuts that require HE30 Pro v0.20.');
  for(let i=0;i<36;i++){
    if(![next.fn2[i],next.gamepad[i],next.travel[i],next.coefficient[i]].every(Number.isInteger)||
       bindingCode(bindingLabel(next.fn2[i]),2)!==next.fn2[i]||next.gamepad[i]<0||next.gamepad[i]>26||
       next.travel[i]<500||next.travel[i]>6000||next.coefficient[i]<0||next.coefficient[i]>65535)
      throw new Error('Invalid profile field for '+KEY_NAMES[i]+'.');
  }
  let nextController=null,migrationWarnings=[];
  if(fullGamepad()){
    if(saved.format==='he30-pro-profile-v2'){
      nextController=decodeGamepad(encodeGamepad(saved.controller));
      const bindings=controllerBindings(nextController);
      if(bindings.some((binding,index)=>binding!==next.gamepad[index]))throw new Error('Controller assignments differ between the exported profile and settings.');
    }else{
      const migrated=migrateLegacyGamepad(next.gamepad,{mode:controller.mode});
      nextController=migrated.config;migrationWarnings=migrated.warnings;
      next.gamepad=controllerBindings(nextController);
    }
  }
  if(client){
    try{
      await client.foundation.applyConfig(nextCfg);
      await client.lighting.apply(next.lighting);
      if(next.lightingPreferences)await client.lighting.applyPreferences(info.active,next.lightingPreferences);
      if(next.fnLighting)for(const layer of [1,2])await client.lighting.applyFn(info.active,layer,next.fnLighting[layer-1]);
      for(let i=0;i<36;i++){
        if(next.fn2[i]!==profile.fn2[i])await client.fn2(i,next.fn2[i]);
        if(!nextController&&next.gamepad[i]!==profile.gamepad[i])await client.mapping(i,next.gamepad[i]);
        if(next.travel[i]!==profile.travel[i]||next.coefficient[i]!==profile.coefficient[i])
          await client.switch(i,next.travel[i],next.coefficient[i]);
      }
      for(let i=0;i<actionSlots;i++)await client.action(i,next.actions[i]);
      if(nextController)await client.applyGamepad(nextController);
      await client.rename(next.name);
      await refresh();
    }catch(error){await refresh().catch(()=>{});throw new Error('Restore was interrupted. Review the keyboard settings before saving. '+error.message);}
  }else{
    next.fnLighting??=profile.fnLighting??blankFnLighting();
    offline[info.active]={config:nextCfg,profile:next};config=nextCfg;profile=next;info.names[info.active]=next.name;
    if(nextController)controller=nextController;
  }
  padChoice=fullGamepad()?gamepadActionForKey(controller,key):null;
  rgb=null;mark(migrationWarnings.length?'Profile imported. '+migrationWarnings.join(' ')+' '+keepChanges():undefined);
}
const actionMap={
  lightingTiming:async()=>{
    const speed=values('animationSpeed'),minutes=num('rgbSleepMinutes',0,1092),seconds=num('rgbSleepSeconds',0,59);
    if(!Number.isInteger(minutes)||!Number.isInteger(seconds))throw new Error('Use whole minutes and seconds.');
    const next={speed,sleep:minutes*60+seconds,keepBar:checkbox('rgbKeepBar')};
    encodeLightingPreferences(next);
    await requireActiveProfile();
    profile.lightingPreferences=client?await client.lighting.applyPreferences(info.active,next):next;
    mark('Animation and sleep applied. '+keepChanges());
  },
  pointerSpeed:async()=>{
    const speed=num('pointerSpeed',1,32);
    if(!Number.isInteger(speed))throw new Error('Choose a whole pointer speed.');
    await requireActiveProfile();
    if(client)await client.pointerSpeed(speed);
    profile.lighting.pointerSpeed=speed;
    mark('Pointer speed applied. '+keepChanges());
  },
  scanTrial:async()=>{
    await client.scanTrial(values('scanTrial'));
    await refresh();
    message('Scanner restarted. Check the measured scan rate and raw readings.');
  },
  selectAllKeys:()=>selectKeys(visualKeyOrder),
  invertKeys:()=>selectKeys(visualKeyOrder,'toggle'),
  singleKey:()=>{selectionAnchor=key;selectKeys([key]);},
  bind:actions.bind,tune:()=>actions.tune(false,false),tuneAll:()=>actions.tune(true,false),
  rapid:()=>actions.tune(false,true),rapidAll:()=>actions.tune(true,true),
  switch:()=>actions.switch(false),switchAll:()=>actions.switch(true),rule:actions.rule,rgb:()=>actions.rgb(),rgbBar:()=>actions.rgb('bar'),gamepad:actions.gamepad,clearPad:actions.clearPad,
  rateImage:()=>{location.assign('../flasher/?polling='+values('polling')+'&scanner='+values('scan'));},
  device:actions.device,sessionRates:()=>actions.device(false),applyPolling:()=>actions.device(false,'polling'),applyScanner:()=>actions.device(false,'scanner'),
  rememberRates:actions.rememberRates,forgetRates:actions.forgetRates,
  renameProfile:actions.renameProfile,exportProfile:downloadProfile,identify:()=>client?.lighting.identify(key),
  begin:()=>actions.control(4,'Calibration started.'),finish:()=>actions.control(5,'Calibration finished. '+keepChanges()),
  abort:()=>actions.control(11,'Calibration stopped.'),enable:()=>actions.control(6,'Typing enabled. Release all keys. '+keepChanges()),
  disable:()=>actions.control(7,'Typing disabled.'),retry:()=>actions.control(10,'Scanner restarted. Check live depth and scan rate.'),
  recovery:recover,quick:()=>{page='performance';view='quick';},settings:()=>{page='settings';view='settings';}
};
document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el||busy||el.disabled)return;
  if(el.dataset.page){
    page=el.dataset.page;view=el.dataset.view||'quick';
    if(!multiKeyPage()){selectedKeys=new Set([key]);selectionAnchor=key;}
    render();
  }
  if(el.dataset.lightingLayer!==undefined){lightingLayer=Number(el.dataset.lightingLayer);render();}
  if(el.dataset.lightingArea&&el.dataset.lightingArea!==lightingArea){lightingArea=el.dataset.lightingArea;render();}
  if(el.dataset.controllerView&&el.dataset.controllerView!==controllerView){controllerView=el.dataset.controllerView;render();}
  if(el.dataset.lightMode!==undefined){
    const mode=byId('lightMode');mode.value=el.dataset.lightMode;
    mode.dispatchEvent(new Event('input',{bubbles:true}));
  }
  if(el.id==='livePressDistanceToggle')setLiveTravel(!liveTravel);
  if(el.dataset.key!==undefined){
    const index=Number(el.dataset.key);
    const modified=e.shiftKey||e.ctrlKey||e.metaKey||e.altKey;
    if(multiKeyPage()&&e.shiftKey){
      const a=visualKeyOrder.indexOf(selectionAnchor),b=visualKeyOrder.indexOf(index);
      selectKeys(visualKeyOrder.slice(Math.min(a,b),Math.max(a,b)+1),e.ctrlKey||e.metaKey?'add':'replace',index);
    }else{
      const mode=multiKeyPage()&&e.altKey?'remove':multiKeyPage()&&(e.ctrlKey||e.metaKey)?'toggle':'replace';
      selectKeys([index],mode,index);
      selectionAnchor=key;
    }
    padChoice=fullGamepad()?gamepadActionForKey(controller,key):null;
    if(page==='advanced'){
      const existing=profile.actions.findIndex(rule=>actionKeys(rule).includes(key));
      if(existing>=0){showRule(existing);return;}
      if(advancedKind===null)slot=Math.max(0,profile.actions.findIndex(rule=>!rule.kind));
    }
    render();
  }
  if(el.dataset.controllerAction!==undefined){
    padChoice=Number(el.dataset.controllerAction);render();
  }
  if(el.dataset.curvePreset){
    const presets={linear:[0,33.33,66.67,100],gentle:[0,10,40,100],fast:[0,60,90,100]};
    [0,1,2,3].forEach(i=>{byId('curveX'+i).value=[0,33.33,66.67,100][i];byId('curveY'+i).value=presets[el.dataset.curvePreset][i];});
    paintControllerCurve();
  }
  if(el.dataset.picker)openPicker(el.dataset.picker);
  if(el.dataset.advancedKind!==undefined)chooseFeature(Number(el.dataset.advancedKind));
  if(el.dataset.ruleSlot!==undefined)showRule(Number(el.dataset.ruleSlot));
  if(el.dataset.removeRule!==undefined)run(()=>actions.removeRule(Number(el.dataset.removeRule)));
  if(el.dataset.action)run(actionMap[el.dataset.action]);
});
byId('backHomeButton').onclick=showWelcome;
byId('tryWorkspace').onclick=showWorkspace;
byId('calibrationAdvice').addEventListener('close',e=>{
  if(e.target.returnValue==='calibrate'&&client){page='performance';view='quick';render();}
});
byId('startInitialization').onclick=()=>{
  if(client){showWorkspace();return;}
  byId('welcomeContent').hidden=true;
  byId('initializeDevice').hidden=false;
};
byId('cancelInitialization').onclick=showWelcome;
byId('toggleSidebar').onclick=()=>{const node=document.documentElement;node.dataset.sidebar=node.dataset.sidebar==='compact'?'':'compact';};
byId('sidebarThemeSelect').onchange=e=>{document.documentElement.dataset.theme=e.target.value;};
byId('rename').onclick=()=>{page='settings';view='profiles';render();byId('profileName').focus();};
byId('editor').addEventListener('input',event=>{
  const input=event.target;
  if(input.id==='perKey'){if(!lightingLayer)byId('lightMode').value='2';paletteEdited=true;}
  if(input.id==='barColor')byId('barEnabled').checked=true;
  if(input.id==='keyColor'&&![1,3,5].includes(values('lightMode')))byId('lightMode').value='1';
  if(page==='lighting'){
    const output=input.parentElement.querySelector('output');
    if(output)output.value=input.value+'%';
    if(input.closest('[data-lightbar]')){barDraft=readLightingEditor('bar');paintBarControls();}
    else if(!input.closest('[data-lighting-timing]'))lightingDraft=readLightingEditor();
    if(byId('lightMode'))byId('editor').querySelectorAll('[data-light-mode]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.lightMode===byId('lightMode').value)));
    paintBoard();
  }
  if(input.dataset.distanceFor)byId(input.dataset.distanceFor).value=input.value;
  else if(input.id){
    const slider=byId('editor').querySelector('[data-distance-for="'+CSS.escape(input.id)+'"]');
    if(slider)slider.value=input.value;
  }
  const rtField=input.dataset.distanceFor||input.id;
  if(rtField==='depth0'||rtField==='depth1')paintRuleTravel();
  if(syncRapid&&['rtPress','rtRelease'].includes(rtField)){
    const other=rtField==='rtPress'?'rtRelease':'rtPress';
    byId(other).value=input.value;
    byId('editor').querySelector('[data-distance-for="'+other+'"]').value=input.value;
  }
});
bindBoardSelection(byId('board'),()=>!busy&&multiKeyPage(),(keys,mode)=>{
  selectKeys(keys,mode,mode==='replace'?keys[0]:key);
  selectionAnchor=key;
  render();
});
byId('editor').addEventListener('change',e=>{
  if(e.target.id==='distancePrecision'){
    distancePrecision=Number(e.target.value);
    render();
  }
  if(e.target.id==='boardGauge'){
    boardGauge=e.target.checked;
    paintBoard();
  }
  if(e.target.id==='showSwitchAdc'){showSwitchAdc=e.target.checked;render();}
  if(e.target.id==='syncRapid'){
    syncRapid=e.target.checked;
    if(syncRapid)byId('rtPress').dispatchEvent(new Event('input',{bubbles:true}));
  }
  if(e.target.id==='restoreProfile')run(()=>restoreProfile(e.target.files[0]));
  if(e.target.id==='layer'){layer=values('layer');render();}
  if(e.target.id==='actionSlot'){
    const next=values('actionSlot');
    if(profile.actions[next].kind)showRule(next);
    else{slot=next;render();}
  }
  if(e.target.id==='hostKey'&&byId('ruleDepths')){
    const fields=byId('ruleDepths'),action=displayedAction(),next=values('hostKey');
    try{
      fields.innerHTML=actionDepthFields({...action,key:next,depth:ruleDepths(action,Number(fields.dataset.keyIndex))},travelField);
      fields.dataset.keyIndex=next;
      paintRuleTravel();
    }catch(error){e.target.value=fields.dataset.keyIndex;message(error.message,true);}
  }
  if(e.target.id==='gamepadBind'&&fullGamepad()){
    const choice=values('gamepadBind')-1;
    padChoice=choice<0?null:choice;render();
  }
  if(e.target.id==='controllerUSB')run(()=>setControllerUSB(e.target.checked));
  if(e.target.id==='mouseUSB')run(()=>setControllerUSB(e.target.checked,'mouse'));
  if(e.target.id==='switchModel'){
    const s=catalog[values('switchModel')];byId('travel').value=s.travel/1000;byId('coefficient').value=s.coefficient;
  }
});
byId('activeProfile').onchange=()=>run(async()=>{
  const next=values('activeProfile');
  if(client){
    await client.select(next);
    if(await refresh())message(profile.name+' active on the keyboard.');
  }else{
    advancedKind=null;slot=0;rgb=null;
    info.active=next;({config,profile}=offline[next]);
    controller=controllerForBindings(profile.gamepad);padChoice=gamepadActionForKey(controller,key);
  }
});
const connectKeyboard=authorizedProduct=>run(async()=>{
  if(client){
    clearTimeout(autoSaveTimer);
    const old=client;
    client=null;generation++;status=padState=rgb=null;
    await old.transport.close();
    message('Keyboard disconnected.');
    return;
  }
  const next=await ProDevice.connect(authorizedProduct);if(!next)return;
  calibrationAdviceShown.clear();switchCalibrationAdvice=false;endpointDeviationSince=0;endpointDeviationKeys=[];
  client=next;generation++;
  try{
    await refresh();
    if(client!==next)return;
    showWorkspace();
    const remembered=browserRates()&&!status.calibrationPhase&&rememberedRates();
    if(remembered){
      try{
        await actions.applyRates(next,info,remembered.rate,remembered.scanMode,info.gamepad);
        if(client===next)message('Connected. Rates restored for this tab.');
      }catch(error){await reportDeviceError(error);}
    }else message('Connected to '+next.transport.device.productName+'.');
  }
  catch(err){client=null;await next.transport.close().catch(()=>{});throw err;}
});
byId('connect').onclick=()=>connectKeyboard();
byId('heroConnect').onclick=()=>{
  connectKeyboard().then(()=>{
    if(!client)byId('initializeStatus').textContent=byId('status').textContent;
  });
};
byId('save').onclick=()=>run(saveChanges);
byId('revert').onclick=()=>run(async()=>{
  clearTimeout(autoSaveTimer);
  await client.foundation.control(12);
  await refresh();rgb=null;
  if(client?.supportsGamepad&&info.gamepad!==info.gamepadAttached)await setControllerUSB(info.gamepad);
  else message('Saved settings restored.');
});
byId('autoApplyToggle').onchange=queueAutoSave;
navigator.hid?.addEventListener('disconnect',event=>{
  if(event.device!==client?.transport.device)return;
  clearTimeout(autoSaveTimer);
  client.transport.disconnected();client=null;generation++;status=rgb=null;
  padState=null;
  message('Keyboard disconnected. Reconnect HE30 Pro to read saved settings.');render();
});
window.addEventListener('pagehide',()=>client?.transport.close().catch(()=>{}));
async function poll(){
  const active=client,stamp=generation,pageAtStart=page,viewAtStart=view;
  const start=performance.now();
  const fast=!!active&&(tuningPage()&&liveTravel||byId('ruleTravel')?.open||boardGauge&&!byId('board').hidden&&page!=='lighting')&&!document.hidden;
  const lighting=page==='lighting'&&!document.hidden;
  if(active&&!document.hidden&&!active.transport.closed&&!busy&&!pollPending&&!recoveryPending&&!usbTransition){
    pollPending=true;
    const current=()=>stamp===generation&&client===active&&!busy&&page===pageAtStart&&view===viewAtStart;
    try{
      const full=switchAdcVisible()||(!fast&&!lighting)||!status||start-lastFullStatus>=(lighting?200:1000);
      const next=full?await active.foundation.readStatus():fast?await active.foundation.readTravel():null;
      const extra=full&&current()&&(['diagnostics','overview','settings'].includes(page)||lighting&&active.supportsDesktopKeys)?await active.capabilities():null;
      const checkProfile=full||start-lastProfileCheck>=200;
      const observed=extra?.active??(checkProfile&&current()?await active.activeProfile():info.active);
      if(current()&&checkProfile)lastProfileCheck=start;
      if(current()&&observed!==info.active){
        if(await refresh(current)){
          render();
          message(profile.name+' active on the keyboard.');
        }
      }else if(current()){
        if(full){
          lastFullStatus=start;
          const wasCalibrating=!!status?.calibrationPhase;
          acceptStatus(next);
          if(wasCalibrating!==!!status.calibrationPhase)render();
          paintSaveState();
          if(extra){
            Object.assign(info,extra);
            if(extra.keyBrightness!==undefined&&extra.keyBrightness!==(profile.lighting.keyBrightness??100)){
              profile.lighting.keyBrightness=extra.keyBrightness;
              const brightness=byId('keyBrightness');
              if(brightness&&!lightingDraft){brightness.value=extra.keyBrightness;brightness.parentElement.querySelector('output').value=extra.keyBrightness+'%';}
            }
          }
          const scan=byId('scan');
          if(scan)scanOptions().forEach((label,index)=>{scan.options[index].textContent=label;});
          if(page==='gamepad'&&active.supportsGamepad){
            const controllerLive=await active.gamepadStatus();
            if(current())padState=controllerLive;
          }
        }else if(next)status={...status,...next};
        if(lighting&&current()&&(!lightingDraft||!barDraft)){
          const frame=await active.liveRGB();
          if(current())rgb=frame;
        }
        if(current())paintBoard();
        if(full&&current())maybeRecommendCalibration();
      }
    }catch(error){if(current())await reportDeviceError(error);}
    finally{pollPending=false;}
  }else if(lighting&&!busy)paintBoard();
  const live=!!client&&(tuningPage()&&liveTravel||byId('ruleTravel')?.open||boardGauge&&!byId('board').hidden&&page!=='lighting')&&!document.hidden;
  const calibrating=!!client&&page==='performance'&&view==='quick'&&!!status?.calibrationPhase&&!document.hidden;
  const interval=switchAdcVisible()&&client&&!document.hidden?100:live?1000/60:page==='lighting'&&!document.hidden?1000/30:calibrating?50:200;
  setTimeout(poll,Math.max(4,interval-(performance.now()-start)));
}
for(const label of [...USAGE_NAMES.values(),'Fn1','Fn2']){
  const option=document.createElement('option');option.value=label;byId('keyCodes').append(option);
}
fetch('switches.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{catalog.push(...data.switches);if(page==='performance'&&view==='switches')render();}).catch(()=>{});
render();
if(!navigator.hid)byId('heroConnect').disabled=true;
poll();
const handoff=new URL(location.href);
const authorizedProduct=handoff.searchParams.get('connect');
if(authorizedProduct&&navigator.hid){
  handoff.searchParams.delete('connect');
  history.replaceState(null,'',handoff);
  showWorkspace();
  connectKeyboard(authorizedProduct);
}
