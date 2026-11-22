import { VID, APP_PID, HIDTransport, readHardwareSnapshot, runHardwareTest } from './protocol.mjs';
const $=id=>document.getElementById(id);
const physical=['Esc','1','2','3','4','5','6','Tab','Q','W','E','R','T','Caps','A','S','D','F','G','Shift','Z','X','C','V','B','Ctrl','Fn','Alt','Space','Grave','F1','F2','F3','F4','F5','F6'];
const channels=[10,11,12,13,4,5,6,7,14,15,8,9];
const errors=['No error','ADC reset-calibration timeout','ADC calibration timeout','ADC conversion timeout','RGB DMA transfer timeout','RGB SPI busy timeout'];
const supported=!!navigator.hid&&window.isSecureContext;
let transport,busy=false,running=false,token=0,latest,baseline,selected=null,winner=null,lastRGB;
let baselineWindow=[],noise=[],candidate=null,guideState='baseline',heldFrames=0,releasedFrames=0,monitorTask,pauseTimer,pauseResolve;
const frames=[],mapping={},observations=[];
for(const name of physical){const option=document.createElement('option');option.value=name;option.textContent=name;$('physical').append(option);}
const cells=Array.from({length:36},(_,i)=>{
  const cell=document.createElement('button');cell.type='button';cell.className='sample';
  const label=document.createElement('span');label.textContent=`#${i} · bank ${Math.floor(i/12)} · ADC${channels[i%12]}`;
  const value=document.createElement('strong');value.textContent='—';
  const delta=document.createElement('span');delta.textContent='No baseline';
  const name=document.createElement('span');cell.append(label,value,delta,name);$('samples').append(cell);
  cell.onclick=()=>{selected=i;showSamples();buttons();};return{cell,value,delta,name};
});
function say(text){$('status').textContent=text;}
function report(){return{diagnostic:'HE30 v0.4',channels,bankHypotheses:['PC13','PC14','PB10'],physicalMapping:mapping,baseline,frames,rgbObservations:observations,automaticGuide:{state:guideState,noise}};}

function prompt(){
  const done=physical.filter(key=>mapping[key]!==undefined).length;
  if(!running){$('guide').textContent=`Sampling stopped. ${done}/36 physical keys recorded.`;return;}
  if(!baseline){$('guide').textContent=`Keep all keys released. Taking the automatic baseline (${baselineWindow.length}/5 stable frames)…`;return;}
  if(done===36){$('guide').textContent='All 36 keys recorded and saved in this browser.';return;}
  const key=$('physical').value;
  $('guide').textContent=candidate&&guideState==='release'?`Release ${candidate.key} completely to record sample #${candidate.slot}.`:`${done}/36 mapped. Press and hold ${key}, then release it. Assignment and the next prompt are automatic.`;
}
function resetBaseline(){baseline=null;baselineWindow=[];noise=[];candidate=null;heldFrames=0;releasedFrames=0;guideState='baseline';selected=null;}
function recordMapping(key,slot,automatic=false){
  mapping[key]=slot;$('mapping').textContent=Object.entries(mapping).map(([name,index])=>`${name} → #${index}`).join(' · ');
  const next=physical.find(name=>mapping[name]===undefined);if(next)$('physical').value=next;
  selected=null;candidate=null;heldFrames=0;releasedFrames=0;guideState='press';showSamples();prompt();
  if(!next&&automatic){stopMonitoring();$('guide').textContent='All 36 keys recorded and saved in this browser. Save results exports the mapping.';}
}
function processAutomatic(snapshot){
  if(!running||snapshot.mode!==2||snapshot.error||snapshot.values.some(v=>v===65535)){prompt();return;}
  if(!baseline){
    baselineWindow.push(snapshot.values.slice());if(baselineWindow.length>5)baselineWindow.shift();
    if(baselineWindow.length===5){
      const spread=snapshot.values.map((_,i)=>Math.max(...baselineWindow.map(v=>v[i]))-Math.min(...baselineWindow.map(v=>v[i])));
      if(spread.every(v=>v<=12)){
        baseline=snapshot.values.map((_,i)=>baselineWindow.map(v=>v[i]).sort((a,b)=>a-b)[2]);noise=spread;guideState='press';
      }
    }
    prompt();return;
  }
  const deltas=snapshot.values.map((v,i)=>Math.abs(v-baseline[i]));
  if(guideState==='release'&&candidate){
    releasedFrames=deltas.every((v,i)=>v<=Math.max(8,(noise[i]||0)*2+4))?releasedFrames+1:0;
    if(releasedFrames>=2)recordMapping(candidate.key,candidate.slot,true);
    prompt();return;
  }
  const active=deltas.map((delta,slot)=>({delta,slot})).filter(v=>v.delta>=Math.max(16,(noise[v.slot]||0)*4+8));
  if(active.length!==1){candidate=null;heldFrames=0;prompt();return;}
  const slot=active[0].slot,key=$('physical').value;
  if(Object.entries(mapping).some(([other,index])=>other!==key&&index===slot)){
    candidate=null;heldFrames=0;$('guide').textContent=`Sample #${slot} is already assigned. Release all keys, then press ${key}; use manual selection if the sensor wiring overlaps.`;return;
  }
  if(candidate?.slot===slot&&candidate.key===key)heldFrames++;else{candidate={slot,key};heldFrames=1;}
  if(heldFrames>=2){guideState='release';releasedFrames=0;}
  prompt();
}
function buttons(){
  $('connect').disabled=!supported||busy||running;
  for(const id of ['refresh','passive','start','red','green','blue','off'])$(id).disabled=!transport||busy||running;
  $('stop').disabled=!running;$('baseline').disabled=!latest||latest.error!==0||latest.mode!==2;
  $('assign').disabled=!latest||latest.error!==0||latest.mode!==2||!baseline;
  $('save').disabled=!frames.length;$('record').disabled=!lastRGB||busy;
}
function showSamples(){
  const values=latest?.values||[];const count=latest?.mode===2?36:latest?.mode===1?12:0;
  const deltas=values.map((v,i)=>i<count&&v!==65535&&baseline?.[i]!==undefined&&baseline[i]!==65535?Math.abs(v-baseline[i]):-1);
  const order=deltas.map((delta,i)=>({delta,i})).sort((a,b)=>b.delta-a.delta);
  winner=order[0]?.delta>=8?order[0]:null;
  cells.forEach(({cell,value,delta,name},i)=>{
    value.textContent=i<count&&values[i]!==65535?String(values[i]):'—';
    delta.textContent=deltas[i]>=0?`Δ ${values[i]-baseline[i]}`:'No released baseline';
    name.textContent=Object.entries(mapping).filter(([,slot])=>slot===i).map(([key])=>key).join(', ');
    cell.classList.toggle('winner',winner?.i===i);cell.classList.toggle('selected',selected===i);
  });
  return order;
}
function show(snapshot){
  if(latest?.mode!==snapshot.mode)resetBaseline();
  latest=snapshot;frames.push({time:new Date().toISOString(),...snapshot});if(frames.length>240)frames.shift();
  processAutomatic(snapshot);
  const {values,...details}=snapshot;$('details').textContent=JSON.stringify(details,null,2);showSamples();buttons();
}
async function guarded(action){if(busy)return;busy=true;buttons();try{await action();}catch(error){stopMonitoring();say(error.message);}finally{busy=false;buttons();}}
async function sample(mode){
  const ack=await runHardwareTest(transport,mode);const snapshot=await readHardwareSnapshot(transport);show(snapshot);
  if(ack.error||snapshot.error){stopMonitoring();say(`${errors[ack.error||snapshot.error]||'Hardware error'}. USB replied; results retained. Automatic tests stopped.`);return false;}
  say(mode===1?'Passive ADC captured. Only the first twelve slots are valid; no bank outputs were driven.':running?'Automatic sensor capture running. Follow the key prompt; results save in this browser.':'Latest capture completed. Automatic sampling is stopped.');return true;
}
$('connect').onclick=async()=>{
  let ready=false;const generation=++token;
  await guarded(async()=>{
  const devices=await navigator.hid.requestDevice({filters:[{vendorId:VID,productId:APP_PID,usagePage:1,usage:0}]});if(!devices[0])return;
  if(devices[0].productName!=='H3M04')throw new Error('Choose H3M04. This page needs v0.4; stock firmware, H3B03 and HE30 Upgrader cannot run these tests.');
  await transport?.close();transport=new HIDTransport(devices[0]);await transport.open();resetBaseline();show(await readHardwareSnapshot(transport));
  say('H3M1 confirmed. Running passive ADC before automatic three-bank capture…');
  ready=await sample(1);
  });
  if(ready&&transport&&generation===token)startMonitoring();
};
$('refresh').onclick=()=>guarded(async()=>{show(await readHardwareSnapshot(transport));say('Snapshot read. No hardware test started.');});
$('passive').onclick=()=>guarded(()=>sample(1));
function stopMonitoring(){running=false;token++;clearTimeout(pauseTimer);pauseResolve?.();pauseResolve=null;prompt();buttons();}
function startMonitoring(){
  if(busy||running||!transport)return monitorTask;running=true;resetBaseline();const current=++token;buttons();prompt();
  monitorTask=(async()=>{
    while(running&&current===token){
      await guarded(()=>sample(2));
      if(running&&current===token)await new Promise(resolve=>{pauseResolve=resolve;pauseTimer=setTimeout(()=>{pauseResolve=null;resolve();},150);});
    }
    buttons();
  })();return monitorTask;
}
$('start').onclick=startMonitoring;
$('stop').onclick=()=>{stopMonitoring();say('Sampling stopped. Completed captures leave the proposed bank outputs high.');return monitorTask;};
$('baseline').onclick=()=>{if(latest?.mode===2&&!latest.error){if(running)resetBaseline();else startMonitoring();prompt();showSamples();say('Release all keys. Collecting a fresh automatic baseline…');}};
$('physical').onchange=()=>{candidate=null;heldFrames=0;releasedFrames=0;guideState=baseline?'press':'baseline';prompt();};
$('assign').onclick=()=>{
  if(!baseline||latest?.mode!==2||latest.error)return;
  const order=showSamples();let slot=selected;
  if(slot===null){
    if(!winner){say('No clear key movement yet. Hold the physical key or select its sample manually.');return;}
    if(order[1]?.delta>0&&winner.delta<order[1].delta*1.3){say('Several samples moved together. Click the intended sample to assign it manually.');return;}
    slot=winner.i;
  }
  if(latest.values[slot]===65535){say('That slot has no valid sample.');return;}
  const key=$('physical').value;recordMapping(key,slot);
  say(`${key} recorded as sample #${slot}. This changed only the local mapping notes.`);
};
async function color(name){
  const logical={r:0,g:0,b:0};if(name!=='off')logical[{red:'r',green:'g',blue:'b'}[name]]=12;
  const options={path:Number($('path').value),index:$('all').checked?255:Number($('pixel').value),...logical,rate:Number($('rate').value)};
  if($('order').value==='RGB')[options.r,options.g]=[options.g,options.r];
  const ack=await runHardwareTest(transport,name==='off'?4:3,options);show(await readHardwareSnapshot(transport));
  lastRGB={time:new Date().toISOString(),color:name,wireOrder:$('order').value,...options,error:ack.error};
  say(ack.error?`${errors[ack.error]}. Save the report; do not assume the LEDs received a complete frame.`:`${name==='off'?'Black':name} frame sent on output ${options.path}. Record what physically lit; transfer completion does not acknowledge an LED.`);
}
for(const name of ['red','green','blue','off'])$(name).onclick=()=>guarded(()=>color(name));
$('record').onclick=()=>{
  const note=$('observation').value.trim();if(!note||!lastRGB){say('Enter the physical LED observation first.');return;}
  observations.push({...lastRGB,note});$('observations').textContent=observations.map(o=>`Output ${o.path}, slot ${o.index===255?'all':o.index}, ${o.color}: ${o.note}`).join(' · ');$('observation').value='';say('LED observation recorded locally. Save results to export it.');
};
$('save').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`he30-mapping-rgb-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
navigator.hid?.addEventListener('disconnect',event=>{if(transport?.device===event.device){stopMonitoring();transport.disconnected();transport=null;say('Diagnostic keyboard disconnected. Previously captured results can still be saved.');buttons();}});
window.addEventListener('pagehide',()=>{stopMonitoring();transport?.close().catch(()=>{});});
