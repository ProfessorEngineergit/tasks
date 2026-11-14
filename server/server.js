#!/usr/bin/env node
// OpenDone server: serves the web app and a small JSON API backed by SQLite.
// No dependencies; needs Node.js 22.5 or newer.
//
//   node server/server.js                       start the server
//   node server/server.js user:add <name>       create a user (asks for a password)
//   node server/server.js user:passwd <name>    set a new password
//   node server/server.js user:list             list users
//   node server/server.js user:delete <name>    delete a user and their tasks
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, newToken, hashToken, rateLimiter, USERNAME_RE, validPassword, SESSION_DAYS } from './auth.js';
import { normalizeTask, applyPatch } from '../web/js/store/common.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(ROOT, 'web');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const env = process.env;
const PORT = Number(env.PORT || 8080);
const HOST = env.HOST || '0.0.0.0';
const DATA_DIR = env.DATA_DIR || join(ROOT, 'data');
const SIGNUP = ['open', 'closed', 'first'].includes(env.OPENDONE_SIGNUP) ? env.OPENDONE_SIGNUP : 'first';
const TRUST_PROXY = /^(1|true|yes)$/i.test(env.OPENDONE_TRUST_PROXY || '');
const SECURE_COOKIES = (env.OPENDONE_SECURE_COOKIES || 'auto').toLowerCase();
const PUBLIC_ORIGIN = (env.OPENDONE_ORIGIN || '').replace(/\/+$/, '');
const COOKIE = 'od_session';
const MAX_BODY = 1024 * 1024;
const MAX_IMPORT_BODY = 10 * 1024 * 1024;
const MAX_TASKS = 20000;

const store = openDb(DATA_DIR);
const { q, tx } = store;

// ── CLI ──────────────────────────────────────────────────────────────────
const [cmd, arg] = process.argv.slice(2);
if (cmd) await runCli(cmd, arg);
else startServer();

async function askPassword(prompt) {
  if (env.OPENDONE_PASSWORD) return env.OPENDONE_PASSWORD;
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    // piped: read the first line
    let data = '';
    for await (const chunk of stdin) { data += chunk; if (data.includes('\n')) break; }
    return data.split('\n')[0];
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let pw = '';
    const onData = ch => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); resolve(pw);
      } else if (ch === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); reject(new Error('aborted')); }
      else if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
      else pw += ch;
    };
    stdin.on('data', onData);
  });
}

async function runCli(command, name) {
  const fail = msg => { console.error(msg); process.exit(1); };
  try {
    if (command === 'user:list') {
      const users = q.listUsers.all();
      if (!users.length) console.log('No users yet.');
      for (const u of users) console.log(`${u.username}${u.is_admin ? ' (admin)' : ''} · ${u.tasks} tasks · since ${u.created_at.slice(0, 10)}`);
    } else if (command === 'user:add' || command === 'user:passwd') {
      if (!name || !USERNAME_RE.test(name)) fail('Usage: user:add <name>  (2–32 characters: letters, digits, . _ -)');
      const existing = q.userByName.get(name);
      if (command === 'user:add' && existing) fail(`User "${name}" already exists.`);
      if (command === 'user:passwd' && !existing) fail(`User "${name}" does not exist.`);
      const pw = await askPassword(`Password for ${name}: `);
      if (!validPassword(pw)) fail('The password needs at least 8 characters.');
      if (existing) {
        q.setPass.run(hashPassword(pw), existing.id);
        q.delUserSessions.run(existing.id);
        console.log(`Password for "${name}" changed. Existing sessions were signed out.`);
      } else {
        const first = q.countUsers.get().n === 0;
        q.addUser.run(name, hashPassword(pw), first ? 1 : 0, new Date().toISOString());
        console.log(`User "${name}" created${first ? ' (admin)' : ''}.`);
      }
    } else if (command === 'user:delete') {
      const u = name && q.userByName.get(name);
      if (!u) fail(`User "${name}" does not exist.`);
      q.delUser.run(u.id);
      console.log(`User "${name}" and their tasks were deleted.`);
    } else if (command === 'help' || command === '--help' || command === '-h') {
      console.log('Commands: user:add <name>, user:passwd <name>, user:list, user:delete <name>. Without a command the server starts.');
    } else if (command === '--version' || command === '-v') {
      console.log(VERSION);
    } else {
      fail(`Unknown command "${command}". Try "help".`);
    }
  } catch (e) { fail(e.message); }
  store.close();
  process.exit(0);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = body === undefined ? '' : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers,
  });
  res.end(payload);
}
const error = (res, status, code) => send(res, status, { error: code });

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, value, maxAge) {
  const secure = SECURE_COOKIES === 'true' || (SECURE_COOKIES === 'auto' && isHttps(req));
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function readJson(req, limit = MAX_BODY) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw Object.assign(new Error('unsupported_media_type'), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

// Requests that change data must come from this site (CSRF defense on top of SameSite=Strict).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetch from older browsers / curl
  if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
  try {
    const host = (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
    return new URL(origin).host === host;
  } catch { return false; }
}

// ── Sessions ─────────────────────────────────────────────────────────────
function createSession(req, res, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  q.addSession.run(hashToken(token), userId, new Date().toISOString(), expires);
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const th = hashToken(token);
  const row = q.session.get(th);
  if (!row) return null;
  const now = Date.now();
  const exp = Date.parse(row.expires_at);
  if (exp < now) { q.delSession.run(th); return null; }
  // Sliding expiry: refresh once a day.
  if (exp - now < (SESSION_DAYS - 1) * 864e5) q.touchSession.run(new Date(now + SESSION_DAYS * 864e5).toISOString(), th);
  return { id: row.user_id, name: row.username, admin: !!row.is_admin, tokenHash: th };
}
setInterval(() => q.purgeSessions.run(new Date().toISOString()), 3600e3).unref();

const publicUser = u => ({ name: u.name ?? u.username, admin: !!(u.admin ?? u.is_admin) });

// 'first': only the very first account can be created in the browser (it becomes admin).
// 'open': anyone who can reach the server may create an account.
// 'closed': accounts are created on the command line only.
function signupMode() {
  if (SIGNUP === 'closed') return 'closed';
  if (q.countUsers.get().n === 0) return 'first';
  return SIGNUP === 'open' ? 'open' : 'closed';
}

// ── Live updates (server-sent events) ────────────────────────────────────
const streams = new Map(); // userId -> Set<res>
function notify(userId) {
  for (const res of streams.get(userId) || []) res.write(`event: change\ndata: ${Date.now()}\n\n`);
}
setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

// ── API ──────────────────────────────────────────────────────────────────
const loginLimit = rateLimiter({ limit: 10, windowMs: 60_000 });
const nameLimit = rateLimiter({ limit: 20, windowMs: 15 * 60_000 });

const readTask = (uid, id) => { const r = q.task.get(uid, id); return r ? JSON.parse(r.data) : null; };
const writeTask = (uid, t) => q.putTask.run(uid, t.id, JSON.stringify(t), t.updatedAt);

async function api(req, res, path) {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return error(res, 403, 'bad_origin');

  if (path === 'health' && method === 'GET') {
    return send(res, 200, { app: 'opendone', version: VERSION, signup: signupMode() });
  }

  if (path === 'auth/login' && method === 'POST') {
    const ip = clientIp(req);
    if (!loginLimit(ip)) return error(res, 429, 'rate_limited');
    const { username, password } = await readJson(req);
    if (typeof username !== 'string' || typeof password !== 'string') return error(res, 400, 'invalid_credentials');
    if (!nameLimit(username.toLowerCase())) return error(res, 429, 'rate_limited');
    const user = q.userByName.get(username.trim());
    const ok = verifyPassword(password, user?.pass_hash);
    if (!user || !ok) return error(res, 401, 'invalid_credentials');
    createSession(req, res, user.id);
    return send(res, 200, { user: publicUser(user) });
  }

  if (path === 'auth/signup' && method === 'POST') {
    if (!loginLimit(clientIp(req))) return error(res, 429, 'rate_limited');
    const { username, password } = await readJson(req);
    const mode = signupMode();
    if (mode === 'closed') return error(res, 403, 'signup_closed');
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) return error(res, 400, 'invalid_username');
    if (!validPassword(password)) return error(res, 400, 'weak_password');
    const name = username.trim();
    const created = tx(() => {
      if (q.userByName.get(name)) return null;
      const first = q.countUsers.get().n === 0;
      if (!first && signupMode() !== 'open') return 'closed';
      const r = q.addUser.run(name, hashPassword(password), first ? 1 : 0, new Date().toISOString());
      return q.userById.get(Number(r.lastInsertRowid));
    })();
    if (created === 'closed') return error(res, 403, 'signup_closed');
    if (!created) return error(res, 409, 'username_taken');
    createSession(req, res, created.id);
    return send(res, 201, { user: publicUser(created) });
  }

  const user = currentUser(req);
  if (path === 'auth/logout' && method === 'POST') {
    if (user) q.delSession.run(user.tokenHash);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return send(res, 204);
  }
  if (!user) return error(res, 401, 'unauthorized');

  if (path === 'me' && method === 'GET') return send(res, 200, { user: publicUser(user) });

  if (path === 'events' && method === 'GET') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    if (!streams.has(user.id)) streams.set(user.id, new Set());
    streams.get(user.id).add(res);
    req.on('close', () => streams.get(user.id)?.delete(res));
    return;
  }

  if (path === 'tasks' && method === 'GET') {
    return send(res, 200, { tasks: q.tasks.all(user.id).map(r => JSON.parse(r.data)) });
  }

  if (path === 'tasks' && method === 'POST') {
    const t = normalizeTask(await readJson(req));
    if (!t) return error(res, 400, 'invalid_task');
    if (!readTask(user.id, t.id) && q.countTasks.get(user.id).n >= MAX_TASKS) return error(res, 403, 'too_many_tasks');
    writeTask(user.id, t);
    notify(user.id);
    return send(res, 201, { task: t });
  }

  if (path === 'tasks/import' && method === 'POST') {
    const body = await readJson(req, MAX_IMPORT_BODY);
    if (!Array.isArray(body.tasks)) return error(res, 400, 'invalid_import');
    const clean = body.tasks.slice(0, MAX_TASKS).map(normalizeTask).filter(Boolean);
    if (q.countTasks.get(user.id).n + clean.length > MAX_TASKS) return error(res, 403, 'too_many_tasks');
    tx(() => { for (const t of clean) writeTask(user.id, t); })();
    notify(user.id);
    return send(res, 200, { imported: clean.length });
  }

  const m = path.match(/^tasks\/([\w-]{1,80})$/);
  if (m && method === 'PATCH') {
    const patch = await readJson(req);
    const cur = readTask(user.id, m[1]);
    if (!cur) return error(res, 404, 'not_found');
    const t = applyPatch(cur, patch && typeof patch === 'object' ? patch : {});
    if (!t) return error(res, 400, 'invalid_task');
    writeTask(user.id, t);
    notify(user.id);
    return send(res, 200, { task: t });
  }
  if (m && method === 'DELETE') {
    q.delTask.run(user.id, m[1]);
    notify(user.id);
    return send(res, 204);
  }

  if (path === 'prefs' && method === 'GET') {
    const row = q.prefs.get(user.id);
    return send(res, 200, {
      settings: row?.settings ? JSON.parse(row.settings) : null,
      order: row?.task_order ? JSON.parse(row.task_order) : null,
    });
  }
  if (path === 'prefs' && method === 'PUT') {
    const body = await readJson(req);
    if ('settings' in body) {
      if (body.settings !== null && (typeof body.settings !== 'object' || Array.isArray(body.settings))) return error(res, 400, 'invalid_settings');
      const json = JSON.stringify(body.settings);
      if (json.length > 64 * 1024) return error(res, 413, 'payload_too_large');
      q.putSettings.run(user.id, json);
    }
    if ('order' in body) {
      const order = body.order;
      if (order !== null && (!Array.isArray(order) || order.length > MAX_TASKS || !order.every(x => typeof x === 'string' && x.length <= 80))) return error(res, 400, 'invalid_order');
      q.putOrder.run(user.id, JSON.stringify(order));
    }
    return send(res, 204);
  }

  return error(res, 404, 'not_found');
}

// ── Static files ─────────────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'method_not_allowed');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return error(res, 400, 'bad_path'); }
  if (rel.includes('\0') || rel.split('/').some(s => s.startsWith('.') && s !== '')) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB + sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const immutable = /\/(fonts|icons|vendor)\//.test(rel);
    const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, { ETag: etag });
    const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache' };
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.method === 'HEAD') return send(res, 200, undefined, headers);
    return send(res, 200, await readFile(file), headers);
  } catch {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

// ── Server ───────────────────────────────────────────────────────────────
function startServer() {
  const server = createServer(async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch { return error(res, 400, 'bad_request'); }
    try {
      if (pathname.startsWith('/api/')) await api(req, res, pathname.slice(5));
      else await serveStatic(req, res, pathname);
    } catch (e) {
      if (e.status) return error(res, e.status, e.message);
      console.error(e);
      if (!res.headersSent) error(res, 500, 'server_error');
      else res.end();
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.listen(PORT, HOST, () => {
    const users = q.countUsers.get().n;
    console.log(`OpenDone ${VERSION} listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Data: ${join(DATA_DIR, 'opendone.db')} · sign-up: ${SIGNUP}${users ? '' : ' · no users yet: the first sign-up becomes admin'}`);
  });
  const shutdown = () => {
    for (const set of streams.values()) for (const r of set) r.end();
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
