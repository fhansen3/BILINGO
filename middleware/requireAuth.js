'use strict';

/**
 * Session-based auth middlewares for server-rendered pages.
 *
 * Roles in this app (most permissive first):
 *   - superadmin     → owns the platform (fhansen3@gmail.com). Sees all companies.
 *   - admin          → legacy global admin. Treated like superadmin for now.
 *   - company_admin  → manages a single company (users + costs for that company).
 *   - user           → regular end-user.
 */

function requireAuth(req, res, next) {
  // TEMP DEBUG
  try {
    console.log('[requireAuth]', req.method, req.originalUrl,
      'hasSession=', !!req.session,
      'hasUser=', !!(req.session && req.session.user),
      'userId=', req.session && req.session.user && req.session.user.id,
      'cookieHeader=', (req.headers.cookie || '').slice(0, 200),
      'accept=', (req.headers.accept || '').slice(0, 120),
      'acceptsHtml=', req.accepts('html'),
      'acceptsJson=', req.accepts('json'));
  } catch(_) {}
  if (req.session && req.session.user && req.session.user.id) {
    req.user = req.session.user;
    // Refresh role + company_id from DB so the sidebar (and any view that uses
    // user.role) always sees the current value even if the cookie-session was
    // issued before a role change.
    try {
      const db = require('../config/db');
      db.query('SELECT role, company_id, status FROM users WHERE id = ?', [req.user.id])
        .then(rows => {
          if (rows && rows.length) {
            const u = rows[0];
            req.user.role = u.role;
            req.user.company_id = u.company_id || null;
            req.user.status = u.status;
            if (req.session && req.session.user) {
              req.session.user.role = u.role;
              req.session.user.company_id = u.company_id || null;
            }
          }
          return next();
        })
        .catch(() => next()); // fall back to cached session on DB error
      return;
    } catch (e) {
      return next();
    }
  }
  // Decide JSON vs HTML response. Treat as JSON only when:
  //   - the path is under /api/*, OR
  //   - the client EXPLICITLY accepts json AND does NOT accept html.
  // Browsers always send Accept: text/html,... so they'll get the redirect.
  const wantsJson =
    req.path.startsWith('/api/') ||
    (req.accepts('html') ? false : !!req.accepts('json'));
  if (wantsJson) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const next_ = encodeURIComponent(req.originalUrl || 'dashboard');
  return res.redirect(`login?next=${next_}`);
}

function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('dashboard');
  }
  return next();
}

// Any admin level (superadmin, admin, company_admin)
function requireAnyAdmin(req, res, next) {
  const r = req.user && req.user.role;
  if (r === 'superadmin' || r === 'admin' || r === 'company_admin') return next();
  return res.status(403).render('404', {
    title: 'Acceso denegado',
    description: 'No tienes permiso para esta sección.',
    nav: 'app',
    user: req.user || null
  });
}

// Only superadmin / admin (platform owners)
function requireSuperAdmin(req, res, next) {
  const r = req.user && req.user.role;
  if (r === 'superadmin' || r === 'admin') return next();
  return res.status(403).render('404', {
    title: 'Acceso denegado',
    description: 'Solo el superadministrador puede acceder a esta sección.',
    nav: 'app',
    user: req.user || null
  });
}

// company_admin specifically (NOT including superadmin? — we include it so
// the superadmin can do everything a company_admin can. Scoping by company
// is handled separately by reading req.user.company_id.)
function requireCompanyAdmin(req, res, next) {
  const r = req.user && req.user.role;
  if (r === 'superadmin' || r === 'admin' || r === 'company_admin') return next();
  return res.status(403).render('404', {
    title: 'Acceso denegado',
    description: 'Solo administradores de empresa.',
    nav: 'app',
    user: req.user || null
  });
}

module.exports = {
  requireAuth,
  redirectIfAuthed,
  requireAnyAdmin,
  requireSuperAdmin,
  requireCompanyAdmin
};
