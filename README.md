# 📋 To-Do App mit Firebase und GitHub Auth

Eine moderne To-Do-App, die auf GitHub Pages gehostet wird und Firebase v9 SDK für Authentication und Firestore verwendet.

## ✨ Features

- 🔐 **GitHub OAuth Login** - Sichere Authentifizierung über GitHub
- 📝 **Task Management** - Erstellen, anzeigen und löschen von Aufgaben
- 🔄 **Status-Tracking** - Drei Status-Stufen: Todo → In Progress → Done
- ⏰ **Fälligkeitsdaten** - Optionale Deadlines für Tasks
- 🔁 **Wiederkehrende Aufgaben** - Tägliche Tasks, die automatisch zurückgesetzt werden
- ⚡ **Echtzeit-Updates** - Automatische Synchronisation mit Firestore
- 👤 **User-spezifisch** - Jeder Nutzer sieht nur seine eigenen Tasks

## 🚀 Setup-Anleitung

### 1. Firebase Projekt erstellen

1. Gehe zu [Firebase Console](https://console.firebase.google.com/)
2. Klicke auf "Projekt hinzufügen" und folge den Anweisungen
3. Gebe deinem Projekt einen Namen (z.B. "tasks-app")

### 2. Firebase Authentication einrichten

1. In der Firebase Console → **Authentication** → **Get Started**
2. Gehe zu **Sign-in method**
3. Aktiviere **GitHub** als Sign-in Provider
4. Du benötigst eine GitHub OAuth App:
   - Gehe zu [GitHub Developer Settings](https://github.com/settings/developers)
   - Klicke auf **New OAuth App**
   - **Application name**: Tasks App
   - **Homepage URL**: `https://professorengineergit.github.io/tasks/`
   - **Authorization callback URL**: Kopiere die URL aus Firebase (z.B. `https://YOUR-PROJECT.firebaseapp.com/__/auth/handler`)
   - Klicke auf **Register application**
   - Kopiere **Client ID** und **Client Secret**
5. Füge Client ID und Client Secret in Firebase ein
6. Klicke auf **Speichern**

### 3. Firestore Database einrichten

1. In der Firebase Console → **Firestore Database** → **Create database**
2. Wähle **Start in production mode**
3. Wähle einen Standort (z.B. europe-west3)
4. Klicke auf **Enable**
5. Gehe zu **Rules** und ändere die Regeln wie folgt:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users können nur ihre eigenen Daten lesen/schreiben
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

6. Klicke auf **Publish**

### 4. Firebase Config einfügen

1. In der Firebase Console → **Projekteinstellungen** (Zahnrad-Symbol)
2. Scrolle zu **Deine Apps** → Klicke auf **Web App** (`</>` Icon)
3. Registriere die App (Name: "Tasks Web App")
4. Kopiere die Firebase Config (das JavaScript-Objekt)
5. Öffne `app.js` in deinem Repository
6. Ersetze die Platzhalter in `firebaseConfig`:

```javascript
const firebaseConfig = {
    apiKey: "AIza...",  // Dein API Key
    authDomain: "tasks-xxxxx.firebaseapp.com",
    projectId: "tasks-xxxxx",
    storageBucket: "tasks-xxxxx.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:xxxxx"
};
```

7. Committe und pushe die Änderungen

### 5. GitHub Pages aktivieren

1. Gehe zu deinem GitHub Repository
2. **Settings** → **Pages**
3. Unter **Source** wähle **Branch: main** (oder den Branch mit deinem Code)
4. Klicke auf **Save**
5. Die App ist jetzt verfügbar unter: `https://professorengineergit.github.io/tasks/`

## 🎯 Verwendung

### Login

1. Öffne `https://professorengineergit.github.io/tasks/`
2. Klicke auf **"Login mit GitHub"**
3. Autorisiere die App in GitHub
4. Du wirst eingeloggt und siehst dein Dashboard

### Tasks erstellen

1. Gib einen **Titel** für deine Aufgabe ein
2. (Optional) Wähle ein **Fälligkeitsdatum**
3. (Optional) Wähle **"Täglich"** für wiederkehrende Aufgaben
4. Klicke auf **"Aufgabe hinzufügen"**

### Status ändern

- Klicke auf den Status-Button eines Tasks
- Der Status wechselt: **Todo** → **In Progress** → **Done** → **Todo**
- Farben helfen bei der Orientierung:
  - Grau = Todo
  - Gelb = In Progress
  - Grün = Done

### Wiederkehrende Tasks

- Tasks mit **"Täglich"** werden automatisch zurückgesetzt
- Wenn ein täglicher Task auf **"Done"** gesetzt wird, wird er am nächsten Tag automatisch wieder zu **"Todo"**
- Das passiert beim Laden der App oder bei Echtzeit-Updates

### Logout

- Klicke auf den **"Logout"** Button oben rechts
- Du wirst abgemeldet und siehst wieder den Login-Screen

## 🔒 Sicherheit

- Jeder User hat Zugriff nur auf seine eigenen Tasks
- Tasks werden unter `users/{userId}/tasks` gespeichert
- Firebase Security Rules verhindern unautorisierten Zugriff
- GitHub OAuth sorgt für sichere Authentifizierung

## 🛠️ Technologie-Stack

- **Frontend**: Vanilla JavaScript (ES6 Modules)
- **Backend**: Firebase (Firestore + Authentication)
- **Auth**: GitHub OAuth via Firebase
- **Hosting**: GitHub Pages
- **SDK**: Firebase v9 (modular)

## 📱 Features im Detail

### Datenpfad
```
Firestore Structure:
└── users
    └── {github-user-id}
        └── tasks
            └── {task-id}
                ├── title: string
                ├── dueDate: string | null
                ├── status: number (0-2)
                ├── repeatType: 'none' | 'daily'
                ├── lastReset: string | null
                └── createdAt: string
```

### Task Status
- **0** = Todo (Zu erledigen)
- **1** = In Progress (In Bearbeitung)
- **2** = Done (Erledigt)

### Wiederkehrende Tasks Logik
```javascript
// Wird beim Laden der Tasks ausgeführt
checkRecurringTasks():
  - Wenn task.repeatType === 'daily'
  - UND task.status === 2 (Done)
  - UND task.lastReset !== heute
  → Setze status = 0 und lastReset = heute
```

## 🤝 Entwicklung

```bash
# Repository klonen
git clone https://github.com/ProfessorEngineergit/tasks.git

# In das Verzeichnis wechseln
cd tasks

# Dateien bearbeiten
# index.html - UI und Styling
# app.js - Logic und Firebase Integration

# Änderungen testen
# Öffne index.html in einem Browser mit Live Server
# ODER pushe zu GitHub und teste auf GitHub Pages
```

## 📝 Lizenz

Dieses Projekt ist Open Source und kann frei verwendet werden.

## 🐛 Bekannte Einschränkungen

- Firebase Config muss manuell eingefügt werden
- Funktioniert nur mit konfigurierten Firebase Credentials
- Benötigt Internet-Verbindung für Firebase Services

## 💡 Erweiterungsideen

- [ ] Kategorien/Tags für Tasks
- [ ] Prioritäten (Low, Medium, High)
- [ ] Notizen/Beschreibungen für Tasks
- [ ] Wöchentliche/Monatliche Wiederholungen
- [ ] Dark Mode
- [ ] Drag & Drop zum Sortieren
- [ ] Export als PDF/JSON
- [ ] Benachrichtigungen für Fälligkeitsdaten