// Optional Firebase backend (GitHub login + Firestore), compatible with the
// data written by OpenDone 1.x. Only loaded when config.js contains a Firebase config.
import { normalizeTask, applyPatch } from './common.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function createFirebaseStore(config) {
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);
  let user = null;
  let cache = new Map();

  const tasksCol = () => fs.collection(db, `users/${user.uid}/tasks`);
  const taskDoc = id => fs.doc(db, `users/${user.uid}/tasks`, id);
  const prefDoc = name => fs.doc(db, `users/${user.uid}/settings/${name}`);
  const clean = t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'id'));

  return {
    kind: 'firebase',
    get user() { return user && { name: user.displayName || user.email || 'GitHub' }; },
    init() {
      return new Promise(resolve => {
        const off = authMod.onAuthStateChanged(auth, u => {
          off(); user = u;
          resolve(u ? { user: this.user, needsAuth: false } : { user: null, needsAuth: true });
        });
      });
    },
    async loginWithGitHub() {
      const res = await authMod.signInWithPopup(auth, new authMod.GithubAuthProvider());
      user = res.user; return this.user;
    },
    async logout() { await authMod.signOut(auth); },
    subscribe(fn) {
      return fs.onSnapshot(fs.query(tasksCol()), snap => {
        const list = [];
        snap.forEach(d => { const t = normalizeTask({ ...d.data(), id: d.id }); if (t) list.push(t); });
        cache = new Map(list.map(t => [t.id, t]));
        fn(list);
      });
    },
    async add(task) { const t = normalizeTask(task); await fs.setDoc(taskDoc(t.id), clean(t)); return t; },
    async update(id, patch) {
      const cur = cache.get(id); if (!cur) return null;
      const t = applyPatch(cur, patch);
      await fs.setDoc(taskDoc(id), clean(t));
      return t;
    },
    async remove(id) { await fs.deleteDoc(taskDoc(id)); },
    async importTasks(list) {
      let n = 0;
      for (const raw of list) { const t = normalizeTask(raw); if (t) { await fs.setDoc(taskDoc(t.id), clean(t)); n++; } }
      return n;
    },
    async loadPrefs() {
      const [s, o] = await Promise.all([fs.getDoc(prefDoc('preferences')), fs.getDoc(prefDoc('order'))]);
      return { settings: s.exists() ? s.data() : null, order: o.exists() ? o.data().order ?? null : null };
    },
    async savePrefs({ settings, order }) {
      if (settings !== undefined) await fs.setDoc(prefDoc('preferences'), settings);
      if (order !== undefined) await fs.setDoc(prefDoc('order'), { order });
    },
    flushOnExit() {},
  };
}
