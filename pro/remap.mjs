// Ported from AE64 Pro's keymapPage and mapping picker for HE30's HID usages.
import {USAGE_NAMES} from '../flasher/keyboard-protocol.mjs';
import {bindingLabel,isProfileUsage,DESKTOP_USAGES,MEDIA_USAGES} from './protocol.mjs';

const layers = ['Main', 'Fn1', 'Fn2'];
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const codeLabel = code => bindingLabel(code);
const hex = code => '0x' + Number(code).toString(16).padStart(4, '0').toUpperCase();
const keyboardGroups = [
  {id:'basic', label:'Basic keys', includes:code => code === 0 || code >= 4 && code <= 57},
  {id:'function', label:'F1–F24', includes:code => code >= 58 && code <= 69 || code >= 104 && code <= 115},
  {id:'navigation', label:'Navigation', includes:code => code >= 70 && code <= 82},
  {id:'numpad', label:'Numpad', includes:code => code >= 83 && code <= 103},
  {id:'modifiers', label:'Modifiers', includes:code => code >= 224 && code <= 231},
  {id:'other', label:'Other keyboard keys', includes:code => code >= 116 && code <= 164}
];
const labels = new Map(USAGE_NAMES);
for (let i=0;i<12;i++) labels.set(104+i, 'F'+(13+i));
['Print Screen','Scroll Lock','Pause','Insert','Home','Page Up','Delete','End','Page Down','Right','Left','Down','Up']
  .forEach((label,index) => labels.set(70+index,label));
['Num Lock','Numpad /','Numpad *','Numpad -','Numpad +','Numpad Enter','Numpad 1','Numpad 2','Numpad 3','Numpad 4','Numpad 5','Numpad 6','Numpad 7','Numpad 8','Numpad 9','Numpad 0','Numpad .','Non-US backslash','Application','Keyboard Power','Numpad =']
  .forEach((label,index) => labels.set(83+index,label));
labels.set(253,'Fn2'); labels.set(255,'Fn1'); labels.set(254,'Transparent');
const labelFor = code => labels.get(code) || codeLabel(code);
const profileCodes = [240,241,242,243];
let picker = null;
let category = 'keyboard';
let keyboardGroup = 'basic';
let search = '';

export function layerTabs(layer, area) {
  return `<div class="layer-tabs" role="tablist" aria-label="Keyboard layer">${layers.map((name,index) => `<button type="button" role="tab" data-${area}-layer="${index}" class="${index===layer?'active':''}" aria-selected="${index===layer}">${name}</button>`).join('')}</div>`;
}

export function renderRemap({keyName,layer,usage,profileKeys,desktopKeys,mediaKeys}) {
  return `<div class="he30-remap keymap-page">
    <div class="layer-bar">${layerTabs(layer,'remap')}<span>Choose a layer, then select a physical key to open its keymap.</span></div>
    <div class="remap-workspaces">
      <section class="keymap-assignment-workspace"><div class="keymap-workspace-head"><div><h2>${escape(keyName)}</h2><p>${layers[layer]} layer · Current primary assignment</p></div><div class="keymap-workspace-code"><strong>${hex(usage)}</strong></div></div>
      <div class="remap-selected-card"><kbd>${escape(keyName)}</kbd><strong>${escape(labelFor(usage))}</strong></div>
      <div class="mapping-launcher"><div class="mapping-groups"><button type="button" class="button ghost" data-remap-group="firmware">Fn and layer keys</button>${desktopKeys?'<button type="button" class="button ghost" data-remap-group="mouse">Mouse</button>':''}${mediaKeys?'<button type="button" class="button ghost" data-remap-group="media">Media and apps</button>':''}</div><button class="button primary" type="button" id="openMappingPicker">Choose a keybind</button></div>
      <div class="apply-row"><button class="button ghost" type="button" id="resetKeycode">Restore physical defaults</button></div></section>
      <section class="remap-profile-panel"><h2>Profile keys</h2><p>${profileKeys?'Assign a shortcut on the current layer for a direct switch on the keyboard. Use the same shortcuts in each profile to make switching back easy.':'Update to HE30 Pro v0.20 to assign onboard profile keys.'}</p>
      <div class="remap-profile-keys">${profileCodes.map(code=>`<button type="button" class="button ghost" data-profile-code="${code}" ${profileKeys?'':'disabled'}>${labelFor(code)}</button>`).join('')}${desktopKeys?'<button type="button" class="button ghost" id="cycleAllProfiles">Assign Next profile in all four profiles</button>':''}</div></section>
    </div>
    <dialog class="app-dialog mapping-picker-dialog" id="mappingPickerDialog" aria-labelledby="mappingPickerTitle"><form method="dialog"><div class="dialog-heading-row"><div><p class="eyebrow">KEYMAP CATALOG</p><h2 id="mappingPickerTitle">Map ${escape(keyName)}</h2></div><button class="dialog-close-button" type="submit" value="close" aria-label="Close keymap catalog">×</button></div><div id="mappingPickerBody"></div><div class="dialog-actions"><button class="button ghost" type="submit" value="close">Cancel</button></div></form></dialog>
  </div>`;
}

export function bindRemap(options) {
  const root = options.root || document;
  root.querySelectorAll('[data-remap-layer]').forEach(button => {
    button.addEventListener('click', () => options.onLayer?.(Number(button.dataset.remapLayer)));
  });
  root.querySelectorAll('[data-remap-group]').forEach(button => {
    button.addEventListener('click', () => openRemapPicker({...options,group:button.dataset.remapGroup}));
  });
  root.querySelector('#openMappingPicker')?.addEventListener('click', () => openRemapPicker(options));
  root.querySelectorAll('[data-profile-code]').forEach(button =>
    button.addEventListener('click', () => options.onPick?.(Number(button.dataset.profileCode))));
  root.querySelector('#cycleAllProfiles')?.addEventListener('click', () => options.onCycleAll?.());
  root.querySelector('#resetKeycode')?.addEventListener('click', () => options.onReset?.());
}

export function openRemapPicker(options) {
  const dialog = document.getElementById('mappingPickerDialog');
  if (!dialog) return;
  picker = {...options};
  category = options.group || (MEDIA_USAGES.has(options.usage)?'media':DESKTOP_USAGES.has(options.usage)?options.usage<240?'mouse':'firmware':options.usage>=253||isProfileUsage(options.usage)?'firmware':'keyboard');
  keyboardGroup = keyboardGroups.find(group => group.includes(options.usage))?.id || 'basic';
  search = '';
  renderPicker();
  if (!dialog.open) dialog.showModal();
  queueMicrotask(() => document.getElementById('mappingPickerSearch')?.focus());
}

export function closeRemapPicker() {
  document.getElementById('mappingPickerDialog')?.close();
  picker = null;
}

function catalog(layer, profileKeys, desktopKeys, mediaKeys) {
  const keyboardCodes = [0,...Array.from({length:161},(_,index) => index+4),...Array.from({length:8},(_,index) => index+224)];
  return [
    ...keyboardCodes.map(code => ({code,label:labelFor(code),category:'keyboard'})),
    ...[255,253,...(layer ? [254] : []),...(profileKeys?profileCodes:[])].map(code => ({code,label:labelFor(code),category:'firmware'})),
    ...(desktopKeys?[...DESKTOP_USAGES].map(([code,label])=>({code,label,category:code<240?'mouse':'firmware'})):[]),
    ...(mediaKeys?[...MEDIA_USAGES].map(([code,label])=>({code,label,category:'media'})):[])
  ];
}

function renderPicker() {
  const body = document.getElementById('mappingPickerBody');
  if (!body || !picker) return;
  const query = search.trim().toLowerCase();
  const subgroup = keyboardGroups.find(group => group.id===keyboardGroup);
  const entries = catalog(picker.layer,picker.profileKeys,picker.desktopKeys,picker.mediaKeys).filter(entry => query
    ? (entry.label+' '+hex(entry.code)).toLowerCase().includes(query)
    : entry.category===category && (category!=='keyboard' || subgroup.includes(entry.code)));
  const selectedCategory = label => !query && category===label;
  body.innerHTML = `<div class="mapping-picker-shell"><aside class="mapping-picker-sidebar"><div class="mapping-picker-summary"><span>PHYSICAL KEY</span><strong>${escape(picker.keyName)}</strong><small>${layers[picker.layer]} · currently ${escape(labelFor(picker.usage))}</small></div><div class="mapping-picker-groups" role="tablist" aria-label="Keymap groups">${[['keyboard','Keyboard'],['firmware','Firmware layers'],...(picker.desktopKeys?[['mouse','Mouse']]:[]),...(picker.mediaKeys?[['media','Media and apps']]:[])].map(([id,label]) => `<button type="button" role="tab" data-remap-category="${id}" class="${selectedCategory(id)?'active':''}" aria-selected="${selectedCategory(id)}"><span>${label}</span><i aria-hidden="true">›</i></button>`).join('')}</div></aside><section class="mapping-picker-catalog"><div class="mapping-picker-catalog-head"><div><span>KEYMAP CATALOG</span><strong>${query?'All categories':category==='keyboard'?subgroup.label:category==='mouse'?'Mouse':category==='media'?'Media and apps':'Firmware layers'}</strong></div><b>${entries.length} ${query?'MATCHES':'VALUES'}</b></div>${category==='keyboard'?`<div class="mapping-keyboard-groups" role="tablist" aria-label="Keyboard key groups">${keyboardGroups.map(group => `<button type="button" role="tab" data-remap-keyboard-group="${group.id}" class="${!query&&group.id===keyboardGroup?'active':''}" aria-selected="${!query&&group.id===keyboardGroup}">${group.label}</button>`).join('')}</div>`:''}<label class="mapping-picker-search"><span>Search all categories</span><input id="mappingPickerSearch" class="search-input" type="search" autocomplete="off" placeholder="Search keybinds…" value="${escape(search)}"></label>${picker.desktopKeys?'<button type="button" class="button ghost" id="cycleAllProfilesInPicker">Assign Next profile in all four profiles</button>':''}<div class="mapping-picker-list${query?' search-results':''}">${entries.length?entries.map(entry => `<button type="button" data-remap-code="${entry.code}" class="${entry.code===picker.usage?'active':''}"><span>${entry.code===picker.usage?'CURRENT':query?entry.category.toUpperCase():'KEY VALUE'}</span><b>${escape(entry.label)}</b><small>${hex(entry.code)}</small></button>`).join(''):'<p class="mapping-picker-empty">No matching keybinds.</p>'}</div></section></div>`;
  body.querySelectorAll('[data-remap-category]').forEach(button => button.addEventListener('click', () => {
    category=button.dataset.remapCategory;search='';renderPicker();
  }));
  body.querySelectorAll('[data-remap-keyboard-group]').forEach(button => button.addEventListener('click', () => {
    keyboardGroup=button.dataset.remapKeyboardGroup;search='';renderPicker();
  }));
  body.querySelector('#mappingPickerSearch').addEventListener('input', event => {
    if(event.isComposing) return;
    const {value,selectionStart,selectionEnd}=event.target;
    search=value;renderPicker();
    const input=body.querySelector('#mappingPickerSearch');input.focus();input.setSelectionRange(selectionStart,selectionEnd);
  });
  body.querySelector('#cycleAllProfilesInPicker')?.addEventListener('click',()=>{
    const callback=picker.onCycleAll;
    closeRemapPicker();
    callback?.();
  });
  body.querySelectorAll('[data-remap-code]').forEach(button => button.addEventListener('click', () => {
    const callback=picker.onPick;
    const code=Number(button.dataset.remapCode);
    closeRemapPicker();callback?.(code);
  }));
}
