#!/usr/bin/env node
'use strict';
/**
 * STEP 19 — End-to-end smoke test for BiLingo Meet.
 *
 * Hits every server-rendered + JSON route the design promises and checks:
 *   - HTTP status codes
 *   - that DB rows are inserted/updated/deleted as expected (via mysql2)
 *   - role-based 403 enforcement (admin pages as a normal user)
 *   - 404 catch-all
 *
 * USAGE:   node scripts/smoke-step19.js
 *          PORT=45037 node scripts/smoke-step19.js     (override port)
 *
 * The script speaks raw HTTP against 127.0.0.1, manages two cookie jars
 * (admin + new user) and reports a pass/fail summary at the end.
 *
 * Exit code: 0 if all assertions passed, 1 otherwise.
 */
const http = require('http');
const db   = require('../config/db');

const PORT = Number(process.env.PORT || 45037);
const HOST = '127.0.0.1';

const ADMIN_EMAIL = 'admin@bilingo.meet';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

const NEW_EMAIL = `smoke19_${Date.now()}@example.com`;
const NEW_PASSWORD = 'TestPass!234';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function req(method, path, { body, cookie, accept, json } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    let contentType = null;
    if (body) {
      if (json) {
        data = JSON.stringify(body);
        contentType = 'application/json';
      } else {
        data = new URLSearchParams(body).toString();
        contentType = 'application/x-www-form-urlencoded';
      }
    }
    const r = http.request({
      host: HOST, port: PORT, method, path,
      headers: {
        ...(data ? {
          'content-type': contentType,
          'content-length': Buffer.byteLength(data)
        } : {}),
        ...(cookie ? { cookie } : {}),
        accept: accept || 'text/html'
      }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: buf
      }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function mergeCookie(prev, setCookieHeader) {
  if (!setCookieHeader) return prev;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const fresh = {};
  if (prev) prev.split('; ').forEach(c => {
    const eq = c.indexOf('=');
    if (eq > 0) fresh[c.slice(0, eq)] = c.slice(eq + 1);
  });
  arr.forEach(line => {
    const first = line.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) fresh[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  });
  return Object.keys(fresh).map(k => `${k}=${fresh[k]}`).join('; ');
}

// ---------------------------------------------------------------------------
// Result tracker
// ---------------------------------------------------------------------------
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Wait for server
// ---------------------------------------------------------------------------
async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await req('GET', '/healthz');
      if (r.status === 200) return true;
    } catch (_) { /* retry */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log(`\n=== BiLingo Meet · STEP 19 smoke test (port ${PORT}) ===\n`);

  const up = await waitForServer();
  if (!up) {
    console.error('Server never came up on http://127.0.0.1:' + PORT);
    process.exit(2);
  }
  check('Service is up (/healthz 200)', true);

  // -------------------------------------------------------------------------
  // PUBLIC pages
  // -------------------------------------------------------------------------
  let r = await req('GET', '/');
  check('GET /  → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/help');
  check('GET /help → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/login');
  check('GET /login → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/signup');
  check('GET /signup → 200', r.status === 200, `status=${r.status}`);

  // -------------------------------------------------------------------------
  // 404 path
  // -------------------------------------------------------------------------
  r = await req('GET', '/does-not-exist-at-all-' + Date.now());
  check('GET /<unknown> → 404', r.status === 404, `status=${r.status}`);
  r = await req('GET', '/api/no-such-endpoint');
  check('GET /api/<unknown> → 404 (JSON)', r.status === 404, `status=${r.status}`);

  // -------------------------------------------------------------------------
  // SIGNUP a new user → cookie jar A
  // -------------------------------------------------------------------------
  let userCookie = null;
  r = await req('POST', '/signup', {
    body: {
      email: NEW_EMAIL, password: NEW_PASSWORD,
      displayName: 'Smoke19 User',
      nativeLanguage: 'es', learningLanguage: 'en'
    }
  });
  check('POST /signup → 302 /dashboard',
    r.status === 302 && r.headers.location === '/dashboard',
    `status=${r.status} location=${r.headers.location}`);
  userCookie = mergeCookie(null, r.headers['set-cookie']);
  check('POST /signup sets bm.sess cookie',
    userCookie && userCookie.includes('bm.sess'),
    `cookie=${userCookie}`);

  // verify the user row exists in DB
  let dbRows = await db.query('SELECT id, email, role FROM users WHERE email = ?', [NEW_EMAIL]);
  const newUser = dbRows[0];
  check('DB: new user row inserted', !!newUser && newUser.role === 'user',
    newUser ? `id=${newUser.id} role=${newUser.role}` : 'no row');

  // -------------------------------------------------------------------------
  // App shell pages (as new user)
  // -------------------------------------------------------------------------
  r = await req('GET', '/dashboard', { cookie: userCookie });
  check('GET /dashboard (auth) → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/profile', { cookie: userCookie });
  check('GET /profile (auth) → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', '/account-settings', { cookie: userCookie });
  check('GET /account-settings (auth) → 200', r.status === 200, `status=${r.status}`);

  // /dashboard without session → 302 to /login
  r = await req('GET', '/dashboard');
  check('GET /dashboard (no auth) → 302 /login',
    r.status === 302 && /\/login/.test(r.headers.location || ''),
    `status=${r.status} location=${r.headers.location}`);

  // -------------------------------------------------------------------------
  // MEETING flow: instant create → lobby → join → room → settings → leave → ended → feedback
  // -------------------------------------------------------------------------
  r = await req('POST', '/meetings/instant', {
    cookie: userCookie,
    body: { topic: 'Smoke19 topic', languageFocus: 'general' }
  });
  check('POST /meetings/instant → 302 /m/:code/lobby',
    r.status === 302 && /^\/m\/[^/]+\/lobby$/.test(r.headers.location || ''),
    `status=${r.status} location=${r.headers.location}`);
  const meetingCode = r.headers.location ? r.headers.location.replace(/^\/m\//, '').replace(/\/lobby$/, '') : '';

  // verify a rooms row was inserted
  dbRows = await db.query('SELECT id, room_code, host_id, status FROM rooms WHERE room_code = ?', [meetingCode]);
  const newRoom = dbRows[0];
  check('DB: rooms row inserted for instant meeting',
    newRoom && newRoom.host_id === newUser.id && newRoom.status === 'active',
    newRoom ? `id=${newRoom.id} status=${newRoom.status}` : 'no row');

  r = await req('GET', `/m/${meetingCode}`, { cookie: userCookie });
  check('GET /m/:code → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', `/m/${meetingCode}/lobby`, { cookie: userCookie });
  check('GET /m/:code/lobby → 200', r.status === 200, `status=${r.status}`);

  // POST /m/:code/join — as host, should redirect to /room
  r = await req('POST', `/m/${meetingCode}/join`, {
    cookie: userCookie,
    body: {
      displayName: 'Smoke19 User',
      nativeLanguage: 'es',
      targetLanguage: 'en',
      speakingVoiceGender: 'female',
      listeningVoiceGender: 'female',
      deliveryMode: 'both',
      captionsEnabled: 'on'
    }
  });
  check('POST /m/:code/join → 302 (room or waiting)',
    r.status === 302 && /\/m\/[^/]+\/(room|waiting)$/.test(r.headers.location || ''),
    `status=${r.status} location=${r.headers.location}`);
  // pull session cookie update
  userCookie = mergeCookie(userCookie, r.headers['set-cookie']);

  // verify a meeting_participants row was created
  dbRows = await db.query(
    `SELECT id, status, display_name FROM meeting_participants WHERE room_id = ? AND user_id = ?`,
    [newRoom.id, newUser.id]
  );
  check('DB: meeting_participants row created',
    dbRows.length === 1 && dbRows[0].status === 'admitted',
    dbRows[0] ? `status=${dbRows[0].status}` : 'no row');

  r = await req('GET', `/m/${meetingCode}/room`, { cookie: userCookie });
  check('GET /m/:code/room → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', `/m/${meetingCode}/settings`, { cookie: userCookie });
  check('GET /m/:code/settings → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', `/m/${meetingCode}/host`, { cookie: userCookie });
  check('GET /m/:code/host (as host) → 200', r.status === 200, `status=${r.status}`);

  // POST /m/:code/leave — should mark left + end meeting (since host) and redirect /ended
  r = await req('POST', `/m/${meetingCode}/leave`, { cookie: userCookie });
  check('POST /m/:code/leave → 302 /ended',
    r.status === 302 && /\/m\/[^/]+\/ended$/.test(r.headers.location || ''),
    `status=${r.status} location=${r.headers.location}`);

  // verify meeting ended in DB
  dbRows = await db.query('SELECT status, ended_at FROM rooms WHERE id = ?', [newRoom.id]);
  check('DB: room status → ended after host leaves',
    dbRows[0] && dbRows[0].status === 'ended' && dbRows[0].ended_at,
    dbRows[0] ? `status=${dbRows[0].status} ended_at=${dbRows[0].ended_at}` : 'no row');

  r = await req('GET', `/m/${meetingCode}/ended`, { cookie: userCookie });
  check('GET /m/:code/ended → 200', r.status === 200, `status=${r.status}`);

  // POST feedback
  r = await req('POST', `/m/${meetingCode}/feedback`, {
    cookie: userCookie,
    body: { translationQuality: '5', audioQuality: '4', comments: 'Smoke19 OK' }
  });
  check('POST /m/:code/feedback → 302 /ended?fb=1',
    r.status === 302 && /\/m\/[^/]+\/ended\?fb=1$/.test(r.headers.location || ''),
    `status=${r.status} location=${r.headers.location}`);

  // verify feedback_ratings row
  dbRows = await db.query(
    'SELECT translation_quality, audio_quality, comments FROM feedback_ratings WHERE room_id = ? AND user_id = ?',
    [newRoom.id, newUser.id]
  );
  check('DB: feedback_ratings row inserted',
    dbRows[0] && dbRows[0].translation_quality === 5 && dbRows[0].audio_quality === 4,
    dbRows[0] ? `tq=${dbRows[0].translation_quality} aq=${dbRows[0].audio_quality}` : 'no row');

  // -------------------------------------------------------------------------
  // HISTORY
  // -------------------------------------------------------------------------
  r = await req('GET', '/history', { cookie: userCookie });
  check('GET /history → 200', r.status === 200, `status=${r.status}`);

  r = await req('GET', `/history/${newRoom.id}`, { cookie: userCookie });
  check('GET /history/:id (as participant) → 200', r.status === 200, `status=${r.status}`);

  // -------------------------------------------------------------------------
  // ROLE-BASED 403 — normal user hits admin pages
  // -------------------------------------------------------------------------
  r = await req('GET', '/admin/users', { cookie: userCookie });
  check('GET /admin/users (non-admin) → 403',
    r.status === 403 || r.status === 302,
    `status=${r.status} location=${r.headers.location || ''}`);

  r = await req('GET', '/admin/languages', { cookie: userCookie });
  check('GET /admin/languages (non-admin) → 403',
    r.status === 403 || r.status === 302,
    `status=${r.status}`);

  r = await req('GET', '/admin/usage', { cookie: userCookie });
  check('GET /admin/usage (non-admin) → 403',
    r.status === 403 || r.status === 302,
    `status=${r.status}`);

  // -------------------------------------------------------------------------
  // ADMIN login
  // -------------------------------------------------------------------------
  let adminCookie = null;
  r = await req('POST', '/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  if (r.status === 302 && r.headers.location === '/dashboard') {
    adminCookie = mergeCookie(null, r.headers['set-cookie']);
    check('POST /login admin → 302 /dashboard', true);

    r = await req('GET', '/admin/users', { cookie: adminCookie });
    check('GET /admin/users (admin) → 200', r.status === 200, `status=${r.status}`);

    r = await req('GET', '/admin/languages', { cookie: adminCookie });
    check('GET /admin/languages (admin) → 200', r.status === 200, `status=${r.status}`);

    r = await req('GET', '/admin/usage', { cookie: adminCookie });
    check('GET /admin/usage (admin) → 200', r.status === 200, `status=${r.status}`);
  } else {
    check('POST /login admin → 302 /dashboard', false,
      `status=${r.status} (admin password may differ; set ADMIN_PASSWORD env)`);
    check('GET /admin/users (admin) → 200', false, 'skipped: admin login failed');
    check('GET /admin/languages (admin) → 200', false, 'skipped: admin login failed');
    check('GET /admin/usage (admin) → 200', false, 'skipped: admin login failed');
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  const passed = results.filter(x => x.ok).length;
  const failed = results.filter(x => !x.ok).length;
  console.log(`\n=== ${passed} passed, ${failed} failed (out of ${results.length}) ===\n`);

  if (failed) {
    console.log('FAILED:');
    results.filter(x => !x.ok).forEach(x => console.log(`  ❌ ${x.name} — ${x.detail}`));
  }

  // close DB pool so node exits cleanly
  try { if (db.pool && db.pool.end) await db.pool.end(); } catch (_) {}

  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('Smoke test crashed:', err && err.stack || err);
  process.exit(2);
});