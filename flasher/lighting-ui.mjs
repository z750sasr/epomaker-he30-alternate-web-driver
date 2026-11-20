import {LightingClient,encodeLighting,exportLighting,importLighting,LED_ORDER,LED_TO_KEY} from './lighting-protocol.mjs';
const $=id=>document.getElementById(id);
const editIds=['lightMode','lightColor','lightLevel','keyColor','keyLevel','barEnabled','barColor','barLevel','barCount','lightOrder','lightRate'];
const buttonIds=['lightApply','lightIdentify','lightOff','lightRetry','lightDefaults','lightExport','lightImport'];
const split=rgb=>{const level=Math.max(...rgb);return{level,color:'#'+rgb.map(v=>Math.round(level?v*255/level:255).toString(16).padStart(2,'0')).join('')};};
function color(id,level){const hex=$(id).value;if(!/^#[\da-f]{6}$/i.test(hex))throw new Error('Choose a valid RGB color.');const n=Number($(level).value);if(!Number.isInteger(n)||n<0||n>32)throw new Error('LED strength must be0–32.');return[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*n/255));}
function showColor(id,level,rgb){const value=split(rgb);$(id).value=value.color;$(level).value=String(value.level);}
export function createLightingUI({runAction,getSelected,keyNames,onDirty}){
  let client,draft,edits=false,ready=false,polls=0;
  $('lightChain').textContent=LED_ORDER.join(' → ');
  function message(text,error=false){$('lightMessage').textContent=text;$('lightMessage').classList.toggle('warning',error);}
  function controls(value=ready){ready=value;for(const id of [...editIds,...buttonIds])$(id).disabled=!ready||!client||!draft;for(const id of ['powerRelease','powerDown','powerUp'])$(id).disabled=!ready||client?.transport.device.productName!=='H3K07';for(const id of ['supplyOn','supplyOff'])$(id).disabled=!ready||client?.transport.device.productName!=='H3K08';}
  function select(){if(!draft)return;const i=getSelected();$('lightSelected').textContent=`${keyNames[i]} · serial LED${LED_TO_KEY.indexOf(i)+1}`;showColor('keyColor','keyLevel',draft.palette[i]);}
  function render(){if(!draft)return;$('lightMode').value=String(draft.mode);$('lightOrder').value=String(draft.order);$('lightRate').value=String(draft.rate);$('barCount').value=String(draft.barCount);$('barEnabled').checked=draft.barEnabled;showColor('lightColor','lightLevel',draft.color);showColor('barColor','barLevel',draft.barColor);select();}
  function capture(){
    if(!draft)throw new Error('Connect v0.6 first.');
    draft.mode=Number($('lightMode').value);draft.order=Number($('lightOrder').value);draft.rate=Number($('lightRate').value);draft.barCount=Number($('barCount').value);draft.barEnabled=$('barEnabled').checked;
    draft.color=color('lightColor','lightLevel');draft.barColor=color('barColor','barLevel');draft.palette[getSelected()]=color('keyColor','keyLevel');encodeLighting(draft);return draft;
  }
  function show(status,force=false){
    $('lightStatus').textContent=`Key frames ${status.keyFrames} · Bar frames ${status.barFrames}${status.error?` · ${status.error===1?'DMA timeout':'SPI timeout'}. RGB stopped; typing remains independent.`:''}`;
    if(status.power){const state=client.transport.device.productName==='H3K08'?status.power.mode?'output high / supply enabled':'output low / supply disabled':['floating / RGB data paused','weak pull-down test','weak pull-up test'][status.power.mode];$('powerStatus').textContent=`PA10: ${state} · digital input ${status.power.digitalHigh?'high':'low'}. Measure LED V+ with the multimeter; this is not a rail-voltage reading.`;}
    if(force||!edits){draft=status.config;edits=false;render();}
  }
  async function refresh(force=false){if(!client)return;show(await client.readStatus(),force);controls();}
  const action=work=>runAction(async()=>{try{await work();}catch(error){message(`${error.message} Multi-command lighting applies may partially change RAM; read settings before saving.`,true);throw error;}});
  for(const [id,mode] of [['powerRelease',0],['powerDown',1],['powerUp',2]])$(id).onclick=()=>action(async()=>{show(await client.powerTest(mode));message(mode?'PA10 weak-bias test started for ten seconds. Measure PA10 and LED V+ now. The pin then returns to floating automatically.':'PA10 released. RGB data paused.');});
  for(const [id,on] of [['supplyOn',true],['supplyOff',false]])$(id).onclick=()=>action(async()=>{show(await client.setPower(on));message(on?'PA10 HIGH requested. RGB data waits10ms for the supply. Measure LED V+ to confirm power.':'PA10 LOW requested; both data lines held low and RGB paused. This override lasts until power-on or reboot.');});
  for(const id of editIds)$(id).addEventListener('input',()=>{edits=true;try{capture();message('Lighting draft changed. Apply lighting to send it.');}catch(error){message(error.message,true);}onDirty();});
  $('lightApply').onclick=()=>action(async()=>{const config=capture();show(await client.apply(config),true);onDirty();message('Lighting applied and read back. Save custom settings to keyboard to keep it after reconnect.');});
  $('lightIdentify').onclick=()=>action(async()=>{await client.identify(getSelected());message(`Identifying ${keyNames[getSelected()]} in dim white for two seconds, then restoring lighting.`);});
  for(const [id,op,text] of [['lightOff',4,'Sent black frames to both chains. Save if you want lighting off at startup.'],['lightRetry',5,'RGB retry requested. Watch the transfer counters and physical LEDs.'],['lightDefaults',6,'Restored dim key lighting and the5-LED bar default, disabled. Save to keep it.']])$(id).onclick=()=>action(async()=>{show(await client.control(op),true);onDirty();message(text);});
  $('lightExport').onclick=()=>{try{const profile=exportLighting(capture()),url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='he30-v06-lighting.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Lighting profile exported. Keyboard calibration/mappings use the separate key profile export.');}catch(error){message(error.message,true);}};
  $('lightImport').onchange=async()=>{const file=$('lightImport').files[0];if(!file||!ready)return;try{if(file.size>1000000)throw new Error('Lighting profile is too large.');draft=importLighting(JSON.parse(await file.text()));edits=true;render();onDirty();message('Lighting profile loaded as a draft. Apply lighting, then Save to persist it.');}catch(error){message(error.message,true);}finally{$('lightImport').value='';}};
  controls(false);
  return{
    get dirty(){return edits;},controls,select,
    async reset(foundation){client=null;draft=null;edits=false;polls=0;const product=foundation?.transport.device.productName;$('powerPanel').hidden=!['H3K07','H3K08'].includes(product);$('weakPowerControls').hidden=product!=='H3K07';$('supplyPowerControls').hidden=product!=='H3K08';$('lightingPanel').hidden=!['H3K06','H3K07','H3K08'].includes(product);if(!$('lightingPanel').hidden){client=new LightingClient(foundation);await refresh(true);message('Confirmed PB15:36 key LEDs, PB5:5 bar LEDs. Transfers are not acknowledgements from LEDs; verify the physical colors.');}controls();},
    refresh,
    async poll(){if(client&&++polls%5===0)await refresh();}
  };
}
