// Stores everything in this browser's localStorage. Used on GitHub Pages and as demo.
import { normalizeTask, applyPatch } from './common.js';

const KEY = 'opendone:v1';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (data && typeof data === 'object') return { tasks: data.tasks || {}, settings: data.settings || null, order: data.order || null };
  } catch { /* fall through */ }
  return { tasks: {}, settings: null, order: null };
}

export function createLocalStore() {
  let state = read();
  const listeners = new Set();
  const emit = () => { const list = Object.values(state.tasks); listeners.forEach(fn => fn(list)); };
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { throw new Error('storage-full'); }
    emit();
  };
  // Keep several open tabs in sync.
  window.addEventListener('storage', e => { if (e.key === KEY) { state = read(); emit(); } });

  return {
    kind: 'local',
    async init() { return { user: null, needsAuth: false }; },
    subscribe(fn) { listeners.add(fn); fn(Object.values(state.tasks)); return () => listeners.delete(fn); },
    async add(task) { const t = normalizeTask(task); state.tasks[t.id] = t; write(); return t; },
    async update(id, patch) {
      const cur = state.tasks[id]; if (!cur) return null;
      const t = applyPatch(cur, patch); state.tasks[id] = t; write(); return t;
    },
    async remove(id) { delete state.tasks[id]; write(); },
    async importTasks(list) {
      let n = 0;
      for (const raw of list) { const t = normalizeTask(raw); if (t) { state.tasks[t.id] = t; n++; } }
      write(); return n;
    },
    async loadPrefs() { return { settings: state.settings, order: state.order }; },
    async savePrefs({ settings, order }) {
      if (settings !== undefined) state.settings = settings;
      if (order !== undefined) state.order = order;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    },
    flushOnExit() {},
  };
}
