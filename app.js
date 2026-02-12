// Firebase v9 SDK imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, GithubAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Firebase Configuration (Add your Firebase config here)
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
        const tasksRef = collection(db, `users/${currentUser.uid}/tasks`);
        await addDoc(tasksRef, {
            title: title,
            dueDate: dueDate || null,
            status: 0, // 0 = Todo, 1 = In Progress, 2 = Done
            repeatType: repeatType,
            lastReset: repeatType === 'daily' ? getTodayString() : null,
            createdAt: new Date().toISOString()
        });
        
        // Clear form
        document.getElementById('task-title').value = '';
        document.getElementById('task-due').value = '';
        document.getElementById('task-repeat').value = 'none';
        
        console.log('Task added successfully');
    } catch (error) {
        console.error('Error adding task:', error);
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
        
        // Check and reset recurring tasks before displaying
        checkRecurringTasks(tasks, uid);
        
        // Display tasks
        displayTasks(tasks);
    }, (error) => {
        console.error('Error loading tasks:', error);
        tasksContainer.innerHTML = '<div class="error">Fehler beim Laden der Aufgaben</div>';
    });
}

// Check and reset recurring tasks
async function checkRecurringTasks(tasks, uid) {
    const today = getTodayString();
    
    for (const task of tasks) {
        // Check if task is daily, done, and needs reset
        if (task.repeatType === 'daily' && task.status === 2 && task.lastReset !== today) {
            try {
                const taskRef = doc(db, `users/${uid}/tasks`, task.id);
                await updateDoc(taskRef, {
                    status: 0,
                    lastReset: today
                });
                console.log(`Reset daily task: ${task.title}`);
            } catch (error) {
                console.error('Error resetting task:', error);
            }
        }
    }
}

// Display tasks in the UI
function displayTasks(tasks) {
    if (tasks.length === 0) {
        tasksContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                <p>Keine Aufgaben vorhanden. Erstelle deine erste Aufgabe!</p>
            </div>
        `;
        return;
    }
    
    const tasksHTML = tasks.map(task => {
        const statusLabels = ['Todo', 'In Progress', 'Done'];
        const statusClasses = ['todo', 'in-progress', 'done'];
        const statusLabel = statusLabels[task.status];
        const statusClass = statusClasses[task.status];
        
        const dueDateText = task.dueDate ? `Fällig: ${formatDate(task.dueDate)}` : 'Kein Datum';
        const repeatText = task.repeatType === 'daily' ? '🔄 Täglich' : '';
        
        return `
            <div class="task-item status-${task.status}">
                <div class="task-info">
                    <div class="task-title">${escapeHtml(task.title)}</div>
                    <div class="task-details">
                        ${dueDateText} ${repeatText ? '• ' + repeatText : ''}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="status-btn ${statusClass}" onclick="changeTaskStatus('${task.id}', ${task.status}, '${task.repeatType}')">
                        ${statusLabel}
                    </button>
                    <button class="delete-btn" onclick="deleteTask('${task.id}')">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    tasksContainer.innerHTML = tasksHTML;
}

// Change task status (0 -> 1 -> 2 -> 0)
window.changeTaskStatus = async function(taskId, currentStatus, repeatType) {
    if (!currentUser) return;
    
    // Cycle through statuses: 0 -> 1 -> 2 -> 0
    const nextStatus = (currentStatus + 1) % 3;
    
    try {
        const taskRef = doc(db, `users/${currentUser.uid}/tasks`, taskId);
        const updateData = { status: nextStatus };
        
        // If changing to done (status 2) and it's a daily task, set lastReset
        if (nextStatus === 2 && repeatType === 'daily') {
            updateData.lastReset = getTodayString();
        }
        
        await updateDoc(taskRef, updateData);
        console.log('Task status updated');
    } catch (error) {
        console.error('Error updating task status:', error);
        alert('Fehler beim Aktualisieren des Status');
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
