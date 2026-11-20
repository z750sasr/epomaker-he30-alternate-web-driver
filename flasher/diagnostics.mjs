import { VID, APP_PID, DONOR_PID, HIDTransport, readRawSamples, usbId } from './protocol.mjs';
const $ = id => document.getElementById(id);
const labels = ['Esc','1','2','3','4','5','6','Tab','Q','W','E','R','T','Caps','A','S','D','F','G','Shift','Z','X','C','V','B','Ctrl','Fn','Alt','Space','Grave','F1','F2','F3','F4','F5','F6'];
const channels = [10,11,12,13,4,5,6,7,14,15,8,9];
let transport, running = false, connecting = false, reading = false, token = 0;
let ranges = [], frames = [], latest;
const cells = labels.map((label, index) => {
  const cell = document.createElement('div'); cell.className = 'sample';
  const title = document.createElement('span'); title.textContent = `#${index} · ${label}`;
  const value = document.createElement('strong'); value.textContent = '—';
  const detail = document.createElement('span'); detail.textContent = `Bank ${Math.floor(index/12)} · ADC ${channels[index%12]}`;
  cell.append(title,value,detail); $('samples').append(cell); return { cell, value, detail };
});
function say(text) { $('status').textContent = text; $('log').textContent = `${new Date().toISOString()} ${text}`; }
function buttons() { $('connect').disabled = running || connecting; $('start').disabled = !transport || running || reading; $('stop').disabled = !running; $('baseline').disabled = !latest; $('save').disabled = !frames.length; }
function show(values) {
  latest = values;
  frames.push({ time: new Date().toISOString(), adc: values }); if (frames.length > 120) frames.shift();
  values.forEach((value, i) => {
    const range = ranges[i] ||= { min: value, max: value };
    range.min = Math.min(range.min,value); range.max = Math.max(range.max,value);
    cells[i].value.textContent = String(value);
    cells[i].detail.textContent = `B${Math.floor(i/12)} ADC${channels[i%12]} · Δ${range.max-range.min}`;
    cells[i].cell.classList.toggle('changed',range.max-range.min>8);
  });
  buttons();
}
async function sample() { if (reading) return; reading = true; try { show(await readRawSamples(transport)); } finally { reading = false; buttons(); } }
$('connect').onclick = async () => {
  if (!navigator.hid || !window.isSecureContext) return say('Use Chrome or Edge on HTTPS or localhost.');
  connecting = true; buttons();
  try {
    const selected = await navigator.hid.requestDevice({ filters: [DONOR_PID, APP_PID].map(productId => ({ vendorId: VID, productId })) });
    if (!selected[0]) return;
    await transport?.close().catch(() => {});
    transport = new HIDTransport(selected[0]); await transport.open();
    await sample(); say(`${selected[0].productName || 'HE30'} · ${usbId(selected[0])} · H3D1 signature confirmed. Ready to monitor.`);
  } catch (error) { say(error.message); await transport?.close().catch(() => {}); transport = null; }
  finally { connecting = false; buttons(); }
};
$('start').onclick = async () => {
  if (!transport || running || reading) return;
  running = true; const current = ++token; buttons(); say('Monitoring raw samples. Press one key at a time.');
  try {
    while (running && current === token) { await sample(); await new Promise(resolve => setTimeout(resolve,100)); }
  } catch (error) { running = false; say(`Monitor stopped: ${error.message}`); }
  finally { if (current === token) { running = false; buttons(); } }
};
$('stop').onclick = () => { running = false; buttons(); say('Monitor stopping after the current read.'); };
$('baseline').onclick = () => { ranges = []; if (latest) show(latest); };
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ firmware: 'H3D02 / Zuoya115', format: 'raw u16 ADC words; non-atomic scan banks', candidateLabels: labels, channels, frames },null,2)],{type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='HE30-raw-scan.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
navigator.hid?.addEventListener('disconnect',event => { if (transport?.device===event.device) { running=false; token++; transport.disconnected(); transport=null; say('Keyboard disconnected.'); buttons(); } });
window.addEventListener('pagehide',() => { running=false; transport?.close().catch(()=>{}); });
buttons();
