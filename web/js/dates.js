// Date helpers. Due dates are plain local calendar days ("YYYY-MM-DD"),
// never converted through UTC, so "today" is always the user's today.

const pad = n => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDateStr(s).getTime());
}

export function todayStr(now = new Date()) { return toDateStr(now); }

export function addDays(s, n) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function diffDays(a, b) {
  // whole days from a to b (b - a); DST-safe because both are local midnights rounded
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// Add months, clamping to the month's end but remembering the intended day.
// e.g. Jan 31 + 1 month = Feb 28/29, and with anchorDay 31 the next step is Mar 31.
export function addMonths(s, n, anchorDay) {
  const d = parseDateStr(s);
  const day = anchorDay || d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + n;
  const target = new Date(y, m, 1);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth())));
  return toDateStr(target);
}

export const REPEAT_TYPES = ['none', 'daily', 'weekdays', 'every2days', 'every3days', 'weekly', 'biweekly', 'monthly', 'yearly'];

export function stepRepeat(s, type, anchorDay) {
  switch (type) {
    case 'daily': return addDays(s, 1);
    case 'every2days': return addDays(s, 2);
    case 'every3days': return addDays(s, 3);
    case 'weekly': return addDays(s, 7);
    case 'biweekly': return addDays(s, 14);
    case 'monthly': return addMonths(s, 1, anchorDay);
    case 'yearly': return addMonths(s, 12, anchorDay);
    case 'weekdays': {
      let next = addDays(s, 1);
      while ([0, 6].includes(parseDateStr(next).getDay())) next = addDays(next, 1);
      return next;
    }
    default: return s;
  }
}

// A completed repeating task comes back once its due day is over AND
// it was not completed today (so you still see it ticked off on the day you did it).
export function shouldReset(task, today) {
  if (!task.repeatType || task.repeatType === 'none') return false;
  if ((task.progress || 0) < 3 || !isDateStr(task.dueDate)) return false;
  if (today <= task.dueDate) return false;
  if (task.completedAt && toDateStr(new Date(task.completedAt)) >= today) return false;
  return true;
}

// The next due date strictly after the old one and not in the past.
export function nextDueDate(task, today) {
  const anchor = task.anchorDay || parseDateStr(task.dueDate).getDate();
  let next = stepRepeat(task.dueDate, task.repeatType, anchor);
  let guard = 0;
  while (next < today && guard++ < 2000) next = stepRepeat(next, task.repeatType, anchor);
  return next;
}

export function endOfWeek(today, firstDay = 'monday') {
  const d = parseDateStr(today);
  const start = firstDay === 'sunday' ? 0 : firstDay === 'saturday' ? 6 : 1;
  const lastDay = (start + 6) % 7;
  const delta = (lastDay - d.getDay() + 7) % 7;
  return addDays(today, delta);
}

// "Wäsche abholen morgen" -> { title: "Wäsche abholen", due: tomorrow }
export function parseQuickDate(text, today) {
  const words = {
    heute: 0, today: 0,
    morgen: 1, tomorrow: 1,
    'übermorgen': 2, uebermorgen: 2,
  };
  const m = text.match(/\s+(heute|today|morgen|tomorrow|übermorgen|uebermorgen)\s*$/i);
  if (!m) return { title: text, due: null };
  return { title: text.slice(0, m.index).trim(), due: addDays(today, words[m[1].toLowerCase()]) };
}
