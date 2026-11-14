// Settings: defaults, the schema that drives the settings sheet, migration of
// pre-2.0 settings, and applying settings to the document.
import { setLanguage } from './i18n.js';

export const SETTINGS_VERSION = 2;

export const DEFAULTS = {
  v: SETTINGS_VERSION,
  // Look
  theme: 'dark',
  accentColor: '#34E39A',
  fontFamily: 'Archivo',
  fontSize: 16,
  cardRadius: 16,
  borderWidth: 1,
  borderStyle: 'solid',
  cardBackground: 'default',
  backgroundPattern: 'none',
  animationSpeed: 'auto',
  // Cards
  progressStyle: 'boxes',
  progressBoxShape: 'rounded',
  filledBoxSymbol: '✓',
  showProgressText: false,
  showDueBadge: true,
  showRepeatBadge: true,
  showPostponeBtn: true,
  showCreatedDate: false,
  showLastUpdated: false,
  showNotesPreview: true,
  cardSpacing: 10,
  taskTitleSize: 16,
  compactMode: false,
  urgentRedTint: false,
  cardEntryAnim: 'fade',
  // Behavior
  language: 'auto',
  dateFormat: 'auto',
  firstDayOfWeek: 'monday',
  defaultRepeatType: 'none',
  sortMode: 'due',
  reverseSortOrder: false,
  importantFirst: true,
  completedLast: true,
  showGroupHeaders: true,
  sectionCountBadge: true,
  showTaskCount: false,
  showGreeting: false,
  confirmDelete: false,
  deletionDelay: true,
  completionFeedback: 'toast',
  confetti: 'small',
  dueDateWarningDays: 2,
  vibrationFeedback: true,
  smartInput: true,
  // Extras
  accentGlow: 'off',
  cardGlow: false,
  hoverLift: false,
  neonGlow: false,
  importantStyle: 'ring',
  importantPulseSpeed: 'medium',
  urgentBlink: false,
  glassmorphism: false,
  cardTiltOnHover: false,
  scanlines: false,
  matrixBg: false,
  hexProgress: false,
  focusMode: false,
};

// Defaults of the 1.x app. Stored values equal to these were never chosen by the
// user, so they are dropped during migration and the calmer 2.0 defaults apply.
const OLD_DEFAULTS = {
  fontFamily: 'Exo 2', accentColor: '#00ff88', fontSize: 16, cardRadius: 20, borderWidth: 2,
  cardBackground: 'jet', animationSpeed: 'normal', backgroundPattern: 'none', cardGlow: true,
  hoverLift: true, showProgressText: true, progressStyle: 'boxes', showRepeatBadge: true,
  showPostponeBtn: true, showDueBadge: true, cardSpacing: 16, taskTitleSize: 20,
  showCreatedDate: false, urgentRedTint: false, confirmDelete: true, showConfetti: true,
  dateFormat: 'de', showTaskCount: false, defaultRepeatType: 'none', crossDragDefault: false,
  autoSortNew: false, firstDayOfWeek: 'monday', focusMode: false, compactMode: false,
  reverseSortOrder: false, glassmorphism: false, sectionCountBadge: false, hexProgress: false,
  matrixBg: false, showLastUpdated: false, borderStyle: 'solid', progressBoxShape: 'rounded',
  neonGlow: false, scanlines: false, accentGlow: 'normal', cardTiltOnHover: false,
  filledBoxSymbol: '✓', urgentBlink: false, importantPulseSpeed: 'medium', cardEntryAnim: 'pop',
  deletionDelay: false, vibrationFeedback: true, dueDateWarningDays: 3,
};

export function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  let s = { ...raw };
  if (!s.v) {
    for (const [k, v] of Object.entries(OLD_DEFAULTS)) if (s[k] === v) delete s[k];
    if ('showConfetti' in s) s.confetti = s.showConfetti ? 'big' : 'off';
    if (s.autoSortNew) s.sortMode = 'created-desc';
    if (s.dateFormat === 'de') s.dateFormat = 'auto';
    if (s.cardBackground && !['default', 'deep', 'raised'].includes(s.cardBackground)) {
      s.cardBackground = s.cardBackground === 'deep' || s.cardBackground === 'jet' ? 'deep' : 'raised';
    }
    if (s.fontFamily === 'Nasalization') s.fontFamily = 'Orbitron';
    if (s.accentGlow === 'normal') s.accentGlow = 'dim';
    if (s.importantPulseSpeed && !('importantStyle' in s)) s.importantStyle = 'pulse';
    delete s.showConfetti; delete s.autoSortNew; delete s.crossDragDefault;
  }
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in s && typeof s[k] === typeof DEFAULTS[k]) out[k] = s[k];
  if (!/^#[0-9a-f]{6}$/i.test(out.accentColor)) out.accentColor = DEFAULTS.accentColor;
  out.v = SETTINGS_VERSION;
  return out;
}

const L = (de, en) => ({ de, en });
const opt = (value, de, en) => ({ value, label: L(de, en ?? de) });
export const FONTS = ['Archivo', 'Inter', 'Exo 2', 'Orbitron', 'Audiowide', 'Rajdhani', 'JetBrains Mono', 'Share Tech Mono', 'VT323', 'Press Start 2P', 'System'];
const MONO = new Set(['JetBrains Mono', 'Share Tech Mono', 'VT323', 'Press Start 2P']);
export const ACCENT_PRESETS = ['#34E39A', '#00FF88', '#4CC2FF', '#9B8CFF', '#FF8A4C', '#FFD23F', '#FF5C8A', '#E6ECE7'];

// The settings sheet is generated from this list.
export const SCHEMA = [
  // ── Look
  { tab: 'look', group: 'grp.theme', key: 'theme', type: 'select', label: L('Modus', 'Mode'),
    options: [opt('dark', 'Dunkel', 'Dark'), opt('light', 'Hell', 'Light'), opt('system', 'Wie das System', 'Follow system')] },
  { tab: 'look', group: 'grp.theme', key: 'accentColor', type: 'color', label: L('Akzentfarbe', 'Accent color'),
    hint: L('Färbt Fortschritt, Buttons und Haken.', 'Colors progress, buttons and checks.') },
  { tab: 'look', group: 'grp.theme', key: 'backgroundPattern', type: 'select', label: L('Hintergrund', 'Background'),
    options: [opt('none', 'Schlicht', 'Plain'), opt('dots', 'Punkte', 'Dots'), opt('grid', 'Raster', 'Grid')] },
  { tab: 'look', group: 'grp.type', key: 'fontFamily', type: 'select', label: L('Schriftart', 'Font'),
    options: FONTS.map(f => opt(f, f === 'Archivo' ? 'Archivo (Standard)' : f === 'System' ? 'Systemschrift' : f, f === 'Archivo' ? 'Archivo (default)' : f === 'System' ? 'System font' : f)) },
  { tab: 'look', group: 'grp.type', key: 'fontSize', type: 'range', label: L('Schriftgröße', 'Text size'), min: 13, max: 20, step: 1, unit: 'px' },
  { tab: 'look', group: 'grp.shape', key: 'cardRadius', type: 'range', label: L('Eckenradius', 'Corner radius'), min: 0, max: 28, step: 2, unit: 'px' },
  { tab: 'look', group: 'grp.shape', key: 'borderWidth', type: 'range', label: L('Rahmenstärke', 'Border width'), min: 0, max: 4, step: 1, unit: 'px' },
  { tab: 'look', group: 'grp.shape', key: 'borderStyle', type: 'select', label: L('Rahmenstil', 'Border style'),
    options: [opt('solid', 'Durchgehend', 'Solid'), opt('dashed', 'Gestrichelt', 'Dashed'), opt('double', 'Doppelt', 'Double')] },
  { tab: 'look', group: 'grp.shape', key: 'cardBackground', type: 'select', label: L('Kartenfläche', 'Card surface'),
    options: [opt('default', 'Standard', 'Default'), opt('deep', 'Tiefer', 'Deeper'), opt('raised', 'Heller', 'Lighter')] },
  { tab: 'look', group: 'grp.motion', key: 'animationSpeed', type: 'select', label: L('Animationen', 'Animations'),
    hint: L('„Automatisch“ folgt der Systemeinstellung für reduzierte Bewegung.', '"Automatic" follows the system reduced-motion setting.'),
    options: [opt('auto', 'Automatisch', 'Automatic'), opt('normal', 'Normal'), opt('slow', 'Langsam', 'Slow'), opt('fast', 'Schnell', 'Fast'), opt('off', 'Aus', 'Off')] },
  { tab: 'look', group: 'grp.motion', key: 'cardEntryAnim', type: 'select', label: L('Neue Karten erscheinen', 'New cards appear'),
    options: [opt('fade', 'Einblenden', 'Fade'), opt('pop', 'Pop'), opt('slide', 'Hereingleiten', 'Slide'), opt('none', 'Sofort', 'Instantly')] },

  // ── Cards
  { tab: 'cards', group: 'grp.progress', key: 'progressStyle', type: 'select', label: L('Fortschritt als', 'Progress as'),
    options: [opt('boxes', 'Drei Kästchen', 'Three boxes'), opt('bar', 'Balken', 'Bar')] },
  { tab: 'cards', group: 'grp.progress', key: 'progressBoxShape', type: 'select', label: L('Kästchenform', 'Box shape'),
    options: [opt('rounded', 'Abgerundet', 'Rounded'), opt('square', 'Eckig', 'Square'), opt('pill', 'Pille', 'Pill')] },
  { tab: 'cards', group: 'grp.progress', key: 'filledBoxSymbol', type: 'select', label: L('Symbol in vollen Kästchen', 'Symbol in filled boxes'),
    options: [opt('✓', '✓ Haken', '✓ Check'), opt('', 'Keins', 'None'), opt('●', '● Punkt', '● Dot'), opt('★', '★ Stern', '★ Star'), opt('✦', '✦ Funke', '✦ Spark'), opt('▓', '▓ Block'), opt('⚡', '⚡ Blitz', '⚡ Bolt')] },
  { tab: 'cards', group: 'grp.progress', key: 'showProgressText', type: 'toggle', label: L('Prozent anzeigen', 'Show percentage') },
  { tab: 'cards', group: 'grp.badges', key: 'showDueBadge', type: 'toggle', label: L('Fälligkeit', 'Due date') },
  { tab: 'cards', group: 'grp.badges', key: 'showRepeatBadge', type: 'toggle', label: L('Wiederholung', 'Repeat') },
  { tab: 'cards', group: 'grp.badges', key: 'showPostponeBtn', type: 'toggle', label: L('„+1 Tag“-Button', '"+1 day" button') },
  { tab: 'cards', group: 'grp.badges', key: 'showNotesPreview', type: 'toggle', label: L('Notiz-Vorschau', 'Note preview') },
  { tab: 'cards', group: 'grp.badges', key: 'showCreatedDate', type: 'toggle', label: L('Erstelldatum', 'Created date') },
  { tab: 'cards', group: 'grp.badges', key: 'showLastUpdated', type: 'toggle', label: L('Zuletzt bearbeitet', 'Last edited') },
  { tab: 'cards', group: 'grp.badges', key: 'urgentRedTint', type: 'toggle', label: L('Überfällige rot tönen', 'Tint overdue red') },
  { tab: 'cards', group: 'grp.layout', key: 'compactMode', type: 'toggle', label: L('Kompakt', 'Compact') },
  { tab: 'cards', group: 'grp.layout', key: 'cardSpacing', type: 'range', label: L('Abstand', 'Spacing'), min: 4, max: 24, step: 2, unit: 'px' },
  { tab: 'cards', group: 'grp.layout', key: 'taskTitleSize', type: 'range', label: L('Titelgröße', 'Title size'), min: 14, max: 26, step: 1, unit: 'px' },

  // ── Behavior
  { tab: 'behavior', group: 'grp.language', key: 'language', type: 'select', label: L('Sprache', 'Language'),
    options: [opt('auto', 'Automatisch', 'Automatic'), opt('de', 'Deutsch'), opt('en', 'English')] },
  { tab: 'behavior', group: 'grp.language', key: 'dateFormat', type: 'select', label: L('Datumsformat', 'Date format'),
    options: [opt('auto', 'Nach Sprache', 'By language'), opt('iso', 'ISO (2026-11-17)')] },
  { tab: 'behavior', group: 'grp.language', key: 'firstDayOfWeek', type: 'select', label: L('Woche beginnt am', 'Week starts on'),
    hint: L('Bestimmt, was „Diese Woche“ umfasst.', 'Decides what "This week" covers.'),
    options: [opt('monday', 'Montag', 'Monday'), opt('sunday', 'Sonntag', 'Sunday'), opt('saturday', 'Samstag', 'Saturday')] },
  { tab: 'behavior', group: 'grp.sorting', key: 'sortMode', type: 'select', label: L('Sortieren nach', 'Sort by'),
    options: [opt('due', 'Fälligkeit', 'Due date'), opt('created-desc', 'Neueste zuerst', 'Newest first'), opt('created-asc', 'Älteste zuerst', 'Oldest first'), opt('title', 'Titel A–Z', 'Title A–Z')] },
  { tab: 'behavior', group: 'grp.sorting', key: 'reverseSortOrder', type: 'toggle', label: L('Umkehren', 'Reverse') },
  { tab: 'behavior', group: 'grp.sorting', key: 'importantFirst', type: 'toggle', label: L('Wichtige zuerst', 'Important first') },
  { tab: 'behavior', group: 'grp.sorting', key: 'completedLast', type: 'toggle', label: L('Erledigte ans Ende', 'Completed last') },
  { tab: 'behavior', group: 'grp.sorting', key: 'showGroupHeaders', type: 'toggle', label: L('Nach Fälligkeit gruppieren', 'Group by due date') },
  { tab: 'behavior', group: 'grp.sorting', key: 'sectionCountBadge', type: 'toggle', label: L('Anzahl pro Gruppe', 'Count per group') },
  { tab: 'behavior', group: 'grp.sorting', key: 'showTaskCount', type: 'toggle', label: L('Gesamtzahl im Kopf', 'Total in header') },
  { tab: 'behavior', group: 'grp.sorting', key: 'showGreeting', type: 'toggle', label: L('Begrüßung mit Namen', 'Greeting with name') },
  { tab: 'behavior', group: 'grp.input', key: 'defaultRepeatType', type: 'select', label: L('Standard-Wiederholung', 'Default repeat'), options: 'repeat' },
  { tab: 'behavior', group: 'grp.input', key: 'smartInput', type: 'toggle', label: L('„heute“ / „morgen“ erkennen', 'Detect "today" / "tomorrow"') },
  { tab: 'behavior', group: 'grp.input', key: 'dueDateWarningDays', type: 'range', label: L('Gelb ab … Tagen vorher', 'Yellow … days ahead'), min: 0, max: 14, step: 1, unit: 'd' },
  { tab: 'behavior', group: 'grp.actions', key: 'completionFeedback', type: 'select', label: L('Beim Erledigen', 'When completing'),
    options: [opt('toast', 'Kurze Meldung', 'Short notice'), opt('dialog', 'Dialog mit Löschen', 'Dialog with delete'), opt('none', 'Nichts', 'Nothing')] },
  { tab: 'behavior', group: 'grp.actions', key: 'confetti', type: 'select', label: L('Konfetti', 'Confetti'),
    options: [opt('off', 'Aus', 'Off'), opt('small', 'Ein bisschen', 'A little'), opt('big', 'Party')] },
  { tab: 'behavior', group: 'grp.actions', key: 'deletionDelay', type: 'toggle', label: L('Löschen rückgängig machen', 'Undo delete'),
    hint: L('Gelöschte Aufgaben 5 Sekunden lang wiederherstellbar.', 'Deleted tasks can be restored for 5 seconds.') },
  { tab: 'behavior', group: 'grp.actions', key: 'confirmDelete', type: 'toggle', label: L('Löschen bestätigen', 'Confirm delete') },
  { tab: 'behavior', group: 'grp.actions', key: 'vibrationFeedback', type: 'toggle', label: L('Vibration beim Ziehen', 'Vibrate on drag') },

  // ── Extras
  { tab: 'extras', group: 'grp.glow', key: 'accentGlow', type: 'select', label: L('Leuchten', 'Glow'),
    options: [opt('off', 'Aus', 'Off'), opt('dim', 'Dezent', 'Subtle'), opt('intense', 'Intensiv', 'Intense')] },
  { tab: 'extras', group: 'grp.glow', key: 'cardGlow', type: 'toggle', label: L('Karten leuchten beim Hover', 'Cards glow on hover') },
  { tab: 'extras', group: 'grp.glow', key: 'hoverLift', type: 'toggle', label: L('Karten heben sich beim Hover', 'Cards lift on hover') },
  { tab: 'extras', group: 'grp.glow', key: 'neonGlow', type: 'toggle', label: L('Neon-Schrift', 'Neon text') },
  { tab: 'extras', group: 'grp.toys', key: 'importantStyle', type: 'select', label: L('Wichtige Aufgaben', 'Important tasks'),
    options: [opt('ring', 'Feiner Rand', 'Fine ring'), opt('pulse', 'Pulsierender Rahmen', 'Pulsing frame')] },
  { tab: 'extras', group: 'grp.toys', key: 'importantPulseSpeed', type: 'select', label: L('Pulstempo', 'Pulse speed'),
    options: [opt('slow', 'Langsam', 'Slow'), opt('medium', 'Mittel', 'Medium'), opt('fast', 'Schnell', 'Fast')] },
  { tab: 'extras', group: 'grp.toys', key: 'urgentBlink', type: 'toggle', label: L('Überfällige blinken', 'Overdue blink') },
  { tab: 'extras', group: 'grp.toys', key: 'glassmorphism', type: 'toggle', label: L('Glas-Karten', 'Glass cards') },
  { tab: 'extras', group: 'grp.toys', key: 'cardTiltOnHover', type: 'toggle', label: L('3D-Kippen beim Hover', '3D tilt on hover') },
  { tab: 'extras', group: 'grp.toys', key: 'focusMode', type: 'toggle', label: L('Fokus: Erledigte abdunkeln', 'Focus: dim completed') },
  { tab: 'extras', group: 'grp.nerd', key: 'scanlines', type: 'toggle', label: L('CRT-Scanlines', 'CRT scanlines') },
  { tab: 'extras', group: 'grp.nerd', key: 'matrixBg', type: 'toggle', label: L('Matrix-Regen', 'Matrix rain') },
  { tab: 'extras', group: 'grp.nerd', key: 'hexProgress', type: 'toggle', label: L('Fortschritt in Hex', 'Progress in hex'), hint: L('0x00 · 0x55 · 0xAA · 0xFF', '0x00 · 0x55 · 0xAA · 0xFF') },
];

const CARD_BG = { default: 'var(--surface)', deep: 'var(--bg)', raised: 'var(--raise)' };
const PULSE = { slow: '3.5s', medium: '2s', fast: '0.9s' };
const SHAPE = { rounded: '9px', square: '2px', pill: '999px' };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function resolvedTheme(s) {
  return s.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : s.theme;
}

export function onSystemChange(cb) {
  systemDark.addEventListener('change', cb);
  reducedMotion.addEventListener('change', cb);
}

export function applySettings(s) {
  const root = document.documentElement;
  const body = document.body;
  setLanguage(s.language);
  root.dataset.theme = resolvedTheme(s);
  root.style.setProperty('--accent', s.accentColor);
  root.style.setProperty('--on-accent', luminance(s.accentColor) > 0.35 ? '#0A0D0B' : '#FFFFFF');
  const font = s.fontFamily === 'System' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    : `'${s.fontFamily}', ${MONO.has(s.fontFamily) ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;
  root.style.setProperty('--font-ui', font);
  root.style.setProperty('--font-size', `${s.fontSize}px`);
  root.style.setProperty('--radius', `${s.cardRadius}px`);
  root.style.setProperty('--border-w', `${s.borderWidth}px`);
  root.style.setProperty('--border-style', s.borderStyle);
  root.style.setProperty('--card-bg', CARD_BG[s.cardBackground] || CARD_BG.default);
  root.style.setProperty('--gap', `${s.cardSpacing}px`);
  root.style.setProperty('--title-size', `${s.taskTitleSize}px`);
  root.style.setProperty('--box-radius', SHAPE[s.progressBoxShape] || SHAPE.rounded);
  root.style.setProperty('--filled-symbol', JSON.stringify(s.filledBoxSymbol || ''));
  root.style.setProperty('--pulse', PULSE[s.importantPulseSpeed] || PULSE.medium);

  const motion = s.animationSpeed === 'auto' ? (reducedMotion.matches ? 'off' : 'normal') : s.animationSpeed;
  const flags = {
    'no-progress-text': !s.showProgressText,
    'no-due-badge': !s.showDueBadge,
    'no-repeat-badge': !s.showRepeatBadge,
    'no-postpone': !s.showPostponeBtn,
    'no-notes': !s.showNotesPreview,
    'show-created': s.showCreatedDate,
    'show-updated': s.showLastUpdated,
    'urgent-red': s.urgentRedTint,
    compact: s.compactMode,
    'hover-lift': s.hoverLift,
    'card-glow': s.cardGlow,
    neon: s.neonGlow,
    'important-pulse': s.importantStyle === 'pulse',
    'urgent-blink': s.urgentBlink,
    glass: s.glassmorphism,
    tilt: s.cardTiltOnHover,
    scanlines: s.scanlines,
    matrix: s.matrixBg,
    'focus-mode': s.focusMode,
    'no-group-headers': !s.showGroupHeaders,
    'no-group-count': !s.sectionCountBadge,
  };
  for (const [k, on] of Object.entries(flags)) body.classList.toggle(`pref-${k}`, !!on);
  for (const [prefix, value] of [['bg', s.backgroundPattern], ['anim', motion], ['glow', s.accentGlow], ['entry', s.cardEntryAnim]]) {
    for (const c of [...body.classList]) if (c.startsWith(`pref-${prefix}-`)) body.classList.remove(c);
    body.classList.add(`pref-${prefix}-${value}`);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = root.dataset.theme === 'light' ? '#F3F5F2' : '#0A0D0B';
}
