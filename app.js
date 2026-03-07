// Firebase v9 SDK imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, GithubAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCgi8dyIlFlb_CVKOexWF5Hj28PviYqKqg",
    authDomain: "tasks-4182a.firebaseapp.com",
    projectId: "tasks-4182a",
    storageBucket: "tasks-4182a.firebasestorage.app",
    messagingSenderId: "693923101612",
    appId: "1:693923101612:web:c63d4c194056746b74d809"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GithubAuthProvider();

// DOM Elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const lockBtn = document.getElementById('lock-btn');
const userNameSpan = document.getElementById('user-name');
const addTaskBtn = document.getElementById('add-task-btn');
const tasksContainer = document.getElementById('tasks-container');

// Current user
let currentUser = null;
let unsubscribeSnapshot = null;

// ── Display state ──────────────────────────────────────────────────────────
// null = chronological order; object = per-section custom order
let customOrder = null;
// Cache of latest tasks array for re-sorting
let currentTasksCache = [];
// Drag state
let dragState = { element: null, section: null, placeholder: null };

// ── Cross-category drag lock ───────────────────────────────────────────────
// true  = tasks can only be reordered within their own category (default)
// false = tasks may be dragged across category boundaries
let crossCategoryDragLocked = true;

// ── Long-press / touch drag constants & state ─────────────────────────────
const LONG_PRESS_MS = 750;
const SCROLL_ZONE_PX = 80;
const SCROLL_MAX_SPEED = 12;
let compactDrag = { element: null, section: null, placeholder: null };

// ── Settings ──────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    // Appearance
    fontFamily: 'Exo 2',
    accentColor: '#00ff88',
    fontSize: 16,
    cardRadius: 20,
    borderWidth: 2,
    cardBackground: 'jet',
    animationSpeed: 'normal',
    backgroundPattern: 'none',
    cardGlow: true,
    hoverLift: true,
    // Cards
    showProgressText: true,
    progressStyle: 'boxes',
    showRepeatBadge: true,
    showPostponeBtn: true,
    showDueBadge: true,
    cardSpacing: 16,
    taskTitleSize: 20,
    showCreatedDate: false,
    urgentRedTint: false,
    // Behavior
    confirmDelete: true,
    showConfetti: true,
    dateFormat: 'de',
    showTaskCount: false,
    defaultRepeatType: 'none',
    crossDragDefault: false,
    autoSortNew: false,
    firstDayOfWeek: 'monday',
    // Labs
    focusMode: false,
    compactMode: false,
    reverseSortOrder: false,
    glassmorphism: false,
    sectionCountBadge: false,
    hexProgress: false,
    matrixBg: false,
    showLastUpdated: false,
    // Appearance extras
    borderStyle: 'solid',
    progressBoxShape: 'rounded',
    neonGlow: false,
    scanlines: false,
    accentGlow: 'normal',
    cardTiltOnHover: false,
    // Cards extras
    filledBoxSymbol: '✓',
    urgentBlink: false,
    importantPulseSpeed: 'medium',
    cardEntryAnim: 'pop',
    // Behavior extras
    deletionDelay: false,
    vibrationFeedback: true,
    dueDateWarningDays: 3,
};
let currentSettings = { ...DEFAULT_SETTINGS };

// ── iOS / iPadOS: block overscroll & zoom ─────────────────────────────────
// Prevent pinch-zoom gesture events (Safari-specific)
['gesturestart', 'gesturechange', 'gestureend'].forEach(evt => {
    document.addEventListener(evt, e => e.preventDefault(), { passive: false });
});

// Prevent rubber-band / overscroll bounce at scroll boundaries (older iOS)
let _prevTouchY = 0;
document.addEventListener('touchstart', e => {
    _prevTouchY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', e => {
    // Never block while a card is being dragged
    if (dragState.element || compactDrag.element) return;

    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const deltaY = e.touches[0].clientY - _prevTouchY;

    // Prevent only when already at top (pulling down) or at bottom (pulling up)
    if ((scrollY <= 0 && deltaY > 0) || (scrollY >= maxScroll && deltaY < 0)) {
        e.preventDefault();
    }
    _prevTouchY = e.touches[0].clientY;
}, { passive: false });

// ── Login ──────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        console.log('Login successful:', result.user.displayName);
    } catch (error) {
        console.error('Login error:', error);
        alert('Login fehlgeschlagen: ' + error.message);
    }
});

// Logout
logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        currentSettings = { ...DEFAULT_SETTINGS };
        applySettings(currentSettings);
        console.log('Logout successful');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Lock / unlock cross-category dragging
lockBtn.addEventListener('click', () => {
    crossCategoryDragLocked = !crossCategoryDragLocked;
    const icon = lockBtn.querySelector('.material-symbols-outlined');
    icon.textContent = crossCategoryDragLocked ? 'lock' : 'lock_open';
    lockBtn.classList.toggle('unlocked', !crossCategoryDragLocked);
    lockBtn.title = crossCategoryDragLocked ? 'Drag-Kategorien sperren' : 'Drag-Kategorien entsperrt';
});

// Auth state observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginContainer.style.display = 'none';
        appContainer.classList.add('active');
        userNameSpan.textContent = user.displayName || user.email || 'User';
        await loadSettings(user.uid);
        await loadCustomOrder(user.uid);
        loadTasks(user.uid);
        initSettingsModal();
    } else {
        currentUser = null;
        loginContainer.style.display = 'block';
        appContainer.classList.remove('active');
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
    }
});

// ── Add new task ───────────────────────────────────────────────────────────
addTaskBtn.addEventListener('click', async () => {
    const title = document.getElementById('task-title').value.trim();
    const dueDate = document.getElementById('task-due').value;
    const repeatType = document.getElementById('task-repeat').value;

    if (!title) {
        alert('Bitte gib einen Titel ein!');
        return;
    }
    if (!currentUser) {
        alert('Du musst eingeloggt sein!');
        return;
    }

    try {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const taskRef = doc(db, `users/${currentUser.uid}/tasks/${taskId}`);

        await setDoc(taskRef, {
            title,
            dueDate: dueDate || null,
            progress: 0,
            repeatType,
            nextDueDate: dueDate || null,
            important: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        document.getElementById('task-title').value = '';
        document.getElementById('task-due').value = '';
        document.getElementById('task-repeat').value = 'none';

        console.log('Task added successfully');
    } catch (error) {
        console.error('Error adding task:', error);
        alert('Fehler beim Hinzufügen der Aufgabe: ' + error.message);
    }
});

// ── Settings helpers ───────────────────────────────────────────────────────
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

const CARD_BG_MAP = { jet: '#0a0a0a', dark: '#111111', deep: '#050505', charcoal: '#141414' };
const FONT_STACK_MAP = {
    'Exo 2': "'Exo 2', sans-serif",
    'Orbitron': "'Orbitron', sans-serif",
    'Audiowide': "'Audiowide', sans-serif",
    'Nasalization': "'Nasalization', sans-serif",
    'Rajdhani': "'Rajdhani', sans-serif",
    'Inter': "'Inter', sans-serif",
    'Share Tech Mono': "'Share Tech Mono', monospace",
    'JetBrains Mono': "'JetBrains Mono', monospace",
    'Press Start 2P': "'Press Start 2P', monospace",
    'VT323': "'VT323', monospace",
};

function applySettings(s) {
    const root = document.documentElement;
    root.style.setProperty('--accent', s.accentColor);
    root.style.setProperty('--accent-rgb', hexToRgb(s.accentColor));
    root.style.setProperty('--font-ui', FONT_STACK_MAP[s.fontFamily] || "'Exo 2', sans-serif");
    root.style.setProperty('--font-size-base', s.fontSize + 'px');
    root.style.setProperty('--card-radius', s.cardRadius + 'px');
    root.style.setProperty('--card-border-w', s.borderWidth + 'px');
    root.style.setProperty('--card-bg', CARD_BG_MAP[s.cardBackground] || '#0a0a0a');
    root.style.setProperty('--card-spacing', s.cardSpacing + 'px');
    root.style.setProperty('--title-size', s.taskTitleSize + 'px');

    const body = document.body;
    body.classList.toggle('pref-no-hover-lift', !s.hoverLift);
    body.classList.toggle('pref-no-glow', !s.cardGlow);
    body.classList.toggle('pref-no-progress-text', !s.showProgressText);
    body.classList.toggle('pref-no-repeat-badge', !s.showRepeatBadge);
    body.classList.toggle('pref-no-postpone', !s.showPostponeBtn);
    body.classList.toggle('pref-no-due-badge', !s.showDueBadge);
    body.classList.toggle('pref-urgent-red', s.urgentRedTint);
    body.classList.toggle('pref-focus-mode', s.focusMode);
    body.classList.toggle('pref-compact', s.compactMode);
    body.classList.toggle('pref-glass', s.glassmorphism);
    body.classList.toggle('pref-section-count', s.sectionCountBadge);
    body.classList.toggle('pref-show-created', s.showCreatedDate);

    body.classList.remove('pref-bg-dots', 'pref-bg-grid');
    if (s.backgroundPattern === 'dots') body.classList.add('pref-bg-dots');
    else if (s.backgroundPattern === 'grid') body.classList.add('pref-bg-grid');

    body.classList.remove('pref-anim-off', 'pref-anim-slow', 'pref-anim-fast');
    if (s.animationSpeed === 'off') body.classList.add('pref-anim-off');
    else if (s.animationSpeed === 'slow') body.classList.add('pref-anim-slow');
    else if (s.animationSpeed === 'fast') body.classList.add('pref-anim-fast');

    crossCategoryDragLocked = !s.crossDragDefault;
    if (lockBtn) {
        const lockIcon = lockBtn.querySelector('.material-symbols-outlined');
        if (lockIcon) lockIcon.textContent = crossCategoryDragLocked ? 'lock' : 'lock_open';
        lockBtn.classList.toggle('unlocked', !crossCategoryDragLocked);
    }

    const repeatSelect = document.getElementById('task-repeat');
    if (repeatSelect && repeatSelect.value === 'none') repeatSelect.value = s.defaultRepeatType;

    // ── New appearance extras ──
    root.style.setProperty('--card-border-style', s.borderStyle || 'solid');
    const shapeMap = { rounded: '12px', square: '0px', pill: '50px' };
    root.style.setProperty('--progress-box-radius', shapeMap[s.progressBoxShape] || '12px');
    root.style.setProperty('--filled-symbol', '"' + (s.filledBoxSymbol || '✓') + '"');
    const pulseSpeedMap = { slow: '3.5s', medium: '2s', fast: '0.9s' };
    root.style.setProperty('--pulse-duration', pulseSpeedMap[s.importantPulseSpeed] || '2s');

    body.classList.toggle('pref-neon', !!s.neonGlow);
    body.classList.toggle('pref-scanlines', !!s.scanlines);
    body.classList.toggle('pref-urgent-blink', !!s.urgentBlink);
    body.classList.toggle('pref-tilt', !!s.cardTiltOnHover);
    body.classList.toggle('pref-matrix', !!s.matrixBg);
    body.classList.toggle('pref-show-updated', !!s.showLastUpdated);

    body.classList.remove('pref-glow-off', 'pref-glow-dim', 'pref-glow-intense');
    if (s.accentGlow === 'off') body.classList.add('pref-glow-off');
    else if (s.accentGlow === 'dim') body.classList.add('pref-glow-dim');
    else if (s.accentGlow === 'intense') body.classList.add('pref-glow-intense');

    body.classList.remove('pref-entry-pop', 'pref-entry-fade', 'pref-entry-slide');
    if (s.cardEntryAnim === 'pop') body.classList.add('pref-entry-pop');
    else if (s.cardEntryAnim === 'fade') body.classList.add('pref-entry-fade');
    else if (s.cardEntryAnim === 'slide') body.classList.add('pref-entry-slide');

    if (s.matrixBg) startMatrixRain(); else stopMatrixRain();
}

async function saveSettings() {
    if (!currentUser) return;
    try {
        const ref = doc(db, `users/${currentUser.uid}/settings/preferences`);
        await setDoc(ref, { ...currentSettings });
    } catch (e) { console.error('Error saving settings:', e); }
}

async function loadSettings(uid) {
    try {
        const ref = doc(db, `users/${uid}/settings/preferences`);
        const snap = await getDoc(ref);
        if (snap.exists()) currentSettings = { ...DEFAULT_SETTINGS, ...snap.data() };
    } catch (e) { console.error('Error loading settings:', e); }
    applySettings(currentSettings);
}

async function saveCustomOrder() {
    if (!currentUser) return;
    try {
        const ref = doc(db, `users/${currentUser.uid}/settings/order`);
        await setDoc(ref, { order: customOrder });
    } catch (e) { console.error('Error saving order:', e); }
}

async function loadCustomOrder(uid) {
    try {
        const ref = doc(db, `users/${uid}/settings/order`);
        const snap = await getDoc(ref);
        if (snap.exists() && snap.data().order) customOrder = snap.data().order;
    } catch (e) { console.error('Error loading order:', e); }
}

// ── Matrix rain ────────────────────────────────────────────────────────────
let matrixAnimId = null;
function startMatrixRain() {
    const canvas = document.getElementById('matrix-canvas');
    if (!canvas || matrixAnimId) return;
    const ctx = canvas.getContext('2d');
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ#@!?<>{}[]▓░'.split('');
    const fontSize = 14;
    const drops = Array(Math.ceil(window.innerWidth / fontSize)).fill(1);
    const draw = () => {
        if (!document.body.classList.contains('pref-matrix')) { matrixAnimId = null; return; }
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = `rgba(${hexToRgb(currentSettings.accentColor)}, 0.65)`;
        ctx.font = `${fontSize}px monospace`;
        drops.forEach((y, i) => {
            ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, y * fontSize);
            if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
        });
        matrixAnimId = requestAnimationFrame(draw);
    };
    draw();
}
function stopMatrixRain() {
    if (matrixAnimId) { cancelAnimationFrame(matrixAnimId); matrixAnimId = null; }
    const canvas = document.getElementById('matrix-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ── Undo-delete toast ──────────────────────────────────────────────────────
function showUndoToast(taskId) {
    document.querySelector('.undo-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    let countdown = 3;
    let cancelled = false;
    const textEl = document.createElement('span');
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = 'Rückgängig';
    undoBtn.addEventListener('click', () => { cancelled = true; clearInterval(timer); toast.remove(); });
    toast.appendChild(textEl);
    toast.appendChild(undoBtn);
    document.body.appendChild(toast);
    const update = () => { textEl.textContent = `Wird gelöscht in ${countdown}s… `; };
    update();
    const timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            clearInterval(timer);
            toast.remove();
            if (!cancelled) deleteDoc(doc(db, `users/${currentUser.uid}/tasks`, taskId)).catch(console.error);
        } else { update(); }
    }, 1000);
}
function initSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const openBtn = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('settings-close-btn');
    const resetBtn = document.getElementById('settings-reset-btn');

    openBtn.addEventListener('click', () => {
        modal.classList.add('active');
        syncSettingsUI(currentSettings);
    });
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

    resetBtn.addEventListener('click', async () => {
        if (!confirm('Alle Einstellungen zurücksetzen?')) return;
        currentSettings = { ...DEFAULT_SETTINGS };
        await saveSettings();
        applySettings(currentSettings);
        syncSettingsUI(currentSettings);
        if (currentTasksCache.length > 0) displayTasks(currentTasksCache);
    });

    document.querySelectorAll('.settings-tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            document.querySelectorAll('.settings-tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
            document.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === name));
        });
    });

    function onSettingChange(key, value, needsRerender = false) {
        currentSettings[key] = value;
        applySettings(currentSettings);
        if (needsRerender && currentTasksCache.length > 0) displayTasks(currentTasksCache);
        saveSettings();
    }

    // Selects
    [
        ['s-fontFamily', 'fontFamily', false],
        ['s-cardBackground', 'cardBackground', false],
        ['s-animationSpeed', 'animationSpeed', false],
        ['s-backgroundPattern', 'backgroundPattern', false],
        ['s-progressStyle', 'progressStyle', true],
        ['s-dateFormat', 'dateFormat', false],
        ['s-defaultRepeatType', 'defaultRepeatType', false],
        ['s-firstDayOfWeek', 'firstDayOfWeek', false],
        ['s-borderStyle', 'borderStyle', false],
        ['s-progressBoxShape', 'progressBoxShape', true],
        ['s-filledBoxSymbol', 'filledBoxSymbol', true],
        ['s-importantPulseSpeed', 'importantPulseSpeed', false],
        ['s-cardEntryAnim', 'cardEntryAnim', false],
        ['s-accentGlow', 'accentGlow', false],
    ].forEach(([id, key, rerender]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => onSettingChange(key, el.value, rerender));
    });

    // Ranges
    [
        ['s-fontSize', 'fontSize', false, 'px'],
        ['s-cardRadius', 'cardRadius', false, 'px'],
        ['s-borderWidth', 'borderWidth', false, 'px'],
        ['s-cardSpacing', 'cardSpacing', false, 'px'],
        ['s-taskTitleSize', 'taskTitleSize', false, 'px'],
        ['s-dueDateWarningDays', 'dueDateWarningDays', true, 'd'],
    ].forEach(([id, key, rerender, unit]) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + '-val');
        if (el) el.addEventListener('input', () => {
            const v = parseInt(el.value);
            if (valEl) valEl.textContent = v + unit;
            onSettingChange(key, v, rerender);
        });
    });

    // Color picker
    const colorEl = document.getElementById('s-accentColor');
    if (colorEl) colorEl.addEventListener('input', () => onSettingChange('accentColor', colorEl.value));

    // Color presets
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            const ce = document.getElementById('s-accentColor');
            if (ce) ce.value = color;
            onSettingChange('accentColor', color);
        });
    });

    // Toggles
    [
        ['s-cardGlow', 'cardGlow', false],
        ['s-hoverLift', 'hoverLift', false],
        ['s-showProgressText', 'showProgressText', false],
        ['s-showRepeatBadge', 'showRepeatBadge', false],
        ['s-showPostponeBtn', 'showPostponeBtn', false],
        ['s-showDueBadge', 'showDueBadge', false],
        ['s-showCreatedDate', 'showCreatedDate', false],
        ['s-urgentRedTint', 'urgentRedTint', false],
        ['s-confirmDelete', 'confirmDelete', false],
        ['s-showConfetti', 'showConfetti', false],
        ['s-showTaskCount', 'showTaskCount', true],
        ['s-crossDragDefault', 'crossDragDefault', false],
        ['s-autoSortNew', 'autoSortNew', false],
        ['s-focusMode', 'focusMode', true],
        ['s-compactMode', 'compactMode', false],
        ['s-reverseSortOrder', 'reverseSortOrder', true],
        ['s-glassmorphism', 'glassmorphism', false],
        ['s-sectionCountBadge', 'sectionCountBadge', true],
        ['s-neonGlow', 'neonGlow', false],
        ['s-scanlines', 'scanlines', false],
        ['s-cardTiltOnHover', 'cardTiltOnHover', false],
        ['s-urgentBlink', 'urgentBlink', false],
        ['s-deletionDelay', 'deletionDelay', false],
        ['s-vibrationFeedback', 'vibrationFeedback', false],
        ['s-hexProgress', 'hexProgress', true],
        ['s-matrixBg', 'matrixBg', false],
        ['s-showLastUpdated', 'showLastUpdated', false],
    ].forEach(([id, key, rerender]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            const newVal = !currentSettings[key];
            el.classList.toggle('on', newVal);
            onSettingChange(key, newVal, rerender);
        });
    });
}

function syncSettingsUI(s) {
    const g = id => document.getElementById(id);
    if (g('s-fontFamily')) g('s-fontFamily').value = s.fontFamily;
    if (g('s-cardBackground')) g('s-cardBackground').value = s.cardBackground;
    if (g('s-animationSpeed')) g('s-animationSpeed').value = s.animationSpeed;
    if (g('s-backgroundPattern')) g('s-backgroundPattern').value = s.backgroundPattern;
    if (g('s-progressStyle')) g('s-progressStyle').value = s.progressStyle;
    if (g('s-dateFormat')) g('s-dateFormat').value = s.dateFormat;
    if (g('s-defaultRepeatType')) g('s-defaultRepeatType').value = s.defaultRepeatType;
    if (g('s-firstDayOfWeek')) g('s-firstDayOfWeek').value = s.firstDayOfWeek;
    if (g('s-borderStyle')) g('s-borderStyle').value = s.borderStyle;
    if (g('s-progressBoxShape')) g('s-progressBoxShape').value = s.progressBoxShape;
    if (g('s-filledBoxSymbol')) g('s-filledBoxSymbol').value = s.filledBoxSymbol;
    if (g('s-importantPulseSpeed')) g('s-importantPulseSpeed').value = s.importantPulseSpeed;
    if (g('s-cardEntryAnim')) g('s-cardEntryAnim').value = s.cardEntryAnim;
    if (g('s-accentGlow')) g('s-accentGlow').value = s.accentGlow;

    const sr = (id, val, unit) => { const r = g(id), v = g(id+'-val'); if(r) r.value=val; if(v) v.textContent=val+unit; };
    sr('s-fontSize', s.fontSize, 'px');
    sr('s-cardRadius', s.cardRadius, 'px');
    sr('s-borderWidth', s.borderWidth, 'px');
    sr('s-cardSpacing', s.cardSpacing, 'px');
    sr('s-taskTitleSize', s.taskTitleSize, 'px');
    sr('s-dueDateWarningDays', s.dueDateWarningDays, 'd');

    if (g('s-accentColor')) g('s-accentColor').value = s.accentColor;

    [
        ['s-cardGlow','cardGlow'],['s-hoverLift','hoverLift'],
        ['s-showProgressText','showProgressText'],['s-showRepeatBadge','showRepeatBadge'],
        ['s-showPostponeBtn','showPostponeBtn'],['s-showDueBadge','showDueBadge'],
        ['s-showCreatedDate','showCreatedDate'],['s-urgentRedTint','urgentRedTint'],
        ['s-confirmDelete','confirmDelete'],['s-showConfetti','showConfetti'],
        ['s-showTaskCount','showTaskCount'],['s-crossDragDefault','crossDragDefault'],
        ['s-autoSortNew','autoSortNew'],['s-focusMode','focusMode'],
        ['s-compactMode','compactMode'],['s-reverseSortOrder','reverseSortOrder'],
        ['s-glassmorphism','glassmorphism'],['s-sectionCountBadge','sectionCountBadge'],
        ['s-neonGlow','neonGlow'],['s-scanlines','scanlines'],
        ['s-cardTiltOnHover','cardTiltOnHover'],['s-urgentBlink','urgentBlink'],
        ['s-deletionDelay','deletionDelay'],['s-vibrationFeedback','vibrationFeedback'],
        ['s-hexProgress','hexProgress'],['s-matrixBg','matrixBg'],
        ['s-showLastUpdated','showLastUpdated'],
    ].forEach(([id, key]) => { const t = g(id); if(t) t.classList.toggle('on', !!s[key]); });
}

// ── Toggle important ───────────────────────────────────────────────────────
window.toggleImportant = async function(taskId) {
    if (!currentUser) return;
    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) return;
        const taskData = taskSnap.data();
        await updateDoc(taskRef, { important: !taskData.important, updatedAt: new Date().toISOString() });
    } catch (e) { console.error('Error toggling important:', e); }
};

// ── Load tasks ─────────────────────────────────────────────────────────────
function loadTasks(uid) {
    const tasksRef = collection(db, `users/${uid}/tasks`);
    const q = query(tasksRef, orderBy('createdAt', 'desc'));

    if (unsubscribeSnapshot) unsubscribeSnapshot();

    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach((d) => tasks.push({ id: d.id, ...d.data() }));

        checkRecurringTasks(tasks, uid);

        // Default chronological sort
        tasks.sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });

        if (currentSettings.reverseSortOrder) tasks.reverse();
        displayTasks(tasks);
    }, (error) => {
        console.error('Error loading tasks:', error);
        tasksContainer.innerHTML = '<div style="color:#ff4444;text-align:center;padding:40px;">Fehler beim Laden der Aufgaben</div>';
    });
}

// ── Recurring task rescheduling ────────────────────────────────────────────
async function checkRecurringTasks(tasks, uid) {
    const today = getTodayString();

    for (const task of tasks) {
        if (task.repeatType !== 'none' && task.progress === 3 && task.nextDueDate) {
            const nextDue = new Date(task.nextDueDate);
            const todayDate = new Date(today);

            if (todayDate >= nextDue) {
                try {
                    const newDueDate = calculateNextDueDate(task.nextDueDate, task.repeatType);
                    const taskRef = doc(db, `users/${uid}/tasks`, task.id);
                    await updateDoc(taskRef, {
                        progress: 0,
                        nextDueDate: newDueDate,
                        dueDate: newDueDate,
                        updatedAt: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('Error rescheduling task:', error);
                }
            }
        }
    }
}

function calculateNextDueDate(currentDate, repeatType) {
    const date = new Date(currentDate);
    switch (repeatType) {
        case 'daily':      date.setDate(date.getDate() + 1);   break;
        case 'every2days': date.setDate(date.getDate() + 2);   break;
        case 'every3days': date.setDate(date.getDate() + 3);   break;
        case 'weekly':     date.setDate(date.getDate() + 7);   break;
        case 'monthly':    date.setMonth(date.getMonth() + 1); break;
        default:           return currentDate;
    }
    return date.toISOString().split('T')[0];
}

// ── Display tasks ──────────────────────────────────────────────────────────
function displayTasks(tasks) {
    currentTasksCache = tasks;

    // Apply sort settings when not using custom order
    if (!customOrder) {
        if (currentSettings.autoSortNew) {
            tasks = [...tasks].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        }
    }

    // Update task count badge
    const badge = document.getElementById('task-count-badge');
    if (badge) {
        badge.textContent = tasks.length;
        badge.style.display = currentSettings.showTaskCount ? 'inline' : 'none';
    }

    tasksContainer.innerHTML = '';

    if (tasks.length === 0) {
        tasksContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                <p>Noch keine Aufgaben. Erstelle deine erste!</p>
            </div>
        `;
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneMonthFromNow = new Date(today);
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

    // ── Categorize into 4 buckets ──
    const sections = { urgent: [], near: [], far: [], nodate: [] };
    tasks.forEach(task => {
        if (!task.dueDate) {
            sections.nodate.push(task);
        } else {
            // Parse without timezone shift
            const [y, m, d] = task.dueDate.split('-').map(Number);
            const due = new Date(y, m - 1, d);
            if (due <= today) {
                sections.urgent.push(task);
            } else if (due <= oneMonthFromNow) {
                sections.near.push(task);
            } else {
                sections.far.push(task);
            }
        }
    });

    // ── Apply custom order within each bucket ──
    if (customOrder) {
        ['urgent', 'near', 'far', 'nodate'].forEach(sec => {
            const order = customOrder[sec];
            if (order && order.length) {
                sections[sec].sort((a, b) => {
                    const ai = order.indexOf(a.id);
                    const bi = order.indexOf(b.id);
                    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
                });
            }
        });
    }

    // ── Re-sort button ──
    if (customOrder !== null) {
        const btn = document.createElement('button');
        btn.className = 'resort-btn';
        btn.innerHTML = '<span class="material-symbols-outlined">sort</span> Chronologisch sortieren';
        btn.addEventListener('click', async () => { customOrder = null; await saveCustomOrder(); displayTasks(currentTasksCache); });
        tasksContainer.appendChild(btn);
    }

    // ── Build section elements ──
    const urgentEl = sections.urgent.length ? createSectionEl('urgent', sections.urgent) : null;
    const nearEl   = sections.near.length   ? createSectionEl('near',   sections.near)   : null;
    const farEl    = sections.far.length    ? createSectionEl('far',    sections.far)    : null;
    const nodateEl = sections.nodate.length ? createSectionEl('nodate', sections.nodate) : null;

    const hasAfterUrgent = nearEl || farEl || nodateEl;
    const hasBeforeFar   = urgentEl || nearEl;

    if (urgentEl) tasksContainer.appendChild(urgentEl);

    // Separator 1: after overdue/today tasks
    if (urgentEl && hasAfterUrgent) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        tasksContainer.appendChild(sep);
    }

    if (nearEl) tasksContainer.appendChild(nearEl);

    // Separator 2: before tasks more than 1 month away
    if (farEl && hasBeforeFar) {
        const sep = document.createElement('div');
        sep.className = 'date-separator long-term';
        const label = document.createElement('span');
        label.textContent = '+ 1 Monat';
        sep.appendChild(label);
        tasksContainer.appendChild(sep);
    }

    if (farEl)    tasksContainer.appendChild(farEl);
    if (nodateEl) tasksContainer.appendChild(nodateEl);
}

// ── Create a draggable section container ──────────────────────────────────
function createSectionEl(sectionName, tasks) {
    const section = document.createElement('div');
    section.className = 'task-section';
    section.dataset.section = sectionName;

    const sectionLabels = { urgent: '⚠ Überfällig', near: '📅 Bald fällig', far: '🗓 Später', nodate: '📌 Kein Datum' };
    const countBadge = document.createElement('div');
    countBadge.className = 'section-count-badge';
    countBadge.innerHTML = `<span class="section-count-label">${sectionLabels[sectionName] || sectionName}</span><span class="section-count-num">${tasks.length}</span>`;
    section.appendChild(countBadge);

    section.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragState.element) return;
        if (crossCategoryDragLocked && dragState.section !== sectionName) return;
        e.dataTransfer.dropEffect = 'move';

        const cards = [...section.querySelectorAll('.task-card:not(.dragging)')];
        if (dragState.placeholder && dragState.placeholder.parentNode) {
            dragState.placeholder.remove();
        }

        let insertBefore = null;
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                insertBefore = card;
                break;
            }
        }

        if (dragState.placeholder) {
            insertBefore
                ? section.insertBefore(dragState.placeholder, insertBefore)
                : section.appendChild(dragState.placeholder);
        }
    });

    section.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragState.element) return;
        if (crossCategoryDragLocked && dragState.section !== sectionName) return;

        if (dragState.placeholder && dragState.placeholder.parentNode === section) {
            section.insertBefore(dragState.element, dragState.placeholder);
        }
        if (dragState.placeholder && dragState.placeholder.parentNode) {
            dragState.placeholder.remove();
        }

        // Persist new order for the target section
        const newOrder = [...section.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
        if (!customOrder) customOrder = {};
        customOrder[sectionName] = newOrder;

        // If cross-section drop, also persist the updated source section order
        if (dragState.section !== sectionName) {
            const srcSection = tasksContainer.querySelector(`.task-section[data-section="${dragState.section}"]`);
            if (srcSection) {
                customOrder[dragState.section] = [...srcSection.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
            }
        }

        saveCustomOrder();

        // Ensure re-sort button is visible
        if (!tasksContainer.querySelector('.resort-btn')) {
            const btn = document.createElement('button');
            btn.className = 'resort-btn';
            btn.innerHTML = '<span class="material-symbols-outlined">sort</span> Chronologisch sortieren';
            btn.addEventListener('click', async () => { customOrder = null; await saveCustomOrder(); displayTasks(currentTasksCache); });
            tasksContainer.insertBefore(btn, tasksContainer.firstChild);
        }

        // Satisfying drop animation
        const dropped = dragState.element;
        dropped.classList.add('just-dropped');
        setTimeout(() => dropped.classList.remove('just-dropped'), 600);
    });

    tasks.forEach(task => section.appendChild(createTaskCard(task, sectionName)));
    return section;
}

// ── Create a single task card DOM element ─────────────────────────────────
function createTaskCard(task, sectionName) {
    const progress = task.progress || 0;
    const dueInfo = getDueDateInfo(task.dueDate);
    const repeatLabel = getRepeatLabel(task.repeatType);
    const progressPercent = Math.round((progress / 3) * 100);

    const card = document.createElement('div');
    card.className = 'task-card' + (task.important ? ' important' : '') + (progress === 3 ? ' progress-complete' : '');
    card.dataset.taskId = task.id;
    card.dataset.section = sectionName;
    card.draggable = true;

    // Drag events on card
    card.addEventListener('dragstart', e => {
        dragState.element = card;
        dragState.section = sectionName;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        document.body.classList.add('dragging-active');

        const ph = document.createElement('div');
        ph.className = 'drag-placeholder';
        ph.style.height = card.offsetHeight + 'px';
        dragState.placeholder = ph;
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        if (dragState.placeholder && dragState.placeholder.parentNode) {
            dragState.placeholder.remove();
        }
        document.body.classList.remove('dragging-active');
        dragState = { element: null, section: null, placeholder: null };
    });

    // Touch long-press drag (iOS / iPadOS)
    let lpTimer = null;
    let lpStartX = 0, lpStartY = 0;

    card.addEventListener('touchstart', e => {
        const t = e.touches[0];
        lpStartX = t.clientX;
        lpStartY = t.clientY;
        lpTimer = setTimeout(() => {
            lpTimer = null;
            if (navigator.vibrate && currentSettings.vibrationFeedback) navigator.vibrate(30);
            // Clear any active text selection before entering drag mode
            window.getSelection()?.removeAllRanges();
            document.body.classList.add('dragging-active');
            compactDrag.element = card;
            compactDrag.section = sectionName;
            card.style.touchAction = 'none';
            // Collapse the card to title-only so it's compact while dragging
            card.classList.add('drag-compact');
            card.classList.add('dragging');
            const ph = document.createElement('div');
            ph.className = 'drag-placeholder';
            ph.style.height = card.offsetHeight + 'px';
            compactDrag.placeholder = ph;
            if (card.parentNode) card.parentNode.insertBefore(ph, card);
        }, LONG_PRESS_MS);
    }, { passive: true });

    card.addEventListener('touchmove', e => {
        if (compactDrag.element === card) {
            e.preventDefault();
            const t = e.touches[0];

            // Determine the target section: locked = original section only,
            // unlocked = section currently under the touch point
            let sec;
            if (crossCategoryDragLocked) {
                sec = card.closest('.task-section');
            } else {
                const ph = compactDrag.placeholder;
                if (ph) ph.style.display = 'none';
                const elemBelow = document.elementFromPoint(t.clientX, t.clientY);
                if (ph) ph.style.display = '';
                sec = (elemBelow && elemBelow.closest('.task-section')) || card.closest('.task-section');
            }

            if (!sec || !compactDrag.placeholder) return;
            const siblings = [...sec.querySelectorAll('.task-card:not(.dragging)')];
            if (compactDrag.placeholder.parentNode) compactDrag.placeholder.remove();
            let before = null;
            for (const s of siblings) {
                const r = s.getBoundingClientRect();
                if (t.clientY < r.top + r.height / 2) { before = s; break; }
            }
            before ? sec.insertBefore(compactDrag.placeholder, before) : sec.appendChild(compactDrag.placeholder);
            // Auto-scroll near viewport edges
            const y = t.clientY;
            if (y < SCROLL_ZONE_PX) {
                window.scrollBy(0, -Math.round(SCROLL_MAX_SPEED * (1 - y / SCROLL_ZONE_PX)));
            } else if (y > window.innerHeight - SCROLL_ZONE_PX) {
                window.scrollBy(0, Math.round(SCROLL_MAX_SPEED * ((y - window.innerHeight + SCROLL_ZONE_PX) / SCROLL_ZONE_PX)));
            }
            return;
        }
        if (lpTimer !== null) {
            const t = e.touches[0];
            if (Math.abs(t.clientX - lpStartX) > 8 || Math.abs(t.clientY - lpStartY) > 8) {
                clearTimeout(lpTimer);
                lpTimer = null;
            }
        }
    }, { passive: false });

    card.addEventListener('touchend', () => {
        if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; }
        if (compactDrag.element !== card) return;
        const ph = compactDrag.placeholder;
        const sec = ph && ph.parentNode ? ph.parentNode : card.closest('.task-section');
        if (ph && ph.parentNode) { ph.parentNode.insertBefore(card, ph); ph.remove(); }
        card.classList.remove('drag-compact');
        card.classList.remove('dragging');
        card.style.touchAction = '';
        document.body.classList.remove('dragging-active');
        // Persist new order
        if (sec) {
            const targetSectionName = sec.dataset.section;
            const newOrder = [...sec.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
            if (!customOrder) customOrder = {};
            customOrder[targetSectionName] = newOrder;
            // If cross-section drop, also persist the updated source section order
            if (targetSectionName !== sectionName) {
                const srcSection = tasksContainer.querySelector(`.task-section[data-section="${sectionName}"]`);
                if (srcSection) {
                    customOrder[sectionName] = [...srcSection.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
                }
            }
            saveCustomOrder();

            if (!tasksContainer.querySelector('.resort-btn')) {
                const btn = document.createElement('button');
                btn.className = 'resort-btn';
                btn.innerHTML = '<span class="material-symbols-outlined">sort</span> Chronologisch sortieren';
                btn.addEventListener('click', async () => { customOrder = null; await saveCustomOrder(); displayTasks(currentTasksCache); });
                tasksContainer.insertBefore(btn, tasksContainer.firstChild);
            }
        }
        compactDrag = { element: null, section: null, placeholder: null };
        card.classList.add('just-dropped');
        setTimeout(() => card.classList.remove('just-dropped'), 600);
    });

    card.addEventListener('touchcancel', () => {
        if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; }
        if (compactDrag.element !== card) return;
        if (compactDrag.placeholder && compactDrag.placeholder.parentNode) compactDrag.placeholder.remove();
        card.classList.remove('drag-compact');
        card.classList.remove('dragging');
        card.style.touchAction = '';
        document.body.classList.remove('dragging-active');
        compactDrag = { element: null, section: null, placeholder: null };
    });

    card.addEventListener('contextmenu', e => e.preventDefault());

    // Header
    const header = document.createElement('div');
    header.className = 'task-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = task.title;
    header.appendChild(titleEl);

    if (dueInfo.badge) {
        const badge = document.createElement('div');
        badge.className = 'task-due-badge' + (dueInfo.class ? ' ' + dueInfo.class : '');
        badge.textContent = dueInfo.badge;
        header.appendChild(badge);
    }

    const importantBtn = document.createElement('button');
    importantBtn.className = 'important-btn' + (task.important ? ' active' : '');
    importantBtn.title = task.important ? 'Wichtig (klicken zum Entfernen)' : 'Als wichtig markieren';
    const importantIcon = document.createElement('span');
    importantIcon.className = 'material-symbols-outlined' + (task.important ? ' ms-filled' : '');
    importantIcon.style.fontSize = '20px';
    importantIcon.textContent = 'star';
    importantBtn.appendChild(importantIcon);
    importantBtn.addEventListener('click', e => { e.stopPropagation(); toggleImportant(task.id); });
    header.appendChild(importantBtn);

    card.appendChild(header);

    // Progress text
    const progressText = document.createElement('div');
    progressText.className = 'progress-text' + (progress === 3 ? ' complete' : '');
    const HEX_VALS = { 0: '0x00', 1: '0x55', 2: '0xAA', 3: '0xFF' };
    if (progress === 3) {
        if (currentSettings.hexProgress) {
            progressText.textContent = '0xFF — Abgeschlossen!';
            progressText.style.fontFamily = 'monospace';
        } else {
            progressText.innerHTML = '<span class="material-symbols-outlined ms-green" style="font-size:20px">celebration</span> Abgeschlossen!';
        }
    } else {
        progressText.textContent = currentSettings.hexProgress
            ? HEX_VALS[progress] + ' erledigt'
            : progressPercent + '% erledigt';
        if (currentSettings.hexProgress) progressText.style.fontFamily = 'monospace';
    }
    card.appendChild(progressText);

    // Progress boxes / bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    if (currentSettings.progressStyle === 'bar') {
        const wrapper = document.createElement('div');
        wrapper.className = 'progress-bar-wrapper';
        const fill = document.createElement('div');
        fill.className = 'progress-bar-fill';
        fill.style.width = progressPercent + '%';
        wrapper.appendChild(fill);
        wrapper.addEventListener('click', e => {
            const pct = (e.clientX - wrapper.getBoundingClientRect().left) / wrapper.offsetWidth;
            const zone = pct < 0.34 ? 1 : pct < 0.67 ? 2 : 3;
            updateProgress(task.id, zone);
        });
        progressContainer.appendChild(wrapper);
    } else {
        for (let i = 1; i <= 3; i++) {
            const box = document.createElement('div');
            box.className = 'progress-box' + (progress >= i ? ' filled' : '');
            box.addEventListener('click', () => updateProgress(task.id, i));
            progressContainer.appendChild(box);
        }
    }
    card.appendChild(progressContainer);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'task-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'task-footer-left';

    if (repeatLabel) {
        const repeatBadge = document.createElement('div');
        repeatBadge.className = 'task-repeat-badge';
        repeatBadge.innerHTML = '<span class="material-symbols-outlined ms-green" style="font-size:15px">autorenew</span> ' + escapeHtml(repeatLabel);
        footerLeft.appendChild(repeatBadge);
    }

    const postponeBtn = document.createElement('button');
    postponeBtn.className = 'postpone-btn';
    postponeBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px">fast_forward</span> +1 Tag';
    postponeBtn.addEventListener('click', () => postponeTask(task.id));
    footerLeft.appendChild(postponeBtn);

    footer.appendChild(footerLeft);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn' + (progress === 3 ? ' visible' : '');
    deleteBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px">delete</span> Löschen';
    deleteBtn.addEventListener('click', () => deleteTask(task.id));
    footer.appendChild(deleteBtn);

    card.appendChild(footer);

    const createdEl = document.createElement('div');
    createdEl.className = 'task-created-date';
    const createdStr = task.createdAt ? task.createdAt.split('T')[0] : null;
    createdEl.textContent = 'Erstellt: ' + (createdStr ? formatDate(createdStr) : '–');
    card.appendChild(createdEl);

    const updatedEl = document.createElement('div');
    updatedEl.className = 'task-updated-date';
    const updatedStr = task.updatedAt ? task.updatedAt.split('T')[0] : null;
    updatedEl.textContent = 'Bearbeitet: ' + (updatedStr ? formatDate(updatedStr) : '–');
    card.appendChild(updatedEl);

    return card;
}

// ── Completion modal ───────────────────────────────────────────────────────
function showCompletionModal(taskId) {
    const modal = document.getElementById('completion-modal');
    if (!modal) return;
    modal.classList.add('active');

    // Replace buttons to clear stale listeners
    const oldDone = document.getElementById('modal-done-btn');
    const oldDel  = document.getElementById('modal-delete-btn');
    const newDone = oldDone.cloneNode(true);
    const newDel  = oldDel.cloneNode(true);
    oldDone.parentNode.replaceChild(newDone, oldDone);
    oldDel.parentNode.replaceChild(newDel, oldDel);

    newDone.addEventListener('click', () => {
        modal.classList.remove('active');
        if (currentSettings.showConfetti) launchConfetti();
    });

    newDel.addEventListener('click', async () => {
        modal.classList.remove('active');
        await deleteTask(taskId, true);
    });
}

// ── Confetti ───────────────────────────────────────────────────────────────
function launchConfetti() {
    if (typeof confetti === 'undefined') return;

    const colors = ['#00ff88', '#00dd77', '#00bb66', '#88ffcc', '#aaffd9', '#ffffff', '#00ff44'];

    // Big initial burst from center
    confetti({ particleCount: 200, spread: 100, startVelocity: 65, origin: { y: 0.6 }, colors, zIndex: 9999 });

    // Sustained side cannons
    const end = Date.now() + 3500;
    const tick = setInterval(() => {
        if (Date.now() > end) return clearInterval(tick);
        confetti({ particleCount: 55, angle: 60,  spread: 60, origin: { x: 0,   y: 0.65 }, colors, zIndex: 9999 });
        confetti({ particleCount: 55, angle: 120, spread: 60, origin: { x: 1,   y: 0.65 }, colors, zIndex: 9999 });
    }, 230);
}

// ── Update task progress ───────────────────────────────────────────────────
window.updateProgress = async function(taskId, boxNumber) {
    if (!currentUser) return;

    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) return;

        const taskData = taskSnap.data();
        const currentProgress = taskData.progress || 0;

        const newProgress = currentProgress >= boxNumber ? boxNumber - 1 : boxNumber;

        const updateData = { progress: newProgress, updatedAt: new Date().toISOString() };

        if (newProgress === 3 && taskData.repeatType !== 'none' && taskData.dueDate) {
            updateData.nextDueDate = calculateNextDueDate(taskData.dueDate, taskData.repeatType);
        }

        await updateDoc(taskRef, updateData);

        // Pop animation on clicked box
        setTimeout(() => {
            const boxes = tasksContainer.querySelectorAll('[data-task-id="' + CSS.escape(taskId) + '"] .progress-box');
            const target = boxes[boxNumber - 1];
            if (target) {
                target.classList.add('just-filled');
                setTimeout(() => target.classList.remove('just-filled'), 400);
            }
        }, 50);

        if (newProgress === 3) {
            setTimeout(() => showCompletionModal(taskId), 350);
        }

    } catch (error) {
        console.error('Error updating task progress:', error);
        alert('Fehler beim Aktualisieren des Fortschritts');
    }
};

// ── Postpone task ──────────────────────────────────────────────────────────
window.postponeTask = async function(taskId) {
    if (!currentUser) return;

    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) return;

        const taskData = taskSnap.data();
        let newDueDate;

        if (taskData.dueDate) {
            const date = new Date(taskData.dueDate);
            date.setDate(date.getDate() + 1);
            newDueDate = date.toISOString().split('T')[0];
        } else {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            newDueDate = tomorrow.toISOString().split('T')[0];
        }

        await updateDoc(taskRef, {
            dueDate: newDueDate,
            nextDueDate: newDueDate,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error postponing task:', error);
        alert('Fehler beim Verschieben der Aufgabe');
    }
};

// ── Delete task ────────────────────────────────────────────────────────────
window.deleteTask = async function(taskId, skipConfirm = false) {
    if (!currentUser) return;

    if (!skipConfirm && currentSettings.confirmDelete && !confirm('Möchtest du diese Aufgabe wirklich löschen?')) return;

    if (!skipConfirm && currentSettings.deletionDelay) {
        showUndoToast(taskId);
        return;
    }

    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        await deleteDoc(taskRef);
        console.log('Task deleted');
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Fehler beim Löschen der Aufgabe');
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getDueDateInfo(dueDate) {
    if (!dueDate) return { badge: null, class: '' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [y, m, d] = dueDate.split('-').map(Number);
    const due = new Date(y, m - 1, d);

    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    const warnDays = currentSettings.dueDateWarningDays || 3;

    if (diffDays < 0)   return { badge: Math.abs(diffDays) + 'd überfällig', class: 'overdue' };
    if (diffDays === 0) return { badge: 'Heute fällig',                       class: 'today'   };
    if (diffDays === 1) return { badge: 'Morgen fällig',                      class: warnDays >= 1 ? 'warning' : '' };
    if (diffDays <= 7)  return { badge: 'In ' + diffDays + ' Tagen',         class: diffDays <= warnDays ? 'warning' : '' };
    return                     { badge: 'Fällig: ' + formatDate(dueDate),    class: ''        };
}

function getRepeatLabel(repeatType) {
    const map = { none: '', daily: 'Täglich', every2days: 'Alle 2 Tage', every3days: 'Alle 3 Tage', weekly: 'Wöchentlich', monthly: 'Monatlich' };
    return map[repeatType] || '';
}

function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

function formatDate(dateString) {
    if (!dateString) return '';
    const [y, m, d] = dateString.split('-').map(Number);
    if (currentSettings.dateFormat === 'iso') return dateString;
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, c => map[c]);
}
