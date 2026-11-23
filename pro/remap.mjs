// AE64 Pro Reloaded inline catalog adapted to HE30's supported HID usages.
import {USAGE_NAMES} from '../flasher/keyboard-protocol.mjs';
import {bindingLabel,DESKTOP_USAGES,MEDIA_USAGES} from './protocol.mjs';

const layers=['Main','Fn1','Fn2'];
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const range=(first,last)=>Array.from({length:last-first+1},(_,i)=>first+i);
const profileCodes=[240,241,242,243];
const labels=new Map(USAGE_NAMES);
for(let i=0;i<12;i++)labels.set(104+i,'F'+(13+i));
['Print Screen','Scroll Lock','Pause','Insert','Home','Page Up','Delete','End','Page Down','Right','Left','Down','Up']
  .forEach((label,i)=>labels.set(70+i,label));
['Num Lock','Numpad /','Numpad *','Numpad -','Numpad +','Numpad Enter','Numpad 1','Numpad 2','Numpad 3','Numpad 4','Numpad 5','Numpad 6','Numpad 7','Numpad 8','Numpad 9','Numpad 0','Numpad .','Non-US backslash','Application','Keyboard Power','Numpad =']
  .forEach((label,i)=>labels.set(83+i,label));
const labelFor=code=>labels.get(code)||bindingLabel(code);
const hex=code=>'0x'+code.toString(16).padStart(2,'0').toUpperCase();
const symbols=new Map([
  [79,'arrow-right'],[80,'arrow-left'],[81,'arrow-down'],[82,'arrow-up'],
  [0xc0,'play-pause'],[0xc1,'previous-track'],[0xc2,'next-track'],[0xc3,'stop-track'],[0xc4,'mute'],
  [0xc5,'volume-up'],[0xc6,'volume-down'],[0xc7,'display-brightness-up'],[0xc8,'display-brightness-down'],[0xcd,'calculator'],
  [0xb0,'mouse-left'],[0xb1,'mouse-right'],[0xb2,'mouse-middle'],[0xb3,'mouse-back'],[0xb4,'mouse-forward'],
  [0xf5,'lighting-brightness-up'],[0xf6,'lighting-brightness-down']
]);
const icon=id=>`<svg class="reloaded-remap-icon" aria-hidden="true" focusable="false"><use href="assets/remap-icons.svg#${id}"></use></svg>`;
export function remapIcon(code,label){
  return symbols.has(code)?`${icon(symbols.get(code))}<span class="remap-sr-only">${escape(label)}</span>`:'';
}

export function layerTabs(layer,area){
  return `<div class="layer-tabs" role="tablist" aria-label="Keyboard layer">${layers.map((name,i)=>`<button type="button" role="tab" data-${area}-layer="${i}" class="${i===layer?'active':''}" aria-selected="${i===layer}">${name}</button>`).join('')}</div>`;
}

let query='';
const expanded=new Set(['basic']);
const dragType='application/x-he30-remap';
function groups({layer,profileKeys,desktopKeys,mediaKeys}){
  return [
    ['basic','Basic characters',[...range(4,57),...range(224,231)]],
    ['extended','Extended characters',[...range(58,164)]],
    ['functions','Functions',[0,255,253,...(layer?[254]:[]),...(desktopKeys?[245,246]:[])]],
    ...(profileKeys?[['profiles','Profiles',[...profileCodes,...(desktopKeys?[244]:[])]]]:[]),
    ...(mediaKeys?[['media','Media and audio',[...MEDIA_USAGES.keys()]]]:[]),
    ...(desktopKeys?[['mouse','Mouse',[...DESKTOP_USAGES.keys()].filter(code=>code<240)]]:[])
  ];
}

export function renderRemap(options){
  const {keyName,layer,usage,desktopKeys}=options;
  return `<div class="he30-remap reloaded-remap">
    <div class="remap-board"><div class="layer-bar">${layerTabs(layer,'remap')}</div></div>
    <div class="remap-current"><div><h2>Key bindings</h2><p>${escape(keyName)} · ${layers[layer]} · ${escape(labelFor(usage))}</p></div><button type="button" class="button ghost" id="resetKeycode">Restore defaults</button></div>
    <div class="reloaded-key-catalog">
      <input type="search" placeholder="Search keybinds…" aria-label="Search keybinds" value="${escape(query)}" data-remap-search>
      <p data-remap-empty hidden>No matching keybinds.</p>
      ${groups(options).map(([id,label,codes])=>`<details data-catalog-group="${id}" ${expanded.has(id)?'open':''}>
        <summary>${icon(id)}${label}</summary>
        <div class="reloaded-keycodes">${codes.map(code=>`<button type="button" draggable="true" data-remap-code="${code}" title="${escape(labelFor(code)+' · '+hex(code))}" aria-label="${escape(labelFor(code))}" aria-pressed="${code===usage}">${remapIcon(code,labelFor(code))||escape(labelFor(code))}</button>`).join('')}</div>
        ${id==='profiles'&&desktopKeys?'<button type="button" class="button ghost remap-cycle" id="cycleAllProfiles">Assign Next profile in all four profiles</button>':''}
      </details>`).join('')}
    </div>
  </div>`;
}

export function bindRemap(options){
  const root=options.root||document;
  const catalog=root.querySelector('.reloaded-key-catalog');
  const board=root.querySelector('.remap-board #board');
  const groups=[...catalog.querySelectorAll('details')];
  const search=catalog.querySelector('[data-remap-search]');
  const filter=()=>{
    const term=query.trim().toLowerCase();
    for(const group of groups){
      let visible=0;
      for(const button of group.querySelectorAll('[data-remap-code]')){
        button.hidden=!button.title.toLowerCase().includes(term);
        if(!button.hidden)visible++;
      }
      group.hidden=!visible;
      group.open=!!term||expanded.has(group.dataset.catalogGroup);
    }
    catalog.querySelector('[data-remap-empty]').hidden=groups.some(group=>!group.hidden);
  };
  filter();
  search.oninput=()=>{query=search.value;filter();};
  for(const group of groups)group.querySelector('summary').onclick=()=>{
    if(!query.trim()){
      if(group.open)expanded.delete(group.dataset.catalogGroup);
      else expanded.add(group.dataset.catalogGroup);
    }
  };
  for(const button of root.querySelectorAll('[data-remap-layer]'))button.onclick=()=>options.onLayer(Number(button.dataset.remapLayer));
  catalog.onclick=event=>{
    const button=event.target.closest('[data-remap-code]');
    if(button)options.onPick(Number(button.dataset.remapCode));
  };
  catalog.ondragstart=event=>{
    const button=event.target.closest('[data-remap-code]');
    if(button)event.dataTransfer.setData(dragType,button.dataset.remapCode);
  };
  board.ondragover=event=>{
    if(event.target.closest('[data-key]')&&event.dataTransfer.types.includes(dragType))event.preventDefault();
  };
  board.ondrop=event=>{
    const target=event.target.closest('[data-key]');
    if(!target||!event.dataTransfer.types.includes(dragType))return;
    const value=event.dataTransfer.getData(dragType);
    if(!catalog.querySelector(`[data-remap-code="${CSS.escape(value)}"]`))return;
    event.preventDefault();
    options.onDrop(Number(target.dataset.key),Number(value));
  };
  root.querySelector('#cycleAllProfiles')?.addEventListener('click',options.onCycleAll);
  root.querySelector('#resetKeycode').onclick=options.onReset;
}
