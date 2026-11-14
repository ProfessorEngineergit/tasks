// OpenDone — app entry point.
import { t, tl, translateDom, getLanguage } from './i18n.js';
import { DEFAULTS, SCHEMA, ACCENT_PRESETS, migrateSettings, applySettings, onSystemChange } from './settings.js';
import { todayStr, toDateStr, addDays, diffDays, parseDateStr, endOfWeek, shouldReset, nextDueDate, parseQuickDate, REPEAT_TYPES, isDateStr } from './dates.js';
import { createLocalStore } from './store/local.js';
import { detectServer, createServerStore } from './store/server.js';
import { $, h, icon, toast, confirmDialog, closeOnBackdrop, confetti, matrixRain } from './ui.js';
import { enableDrag } from './drag.js';

const VERSION = '2.0.0';
const REPO = 'https://github.com/ProfessorEngineergit/tasks';
const config = Object.assign({ backend: 'auto', firebase: null }, window.OPENDONE_CONFIG || {});

const state = {
  store: null,
  user: null,
  tasks: [],
  settings: { ...DEFAULTS },
  order: null,          // global custom order (array of ids) or null
  hidden: new Set(),    // ids pending deletion (undo window)
  pendingDeletes: new Map(),
  seen: new Set(),      // ids already rendered once (for entry animation)
  lastProgress: new Map(),
  firstRender: true,
  resetting: new Set(),
  today: todayStr(),
  renderQueued: false,
};
let drag;

// ── Boot ─────────────────────────────────────────────────────────────────
async function pickStore() {
  const want = config.backend;
  if (want === 'server' || want === 'auto') {
    const health = await detectServer();
    if (health) return createServerStore(health, { onError: reportError });
    if (want === 'server') throw new Error('Server not reachable');
  }
  if ((want === 'firebase' || want === 'auto') && config.firebase && config.firebase.apiKey) {
    const { createFirebaseStore } = await import('./store/firebase.js');
    return createFirebaseStore(config.firebase);
  }
  return createLocalStore();
}

async function boot() {
  // Apply locally cached look first, so there is no flash of default styling.
  try { const cached = JSON.parse(localStorage.getItem('opendone:look') || 'null'); if (cached) state.settings = migrateSettings(cached); } catch { /* ignore */ }
  applySettings(state.settings);
  translateDom();

  try {
    state.store = await pickStore();
    const res = await state.store.init();
    if (res.needsAuth) return showAuth();
    state.user = res.user;
    await startApp();
  } catch (e) {
    console.error(e);
    showFatal(e);
  }
}

async function startApp() {
  showView('app');
  try {
    const prefs = await state.store.loadPrefs();
    state.settings = migrateSettings(prefs.settings);
    state.order = Array.isArray(prefs.order) ? prefs.order : null;
  } catch (e) { reportError(e); }
  refreshLook();
  buildSettings();
  initAddForm();
  drag ??= enableDrag($('#list'), { onDrop: saveOrderFromDom, vibrate: () => state.settings.vibrationFeedback });
  state.store.subscribe(list => {
    state.tasks = list;
    runRecurrence();
    queueRender();
  });
  $('#mode-label').textContent = t(`mode.${state.store.kind}`);
}

function showView(name) {
  for (const v of ['loading', 'auth', 'app', 'fatal']) {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = v !== name;
  }
  $('#settings-btn').hidden = name !== 'app';
  document.body.dataset.view = name;
  if (state.store) $('#mode-label').textContent = t(`mode.${state.store.kind}`);
  document.body.classList.remove('booting');
}

function showFatal(e) {
  showView('fatal');
  $('#view-fatal').replaceChildren(
    h('h1', {}, 'OpenDone'),
    h('p', {}, e.message === 'Server not reachable'
      ? 'The OpenDone server is not reachable. Check that it is running.'
      : `Something went wrong while starting: ${e.message}`),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload'));
}

function reportError(e) {
  console.error(e);
  if (e && (e.status === 0 || e instanceof TypeError)) toast(t('toast.offline'));
  else toast(t('toast.error'));
}

// ── Auth ─────────────────────────────────────────────────────────────────
function showAuth() {
  showView('auth');
  const root = $('#view-auth');
  const store = state.store;
  const hero = h('div', { class: 'auth-hero' },
    h('img', { src: 'icons/icon.svg', alt: '', width: 88, height: 88, class: 'auth-icon' }),
    h('h1', { class: 'wordmark auth-wordmark' }, 'opendone'),
    h('p', { class: 'auth-tagline' }, t('app.tagline')));

  if (store.kind === 'firebase') {
    root.replaceChildren(hero, h('div', { class: 'auth-card' },
      h('p', { class: 'auth-title' }, t('auth.firebaseTitle')),
      h('button', {
        class: 'btn btn-primary btn-wide', type: 'button',
        onclick: async () => {
          try { state.user = await store.loginWithGitHub(); await startApp(); }
          catch (e) { toast(t('auth.error', { m: e.code || e.message })); }
        },
        html: `${icon('github', { size: 20 })}<span>${t('auth.github')}</span>`,
      })));
    return;
  }

  const health = store.health || {};
  let mode = health.signup === 'first' ? 'signup' : 'login';
  const canSignup = health.signup === 'first' || health.signup === 'open';
  const err = h('p', { class: 'auth-error', role: 'alert' });
  const user = h('input', { id: 'auth-user', name: 'username', autocomplete: 'username', required: true, minlength: 2, maxlength: 32, autocapitalize: 'off', spellcheck: 'false' });
  const pass = h('input', { id: 'auth-pass', name: 'password', type: 'password', required: true, minlength: 8, maxlength: 200 });
  const submit = h('button', { class: 'btn btn-primary btn-wide', type: 'submit' });
  const title = h('p', { class: 'auth-title' });
  const switcher = h('button', { class: 'link-btn', type: 'button' });
  const form = h('form', { class: 'auth-card', novalidate: true },
    title,
    h('label', { class: 'field' }, h('span', {}, t('auth.username')), user),
    h('label', { class: 'field' }, h('span', {}, t('auth.password')), pass),
    err, submit, canSignup && health.signup !== 'first' ? switcher : null);
  const sync = () => {
    title.textContent = mode === 'signup' ? (health.signup === 'first' ? t('auth.firstUser') : t('auth.signup')) : t('auth.loginTitle');
    submit.textContent = mode === 'signup' ? t('auth.signup') : t('auth.login');
    switcher.textContent = mode === 'signup' ? t('auth.toLogin') : t('auth.toSignup');
    pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    err.textContent = '';
  };
  switcher.addEventListener('click', () => { mode = mode === 'signup' ? 'login' : 'signup'; sync(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    const name = user.value.trim();
    if (mode === 'signup' && !/^[a-zA-Z0-9._-]{2,32}$/.test(name)) { err.textContent = t('auth.badName'); return; }
    if (mode === 'signup' && pass.value.length < 8) { err.textContent = t('auth.weak'); return; }
    submit.disabled = true;
    try {
      state.user = mode === 'signup' ? await store.signup(name, pass.value) : await store.login(name, pass.value);
      pass.value = '';
      await startApp();
    } catch (ex) {
      const map = { invalid_credentials: 'auth.failed', username_taken: 'auth.taken', signup_closed: 'auth.closed', weak_password: 'auth.weak', invalid_username: 'auth.badName', rate_limited: 'auth.rate' };
      err.textContent = map[ex.code] ? t(map[ex.code]) : t('auth.error', { m: ex.message });
    } finally { submit.disabled = false; }
  });
  sync();
  root.replaceChildren(hero, form);
  user.focus();
}

// ── Settings ─────────────────────────────────────────────────────────────
let saveTimer = null;
function saveSettingsSoon() {
  try { localStorage.setItem('opendone:look', JSON.stringify(state.settings)); } catch { /* ignore */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => state.store.savePrefs({ settings: state.settings }).catch(reportError), 400);
}

function setSetting(key, value) {
  const languageChanged = key === 'language';
  state.settings[key] = value;
  refreshLook();
  saveSettingsSoon();
  if (languageChanged) { translateDom(); buildSettings('behavior'); initAddForm(); $('#mode-label').textContent = t(`mode.${state.store.kind}`); }
  queueRender();
}

function refreshLook() {
  applySettings(state.settings);
  matrixRain(state.settings.matrixBg, () => state.settings.accentColor + 'A6');
  try { localStorage.setItem('opendone:look', JSON.stringify(state.settings)); } catch { /* ignore */ }
}
onSystemChange(() => { refreshLook(); });

const TABS = [['look', 'tab.look'], ['cards', 'tab.cards'], ['behavior', 'tab.behavior'], ['extras', 'tab.extras'], ['data', 'tab.data']];

function control(item) {
  const s = state.settings;
  const id = `s-${item.key}`;
  if (item.type === 'toggle') {
    const btn = h('button', { id, class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!s[item.key]) }, h('span', { class: 'switch-thumb' }));
    btn.addEventListener('click', () => {
      const v = !state.settings[item.key];
      btn.setAttribute('aria-checked', String(v));
      setSetting(item.key, v);
    });
    return btn;
  }
  if (item.type === 'select') {
    const opts = item.options === 'repeat'
      ? REPEAT_TYPES.map(v => ({ value: v, label: t(`repeat.${v}`) }))
      : item.options.map(o => ({ value: o.value, label: tl(o.label) }));
    const sel = h('select', { id, class: 'select' }, opts.map(o => h('option', { value: o.value, selected: o.value === s[item.key] }, o.label)));
    sel.addEventListener('change', () => setSetting(item.key, sel.value));
    return sel;
  }
  if (item.type === 'range') {
    const out = h('output', { class: 'range-out', for: id }, `${s[item.key]}${item.unit}`);
    const input = h('input', { id, type: 'range', class: 'range', min: item.min, max: item.max, step: item.step, value: s[item.key] });
    input.addEventListener('input', () => { out.textContent = `${input.value}${item.unit}`; setSetting(item.key, Number(input.value)); });
    return h('div', { class: 'range-wrap' }, input, out);
  }
  if (item.type === 'color') {
    const picker = h('input', { id, type: 'color', class: 'color-input', value: s.accentColor.toLowerCase(), 'aria-label': tl(item.label) });
    const presets = ACCENT_PRESETS.map(c => h('button', {
      type: 'button', class: 'swatch', style: `--c:${c}`, title: c, 'aria-label': c,
      'aria-pressed': String(c.toLowerCase() === s.accentColor.toLowerCase()),
      onclick: () => { picker.value = c.toLowerCase(); pickColor(c); },
    }));
    const pickColor = c => {
      presets.forEach(p => p.setAttribute('aria-pressed', String(p.title.toLowerCase() === c.toLowerCase())));
      setSetting('accentColor', c.toUpperCase());
    };
    picker.addEventListener('input', () => pickColor(picker.value));
    return h('div', { class: 'color-wrap' }, h('div', { class: 'swatches' }, presets), picker);
  }
  return null;
}

function buildSettings(activeTab = 'look') {
  const dlg = $('#settings');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'sheet-body' });
  for (const [key, label] of TABS) {
    const pane = h('div', { class: 'pane', role: 'tabpanel', id: `pane-${key}`, hidden: key !== activeTab });
    const tab = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(key === activeTab), 'aria-controls': `pane-${key}`, onclick: () => {
      tabs.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b === tab)));
      body.querySelectorAll('.pane').forEach(p => { p.hidden = p !== pane; });
      body.scrollTop = 0;
    } }, t(label));
    tabs.append(tab);
    if (key === 'data') buildDataPane(pane);
    else {
      let group = null;
      for (const item of SCHEMA.filter(i => i.tab === key)) {
        if (item.group !== group) { group = item.group; pane.append(h('h3', { class: 'group-title' }, t(group))); }
        pane.append(h('div', { class: 'row' },
          h('label', { class: 'row-label', for: `s-${item.key}` }, h('span', {}, tl(item.label)), item.hint ? h('small', {}, tl(item.hint)) : null),
          control(item)));
      }
    }
    body.append(pane);
  }
  dlg.replaceChildren(h('div', { class: 'sheet-inner' },
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'settings-title' }, t('settings.title')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), title: t('settings.close'), onclick: () => dlg.close(), html: icon('close') })),
    tabs, body));
}

function actionRow(label, hint, btnLabel, iconName, onclick, danger = false) {
  return h('div', { class: 'row' },
    h('div', { class: 'row-label' }, h('span', {}, label), hint ? h('small', {}, hint) : null),
    h('button', { class: `btn btn-small ${danger ? 'btn-danger-ghost' : 'btn-ghost'}`, type: 'button', onclick, html: `${icon(iconName, { size: 16 })}<span>${btnLabel}</span>` }));
}

function buildDataPane(pane) {
  const store = state.store;
  pane.append(h('h3', { class: 'group-title' }, t('grp.account')));
  pane.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('span', {}, t('data.mode')),
    store.kind === 'local' ? h('small', {}, t('data.localHint')) : null), h('span', { class: 'mono-val' }, t(`mode.${store.kind}`))));
  if (state.user) {
    pane.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('span', {}, t('data.user'))), h('span', { class: 'mono-val' }, state.user.name)));
    pane.append(actionRow(t('data.logout'), null, t('data.logout'), 'logout', async () => { await store.logout(); location.reload(); }));
  }
  pane.append(h('h3', { class: 'group-title' }, t('grp.backup')));
  pane.append(actionRow(t('data.export'), t('data.exportHint'), t('data.export'), 'download', exportData));
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => importData(e.target) });
  pane.append(actionRow(t('data.import'), t('data.importHint'), t('data.import'), 'upload', () => file.click()), file);
  pane.append(h('h3', { class: 'group-title' }, t('grp.cleanup')));
  pane.append(actionRow(t('data.clearDone'), t('data.clearDoneHint'), t('run'), 'broom', clearDone, true));
  pane.append(actionRow(t('data.reset'), t('data.resetHint'), t('reset'), 'reset', async () => {
    if (!(await confirmDialog(t('confirm.resetSettings'), { danger: true, yes: t('reset') }))) return;
    state.settings = { ...DEFAULTS };
    refreshLook(); saveSettingsSoon(); translateDom(); buildSettings('data'); initAddForm(); queueRender();
  }, true));
  pane.append(h('h3', { class: 'group-title' }, t('grp.about')));
  pane.append(h('div', { class: 'about' },
    h('img', { src: 'icons/icon.svg', alt: '', width: 48, height: 48 }),
    h('div', {},
      h('strong', { class: 'wordmark' }, 'opendone'),
      h('small', {}, `${t('about.version', { v: VERSION })} · ${t('about.license')}`),
      h('div', { class: 'about-links' },
        h('a', { href: REPO, target: '_blank', rel: 'noopener' }, t('about.source')),
        h('a', { href: `${REPO}#self-hosting`, target: '_blank', rel: 'noopener' }, t('about.selfhost'))))));
}

$('#settings-btn').addEventListener('click', () => $('#settings').showModal());
closeOnBackdrop($('#settings'));

// ── Data: export / import / cleanup ──────────────────────────────────────
function exportData() {
  const data = { app: 'opendone', version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks, settings: state.settings, order: state.order };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `opendone-${todayStr()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  let list;
  try {
    const data = JSON.parse(await f.text());
    list = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(list)) throw new Error('bad');
  } catch { toast(t('toast.importFailed')); return; }
  if (!(await confirmDialog(t('confirm.import', { n: list.length }), { yes: t('data.import') }))) return;
  try { const n = await state.store.importTasks(list); toast(t('toast.imported', { n })); }
  catch (e) { reportError(e); }
}

async function clearDone() {
  const done = state.tasks.filter(x => x.progress === 3 && x.repeatType === 'none');
  if (!done.length) { toast(t('data.clearDoneNone')); return; }
  if (!(await confirmDialog(t('confirm.deleteDone', { n: done.length }), { danger: true, yes: t('card.delete') }))) return;
  for (const x of done) await state.store.remove(x.id).catch(reportError);
  toast(t('toast.clearedDone', { n: done.length }));
}

// ── Add form ─────────────────────────────────────────────────────────────
let addFormBound = false;
function initAddForm() {
  const repeat = $('#add-repeat');
  repeat.replaceChildren(...REPEAT_TYPES.map(v => h('option', { value: v }, t(`repeat.${v}`))));
  repeat.value = state.settings.defaultRepeatType;
  translateDom($('#add-form'));
  if (addFormBound) return;
  addFormBound = true;
  const form = $('#add-form');
  const imp = $('#add-important');
  imp.innerHTML = icon('star');
  imp.addEventListener('click', () => {
    const on = imp.getAttribute('aria-pressed') !== 'true';
    imp.setAttribute('aria-pressed', String(on));
    imp.innerHTML = icon('star', { filled: on });
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const titleEl = $('#add-title');
    let title = titleEl.value.trim();
    let due = $('#add-due').value || null;
    if (state.settings.smartInput && !due) {
      const q = parseQuickDate(title, todayStr());
      if (q.due && q.title) { title = q.title; due = q.due; }
    }
    if (!title) { toast(t('toast.titleRequired')); titleEl.focus(); return; }
    const repeatType = repeat.value;
    if (repeatType !== 'none' && !due) due = todayStr();
    const task = {
      title, dueDate: due, repeatType, progress: 0,
      important: imp.getAttribute('aria-pressed') === 'true',
      anchorDay: due && ['monthly', 'yearly'].includes(repeatType) ? parseDateStr(due).getDate() : null,
    };
    titleEl.value = '';
    $('#add-due').value = '';
    repeat.value = state.settings.defaultRepeatType;
    imp.setAttribute('aria-pressed', 'false'); imp.innerHTML = icon('star');
    form.classList.remove('has-text');
    try { await state.store.add(task); } catch (ex) { reportError(ex); }
    titleEl.focus();
  });
  $('#add-title').addEventListener('input', e => form.classList.toggle('has-text', !!e.target.value));

  // Show date/repeat while the form is in use. Collapse only after a click has
  // finished, so the list does not jump between mouse-down and mouse-up.
  let pointerDown = false;
  let collapseLater = false;
  const collapse = () => { if (!form.contains(document.activeElement) && !$('#add-title').value) form.classList.remove('open'); };
  form.addEventListener('focusin', () => form.classList.add('open'));
  form.addEventListener('focusout', () => setTimeout(() => { if (pointerDown) collapseLater = true; else collapse(); }, 0));
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    if (collapseLater) { collapseLater = false; setTimeout(collapse, 0); }
  }, true);
}

// ── Recurrence ───────────────────────────────────────────────────────────
function runRecurrence() {
  const today = todayStr();
  for (const task of state.tasks) {
    if (!shouldReset(task, today) || state.resetting.has(task.id)) continue;
    state.resetting.add(task.id);
    const dueDate = nextDueDate(task, today);
    state.store.update(task.id, { progress: 0, completedAt: null, dueDate })
      .catch(reportError)
      .finally(() => state.resetting.delete(task.id));
  }
}
// Re-check when the day changes or the app comes back to the foreground.
function checkDayChange() {
  if (!state.store || todayStr() === state.today) return;
  state.today = todayStr();
  runRecurrence();
  queueRender();
}
setInterval(checkDayChange, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });

// ── Task actions ─────────────────────────────────────────────────────────
const byId = id => state.tasks.find(x => x.id === id);

async function setProgress(id, n) {
  const task = byId(id); if (!task) return;
  const cur = task.progress || 0;
  const next = cur >= n ? n - 1 : n;
  const patch = { progress: next, completedAt: next === 3 ? new Date().toISOString() : null };
  try { await state.store.update(id, patch); } catch { return; }
  if (next === 3) onCompleted(task);
}

function onCompleted(task) {
  const s = state.settings;
  confetti(s.confetti, s.accentColor);
  if (s.completionFeedback === 'toast') {
    toast(t('toast.done'), task.repeatType === 'none' ? { action: t('toast.delete'), onAction: () => deleteTask(task.id, { skipConfirm: true }) } : {});
  } else if (s.completionFeedback === 'dialog') {
    const dlg = h('dialog', { class: 'dialog dialog-small' }, h('div', { class: 'dialog-body center' },
      h('div', { class: 'complete-icon', html: icon('check', { size: 34 }) }),
      h('h2', {}, t('complete.title')),
      h('p', { class: 'dialog-text' }, task.title),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-danger-ghost', type: 'button', value: 'delete' }, t('complete.delete')),
        h('button', { class: 'btn btn-primary', type: 'button', value: 'keep' }, t('complete.keep')))));
    dlg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { dlg.close(); if (b.value === 'delete') deleteTask(task.id, { skipConfirm: true }); }
      else if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn-primary').focus();
  }
}

async function toggleImportant(id) {
  const task = byId(id); if (!task) return;
  await state.store.update(id, { important: !task.important }).catch(() => {});
}

async function postpone(id) {
  const task = byId(id); if (!task) return;
  const today = todayStr();
  const base = task.dueDate && task.dueDate >= today ? task.dueDate : today;
  const dueDate = addDays(base, 1);
  await state.store.update(id, { dueDate }).catch(() => {});
}

async function deleteTask(id, { skipConfirm = false } = {}) {
  const s = state.settings;
  if (!skipConfirm && s.confirmDelete && !(await confirmDialog(t('confirm.delete'), { danger: true, yes: t('card.delete') }))) return;
  if (!s.deletionDelay) { await state.store.remove(id).catch(() => {}); return; }
  state.hidden.add(id);
  queueRender();
  const commit = () => {
    if (!state.pendingDeletes.has(id)) return;
    state.pendingDeletes.delete(id);
    state.store.remove(id).catch(() => {}).finally(() => state.hidden.delete(id));
  };
  const handle = toast(t('toast.deleted'), {
    action: t('toast.undo'), duration: 5000,
    onAction: () => { state.pendingDeletes.delete(id); state.hidden.delete(id); queueRender(); },
    onExpire: commit,
  });
  state.pendingDeletes.set(id, { commit, handle });
}
// Leaving the page during the undo window still deletes.
window.addEventListener('pagehide', () => {
  for (const [id] of state.pendingDeletes) state.store.remove(id, { keepalive: true });
  state.pendingDeletes.clear();
});

// ── Edit dialog ──────────────────────────────────────────────────────────
function openEdit(id) {
  const task = byId(id); if (!task) return;
  const dlg = $('#edit');
  const title = h('input', { id: 'edit-title', value: task.title, required: true, maxlength: 500, autocomplete: 'off' });
  const notes = h('textarea', { id: 'edit-notes', rows: 4, maxlength: 5000, placeholder: t('edit.notesPlaceholder') });
  notes.value = task.notes || '';
  const due = h('input', { id: 'edit-due', type: 'date', value: task.dueDate || '' });
  const repeat = h('select', { id: 'edit-repeat' }, REPEAT_TYPES.map(v => h('option', { value: v, selected: v === task.repeatType }, t(`repeat.${v}`))));
  const important = h('button', { id: 'edit-important', class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!task.important) }, h('span', { class: 'switch-thumb' }));
  important.addEventListener('click', () => important.setAttribute('aria-checked', String(important.getAttribute('aria-checked') !== 'true')));
  const form = h('form', { class: 'dialog-body', method: 'dialog' },
    h('h2', {}, t('edit.title')),
    h('label', { class: 'field' }, h('span', {}, t('edit.name')), title),
    h('label', { class: 'field' }, h('span', {}, t('edit.notes')), notes),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, t('edit.due')),
        h('div', { class: 'date-wrap' }, due, h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { due.value = ''; } }, t('edit.clearDate')))),
      h('label', { class: 'field' }, h('span', {}, t('edit.repeat')), repeat)),
    h('div', { class: 'row row-plain' }, h('label', { class: 'row-label', for: 'edit-important' }, h('span', {}, t('edit.important'))), important),
    h('div', { class: 'dialog-actions spread' },
      h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: () => { dlg.close(); deleteTask(id); }, html: `${icon('trash', { size: 16 })}<span>${t('edit.delete')}</span>` }),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, t('edit.cancel')),
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('edit.save')))));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const newTitle = title.value.trim();
    if (!newTitle) { title.focus(); return; }
    let dueDate = isDateStr(due.value) ? due.value : null;
    const repeatType = repeat.value;
    if (repeatType !== 'none' && !dueDate) dueDate = todayStr();
    const patch = {
      title: newTitle, notes: notes.value, dueDate, repeatType,
      important: important.getAttribute('aria-checked') === 'true',
      anchorDay: dueDate && ['monthly', 'yearly'].includes(repeatType) ? parseDateStr(dueDate).getDate() : null,
    };
    dlg.close();
    await state.store.update(id, patch).catch(() => {});
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  title.focus();
}
closeOnBackdrop($('#edit'));

// ── Rendering ────────────────────────────────────────────────────────────
function queueRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    if (drag && drag.isDragging()) { setTimeout(queueRender, 150); return; }
    render();
  });
}

const GROUPS = ['overdue', 'today', 'week', 'later', 'nodate', 'done'];

function groupOf(task, today, eow) {
  if (state.settings.completedLast && task.progress === 3) return 'done';
  if (!task.dueDate) return 'nodate';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= eow) return 'week';
  return 'later';
}

function sortTasks(list) {
  const s = state.settings;
  const lang = getLanguage();
  const cmp = {
    due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt),
    'created-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
    'created-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
    title: (a, b) => a.title.localeCompare(b.title, lang, { sensitivity: 'base' }),
  }[s.sortMode] || ((a, b) => 0);
  let out = [...list].sort(cmp);
  if (s.reverseSortOrder) out.reverse();
  if (state.order) {
    const idx = new Map(state.order.map((id, i) => [id, i]));
    out.sort((a, b) => (idx.get(a.id) ?? Infinity) - (idx.get(b.id) ?? Infinity));
  } else if (s.importantFirst) {
    out.sort((a, b) => Number(b.important) - Number(a.important));
  }
  return out;
}

function dueInfo(task, today) {
  if (!task.dueDate) return null;
  const d = diffDays(today, task.dueDate);
  const s = state.settings;
  const lang = getLanguage();
  let text;
  if (d === 0) text = t('due.today');
  else if (d === 1) text = t('due.tomorrow');
  else if (d < 0) text = d === -1 && task.progress === 3 ? t('due.yesterday') : t('due.overdue', { n: -d });
  else if (d < 7) text = parseDateStr(task.dueDate).toLocaleDateString(lang, { weekday: 'short' });
  else text = formatDate(task.dueDate, parseDateStr(task.dueDate).getFullYear() !== parseDateStr(today).getFullYear());
  let cls = '';
  if (task.progress === 3) cls = '';
  else if (d < 0) cls = 'late';
  else if (d === 0) cls = 'today';
  else if (d <= s.dueDateWarningDays) cls = 'soon';
  return { text, cls, title: formatDate(task.dueDate, true) };
}

function formatDate(str, withYear = true) {
  if (state.settings.dateFormat === 'iso') return withYear ? str : str.slice(5);
  return parseDateStr(str).toLocaleDateString(getLanguage() === 'de' ? 'de-DE' : 'en-GB',
    withYear ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: '2-digit', month: '2-digit' });
}

function renderCard(task, today) {
  const s = state.settings;
  const p = task.progress || 0;
  const due = dueInfo(task, today);
  const isNew = !state.seen.has(task.id);
  state.seen.add(task.id);
  const prev = state.lastProgress.get(task.id);
  state.lastProgress.set(task.id, p);
  const popBox = prev !== undefined && p > prev ? p : 0;
  const card = h('article', {
    class: ['card', task.important && 'important', p === 3 && 'complete', due && due.cls === 'late' && 'overdue', isNew && 'enter'].filter(Boolean).join(' '),
    dataset: { id: task.id },
  });

  const head = h('div', { class: 'card-head' },
    h('button', { class: 'card-title', type: 'button', dataset: { act: 'edit' }, title: t('card.edit') }, task.title),
    due ? h('span', { class: `due ${due.cls}`, title: due.title }, due.text) : null,
    h('button', {
      class: `star${task.important ? ' on' : ''}`, type: 'button', dataset: { act: 'star' },
      'aria-pressed': String(!!task.important), 'aria-label': task.important ? t('card.unmarkImportant') : t('card.markImportant'),
      title: task.important ? t('card.unmarkImportant') : t('card.markImportant'),
      html: icon('star', { filled: task.important }),
    }));
  card.append(head);

  if (task.notes && task.notes.trim()) card.append(h('p', { class: 'card-notes' }, task.notes.trim().split('\n')[0]));

  const pct = Math.round((p / 3) * 100);
  const hex = ['0x00', '0x55', '0xAA', '0xFF'][p];
  card.append(h('div', { class: `progress-text${p === 3 ? ' complete' : ''}${s.hexProgress ? ' mono' : ''}` },
    p === 3 ? (s.hexProgress ? `0xFF · ${t('card.complete')}` : t('card.complete')) : (s.hexProgress ? hex : t('card.progress', { p: pct }))));

  if (s.progressStyle === 'bar') {
    const bar = h('div', { class: 'bar', role: 'group', 'aria-label': t('card.progress', { p: pct }) },
      h('div', { class: 'bar-fill', style: `width:${pct}%` }),
      ...[1, 2, 3].map(n => h('button', { class: 'bar-hit', type: 'button', dataset: { act: 'box', n }, 'aria-label': t('card.step', { n }), 'aria-pressed': String(p >= n) })));
    card.append(bar);
  } else {
    card.append(h('div', { class: 'boxes', role: 'group', 'aria-label': t('card.progress', { p: pct }) },
      [1, 2, 3].map(n => h('button', { class: `box${p >= n ? ' f' : ''}${n === popBox ? ' pop' : ''}`, type: 'button', dataset: { act: 'box', n }, 'aria-label': t('card.step', { n }), 'aria-pressed': String(p >= n) }))));
  }

  const foot = h('div', { class: 'card-foot' });
  if (task.repeatType !== 'none') foot.append(h('span', { class: 'repeat-badge', html: `${icon('repeat', { size: 14 })}<span>${t(`repeat.${task.repeatType}`)}</span>` }));
  if (p < 3) foot.append(h('button', { class: 'postpone', type: 'button', dataset: { act: 'postpone' }, html: `${icon('forward', { size: 14 })}<span>${t('card.postpone')}</span>` }));
  foot.append(h('span', { class: 'spacer' }));
  foot.append(h('button', { class: `del${p === 3 ? ' visible' : ''}`, type: 'button', dataset: { act: 'delete' }, 'aria-label': t('card.delete'), title: t('card.delete'), html: icon('trash', { size: 16 }) }));
  card.append(foot);

  const day = iso => formatDate(toDateStr(new Date(iso)));
  card.append(h('div', { class: 'stamps' },
    h('span', { class: 'stamp-created' }, t('card.created', { d: day(task.createdAt) })),
    h('span', { class: 'stamp-updated' }, t('card.updated', { d: day(task.updatedAt) }))));
  return card;
}

function render() {
  const list = $('#list');
  const s = state.settings;
  const today = todayStr();
  const eow = endOfWeek(today, s.firstDayOfWeek);
  const visible = state.tasks.filter(x => !state.hidden.has(x.id));

  // Remember focus so keyboard users stay on the same control after a re-render.
  const a = document.activeElement;
  const focusKey = a && list.contains(a) && a.closest('.card') ? { id: a.closest('.card').dataset.id, act: a.dataset.act, n: a.dataset.n } : null;

  const count = visible.filter(x => x.progress < 3).length;
  const countEl = $('#task-count');
  countEl.hidden = !s.showTaskCount;
  countEl.textContent = String(count);
  const greet = $('#greeting');
  greet.hidden = !(s.showGreeting && state.user);
  if (state.user) greet.textContent = t('greeting', { name: state.user.name });

  $('#order-bar').hidden = !state.order;

  if (!visible.length) {
    const kids = [h('p', { class: 'empty-title' }, t('empty.title')), h('p', {}, t('empty.text'))];
    if (state.store.kind === 'local' && !state.tasks.length) kids.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: loadSamples }, t('empty.sample')));
    list.replaceChildren(h('div', { class: 'empty' }, h('img', { src: 'icons/mark.svg', alt: '', class: 'empty-mark' }), ...kids));
    state.firstRender = false;
    return;
  }

  const keyFor = task => s.showGroupHeaders ? groupOf(task, today, eow) : (s.completedLast && task.progress === 3 ? 'done' : 'all');
  const groups = new Map((s.showGroupHeaders ? GROUPS : ['all', 'done']).map(g => [g, []]));
  for (const task of visible) groups.get(keyFor(task)).push(task);

  const frag = document.createDocumentFragment();
  for (const [name, tasks] of groups) {
    if (!tasks.length) continue;
    const section = h('section', { class: `group group-${name}`, 'aria-label': t(`group.${name}`) });
    section.append(h('h2', { class: 'group-head' }, h('span', {}, t(`group.${name}`)), h('span', { class: 'group-count' }, String(tasks.length))));
    const ul = h('div', { class: 'group-list', dataset: { group: name } });
    for (const task of sortTasks(tasks)) ul.append(renderCard(task, today));
    section.append(ul);
    frag.append(section);
  }
  list.replaceChildren(frag);
  state.firstRender = false;

  if (focusKey) {
    const sel = `.card[data-id="${CSS.escape(focusKey.id)}"] [data-act="${focusKey.act}"]${focusKey.n ? `[data-n="${focusKey.n}"]` : ''}`;
    list.querySelector(sel)?.focus();
  }
}

$('#list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'box') setProgress(id, Number(btn.dataset.n));
  else if (act === 'star') toggleImportant(id);
  else if (act === 'postpone') postpone(id);
  else if (act === 'delete') deleteTask(id);
  else if (act === 'edit') openEdit(id);
});

function saveOrderFromDom() {
  state.order = [...$('#list').querySelectorAll('.card')].map(c => c.dataset.id);
  $('#order-bar').hidden = false;
  state.store.savePrefs({ order: state.order }).catch(reportError);
}

$('#order-reset').addEventListener('click', () => {
  state.order = null;
  state.store.savePrefs({ order: null }).catch(reportError);
  queueRender();
});

async function loadSamples() {
  const today = todayStr();
  const de = getLanguage() === 'de';
  const samples = [
    { title: de ? 'Steuerunterlagen an die Kanzlei schicken' : 'Send tax documents to the accountant', dueDate: addDays(today, -2), progress: 1, important: true },
    { title: de ? 'Server-Backup prüfen' : 'Check the server backup', dueDate: addDays(today, 1), progress: 2, repeatType: 'weekly' },
    { title: de ? 'Wasser für die Pflanzen' : 'Water the plants', dueDate: today, progress: 0, repeatType: 'every3days' },
    { title: de ? 'Zahnarzttermin ausmachen' : 'Book a dentist appointment', dueDate: null, progress: 0, notes: de ? 'Praxis hat Mo–Do bis 18 Uhr offen.' : 'Open Mon–Thu until 6 pm.' },
    { title: de ? 'Geschenk für Lea besorgen' : 'Get a present for Lea', dueDate: addDays(today, 20), progress: 0 },
    { title: de ? 'Wäsche abholen' : 'Pick up the laundry', dueDate: today, progress: 3, completedAt: new Date().toISOString() },
  ];
  await state.store.importTasks(samples.map(x => ({ repeatType: 'none', notes: '', ...x })));
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('dialog[open]')) return;
  if (e.key === 'n' || e.key === '/') { e.preventDefault(); $('#add-title')?.focus(); }
});

// ── Service worker (offline + installable) ───────────────────────────────
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
