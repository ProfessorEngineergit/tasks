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
let compactDrag = {
    active: false, card: null, section: null, sectionEl: null,
    ghost: null, placeholder: null, offsetX: 0, offsetY: 0,
    scrollRAF: null, hasMoved: false, lastMouseY: 0
};
let longPressTimer = null;

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
    if (compactDrag.active) return;

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
        console.log('Logout successful');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loginContainer.style.display = 'none';
        appContainer.classList.add('active');
        userNameSpan.textContent = user.displayName || user.email || 'User';
        loadTasks(user.uid);
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
        btn.addEventListener('click', () => {
            customOrder = null;
            displayTasks(currentTasksCache);
        });
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
    card.className = 'task-card';
    card.dataset.taskId = task.id;
    card.dataset.section = sectionName;
    card.draggable = false;

    // Long-press handler for compact drag
    card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .progress-box')) return;
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;

        const onEarlyMove = (me) => {
            if (Math.abs(me.clientX - startX) > 8 || Math.abs(me.clientY - startY) > 8) {
                clearTimeout(longPressTimer);
                earlyCleanup();
            }
        };

        const onEarlyUp = () => {
            clearTimeout(longPressTimer);
            earlyCleanup();
        };

        const earlyCleanup = () => {
            document.removeEventListener('mousemove', onEarlyMove);
            document.removeEventListener('mouseup', onEarlyUp);
        };

        longPressTimer = setTimeout(() => {
            earlyCleanup();
            startCompactDrag(card, sectionName, startX, startY);
        }, 750);

        document.addEventListener('mousemove', onEarlyMove);
        document.addEventListener('mouseup', onEarlyUp);
    });

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
    card.appendChild(header);

    // Progress text
    const progressText = document.createElement('div');
    progressText.className = 'progress-text' + (progress === 3 ? ' complete' : '');
    if (progress === 3) {
        progressText.innerHTML = '<span class="material-symbols-outlined ms-green" style="font-size:20px">celebration</span> Abgeschlossen!';
    } else {
        progressText.textContent = progressPercent + '% erledigt';
    }
    card.appendChild(progressText);

    // Progress boxes
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    for (let i = 1; i <= 3; i++) {
        const box = document.createElement('div');
        box.className = 'progress-box' + (progress >= i ? ' filled' : '');
        box.addEventListener('click', () => updateProgress(task.id, i));
        progressContainer.appendChild(box);
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
    return card;
}

// ── Compact-mode drag system ──────────────────────────────────────────────
function startCompactDrag(card, sectionName, mouseX, mouseY) {
    document.body.classList.add('compact-mode');

    const sectionEl = card.closest('.task-section');
    const cardRect = card.getBoundingClientRect();

    // Ghost element (floating card title)
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = card.querySelector('.task-title').textContent;
    ghost.style.width = cardRect.width + 'px';
    ghost.style.left = cardRect.left + 'px';
    ghost.style.top = cardRect.top + 'px';
    document.body.appendChild(ghost);

    // Placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = '44px';
    sectionEl.insertBefore(placeholder, card);

    // Hide source card
    card.classList.add('drag-source');

    compactDrag = {
        active: true, card, section: sectionName, sectionEl, ghost, placeholder,
        offsetX: mouseX - cardRect.left, offsetY: mouseY - cardRect.top,
        scrollRAF: null, hasMoved: false, lastMouseY: mouseY
    };

    // Start continuous auto-scroll loop
    (function scrollTick() {
        if (!compactDrag.active) return;
        const ZONE = 60, MAX_SPEED = 12;
        const vh = window.innerHeight;
        const y = compactDrag.lastMouseY;
        if (y > vh - ZONE) {
            window.scrollBy(0, ((y - (vh - ZONE)) / ZONE) * MAX_SPEED);
            updatePlaceholder(y);
        } else if (y < ZONE) {
            window.scrollBy(0, -(((ZONE - y) / ZONE) * MAX_SPEED));
            updatePlaceholder(y);
        }
        compactDrag.scrollRAF = requestAnimationFrame(scrollTick);
    })();

    document.addEventListener('mousemove', onCompactDragMove);
    document.addEventListener('mouseup', onCompactDragEnd);
}

function onCompactDragMove(e) {
    if (!compactDrag.active) return;
    compactDrag.hasMoved = true;
    compactDrag.lastMouseY = e.clientY;

    const { ghost } = compactDrag;
    ghost.style.left = (e.clientX - compactDrag.offsetX) + 'px';
    ghost.style.top = (e.clientY - compactDrag.offsetY) + 'px';

    updatePlaceholder(e.clientY);
}

function updatePlaceholder(mouseY) {
    const { placeholder, sectionEl } = compactDrag;
    if (!placeholder || !sectionEl) return;

    const cards = [...sectionEl.querySelectorAll('.task-card:not(.drag-source)')];
    let insertBefore = null;

    for (const c of cards) {
        const rect = c.getBoundingClientRect();
        if (mouseY < rect.top + rect.height / 2) {
            insertBefore = c;
            break;
        }
    }

    const currentNext = placeholder.nextElementSibling;
    if (insertBefore !== currentNext || placeholder.parentNode !== sectionEl) {
        if (placeholder.parentNode) placeholder.remove();
        if (insertBefore) {
            sectionEl.insertBefore(placeholder, insertBefore);
        } else {
            sectionEl.appendChild(placeholder);
        }
    }
}

function onCompactDragEnd() {
    if (!compactDrag.active) return;

    const { card, ghost, placeholder, sectionEl, section, hasMoved } = compactDrag;

    // Stop auto-scroll
    if (compactDrag.scrollRAF) cancelAnimationFrame(compactDrag.scrollRAF);

    // Insert card at placeholder position
    if (placeholder.parentNode === sectionEl) {
        sectionEl.insertBefore(card, placeholder);
    }

    // Clean up DOM
    if (placeholder.parentNode) placeholder.remove();
    if (ghost.parentNode) ghost.remove();
    card.classList.remove('drag-source');

    if (hasMoved) {
        // Persist new order for this section
        const newOrder = [...sectionEl.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
        if (!customOrder) customOrder = {};
        customOrder[section] = newOrder;

        // Ensure re-sort button is visible
        if (!tasksContainer.querySelector('.resort-btn')) {
            const btn = document.createElement('button');
            btn.className = 'resort-btn';
            btn.innerHTML = '<span class="material-symbols-outlined">sort</span> Chronologisch sortieren';
            btn.addEventListener('click', () => {
                customOrder = null;
                displayTasks(currentTasksCache);
            });
            tasksContainer.insertBefore(btn, tasksContainer.firstChild);
        }

        // Satisfying drop animation
        card.classList.add('just-dropped');
        setTimeout(() => card.classList.remove('just-dropped'), 600);
    }

    // Exit compact mode (small delay for smooth visual)
    setTimeout(() => document.body.classList.remove('compact-mode'), 150);

    // Remove listeners
    document.removeEventListener('mousemove', onCompactDragMove);
    document.removeEventListener('mouseup', onCompactDragEnd);

    // Reset state
    compactDrag = {
        active: false, card: null, section: null, sectionEl: null,
        ghost: null, placeholder: null, offsetX: 0, offsetY: 0,
        scrollRAF: null, hasMoved: false, lastMouseY: 0
    };
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
        launchConfetti();
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

    if (!skipConfirm && !confirm('Möchtest du diese Aufgabe wirklich löschen?')) return;

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

    if (diffDays < 0)   return { badge: Math.abs(diffDays) + 'd überfällig', class: 'overdue' };
    if (diffDays === 0) return { badge: 'Heute fällig',                       class: 'today'   };
    if (diffDays === 1) return { badge: 'Morgen fällig',                      class: ''        };
    if (diffDays <= 7)  return { badge: 'In ' + diffDays + ' Tagen',         class: ''        };
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
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, c => map[c]);
}
