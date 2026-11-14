// Small UI building blocks: toasts, confirm dialog, confetti, matrix rain.
import { t } from './i18n.js';
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM, allowed under a strict CSP
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ── Toasts ───────────────────────────────────────────────────────────────
let toastRoot;
export function toast(message, { action, onAction, duration = 4000, onExpire } = {}) {
  toastRoot ??= document.getElementById('toasts');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  let done = false;
  const close = expired => {
    if (done) return; done = true;
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 200);
    if (expired) onExpire?.();
  };
  if (action) {
    el.append(h('button', { class: 'toast-btn', type: 'button', onclick: () => { close(false); onAction?.(); } }, action));
  }
  toastRoot.append(el);
  const timer = setTimeout(() => close(true), duration);
  return { close: () => { clearTimeout(timer); close(false); }, expire: () => { clearTimeout(timer); close(true); } };
}

// ── Confirm dialog (replaces window.confirm) ─────────────────────────────
export function confirmDialog(message, { yes = t('confirm.yes'), danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'dialog dialog-small' }, h('div', { class: 'dialog-body' },
      h('p', { class: 'dialog-text' }, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', value: 'no' }, t('confirm.no')),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', value: 'yes' }, yes))));
    let result = false;
    dlg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { result = b.value === 'yes'; dlg.close(); }
      else if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn-primary, .btn-danger').focus();
  });
}

// Close a <dialog> when clicking its backdrop. Dialogs have no padding of their
// own (content sits in an inner wrapper), so a click on the element itself is a backdrop click.
export function closeOnBackdrop(dlg) {
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
}

// ── Confetti ─────────────────────────────────────────────────────────────
export function confetti(level, color) {
  if (level === 'off' || typeof window.confetti !== 'function') return;
  if (document.body.classList.contains('pref-anim-off')) return;
  const colors = [color, '#ffffff', color];
  if (level === 'small') {
    window.confetti({ particleCount: 60, spread: 70, startVelocity: 32, origin: { y: 0.7 }, colors, scalar: 0.8, ticks: 140, disableForReducedMotion: true });
    return;
  }
  window.confetti({ particleCount: 180, spread: 100, startVelocity: 60, origin: { y: 0.6 }, colors, disableForReducedMotion: true });
  const end = Date.now() + 1800;
  const tick = setInterval(() => {
    if (Date.now() > end) return clearInterval(tick);
    window.confetti({ particleCount: 40, angle: 60, spread: 60, origin: { x: 0, y: 0.65 }, colors, disableForReducedMotion: true });
    window.confetti({ particleCount: 40, angle: 120, spread: 60, origin: { x: 1, y: 0.65 }, colors, disableForReducedMotion: true });
  }, 250);
}

// ── Matrix rain ──────────────────────────────────────────────────────────
let matrix = null;
export function matrixRain(on, getColor) {
  const canvas = document.getElementById('matrix');
  if (!on) {
    if (matrix) { cancelAnimationFrame(matrix.raf); window.removeEventListener('resize', matrix.resize); matrix = null; }
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (matrix) return;
  const ctx = canvas.getContext('2d');
  const size = 14;
  const chars = '01アイウエオカキクケコサシスセソタチツテト#$%<>{}[]'.split('');
  let drops = [];
  const resize = () => {
    canvas.width = innerWidth; canvas.height = innerHeight;
    drops = Array.from({ length: Math.ceil(innerWidth / size) }, () => Math.random() * -50);
  };
  resize();
  window.addEventListener('resize', resize);
  let last = 0;
  const draw = ts => {
    matrix.raf = requestAnimationFrame(draw);
    if (ts - last < 50 || document.hidden) return; // ~20 fps is plenty
    last = ts;
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = getColor();
    ctx.font = `${size}px ui-monospace, monospace`;
    drops.forEach((y, i) => {
      ctx.fillText(chars[(Math.random() * chars.length) | 0], i * size, y * size);
      drops[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
    });
  };
  matrix = { raf: requestAnimationFrame(draw), resize };
}

export { icon };
