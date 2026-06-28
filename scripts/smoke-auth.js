#!/usr/bin/env node
'use strict';
/**
 * Smoke test for the server-rendered auth flow.
 * Hits the running service on localhost:PORT and validates:
 *   1. GET  /signup           → 200
 *   2. GET  /login            → 200
 *   3. GET  /forgot-password  → 200
 *   4. POST /signup           → 302 to /dashboard, sets bm.sess cookie
 *   5. GET  /dashboard with cookie → 200 (SPA shell)
 *   6. GET  /dashboard no cookie    → 302 to /login?next=...
 *   7. POST /logout           → 302 to /
 *   8. POST /login            → 302 to /dashboard
 *   9. POST /forgot-password  → 200 (renders sent state)
 */
const http = require('http');

const PORT = process.env.PORT || 45037;
const HOST = '127.0.0.1';
const EMAIL = `smoke_${Date.now()}@example.com`;
const PASSWORD = 'TestPass!234';

function req(method, path, { body, cookie, accept } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : null;
    const r = http.request({
      host: HOST, port: PORT, method, path,
      headers: {
        ...(data ? {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(data)
        } : {}),
        ...(cookie ? { cookie } : {}),
        ...(accept ? { accept } : { accept: 'text/html' })
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

function extractCookie(setCookie) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const results = [];
  function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail || '' });
    console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  }

  // 1
  let r = await req('GET', '/signup');
  check('GET /signup is 200', r.status === 200, `status=${r.status}, has form=${/name="email"/.test(r.body)}`);

  // 2
  r = await req('GET', '/login');
  check('GET /login is 200', r.status === 200, `status=${r.status}`);

  // 3
  r = await req('GET', '/forgot-password');
  check('GET /forgot-password is 200', r.status === 200, `status=${r.status}`);

  // 4 signup
  r = await req('POST', '/signup', {
    body: {
      email: EMAIL,
      password: PASSWORD,
      displayName: 'Smoke Tester',
      nativeLanguage: 'es',
      learningLanguage: 'en'
    }
  });
  check('POST /signup redirects to /dashboard',
    r.status === 302 && r.headers.location === '/dashboard',
    `status=${r.status}, location=${r.headers.location}`);
  const cookie = extractCookie(r.headers['set-cookie']);
  check('POST /signup sets bm.sess cookie', cookie && cookie.includes('bm.sess'), `cookie=${cookie}`);

  // 5
  r = await req('GET', '/dashboard', { cookie });
  check('GET /dashboard with session → 200', r.status === 200, `status=${r.status}`);

  // 6
  r = await req('GET', '/dashboard');
  check('GET /dashboard without session → 302 to /login',
    r.status === 302 && /\/login/.test(r.headers.location || ''),
    `status=${r.status}, location=${r.headers.location}`);

  // 7 logout
  r = await req('POST', '/logout', { cookie });
  check('POST /logout redirects to /',
    r.status === 302 && r.headers.location === '/',
    `status=${r.status}, location=${r.headers.location}`);

  // 8 login again
  r = await req('POST', '/login', {
    body: { email: EMAIL, password: PASSWORD }
  });
  check('POST /login redirects to /dashboard',
    r.status === 302 && r.headers.location === '/dashboard',
    `status=${r.status}, location=${r.headers.location}`);

  // 8b login wrong password
  r = await req('POST', '/login', {
    body: { email: EMAIL, password: 'wrong-password' }
  });
  check('POST /login wrong pw → 401', r.status === 401, `status=${r.status}`);

  // 9 forgot-password
  r = await req('POST', '/forgot-password', { body: { email: EMAIL } });
  check('POST /forgot-password → 200 (sent state)',
    r.status === 200 && /enviado/i.test(r.body),
    `status=${r.status}`);

  const passed = results.filter(x => x.ok).length;
  const failed = results.filter(x => !x.ok).length;
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});