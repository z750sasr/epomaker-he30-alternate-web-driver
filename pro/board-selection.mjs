/* The rectangle follows the same replace/add/toggle rules as key clicks. */
export function bindBoardSelection(board, canSelect, onSelect) {
  let drag = null;
  let suppressClick = false;
  const rectangle = document.createElement('div');
  rectangle.className = 'key-selection-marquee';
  rectangle.hidden = true;
  rectangle.setAttribute('aria-hidden', 'true');
  board.append(rectangle);

  const reset = () => {
    drag = null;
    rectangle.hidden = true;
  };

  board.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (!canSelect() || !event.isPrimary || event.pointerType === 'touch' || event.button !== 0 ||
        !event.target.closest('.pro-board')) return;
    const mode = event.altKey ? 'remove' : event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace';
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, mode, moved: false};
  });

  board.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!canSelect() || !event.buttons) { reset(); return; }
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      drag.moved = true;
      suppressClick = true;
      board.setPointerCapture(drag.id);
      if (!rectangle.isConnected) board.append(rectangle);
      rectangle.hidden = false;
    }
    const left = Math.min(drag.x, event.clientX);
    const top = Math.min(drag.y, event.clientY);
    Object.assign(rectangle.style, {
      left: left + 'px', top: top + 'px',
      width: Math.abs(event.clientX - drag.x) + 'px',
      height: Math.abs(event.clientY - drag.y) + 'px'
    });
  });

  board.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const {moved, x, y, mode} = drag;
    reset();
    if (!moved || !canSelect()) return;
    const left = Math.min(x, event.clientX), right = Math.max(x, event.clientX);
    const top = Math.min(y, event.clientY), bottom = Math.max(y, event.clientY);
    const keys = Array.from(board.querySelectorAll('[data-key]')).filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.left <= right && rect.right >= left && rect.top <= bottom && rect.bottom >= top;
    }).map(node => Number(node.dataset.key));
    if (keys.length) onSelect(keys, mode);
  });

  board.addEventListener('pointercancel', reset);
  board.addEventListener('lostpointercapture', reset);
  board.addEventListener('pointerleave', () => { if (!drag?.moved) reset(); });
  board.addEventListener('click', event => {
    if (suppressClick && event.detail) {
      suppressClick = false;
      event.stopPropagation();
    }
  }, true);
}
