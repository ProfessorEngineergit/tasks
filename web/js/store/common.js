import { isDateStr, REPEAT_TYPES } from '../dates.js';

export function newId() {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return 't_' + Date.now().toString(36) + '_' + [...rnd].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Coerce anything task-shaped (old 1.x documents, imports) into a clean task.
export function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? '').trim().slice(0, 500);
  if (!title) return null;
  const now = new Date().toISOString();
  const progress = Math.min(3, Math.max(0, Math.round(Number(raw.progress) || 0)));
  const iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : newId(),
    title,
    notes: String(raw.notes ?? '').slice(0, 5000),
    dueDate: isDateStr(raw.dueDate) ? raw.dueDate : null,
    progress,
    repeatType: REPEAT_TYPES.includes(raw.repeatType) ? raw.repeatType : 'none',
    anchorDay: Number.isInteger(raw.anchorDay) && raw.anchorDay >= 1 && raw.anchorDay <= 31 ? raw.anchorDay : null,
    important: !!raw.important,
    createdAt: iso(raw.createdAt) || now,
    updatedAt: iso(raw.updatedAt) || now,
    completedAt: progress === 3 ? (iso(raw.completedAt) || iso(raw.updatedAt) || now) : null,
  };
}

// Fields a client may change on an existing task.
export const PATCHABLE = ['title', 'notes', 'dueDate', 'progress', 'repeatType', 'anchorDay', 'important', 'completedAt'];

export function applyPatch(task, patch) {
  const merged = { ...task };
  for (const k of PATCHABLE) if (k in patch) merged[k] = patch[k];
  merged.updatedAt = new Date().toISOString();
  return normalizeTask(merged);
}
