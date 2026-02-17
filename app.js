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

// Login with GitHub
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
        // User is logged in
        currentUser = user;
        loginContainer.style.display = 'none';
        appContainer.classList.add('active');
        userNameSpan.textContent = user.displayName || user.email || 'User';
        
        // Load user's tasks
        loadTasks(user.uid);
    } else {
        // User is logged out
        currentUser = null;
        loginContainer.style.display = 'block';
        appContainer.classList.remove('active');
        
        // Unsubscribe from tasks snapshot
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
    }
});

// Add new task
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
        // Use setDoc with auto-generated ID instead of addDoc for better control
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const taskRef = doc(db, `users/${currentUser.uid}/tasks/${taskId}`);
        
        const taskData = {
            title: title,
            dueDate: dueDate || null,
            progress: 0, // 0, 1, 2, or 3 (0 = not started, 3 = complete)
            repeatType: repeatType,
            nextDueDate: dueDate || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await setDoc(taskRef, taskData);
        
        // Clear form
        document.getElementById('task-title').value = '';
        document.getElementById('task-due').value = '';
        document.getElementById('task-repeat').value = 'none';
        
        console.log('Task added successfully');
    } catch (error) {
        console.error('Error adding task:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        alert('Fehler beim Hinzufügen der Aufgabe: ' + error.message);
    }
});

// Load tasks with real-time updates
function loadTasks(uid) {
    const tasksRef = collection(db, `users/${uid}/tasks`);
    const q = query(tasksRef, orderBy('createdAt', 'desc'));
    
    // Unsubscribe from previous snapshot if exists
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
    }
    
    // Subscribe to real-time updates
    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach((doc) => {
            tasks.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        // Check and reschedule recurring tasks before displaying
        checkRecurringTasks(tasks, uid);
        
        // Sort tasks by due date (earliest first), tasks without due date go to end
        tasks.sort((a, b) => {
            // Tasks without due date go to the end
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            
            // Compare due dates
            return new Date(a.dueDate) - new Date(b.dueDate);
        });
        
        // Display tasks
        displayTasks(tasks);
    }, (error) => {
        console.error('Error loading tasks:', error);
        tasksContainer.innerHTML = '<div class="error" style="color: #ff4444; text-align: center; padding: 40px;">Fehler beim Laden der Aufgaben</div>';
    });
}

// Check and reschedule recurring tasks
async function checkRecurringTasks(tasks, uid) {
    const today = getTodayString();
    
    for (const task of tasks) {
        // Only check tasks that have repeat settings and are completed
        if (task.repeatType !== 'none' && task.progress === 3 && task.nextDueDate) {
            const nextDue = new Date(task.nextDueDate);
            const todayDate = new Date(today);
            
            // If the next due date has passed, reschedule the task
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
                    console.log(`Rescheduled recurring task: ${task.title} to ${newDueDate}`);
                } catch (error) {
                    console.error('Error rescheduling task:', error);
                }
            }
        }
    }
}

// Calculate next due date based on repeat type
function calculateNextDueDate(currentDate, repeatType) {
    const date = new Date(currentDate);
    
    switch(repeatType) {
        case 'daily':
            date.setDate(date.getDate() + 1);
            break;
        case 'every2days':
            date.setDate(date.getDate() + 2);
            break;
        case 'every3days':
            date.setDate(date.getDate() + 3);
            break;
        case 'weekly':
            date.setDate(date.getDate() + 7);
            break;
        case 'monthly':
            date.setMonth(date.getMonth() + 1);
            break;
        default:
            return currentDate;
    }
    
    return date.toISOString().split('T')[0]; // Return YYYY-MM-DD
}

// Display tasks in the UI
function displayTasks(tasks) {
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
    const todayStr = getTodayString();
    
    let addedSeparator = false;
    
    const tasksHTML = tasks.map((task, index) => {
        const progress = task.progress || 0;
        const dueInfo = getDueDateInfo(task.dueDate);
        const repeatLabel = getRepeatLabel(task.repeatType);
        const progressPercent = Math.round((progress / 3) * 100);
        
        // Check if we need to add a separator
        let separator = '';
        const currentDueDate = task.dueDate || null;
        
        // Check if this task is after today
        const isAfterToday = currentDueDate && new Date(currentDueDate) > today;
        
        // Add separator before the first task that is after today (only once)
        if (isAfterToday && !addedSeparator) {
            separator = '<div class="date-separator"></div>';
            addedSeparator = true;
        }
        
        return `
            ${separator}
            <div class="task-card">
                <div class="task-header">
                    <div class="task-title">${escapeHtml(task.title)}</div>
                    ${dueInfo.badge ? `<div class="task-due-badge ${dueInfo.class}">${dueInfo.badge}</div>` : ''}
                </div>
                
                <div class="progress-text ${progress === 3 ? 'complete' : ''}">
                    ${progress === 3 ? '🎉 Abgeschlossen!' : `${progressPercent}% erledigt`}
                </div>
                
                <div class="progress-container">
                    <div class="progress-box ${progress >= 1 ? 'filled' : ''}" 
                         onclick="updateProgress('${task.id}', 1)">
                    </div>
                    <div class="progress-box ${progress >= 2 ? 'filled' : ''}" 
                         onclick="updateProgress('${task.id}', 2)">
                    </div>
                    <div class="progress-box ${progress >= 3 ? 'filled' : ''}" 
                         onclick="updateProgress('${task.id}', 3)">
                    </div>
                </div>
                
                <div class="task-footer">
                    <div class="task-footer-left">
                        ${repeatLabel ? `<div class="task-repeat-badge">🔄 ${repeatLabel}</div>` : ''}
                        <button class="postpone-btn" onclick="postponeTask('${task.id}')">
                            ⏭️ +1 Tag
                        </button>
                    </div>
                    <button class="delete-btn ${progress === 3 ? 'visible' : ''}" 
                            onclick="deleteTask('${task.id}')">
                        Löschen
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    tasksContainer.innerHTML = tasksHTML;
}

// Get due date info with styling
function getDueDateInfo(dueDate) {
    if (!dueDate) return { badge: null, class: '' };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    
    const diffTime = due - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return { badge: `${Math.abs(diffDays)}d überfällig`, class: 'overdue' };
    } else if (diffDays === 0) {
        return { badge: 'Heute fällig', class: 'today' };
    } else if (diffDays === 1) {
        return { badge: 'Morgen fällig', class: '' };
    } else if (diffDays <= 7) {
        return { badge: `In ${diffDays} Tagen`, class: '' };
    } else {
        return { badge: `Fällig: ${formatDate(dueDate)}`, class: '' };
    }
}

// Get repeat label
function getRepeatLabel(repeatType) {
    const labels = {
        'none': '',
        'daily': 'Täglich',
        'every2days': 'Alle 2 Tage',
        'every3days': 'Alle 3 Tage',
        'weekly': 'Wöchentlich',
        'monthly': 'Monatlich'
    };
    return labels[repeatType] || '';
}

// Update task progress (clicking on boxes)
window.updateProgress = async function(taskId, boxNumber) {
    if (!currentUser) return;
    
    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        
        // Get current task data directly
        const taskSnap = await getDoc(taskRef);
        
        if (!taskSnap.exists()) {
            console.error('Task not found');
            return;
        }
        
        const taskData = taskSnap.data();
        const currentProgress = taskData.progress || 0;
        
        // Toggle logic: if clicking on an already filled box, unfill it and all after
        // If clicking on an empty box, fill it
        let newProgress;
        if (currentProgress >= boxNumber) {
            // Clicking on a filled box - unfill it and all after
            newProgress = boxNumber - 1;
        } else {
            // Clicking on an empty box - fill up to this box
            newProgress = boxNumber;
        }
        
        const updateData = {
            progress: newProgress,
            updatedAt: new Date().toISOString()
        };
        
        // If completing task (progress = 3) and it's recurring, set up next due date
        if (newProgress === 3) {
            if (taskData.repeatType !== 'none' && taskData.dueDate) {
                const nextDue = calculateNextDueDate(taskData.dueDate, taskData.repeatType);
                updateData.nextDueDate = nextDue;
            }
        }
        
        await updateDoc(taskRef, updateData);
        console.log('Task progress updated');
        
        // Add animation class
        setTimeout(() => {
            const boxes = document.querySelectorAll(`[onclick*="${taskId}"]`);
            boxes.forEach((box, index) => {
                if (index + 1 === boxNumber) {
                    box.classList.add('just-filled');
                    setTimeout(() => box.classList.remove('just-filled'), 400);
                }
            });
        }, 50);
        
    } catch (error) {
        console.error('Error updating task progress:', error);
        alert('Fehler beim Aktualisieren des Fortschritts');
    }
};

// Postpone task to next day
window.postponeTask = async function(taskId) {
    if (!currentUser) return;
    
    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        const taskSnap = await getDoc(taskRef);
        
        if (!taskSnap.exists()) {
            console.error('Task not found');
            return;
        }
        
        const taskData = taskSnap.data();
        const currentDueDate = taskData.dueDate;
        
        // Calculate next day
        let newDueDate;
        if (currentDueDate) {
            const date = new Date(currentDueDate);
            date.setDate(date.getDate() + 1);
            newDueDate = date.toISOString().split('T')[0];
        } else {
            // If no due date, set to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            newDueDate = tomorrow.toISOString().split('T')[0];
        }
        
        await updateDoc(taskRef, {
            dueDate: newDueDate,
            nextDueDate: newDueDate,
            updatedAt: new Date().toISOString()
        });
        
        console.log('Task postponed to next day:', newDueDate);
    } catch (error) {
        console.error('Error postponing task:', error);
        alert('Fehler beim Verschieben der Aufgabe');
    }
};

// Delete task
window.deleteTask = async function(taskId) {
    if (!currentUser) return;
    
    if (!confirm('Möchtest du diese Aufgabe wirklich löschen?')) {
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

// Helper functions
function getTodayString() {
    const today = new Date();
    return today.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
