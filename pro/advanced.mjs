// The AE64 Pro feature-card layout, using HE30's Action record.
import {ACTIONS,KEY_NAMES,bindingLabel} from './protocol.mjs';

export const FEATURES = [
  null,
  {symbol:'↔', detail:'Resolve opposite directions when both keys are held.'},
  {symbol:'≋', detail:'Give the deeper of two pressed switches priority.'},
  {symbol:'↧', detail:'Send outputs at two press and two release stages.',
    outputs:['Shallow press', 'Deep press', 'Deep release', 'Shallow release'], depths:['Shallow threshold', 'Deep threshold']},
  {symbol:'◐', detail:'Choose separate outputs for a tap and a hold.',
    outputs:['Tap', 'Hold'], time:['Hold threshold',180]},
  {symbol:'⏻', detail:'Latch an output on the first press and release it on the next.', outputs:['Latched output']},
  {symbol:'⌘', detail:'Hold up to four outputs together while the physical key is down.',
    outputs:['Output 1','Output 2','Output 3','Output 4']},
  {symbol:'▶', detail:'Play up to four taps, with a release gap between taps.',
    outputs:['Tap 1','Tap 2','Tap 3','Tap 4'], time:['Tap and gap duration',24]},
  {symbol:'⋮', detail:'Add held outputs as the switch crosses each depth.',
    outputs:['Shallow output','Middle output','Deep output'], depths:['Shallow depth','Middle depth','Deep depth']},
  {symbol:'↥', detail:'Hold one output on press and send another after release.',
    outputs:['Press output','Release output'], time:['Release delay',0]},
];

export function actionForFeature(kind,key,other){
  const feature=FEATURES[kind];
  const depth=kind===2?[20,0,0]:feature?.depths?[250,650,900]:[feature?.time?.[1]||0,0,0];
  return {kind,key,other,mode:0,usage:[0,0,0,0],depth};
}

export function actionKeys(action){
  if(!action.kind)return [];
  return action.kind<=2?[action.key,action.other]:[action.key];
}

export function actionDepthFields(action,travelField){
  const feature=FEATURES[action.kind];
  if(action.kind===2)return travelField('depth0','Depth difference',action.depth[0],0,1000,'Relative to Key A’s travel.',action.key);
  return feature.depths?.map((label,index)=>travelField('depth'+index,label,action.depth[index],0,1000,'',action.key)).join('')||'';
}

export function renderAdvanced({action:a,rules,slot,creating,select,field,travelField,bindingField,esc}){
  const feature=FEATURES[a.kind];
  const assignments=rules.map((rule,index)=>rule.kind?`<li><button type="button" class="advanced-assignment" data-rule-slot="${index}" aria-pressed="${index===slot&&!creating}">
    <strong>${ACTIONS[rule.kind]}</strong><span>${actionKeys(rule).map(index=>esc(KEY_NAMES[index])).join(' + ')}</span></button>
    <button type="button" class="button ghost small" data-remove-rule="${index}" aria-label="Remove ${ACTIONS[rule.kind]}">Remove</button></li>`:'').join('');
  let editor='<p class="hint">Select a key on the keyboard, then choose a feature.</p>';
  if(feature){
    const pair=a.kind<=2;
    const inputs=select('hostKey',pair?'Key A':'Physical key',KEY_NAMES,a.key)+
      (pair?select('otherKey','Key B',KEY_NAMES,a.other):'');
    const pairOptions=a.kind===1?['Neutral','Give Key A priority','Give Key B priority','Last pressed wins']:
      ['Neutral inside the deadband','Keep the current winner inside the deadband'];
    const mode=pair?select('pairMode','Behavior',pairOptions,a.kind===2?Number(!!a.mode):a.mode):'';
    const bounds=actionDepthFields(a,travelField);
    const minimum=a.kind===7?16:a.kind===4?1:0;
    const time=feature.time?field('depth0',feature.time[0]+' · ms',a.depth[0]<minimum?feature.time[1]:a.depth[0],minimum,1000):'';
    const outputs=feature.outputs?.map((label,index)=>bindingField('output'+index,label,bindingLabel(a.usage[index]))).join('')||'';
    editor=`<div class="advanced-rule-editor"><h2>${ACTIONS[a.kind]}</h2><p>${feature.detail}</p>
      ${select('actionSlot','Assignment slot',rules.map((rule,index)=>(index+1)+' · '+ACTIONS[rule.kind]),slot)}
      <div class="pro-grid">${inputs}${mode}</div>
      ${bounds?`<div class="pro-grid" id="ruleDepths" data-key-index="${a.key}">${bounds}</div>`:time}
      ${a.kind===3?`<details class="rule-travel" id="ruleTravel">
        <summary>Preview DKS travel</summary>
        <div class="rule-travel-track" aria-hidden="true"><i></i><b></b><b></b></div>
        <p id="ruleTravelStage"></p>
        <small>Uses the draft thresholds and the selected key’s live travel.</small>
      </details>`:''}
      ${outputs?'<div class="advanced-outputs">'+outputs+'</div>':''}
      <div class="commands"><button type="button" class="button primary" data-action="rule">Apply assignment</button></div>
    </div>`;
  }
  return `<div class="advanced-layout"><section><h2>Advanced features</h2>
    <div class="advanced-feature-grid">${FEATURES.map((item,kind)=>item?`<button type="button" class="advanced-feature-card" data-advanced-kind="${kind}" aria-pressed="${kind===a.kind}"><span class="advanced-card-symbol" aria-hidden="true">${item.symbol}</span><span class="advanced-card-copy"><strong>${ACTIONS[kind]}</strong><small>${item.detail}</small></span></button>`:'').join('')}</div>
    ${editor}</section><aside class="advanced-assignment-list"><h2>Assigned rules</h2><p>${rules.filter(rule=>rule.kind).length} of ${rules.length} slots used</p>${assignments?'<ul>'+assignments+'</ul>':'<p>Choose an advanced feature to add a rule.</p>'}</aside></div>`;
}
