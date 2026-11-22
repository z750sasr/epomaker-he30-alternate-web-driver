/* Compact travel monitor adapted from the AE64 Pro Reloaded workspace. */
export function liveTravelPanel() {
  return `<aside class="panel live-press-panel reloaded-live-press compact" aria-label="Live press distance">
    <div class="panel-head">
      <button type="button" class="live-press-handle" title="Drag to move"><span aria-hidden="true">⠿</span> Live press distance</button>
      <span id="liveTravelStatus" class="badge">OFFLINE</span>
      <button id="closeLiveTravel" class="button ghost small live-press-close" type="button" aria-label="Close live press distance">×</button>
    </div>
    <div class="live-press-readout">
      <div class="live-press-value-row"><b id="liveTravelKey"></b><strong id="liveTravelValue">—</strong></div>
      <div class="live-travel-scale" aria-hidden="true"><i class="live-travel-fill"></i><i class="live-travel-marker"></i></div>
      <div class="live-travel-limits"><span>0 mm</span><span id="liveTravelMax"></span></div>
      <p class="live-travel-actuation" id="liveTravelActuation"></p>
      <label class="live-press-scope"><input id="liveTravelSelectionOnly" type="checkbox" checked> Selected keys only</label>
      <div class="live-press-pressed"><h3>Pressed keys</h3><div id="liveTravelPressed" class="pressed-key-list"></div></div>
    </div>
  </aside>`;
}

export function bindLiveTravelPanel(panel, {position, onMove, onClose}) {
  const handle = panel.querySelector('.live-press-handle');
  const move = (x, y) => {
    const rect = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
    Object.assign(panel.style, {left: left+'px', top: top+'px', right: 'auto', bottom: 'auto'});
    onMove({left, top});
  };
  if (position) move(position.left, position.top);
  let start;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const {left, top} = panel.getBoundingClientRect();
    start = {left, top, x: event.clientX, y: event.clientY};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (start && handle.hasPointerCapture(event.pointerId)) {
      move(start.left + event.clientX - start.x, start.top + event.clientY - start.y);
    }
  });
  handle.addEventListener('lostpointercapture', () => { start = null; });
  handle.addEventListener('keydown', event => {
    const directions = {ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10]};
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const {left, top} = panel.getBoundingClientRect();
    move(left + direction[0], top + direction[1]);
  });
  panel.querySelector('#closeLiveTravel').addEventListener('click', onClose);
}

export function paintLiveTravel(panel, {connected, labels, primary, selection, travel, settings, sample}) {
  if (!panel) return;
  const get = id => panel.querySelector('#'+id);
  const indices = get('liveTravelSelectionOnly').checked ? selection : labels.map((_, index) => index);
  const positions = sample?.positions;
  const pressed = sample?.pressed;
  const distance = index => positions[index] * travel[index] / 1e6;
  const deepest = positions && indices.reduce((current, next) => distance(next) > distance(current) ? next : current, primary);
  const key = deepest ?? primary;
  const nominal = travel[key] / 1000;
  const actuation = nominal * settings[key].actuation / 1000;

  get('liveTravelStatus').textContent = !connected ? 'OFFLINE' : positions ? 'LIVE' : 'WAITING';
  get('liveTravelKey').textContent = labels[key];
  get('liveTravelValue').textContent = positions ? distance(key).toFixed(3)+' mm' : '—';
  get('liveTravelMax').textContent = nominal.toFixed(3)+' mm';
  get('liveTravelActuation').textContent = 'Actuation '+actuation.toFixed(3)+' mm';
  panel.style.setProperty('--press-distance', (positions?.[key] || 0) / 10 + '%');
  panel.style.setProperty('--actuation-distance', settings[key].actuation / 10 + '%');

  const list = get('liveTravelPressed');
  const lines = positions ? indices.filter(index => pressed[index] || positions[index] > 5)
    .map(index => labels[index]+' '+distance(index).toFixed(2)+' mm') : [];
  const summary = lines.join(' · ');
  if (list.dataset.summary !== summary) {
    list.dataset.summary = summary;
    list.replaceChildren(...lines.map(line => {
      const item = document.createElement('span');
      item.textContent = line;
      return item;
    }));
  }
  if (!lines.length && !list.textContent) list.textContent = '—';
}
