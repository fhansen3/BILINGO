'use strict';

/**
 * Session-based requireAuth for server-rendered pages.
 *
 * If a session user exists, attaches it to req.user and continues.
 * Otherwise:
 *   - JSON requests get 401 JSON.
 *   - HTML/browser requests get redirected to /login?next=<original-path>.
 *
 * NOTE: The SPA / JSON API uses the JWT-based middleware in ./auth.js
 * (requireAuth, requireRole). This one is for the EJS flows only.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    req.user = req.session.user;
    return next();
  }

  // API-style request? Return JSON.
  if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Browser request — redirect to login, preserving the intended destination.
  const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${next_}`);
}

function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = { requireAuth, redirectIfAuthed };