// SQLite storage via Node's built-in node:sqlite. One file, no dependencies.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// node:sqlite still prints an "experimental" warning on Node 22; hide only that one.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'opendone.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash  TEXT NOT NULL,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS tasks (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS prefs (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings   TEXT,
      task_order TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1');
  `);

  const q = {
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    listUsers: db.prepare('SELECT u.id, u.username, u.is_admin, u.created_at, (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS tasks FROM users u ORDER BY u.id'),
    addUser: db.prepare('INSERT INTO users (username, pass_hash, is_admin, created_at) VALUES (?, ?, ?, ?)'),
    setPass: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    delUser: db.prepare('DELETE FROM users WHERE id = ?'),

    addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.user_id, s.expires_at, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

    tasks: db.prepare('SELECT data FROM tasks WHERE user_id = ?'),
    task: db.prepare('SELECT data FROM tasks WHERE user_id = ? AND id = ?'),
    countTasks: db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?'),
    putTask: db.prepare('INSERT INTO tasks (user_id, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
    delTask: db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?'),

    prefs: db.prepare('SELECT settings, task_order FROM prefs WHERE user_id = ?'),
    putSettings: db.prepare('INSERT INTO prefs (user_id, settings) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings'),
    putOrder: db.prepare('INSERT INTO prefs (user_id, task_order) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET task_order = excluded.task_order'),
  };

  const tx = fn => (...args) => {
    db.exec('BEGIN');
    try { const r = fn(...args); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  return { db, q, tx, close: () => db.close() };
}
