// Talks to the OpenDone server (server/server.js) on the same origin.
// Changes are applied locally right away, sent to the server, and other
// devices are told about them through a server-sent event stream.
import { normalizeTask, applyPatch } from './common.js';

class HttpError extends Error {
  constructor(status, code) { super(code || `HTTP ${status}`); this.status = status; this.code = code; }
}

async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const res = await fetch(`./api/${path}`, {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, data && data.error);
  return data;
}

export async function detectServer() {
  try {
    const res = await fetch('./api/health', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.app === 'opendone' ? data : null;
  } catch { return null; }
}

export function createServerStore(health, { onError } = {}) {
  let tasks = new Map();
  let user = null;
  const listeners = new Set();
  let events = null;
  let refetchTimer = null;
  const emit = () => { const list = [...tasks.values()]; listeners.forEach(fn => fn(list)); };

  const signature = map => JSON.stringify([...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));

  async function refetch() {
    try {
      const data = await api('tasks');
      const next = new Map(data.tasks.map(t => [t.id, t]));
      // Our own changes come back as events too; only re-render if something differs.
      if (signature(next) === signature(tasks)) return;
      tasks = next;
      emit();
    } catch (e) {
      if (e.status === 401) location.reload();
      else onError?.(e);
    }
  }
  const scheduleRefetch = () => { clearTimeout(refetchTimer); refetchTimer = setTimeout(refetch, 120); };

  function connectEvents() {
    if (events) events.close();
    events = new EventSource('./api/events', { withCredentials: true });
    events.addEventListener('change', scheduleRefetch);
    // EventSource reconnects by itself; refetch after a reconnect to catch up.
    events.addEventListener('open', scheduleRefetch);
  }

  async function mutate(local, remote) {
    local(); emit();
    try { await remote(); }
    catch (e) { onError?.(e); await refetch(); throw e; }
  }

  return {
    kind: 'server',
    health,
    get user() { return user; },
    async init() {
      try { user = (await api('me')).user; }
      catch (e) { if (e.status === 401) return { user: null, needsAuth: true }; throw e; }
      return { user, needsAuth: false };
    },
    async login(username, password) { user = (await api('auth/login', { method: 'POST', body: { username, password } })).user; return user; },
    async signup(username, password) { user = (await api('auth/signup', { method: 'POST', body: { username, password } })).user; return user; },
    async logout() { await api('auth/logout', { method: 'POST', body: {} }).catch(() => {}); events?.close(); },
    subscribe(fn) {
      listeners.add(fn);
      if (!events) { connectEvents(); refetch(); } else fn([...tasks.values()]);
      return () => listeners.delete(fn);
    },
    async add(task) {
      const t = normalizeTask(task);
      await mutate(() => tasks.set(t.id, t), async () => {
        const res = await api('tasks', { method: 'POST', body: t });
        if (res && res.task) tasks.set(t.id, res.task);
      });
      return t;
    },
    async update(id, patch) {
      const cur = tasks.get(id); if (!cur) return null;
      const t = applyPatch(cur, patch);
      await mutate(() => tasks.set(id, t), async () => {
        const res = await api(`tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
        if (res && res.task) tasks.set(id, res.task); // keep the server's timestamps, no re-render needed
      });
      return t;
    },
    async remove(id, { keepalive = false } = {}) {
      await mutate(() => tasks.delete(id), () => api(`tasks/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive }));
    },
    async importTasks(list) {
      const clean = list.map(normalizeTask).filter(Boolean);
      const res = await api('tasks/import', { method: 'POST', body: { tasks: clean } });
      await refetch();
      return res.imported;
    },
    async loadPrefs() { const p = await api('prefs'); return { settings: p.settings, order: p.order }; },
    async savePrefs(prefs) { await api('prefs', { method: 'PUT', body: prefs }); },
    flushOnExit() {},
  };
}
