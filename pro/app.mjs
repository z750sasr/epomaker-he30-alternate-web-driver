import {ProDevice,ACTIONS,GAMEPAD,RATES,ZUOYA,KEY_NAMES,bindingCode,bindingLabel,encodeConfig,encodeLighting} from './protocol.mjs';
import {USAGE_NAMES,importProfile} from '../flasher/keyboard-protocol.mjs';
import {importLighting} from '../flasher/lighting-protocol.mjs';
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
  version:1,groupOutputs:[2,0,1],settleLoops:16000,bankVerified:true,startupTyping:false,
  calibrated:Array(36).fill(false),released:Array(36).fill(0),pressed:Array(36).fill(0),
  keys:KEY_NAMES.map((name,i)=>({normalUsage:codeFor(name),fnUsage:i<6?64+i:254,actuation:500,hysteresis:50,rtPress:40,rtRelease:40,rapidTrigger:false,topDeadzone:0,bottomDeadzone:0,disabled:false}))
});
const defaultProfile=()=>({name:'Profile',fn2:Array(36).fill(254),gamepad:Array(36).fill(0),travel:Array(36).fill(4000),coefficient:Array(36).fill(0),
  actions:Array.from({length:8},blankAction),lighting:{version:1,mode:1,order:0,rate:0,barCount:5,barEnabled:true,color:[16,16,16],barColor:[16,16,16],palette:Array.from({length:36},()=>[0,0,0])}});
const offline=Array.from({length:4},(_,i)=>({config:defaults(),profile:{...defaultProfile(),name:'Profile '+(i+1)}}));
let client=null,config=offline[0].config,profile=offline[0].profile;
let info={active:0,rate:3,scanMode:0,gamepad:false,names:offline.map(p=>p.profile.name)};
let status=null,rgb=null,slot=0,layer=0,key=0,page='performance',view='quick',busy=false,dirty=false,generation=0,pollPending=false;
let catalog=[{name:'Linear / custom',brand:'Endpoint calibration',travel:4000,coefficient:0},...ZUOYA];
const esc=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const color=(values,scale=1)=>'#'+values.map(value=>Math.round(value*scale).toString(16).padStart(2,'0')).join('');
function channels(input){return input.slice(1).match(/../g).map(n=>Math.round(parseInt(n,16)*32/255));}
const select=(id,label,options,selected)=>'<label>'+label+'<select id="'+id+'">'+options.map((label,i)=>'<option value="'+i+'" '+(i===selected?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
const field=(id,label,value,min,max,step=1)=>'<label>'+label+'<input type="number" id="'+id+'" value="'+value+'" min="'+min+'" max="'+max+'" step="'+step+'"></label>';
const check=(id,text,value)=>'<label class="check"><input id="'+id+'" type="checkbox" '+(value?'checked':'')+'>'+text+'</label>';
const textField=(id,label,value,list='')=>'<label>'+label+'<input id="'+id+'" '+(list?'list="'+list+'"':'')+' value="'+esc(value)+'"></label>';
const btn=(label,action,disabled=false)=>'<button type="button" class="button ghost" data-action="'+action+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
const commands=(...items)=>'<div class="commands">'+items.join('')+'</div>';
const grid=(...items)=>'<div class="pro-grid">'+items.join('')+'</div>';
const liveOnly=!navigator.hid;
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
async function refresh(){
  const current=client;
  if(!current)return;
  const next=await current.capabilities(),nextConfig=await current.foundation.readConfig(),nextProfile=await current.profile();
  const state=await current.foundation.readStatus();
  if(current!==client)return;
  info=next;config=nextConfig;profile=nextProfile;status=state;dirty=state.dirty;
}
async function run(task){
  if(busy)return;
  busy=true;document.body.classList.add('working');byId('save').disabled=true;
  try{await task();}
  catch(err){message(err.message,true);}
  finally{busy=false;document.body.classList.remove('working');render();}
}
function mark(text='Changes applied. Save changes to keep them after unplugging.'){
  dirty=true;message(client?text:'Offline workspace updated.');
}
function selectedUsage(idx){
  return layer===2?profile.fn2[idx]:layer===1?config.keys[idx].fnUsage:config.keys[idx].normalUsage;
}
function renderBoard(){
  const board=byId('board');
  board.hidden=page==='firmware'||page==='settings'||page==='diagnostics';
  if(board.hidden)return;
  board.innerHTML='<div class="pro-board">'+rows.map(row=>'<div class="pro-row">'+row.map(i=>'<button type="button" class="pro-key" data-key="'+i+'" data-selected="'+(i===key)+'" style="flex-grow:'+(({Tab:1.5,Caps:1.75,LShift:2.25,Ctrl:1.25,Fn:1.25,Alt:1.25,Space:2.75})[KEY_NAMES[i]]||1)+'"><span>'+esc(KEY_NAMES[i]==='Grave'?'~':KEY_NAMES[i])+'</span><small>'+esc(page==='gamepad'?GAMEPAD[profile.gamepad[i]]:bindingLabel(selectedUsage(i)))+'</small></button>').join('')+'</div>').join('')+'</div><div class="pro-bar" aria-label="Five lightbar LEDs">'+Array(5).fill('<i></i>').join('')+'</div>';
  paintBoard();
}
function paintBoard(){
  for(const element of byId('board').querySelectorAll('[data-key]')){
    const i=Number(element.dataset.key);
    element.dataset.pressed=!!status?.pressed[i];
    element.style.setProperty('--depth',(status?.positions[i]||0)/10+'%');
    if(page==='lighting'){
      const {mode,palette,color:base}=profile.lighting;
      const preview=mode===2?palette[i]:mode===1||mode===3&&status?.pressed[i]?base:[0,0,0];
      const actual=rgb?Array.from(rgb.slice(3*i,3*i+3)):preview;
      element.style.borderColor=actual.some(Boolean)?color(actual,255/32):'';
    }
  }
  byId('board').querySelectorAll('.pro-bar i').forEach((led,i)=>{
    const actual=rgb?Array.from(rgb.slice(108+3*i,111+3*i)):profile.lighting.barEnabled?profile.lighting.barColor:[0,0,0];
    led.style.setProperty('--bar-color',actual.some(Boolean)?color(actual,255/32):'');
  });
  const pos=status?.positions[key];
  const travel=byId('travelReading');
  if(travel)travel.textContent=pos==null?'—':(pos*profile.travel[key]/1e6).toFixed(3)+' mm estimated · '+(pos/10).toFixed(1)+'%';
  const cal=byId('calState');
  if(cal){
    const n=status?.calibrated.filter(Boolean).length||0;
    cal.textContent=status?.adcError?'ADC error '+status.adcError:status?.calibrationPhase===1?'Keep all keys released while baseline readings are collected.':status?.calibrationPhase===2?'Fully press and release each key. '+n+' of 36 measured.':n+' of 36 keys calibrated.';
    byId('calProgress').value=n;
    byId('finish').disabled=!client||n!==36||status?.calibrationPhase!==2;
  }
  const diag=byId('scanStats');
  if(diag)diag.textContent=info.scanHz?info.scanHz.toLocaleString()+' Hz complete 36-key scans · '+(info.scanTicks/144).toFixed(1)+' µs ADC frame · '+(info.scanWorst/144).toFixed(1)+' µs worst ADC frame':'Awaiting a scan measurement';
}
const headings={
  quick:['Quick Settings','Calibrate the sensors and set up the keyboard.'],
  actuation:['Actuation Point','Adjust the selected key’s press point, release hysteresis and dead zones.'],
  rapid:['Rapid Trigger','Set the minimum movement needed to press and release again.'],
  switches:['Magnetic Switches','Assign a switch curve and travel to the selected physical key.'],
  keymap:['Remap','Edit the current onboard profile’s Main, Fn1 and Fn2 layers.'],
  advanced:['Advanced Keys','Configure eight rules per profile. Actions and pairs use physical key positions.'],
  gamepad:['Gamepad','Assign physical keys to controller buttons, triggers and opposing stick directions.'],
  lighting:['RGB Settings','Set the 36-key LEDs and the five-LED lightbar.'],
  settings:['Keyboard Settings','Choose report cadence, scan mode and USB controller visibility.'],
  profiles:['My Profiles','Four onboard slots, each with its own keymap, tuning, actions, gamepad bindings and lighting.'],
  overview:['Device Overview','See the active profile and firmware capabilities.'],
  diagnostics:['Diagnostics','Monitor complete scan frames and inspect sensor readings.'],
  firmware:['Firmware','Load the H3K09 firmware using the HE30 recovery page.']
};
function tuning(rapid){
  const k=config.keys[key],travel=profile.travel[key]/1000;
  const mm=(id,label,val)=>field(id,label,(val*travel/1000).toFixed(3),0,travel,0.005);
  return '<h2>'+esc(KEY_NAMES[key])+'</h2><p class="readout" id="travelReading">—</p>'+
    (rapid?grid(check('rapid','Rapid Trigger',k.rapidTrigger),mm('rtPress','Press movement · mm',k.rtPress),mm('rtRelease','Release movement · mm',k.rtRelease)):
      grid(mm('act','Actuation · mm',k.actuation),mm('hys','Release hysteresis · mm',k.hysteresis),field('top','Released dead zone · %',k.topDeadzone,0,40),field('bottom','Bottom dead zone · %',k.bottomDeadzone,0,40),check('disabled','Disable this physical key',k.disabled)))+
    commands(btn('Apply to selected key',rapid?'rapid':'tune'),btn('Apply tuning to every key',rapid?'rapidAll':'tuneAll'));
}
function renderEditor(which){
  if(which==='quick')return '<h2>Switch calibration</h2><p id="calState" aria-live="polite"></p><progress id="calProgress" max="36" value="0"></progress>'+
    '<div class="commands">'+btn('Begin calibration','begin',!client||!!status?.calibrationPhase)+'<button id="finish" class="button ghost" data-action="finish" disabled>Finish calibration</button>'+btn('Abort','abort',!client||!status?.calibrationPhase)+
    btn(status?.typingEnabled?'Disable typing':'Enable typing',status?.typingEnabled?'disable':'enable',!client||!!status?.calibrationPhase)+'</div><p>With all keys released, begin calibration. Then fully press and release every physical key.</p>';
  if(which==='actuation'||which==='rapid')return tuning(which==='rapid');
  if(which==='keymap')return '<h2>'+esc(KEY_NAMES[key])+'</h2>'+grid(select('layer','Layer',['Main','Fn1','Fn2'],layer),textField('binding','Binding',bindingLabel(selectedUsage(key)),'keyCodes'))+commands(btn('Apply binding','bind'))+
    '<p>Bind a Main-layer key to Fn1 or Fn2 to momentarily activate that layer. Transparent falls back to Main.</p>';
  if(which==='switches'){
    const chosen=catalog.findIndex(x=>x.coefficient===profile.coefficient[key]&&x.travel===profile.travel[key]);
    return '<h2>'+esc(KEY_NAMES[key])+'</h2>'+grid(select('switchModel','Switch',catalog.map(x=>x.brand+' · '+x.name),Math.max(0,chosen)),
      field('travel','Nominal travel · mm',profile.travel[key]/1000,.5,6,.005),field('coefficient','Hall curve coefficient',profile.coefficient[key],0,65535))+
      commands(btn('Apply to selected key','switch'),btn('Apply to all keys','switchAll'))+
      '<p>Zuoya fits and AE64 catalog entries are starting curves. Calibrate the installed switches. Displayed millimeters are estimates.</p>';
  }
  if(which==='lighting'){
    const light=profile.lighting;
    return '<h2>Keyboard and lightbar</h2>'+grid(select('lightMode','Keyboard effect',['Off','Solid','Per key','Reactive','Color wave','Breathing'],light.mode),
      '<label>Keyboard color<input id="keyColor" type="color" value="'+color(light.color,255/32)+'"></label>',
      check('barEnabled','Enable lightbar',light.barEnabled),
      '<label>Lightbar color<input id="barColor" type="color" value="'+color(light.barColor,255/32)+'"></label>',
      '<label>'+esc(KEY_NAMES[key])+' color<input id="perKey" type="color" value="'+color(light.palette[key],255/32)+'"></label>',
      select('colorOrder','Channel order',['GRB','RGB'],light.order),select('waveRate','LED data rate',['Original','Half rate'],light.rate))+
      commands(btn('Apply lighting','rgb'),btn('Identify selected LED','identify',!client));
  }
  if(which==='gamepad')return '<h2>'+esc(KEY_NAMES[key])+'</h2>'+grid(select('gamepadBind','Controller binding',GAMEPAD,profile.gamepad[key]))+
    commands(btn('Apply controller binding','gamepad'),btn('Controller settings','settings'))+
    '<p>Controller interface '+(info.gamepadAttached?'connected':'off')+'. Controller bindings suppress that physical key’s ordinary output while the interface is enabled.</p><p id="padStatus" class="readout"></p>';
  if(which==='advanced'){
    const a=profile.actions[slot];
    return '<h2>'+esc(ACTIONS[a.kind])+'</h2>'+grid(select('actionSlot','Rule slot',profile.actions.map((item,i)=>(i+1)+' · '+ACTIONS[item.kind]),slot),
      select('actionKind','Action',ACTIONS,a.kind),select('hostKey','Physical key',KEY_NAMES,a.key),
      select('otherKey','Other key',KEY_NAMES,a.other),select('pairMode','Pair policy',['Neutral / no hysteresis','Key A / retain priority','Key B','Last pressed'],a.mode),
      ...a.usage.map((u,i)=>textField('output'+i,['Output 1','Output 2','Output 3','Output 4'][i],bindingLabel(u),'keyCodes')),
      ...a.depth.map((d,i)=>field('depth'+i,['Depth 1 or time','Depth 2','Depth 3'][i],d,0,1000)))+
      '<p>Depth uses 0–1000 of travel. Mod Tap, Macro and End Key use the first field in milliseconds. DKS outputs run in shallow press, deep press, deep release, shallow release order.</p>'+commands(btn('Apply rule','rule'));
  }
  if(which==='settings'||which==='profiles')return '<h2>'+(which==='profiles'?'Onboard profiles':'USB and scanner')+'</h2>'+
    (which==='settings'?grid(select('polling','Report cadence',RATES.map(rate=>rate+' Hz'),info.rate),
      select('scan','Scanner',['Compatibility','ADC DMA · 13.5 cycles','ADC DMA · 7.5 cycles'],info.scanMode),check('enablePad','Expose USB gamepad after reconnect',info.gamepad))+
      commands(btn('Apply device settings','device'),btn('Restart scanner','retry',!client))+
      '<p>Save and reconnect to change report cadence or USB gamepad visibility. DMA modes require a hardware scan and noise check.</p>':
      grid(textField('profileName','Current profile name',profile.name))+commands(btn('Rename profile','renameProfile'),btn('Export current profile','exportProfile'))+
      '<label>Restore profile or earlier HE30 settings<input type="file" id="restoreProfile" accept="application/json,.json"></label>');
  if(which==='firmware')return '<h2>Firmware & recovery</h2><p>The recovery page checks the firmware hash and tracks the USB transition.</p>'+
    '<a href="../flasher/" class="button ghost linked-button">Open flasher</a>';
  if(which==='diagnostics')return '<h2>Scan diagnostics</h2><p id="scanStats">Awaiting a scan measurement</p><p id="travelReading"></p><pre id="rawData"></pre>';
  return '<h2>Epomaker HE30</h2><p>'+(client?'H3K09 connected':'Offline workspace')+' · 36 Hall sensors · 4 onboard profiles · 3 layers</p>'+
    '<p>Current profile '+esc(profile.name)+'. USB gamepad '+(info.gamepadAttached?'enabled':'disabled')+'.</p><p id="scanStats"></p>'+commands(btn('Calibration','quick'));
}
function render(){
  const which=page==='performance'?view:page==='settings'&&view==='profiles'?'profiles':page;
  const [title,description]=headings[which]||headings.overview;
  byId('pageTitle').innerHTML='<h1>'+title+'</h1><p>'+description+'</p>';
  byId('editor').innerHTML=renderEditor(which);
  byId('activeProfile').replaceChildren(...info.names.map((name,i)=>{
    const o=document.createElement('option');o.value=String(i);o.textContent=name||'Profile '+(i+1);o.selected=i===info.active;return o;
  }));
  byId('activeProfile').disabled=busy||!!status?.calibrationPhase;
  byId('save').disabled=!client||busy||!dirty||!!status?.calibrationPhase;
  byId('connect').textContent=client?'Disconnect':'Connect';
  byId('connect').disabled=busy||liveOnly;
  byId('connectionLabel').textContent=client?'H3K09 connected':'Offline workspace';
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page&&(!el.dataset.view||el.dataset.view===view)));
  renderBoard();
}
async function editConfig(edit){
  const next=structuredClone(config);edit(next);encodeConfig(next);
  if(client)config=await client.foundation.applyConfig(next);
  else offline[info.active].config=config=next;
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
    const max=profile.travel[key]/1000;
    const requested=input.map(id=>num(id,0,max));
    const top=rapid?0:num('top',0,40),bottom=rapid?0:num('bottom',0,40);
    const flag=checkbox(rapid?'rapid':'disabled');
    await editConfig(next=>{
      for(let i=0;i<36;i++)if(all||i===key){
        const k=next.keys[i],norm=(n,minimum,maximum)=>Math.max(minimum,Math.min(maximum,Math.round(n*1e6/profile.travel[i])));
        if(rapid) Object.assign(k,{rtPress:norm(requested[0],5,1000),rtRelease:norm(requested[1],5,1000),rapidTrigger:flag});
        else Object.assign(k,{actuation:norm(requested[0],10,990),hysteresis:norm(requested[1],1,500),topDeadzone:Math.round(top),bottomDeadzone:Math.round(bottom),disabled:flag});
      }
    });
  },
  async switch(all){
    const travel=Math.round(num('travel',.5,6)*1000),coefficient=Math.round(num('coefficient',0,65535));
    for(let i=0;i<36;i++)if(all||i===key){
      if(client)await client.switch(i,travel,coefficient);
      profile.travel[i]=travel;profile.coefficient[i]=coefficient;
    }
    mark();
  },
  async rule(){
    const kind=values('actionKind'),a={kind,key:values('hostKey'),other:values('otherKey'),mode:values('pairMode'),
      usage:Array.from({length:4},(_,i)=>bindingCode(named('output'+i),0)),depth:Array.from({length:3},(_,i)=>Math.round(num('depth'+i,0,1000)))};
    if(client)await client.action(slot,a);
    else {const {actionBytes}=await import('./protocol.mjs');actionBytes(a);}
    profile.actions[slot]=a;mark();
  },
  async rgb(){
    const next=structuredClone(profile.lighting);
    Object.assign(next,{mode:values('lightMode'),order:values('colorOrder'),rate:values('waveRate'),color:channels(named('keyColor')),
      barColor:channels(named('barColor')),barEnabled:checkbox('barEnabled')});
    next.palette[key]=channels(named('perKey'));encodeLighting(next);
    if(client)await client.lighting.apply(next);
    profile.lighting=next;rgb=null;mark();
  },
  async gamepad(){
    const binding=values('gamepadBind');
    if(client)await client.mapping(key,binding);
    profile.gamepad[key]=binding;mark();
  },
  async device(){
    const rate=values('polling'),scanMode=values('scan'),gamepad=checkbox('enablePad');
    if(client)await client.deviceSettings(rate,scanMode,gamepad);
    Object.assign(info,{rate,scanMode,gamepad});
    mark('Settings applied. Save changes, then reconnect USB for the new cadence and gamepad interface.');
  },
  async renameProfile(){
    const label=named('profileName').trim();
    if(!/^[ -~]{1,15}$/.test(label))throw new Error('Use 1–15 printable ASCII characters.');
    if(client)await client.rename(label);
    profile.name=label;info.names[info.active]=label;mark();
  },
  async control(op,text){
    if(!client)return;
    await client.foundation.control(op);await refresh();message(text);
  }
};
function downloadProfile(){
  const blob=new Blob([JSON.stringify({format:'he30-pro-profile-v1',config,profile},null,2)],{type:'application/json'});
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
    mark('Earlier keyboard settings restored to the current slot. Save changes to keep them.');
    return;
  }
  if(saved.format==='he30-lighting-profile-v1'){
    const validated=importLighting(saved);
    validated.barCount=Math.min(5,validated.barCount);
    if(client)await client.lighting.apply(validated);
    profile.lighting=validated;rgb=null;mark();return;
  }
  if(saved.format!=='he30-pro-profile-v1')throw new Error('Choose a HE30 profile JSON.');
  const {actionBytes}=await import('./protocol.mjs');
  const next=structuredClone(saved.profile),nextCfg=structuredClone(saved.config);
  encodeConfig(nextCfg);encodeLighting(next.lighting);
  if(!/^[ -~]{1,15}$/.test(next.name)||next.lighting.barCount>5||next.actions?.length!==8||
     !['fn2','gamepad','travel','coefficient'].every(name=>Array.isArray(next[name])&&next[name].length===36))
    throw new Error('Invalid profile structure.');
  next.actions.forEach(actionBytes);
  for(let i=0;i<36;i++){
    if(![next.fn2[i],next.gamepad[i],next.travel[i],next.coefficient[i]].every(Number.isInteger)||
       bindingCode(bindingLabel(next.fn2[i]),2)!==next.fn2[i]||next.gamepad[i]<0||next.gamepad[i]>26||
       next.travel[i]<500||next.travel[i]>6000||next.coefficient[i]<0||next.coefficient[i]>65535)
      throw new Error('Invalid profile field for '+KEY_NAMES[i]+'.');
  }
  if(client){
    try{
      await client.foundation.applyConfig(nextCfg);
      await client.lighting.apply(next.lighting);
      for(let i=0;i<36;i++){
        if(next.fn2[i]!==profile.fn2[i])await client.fn2(i,next.fn2[i]);
        if(next.gamepad[i]!==profile.gamepad[i])await client.mapping(i,next.gamepad[i]);
        if(next.travel[i]!==profile.travel[i]||next.coefficient[i]!==profile.coefficient[i])
          await client.switch(i,next.travel[i],next.coefficient[i]);
      }
      for(let i=0;i<8;i++)await client.action(i,next.actions[i]);
      await client.rename(next.name);
      await refresh();
    }catch(error){await refresh().catch(()=>{});throw new Error('Restore was interrupted. Review the keyboard settings before saving. '+error.message);}
  }else{
    offline[info.active]={config:nextCfg,profile:next};config=nextCfg;profile=next;info.names[info.active]=next.name;
  }
  rgb=null;mark();
}
const actionMap={
  bind:actions.bind,tune:()=>actions.tune(false,false),tuneAll:()=>actions.tune(true,false),
  rapid:()=>actions.tune(false,true),rapidAll:()=>actions.tune(true,true),
  switch:()=>actions.switch(false),switchAll:()=>actions.switch(true),rule:actions.rule,rgb:actions.rgb,gamepad:actions.gamepad,
  device:actions.device,renameProfile:actions.renameProfile,exportProfile:downloadProfile,identify:()=>client?.lighting.identify(key),
  begin:()=>actions.control(4,'Calibration started.'),finish:()=>actions.control(5,'Calibration finished. Enable typing, then save.'),
  abort:()=>actions.control(11,'Calibration stopped.'),enable:()=>actions.control(6,'Typing enabled. Release all keys, then save.'),
  disable:()=>actions.control(7,'Typing disabled.'),retry:()=>actions.control(10,'Scanner restarted. Check live depth and scan rate.'),
  quick:()=>{page='performance';view='quick';},settings:()=>{page='settings';view='settings';}
};
document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el||busy||el.disabled)return;
  if(el.dataset.page){page=el.dataset.page;view=el.dataset.view||'quick';render();}
  if(el.dataset.key!==undefined){key=Number(el.dataset.key);render();}
  if(el.dataset.action)run(actionMap[el.dataset.action]);
});
byId('backHomeButton').onclick=()=>{page='performance';view='quick';render();};
byId('toggleSidebar').onclick=()=>{const node=document.documentElement;node.dataset.sidebar=node.dataset.sidebar==='compact'?'':'compact';};
byId('sidebarThemeSelect').onchange=e=>{document.documentElement.dataset.theme=e.target.value;};
byId('rename').onclick=()=>{page='settings';view='profiles';render();byId('profileName').focus();};
byId('editor').addEventListener('change',e=>{
  if(e.target.id==='restoreProfile')run(()=>restoreProfile(e.target.files[0]));
  if(e.target.id==='layer'){layer=values('layer');render();}
  if(e.target.id==='actionSlot'){slot=values('actionSlot');render();}
  if(e.target.id==='switchModel'){
    const s=catalog[values('switchModel')];byId('travel').value=s.travel/1000;byId('coefficient').value=s.coefficient;
  }
});
byId('activeProfile').onchange=()=>run(async()=>{
  const next=values('activeProfile');
  if(client){await client.select(next);await refresh();mark('Profile selected. Save changes to keep this slot active after unplugging.');}
  else{info.active=next;({config,profile}=offline[next]);}
  rgb=null;
});
byId('connect').onclick=()=>run(async()=>{
  if(client){const old=client;client=null;generation++;await old.transport.close();status=rgb=null;message('Keyboard disconnected.');return;}
  const next=await ProDevice.connect();if(!next)return;
  client=next;generation++;
  try{await refresh();message('Connected to H3K09.');}
  catch(err){client=null;await next.transport.close().catch(()=>{});throw err;}
});
byId('save').onclick=()=>run(async()=>{
  if(!client)return;
  await client.foundation.control(8);await refresh();
  message('All four profile slots and device settings saved.');
});
navigator.hid?.addEventListener('disconnect',event=>{
  if(event.device!==client?.transport.device)return;
  client.transport.disconnected();client=null;generation++;status=rgb=null;
  message('Keyboard disconnected. Reconnect H3K09 to read saved settings.');render();
});
window.addEventListener('pagehide',()=>client?.transport.close().catch(()=>{}));
async function poll(){
  const active=client,stamp=generation;
  if(active&&!busy&&!pollPending){
    pollPending=true;
    try{
      const next=await active.foundation.readStatus();
      const extra=page==='diagnostics'||page==='overview'?await active.capabilities():null;
      const live=page==='lighting'?await active.liveRGB():null;
      if(stamp===generation&&client===active&&!busy){
        status=next;dirty=next.dirty;
        if(extra)Object.assign(info,extra);
        rgb=live;paintBoard();
        if(byId('rawData'))byId('rawData').textContent=KEY_NAMES.map((k,i)=>k.padEnd(7)+String(next.raw[i]).padStart(5)+' ADC   '+(next.positions[i]/10).toFixed(1)+'%').join('\n');
        byId('save').disabled=!dirty||!!status.calibrationPhase;
      }
    }catch(error){if(client===active&&!busy)message(error.message,true);}
    finally{pollPending=false;}
  }
  const pad=byId('padStatus');
  if(pad){
    const found=Array.from(navigator.getGamepads?.()||[]).filter(Boolean);
    pad.textContent=found.length?found.map(p=>p.id+' · '+p.axes.map(v=>v.toFixed(2)).join(' / ')).join(' | '):'Press a controller binding to activate the browser tester.';
  }
  setTimeout(poll,200);
}
for(const label of [...USAGE_NAMES.values(),'Fn1','Fn2']){
  const option=document.createElement('option');option.value=label;byId('keyCodes').append(option);
}
fetch('switches.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{catalog.push(...data.switches);if(page==='performance'&&view==='switches')render();}).catch(()=>{});
render();poll();
