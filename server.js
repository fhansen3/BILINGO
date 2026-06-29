'use strict';

process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException]', err && err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL unhandledRejection]', err && err.stack || err);
  process.exit(1);
});

console.log('[boot] starting BiLingo Meet…');
console.log('[boot] node', process.version, 'pid', process.pid);
console.log('[boot] PORT env =', process.env.PORT, 'DB_HOST set?', !!process.env.DB_HOST);
console.log('[boot] BASE_PATH =', JSON.stringify(process.env.BASE_PATH || ''));

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');
const expressLayouts = require('express-ejs-layouts');
const http = require('http');
const { Server } = require('socket.io');

const env = require('./config/env');
console.log('[boot] env loaded, port =', env.port);
const routes = require('./routes');
const { errorHandler } = require('./middleware/errors');
const { attachSockets } = require('./sockets');
const { setIO } = require('./sockets/io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// View engine: EJS with layout support
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// cookie-session for server-rendered auth flows
app.use(cookieSession({
  name: 'bm.sess',
  keys: [env.jwt.secret, env.jwt.secret + '-fallback'],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  httpOnly: true,
  sameSite: 'lax'
}));

app.use(express.static(path.join(__dirname, 'public')));

// JSON API
app.use('/api', routes);

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Server-rendered auth flows (signup, login, logout, forgot/reset password)
app.use('/', require('./routes/auth'));

// Server-rendered public pages (landing, help, /join handler)
const publicRoutes = require('./routes/public');
app.use('/', publicRoutes);

// Authenticated app shell (server-rendered EJS):
//   /dashboard, /profile, /account-settings
// Mounted BEFORE the SPA fallback so these paths render real pages.
app.use('/', require('./routes/app'));

// Friendly aliases so legacy links (/app, /app/profile) that used to hit the
// SPA now land on the server-rendered EJS pages where the sidebar with the
// admin menu lives.
app.get('/app', (req, res) => res.redirect('dashboard'));
app.get('/app/profile', (req, res) => res.redirect('profile'));
app.get('/app/account', (req, res) => res.redirect('account-settings'));

// Meetings setup (server-rendered EJS):
//   POST /meetings/instant, POST /rooms/new
//   GET/POST /schedule
//   GET /m/:code, GET /m/:code/lobby
app.use('/', require('./routes/meetings'));

// Admin pages (server-rendered EJS):
//   GET /admin, /admin/users, /admin/languages, /admin/usage
//   POST /admin/users/:id/{suspend,activate,role}
//   POST /admin/languages, /admin/languages/:id/toggle
//   POST /admin/voices, /admin/voices/:id/toggle
app.use('/', require('./routes/admin'));

// SPA fallback for the existing client-side router.
// Serves the SPA shell for any non-API, non-file GET that wasn't matched above.
// Known app routes that the SPA handles client-side.
// NOTE: /login, /signup, /register, and password flows are now server-rendered
// (above) so they are intentionally NOT in this list.
// /dashboard and /profile are now server-rendered above, so they are
// intentionally NOT in this list. /account-settings is also server-rendered.
const spaPrefixes = ['/app', '/partners', '/room'];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  if (path.extname(req.path)) return next();
  const isSpaRoute = spaPrefixes.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!isSpaRoute) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 — anything that fell through above
app.use(publicRoutes.notFoundHandler);

app.use(errorHandler);

setIO(io);
attachSockets(io);

// Sweeper: closes zombie meetings + backfills missing usage every 5 min.
try {
  const sweeper = require('./services/meetingSweeper');
  sweeper.start();
} catch (e) {
  console.error('[boot] meetingSweeper failed to start (non-fatal):', e && e.message || e);
}

server.listen(env.port, () => {
  console.log(`[boot] BiLingo Meet listening on port ${env.port}`);
});