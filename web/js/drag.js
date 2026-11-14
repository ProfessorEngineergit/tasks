// Reorder cards inside one group by dragging.
// Mouse: press and move. Touch: long-press, then move. One code path for both.
const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 8;
const EDGE = 80;
const MAX_SCROLL = 14;

export function enableDrag(container, { onDrop, vibrate }) {
  let pending = null;   // press that may become a drag
  let drag = null;      // active drag

  const point = e => (e.touches ? e.touches[0] || e.changedTouches[0] : e);
  const ignore = el => el.closest('button, input, select, textarea, a, .boxes, .bar, [data-nodrag]');

  function start(e) {
    if (drag || pending) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    const card = e.target.closest('.card');
    if (!card || !container.contains(card) || ignore(e.target)) return;
    const p = point(e);
    pending = { card, x: p.clientX, y: p.clientY, touch: e.type === 'touchstart', timer: null };
    if (pending.touch) pending.timer = setTimeout(() => begin(pending.x, pending.y), LONG_PRESS_MS);
  }

  function begin(x, y) {
    if (!pending) return;
    const { card } = pending;
    clearTimeout(pending.timer);
    pending = null;
    const list = card.parentElement;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.appendChild(ghost);
    card.classList.add('is-dragging');
    document.body.classList.add('dragging');
    window.getSelection()?.removeAllRanges();
    if (vibrate()) navigator.vibrate?.(25);
    drag = { card, list, ghost, dx: x - rect.left, dy: y - rect.top, x, y, before: [...list.children].indexOf(card), raf: 0 };
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function move(e) {
    if (pending) {
      const p = point(e);
      const far = Math.abs(p.clientX - pending.x) > MOVE_TOLERANCE || Math.abs(p.clientY - pending.y) > MOVE_TOLERANCE;
      if (far) {
        if (pending.touch) { clearTimeout(pending.timer); pending = null; } // it's a scroll
        else begin(pending.x, pending.y);
      }
    }
    if (!drag) return;
    if (e.cancelable) e.preventDefault();
    const p = point(e);
    drag.x = p.clientX; drag.y = p.clientY;
    drag.ghost.style.left = `${drag.x - drag.dx}px`;
    drag.ghost.style.top = `${drag.y - drag.dy}px`;
    reorder();
  }

  function reorder() {
    const siblings = [...drag.list.querySelectorAll(':scope > .card:not(.is-dragging)')];
    let before = null;
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      if (drag.y < r.top + r.height / 2) { before = s; break; }
    }
    if (before) { if (drag.card.nextElementSibling !== before) drag.list.insertBefore(drag.card, before); }
    else if (drag.list.lastElementChild !== drag.card) drag.list.appendChild(drag.card);
  }

  function autoScroll() {
    if (!drag) return;
    const h = window.innerHeight;
    let dy = 0;
    if (drag.y < EDGE) dy = -MAX_SCROLL * (1 - drag.y / EDGE);
    else if (drag.y > h - EDGE) dy = MAX_SCROLL * ((drag.y - (h - EDGE)) / EDGE);
    if (dy) { window.scrollBy(0, Math.round(dy)); reorder(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function end() {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (!drag) return;
    const { card, list, ghost, before } = drag;
    cancelAnimationFrame(drag.raf);
    drag = null;
    const target = card.getBoundingClientRect();
    ghost.classList.add('drag-ghost-drop');
    ghost.style.left = `${target.left}px`;
    ghost.style.top = `${target.top}px`;
    const finish = () => {
      ghost.remove();
      card.classList.remove('is-dragging');
      document.body.classList.remove('dragging');
      const moved = [...list.children].indexOf(card) !== before;
      if (moved) {
        card.classList.add('just-dropped');
        setTimeout(() => card.classList.remove('just-dropped'), 500);
        onDrop([...list.querySelectorAll(':scope > .card')].map(c => c.dataset.id), list.dataset.group);
      }
    };
    ghost.addEventListener('transitionend', finish, { once: true });
    setTimeout(() => { if (ghost.isConnected) finish(); }, 260);
  }

  container.addEventListener('mousedown', start);
  container.addEventListener('touchstart', start, { passive: true });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', end);
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
  window.addEventListener('blur', end);
  // Long-press on Android opens the context menu; suppress it only while a drag is pending.
  container.addEventListener('contextmenu', e => { if (pending || drag) e.preventDefault(); });

  return { isDragging: () => !!drag };
}
