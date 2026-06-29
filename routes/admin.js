'use strict';

/**
 * BiLingo Meet — server-rendered admin pages.
 *
 * Three-tier admin model:
 *   - superadmin / admin → see ALL companies, ALL users, ALL costs.
 *   - company_admin       → see ONLY their own company (users + costs scoped).
 *
 * Mutations:
 *   - Creating companies, toggling languages/voices, full reports access → superadmin only.
 *   - Creating users, toggling their status, resetting their company → company_admin OK
 *     (but only inside their own company; superadmin can do it anywhere).
 *
 * User creation flow: admin enters email + display name + native language; the
 * server creates the row with status='suspended' and an unusable password,
 * then issues an activation token. The activation URL is shown back to the
 * admin (no SMTP transport configured yet).
 */

const router = require('express').Router();
const crypto = require('crypto');
const db = require('../config/db');
const {
  requireAuth,
  requireAnyAdmin,
  requireSuperAdmin
} = require('../middleware/requireAuth');
const activation = require('../services/activation.service');
const costs = require('../services/costs.service');
const credits = require('../services/credits.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ['#58CC02', '#1CB0F6', '#FF9600', '#CE82FF', '#FF4B4B', '#FFC800', '#2B70C9'];

// Build a redirect target that always lands at the right place, both
// when the app is mounted at "/" (direct port) and behind the proxy
// (/run/<id>/ or /project-<u>/<p>/).
//
// CRITICAL: this MUST NEVER return a path with a leading "/" unless we have
// genuinely detected the proxy prefix. A bare "/admin/users" handed to
// res.redirect() emits a Location header of "/admin/users", which the
// BROWSER then resolves against the SITE ROOT — escaping our reverse proxy
// (/run/<id>/) and landing the user on the parent platform's /admin/users
// (which doesn't exist). That is the #1 source of "the admin link redirects
// me out of the app" bugs.
//
// Detection order (most reliable first):
//   1. req.basePrefix (populated by middleware/basePrefix.js from
//      X-Forwarded-Prefix / X-Forwarded-Path / X-Script-Name / BASE_PATH).
//   2. Re-read the same headers directly (in case the middleware wasn't run).
//   3. BASE_PATH env var injected by the runtime.
//   4. Fall back to a RELATIVE path ("../admin/users") computed from the
//      CURRENT request URL — never a leading slash.
function detectPrefix(req) {
  // 1. Middleware-populated value (preferred)
  if (req && typeof req.basePrefix === 'string' && req.basePrefix) {
    return req.basePrefix.replace(/\/+$/, '');
  }
  // 2. Re-read proxy headers (defensive)
  const fp = req && req.headers && (
    req.headers['x-forwarded-prefix'] ||
    req.headers['x-forwarded-path']   ||
    req.headers['x-script-name']
  );
  if (fp) {
    let p = String(fp).trim();
    if (p && !p.startsWith('/')) p = '/' + p;
    return p.replace(/\/+$/, '');
  }
  // 3. BASE_PATH from runtime
  if (process.env.BASE_PATH) {
    let p = String(process.env.BASE_PATH).trim();
    if (p && !p.startsWith('/')) p = '/' + p;
    return p.replace(/\/+$/, '');
  }
  return '';
}

// Compute a relative path that takes us from the CURRENT request URL up to
// the app root, then appends `target`. Used as the safe fallback when no
// proxy prefix can be detected — guarantees we never emit a leading-slash
// Location header that would escape the proxy.
//
// Example:
//   req.originalUrl = "/admin/users/5/suspend", target = "admin/users"
//   → currentPath segments = ["admin","users","5","suspend"]  (4 segments)
//   → we want to go UP 4 levels and then to "admin/users"
//   → "../../../../admin/users"
function relativeToAppRoot(req, target) {
  const t = String(target || '').replace(/^\/+/, '');
  const url = (req && req.originalUrl) || (req && req.url) || '/';
  // strip querystring, split into segments, drop empties
  const pathOnly = url.split('?')[0];
  const segs = pathOnly.split('/').filter(Boolean);
  // The last segment is the resource; we want to walk back to the app root.
  // For a path "/admin/users/5/suspend" we have 4 segments — so 4 "../".
  const ups = segs.length > 0 ? '../'.repeat(segs.length) : '';
  return ups + t;
}

function adminPath(target, req) {
  const t = String(target || '').replace(/^\/+/, '');
  const prefix = detectPrefix(req);
  if (prefix) {
    // We KNOW the proxy prefix — emit an absolute path that includes it.
    // e.g. "/run/184" + "/" + "admin/users" → "/run/184/admin/users"
    return prefix + '/' + t;
  }
  // No prefix detected. NEVER emit a leading slash here — the browser would
  // resolve it against the site root and escape the proxy. Instead emit a
  // path that walks back to the app root using "../" segments.
  if (req) return relativeToAppRoot(req, t);
  // Last-resort (no req at all): bare relative path. Caller should always
  // pass req, but if they didn't, a bare relative is still safer than "/".
  return t;
}


// Refresh role + company_id from DB so a stale session can't escalate.
async function loadAdminContext(req, res, next) {
  try {
    const rows = await db.query(
      'SELECT id, role, status, company_id FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) {
      return res.status(403).render('404', {
        title: 'Acceso denegado', description: '', nav: 'app', user: req.user
      });
    }
    const u = rows[0];
    req.user.role = u.role;
    req.user.company_id = u.company_id || null;
    if (req.session && req.session.user) {
      req.session.user.role = u.role;
      req.session.user.company_id = u.company_id || null;
    }
    if (!['superadmin', 'admin', 'company_admin'].includes(u.role)) {
      return res.status(403).render('404', {
        title: 'Acceso denegado',
        description: 'No tienes permiso para acceder al panel de administración.',
        nav: 'app',
        user: req.user
      });
    }
    next();
  } catch (err) { next(err); }
}

function isSuper(req) {
  return req.user && (req.user.role === 'superadmin' || req.user.role === 'admin');
}

function scopeCompanyId(req) {
  // For company_admin queries are scoped to their company.
  return isSuper(req) ? null : (req.user.company_id || 0);
}

async function logAudit(adminId, action, targetType, targetId, details) {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminId, action, targetType, targetId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('[admin] audit log failed:', err && err.message);
  }
}

function buildActivationUrl(req, token) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const base = detectPrefix(req);
  return `${proto}://${host}${base}/activate/${token}`;
}

// ---------------------------------------------------------------------------
// GET /admin → redirect
// ---------------------------------------------------------------------------
router.get('/admin', requireAuth, loadAdminContext, (req, res) => {
  return res.redirect(adminPath('admin/users', req));
});

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------
router.get('/admin/users', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const status = (req.query.status || '').trim();
    const companyFilter = (req.query.company || '').trim();

    const where = [];
    const params = [];
    if (search) {
      where.push('(u.email LIKE ? OR u.display_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (role && ['user', 'company_admin', 'admin', 'superadmin'].includes(role)) {
      where.push('u.role = ?');
      params.push(role);
    }
    if (status && ['active', 'suspended', 'banned'].includes(status)) {
      where.push('u.status = ?');
      params.push(status);
    }

    // SCOPING: company_admin can ONLY see their company.
    if (isSuper(req)) {
      if (companyFilter) {
        where.push('u.company_id = ?');
        params.push(parseInt(companyFilter, 10) || 0);
      }
    } else {
      where.push('u.company_id = ?');
      params.push(req.user.company_id || 0);
    }

    const sql = `
      SELECT u.id, u.email, u.display_name, u.avatar_color, u.role, u.status,
             u.native_language, u.created_at,
             u.company_id, c.code AS company_code, c.name AS company_name
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.created_at DESC
      LIMIT 200
    `;
    const users = await db.query(sql, params);

    // companies dropdown: superadmin sees all, company_admin only their own.
    let companies;
    if (isSuper(req)) {
      companies = await db.query(
        'SELECT id, code, name FROM companies WHERE is_active = 1 ORDER BY name ASC'
      );
    } else {
      companies = await db.query(
        'SELECT id, code, name FROM companies WHERE id = ?',
        [req.user.company_id || 0]
      );
    }

    // languages for the "new user" modal
    const languages = await db.query(
      'SELECT code, name FROM languages WHERE is_enabled = 1 ORDER BY sort_order ASC, name ASC'
    );

    res.render('admin_users', {
      title: 'Usuarios · Admin · BiLingo Meet',
      description: 'Gestión de usuarios.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      isSuper: isSuper(req),
      users,
      companies,
      languages,
      search,
      role,
      status,
      company: companyFilter,
      flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
      flashError: req.query.err ? decodeURIComponent(req.query.err) : null,
      activationUrl: req.query.activation ? decodeURIComponent(req.query.activation) : null
    });
  } catch (err) { next(err); }
});

// POST /admin/users  (create user with magic-link activation)
router.post('/admin/users', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const displayName = String(req.body.display_name || '').trim();
    const nativeLanguage = String(req.body.native_language || '').trim() || null;
    let role = String(req.body.role || 'user').trim();
    let companyIdRaw = String(req.body.company_id || '').trim();
    let companyId = companyIdRaw === '' ? null : parseInt(companyIdRaw, 10);

    // Permission scoping
    if (!isSuper(req)) {
      // company_admin: can only create user or company_admin INSIDE own company
      companyId = req.user.company_id || null;
      if (!['user', 'company_admin'].includes(role)) role = 'user';
    } else {
      if (!['user', 'company_admin', 'admin', 'superadmin'].includes(role)) role = 'user';
    }

    if (!email || !displayName) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Email y nombre son obligatorios.')));
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Email inválido.')));
    }
    if (!companyId && role !== 'superadmin' && role !== 'admin') {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Debes asignar una empresa al usuario.')));
    }

    // Verify company exists
    if (companyId) {
      const rows = await db.query('SELECT id FROM companies WHERE id = ?', [companyId]);
      if (!rows.length) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Empresa no encontrada.')));
      }
    }

    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Ya existe una cuenta con ese email.')));
    }

    // Random unusable password — user will set theirs via magic link.
    const placeholderHash = '!' + crypto.randomBytes(32).toString('hex');
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const result = await db.query(
      `INSERT INTO users (email, password_hash, display_name, avatar_color,
                          native_language, company_id, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'suspended')`,
      [email, placeholderHash, displayName, color, nativeLanguage, companyId, role]
    );

    const token = await activation.issueToken(result.insertId, req.user.id);
    await logAudit(req.user.id, 'user.activate', 'user', result.insertId, {
      created: true, email, role, companyId
    });
    const url = buildActivationUrl(req, token);

    return res.redirect(adminPath(
      'admin/users?ok=' + encodeURIComponent('Usuario creado. Comparte el enlace de activación con el usuario.') +
      '&activation=' + encodeURIComponent(url)
    ));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/resend-activation
router.post('/admin/users/:id/resend-activation', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('ID inválido.')));
    const rows = await db.query(
      'SELECT id, email, status, company_id FROM users WHERE id = ?', [id]
    );
    if (!rows.length) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Usuario no encontrado.')));
    if (!isSuper(req) && rows[0].company_id !== req.user.company_id) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin permiso.')));
    }
    const token = await activation.issueToken(id, req.user.id);
    const url = buildActivationUrl(req, token);
    return res.redirect(adminPath(
      'admin/users?ok=' + encodeURIComponent('Nuevo enlace de activación generado.') +
      '&activation=' + encodeURIComponent(url)
    ));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/suspend
router.post('/admin/users/:id/suspend', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('ID inválido')));
    if (id === req.user.id) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('No puedes suspenderte a ti mismo.')));
    }
    const rows = await db.query('SELECT id, company_id, role FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Usuario no encontrado.')));
    if (!isSuper(req)) {
      if (rows[0].company_id !== req.user.company_id) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin permiso.')));
      }
      if (rows[0].role === 'superadmin' || rows[0].role === 'admin') {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('No puedes modificar a un administrador global.')));
      }
    }
    await db.query("UPDATE users SET status='suspended' WHERE id = ?", [id]);
    await logAudit(req.user.id, 'user.suspend', 'user', id, { by: req.user.email });
    return res.redirect(adminPath('admin/users?ok=' + encodeURIComponent('Usuario suspendido.')));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/activate
router.post('/admin/users/:id/activate', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('ID inválido')));
    const rows = await db.query('SELECT id, company_id, role FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Usuario no encontrado.')));
    if (!isSuper(req)) {
      if (rows[0].company_id !== req.user.company_id) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin permiso.')));
      }
    }
    await db.query("UPDATE users SET status='active' WHERE id = ?", [id]);
    await logAudit(req.user.id, 'user.activate', 'user', id, { by: req.user.email });
    return res.redirect(adminPath('admin/users?ok=' + encodeURIComponent('Usuario activado.')));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/company  (superadmin only — change a user's company)
router.post('/admin/users/:id/company', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    if (!isSuper(req)) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Solo el superadministrador puede reasignar empresas.')));
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('ID inválido')));
    const companyIdRaw = String(req.body.company_id || '').trim();
    const companyId = companyIdRaw === '' ? null : parseInt(companyIdRaw, 10);

    if (companyId !== null) {
      const rows = await db.query('SELECT id FROM companies WHERE id = ? AND is_active = 1', [companyId]);
      if (!rows.length) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Empresa no encontrada o inactiva.')));
      }
    }

    await db.query('UPDATE users SET company_id = ? WHERE id = ?', [companyId, id]);
    return res.redirect(adminPath('admin/users?ok=' + encodeURIComponent('Empresa del usuario actualizada.')));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/role
router.post('/admin/users/:id/role', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    let newRole = String(req.body.role || '').trim();
    if (!id || !['user', 'company_admin', 'admin', 'superadmin'].includes(newRole)) {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Datos inválidos.')));
    }
    const rows = await db.query('SELECT id, company_id, role FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Usuario no encontrado.')));

    if (!isSuper(req)) {
      // company_admin can only toggle user <-> company_admin within their own company
      if (rows[0].company_id !== req.user.company_id) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin permiso.')));
      }
      if (!['user', 'company_admin'].includes(newRole)) {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin permiso para asignar ese rol.')));
      }
      if (rows[0].role === 'superadmin' || rows[0].role === 'admin') {
        return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('No puedes modificar a un administrador global.')));
      }
    }
    if (id === req.user.id && newRole === 'user') {
      return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('No puedes degradarte a ti mismo.')));
    }

    await db.query('UPDATE users SET role = ? WHERE id = ?', [newRole, id]);
    await logAudit(req.user.id, 'user.role_change', 'user', id, { newRole, by: req.user.email });
    return res.redirect(adminPath('admin/users?ok=' + encodeURIComponent('Rol actualizado a ' + newRole + '.')));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/languages  (superadmin only — platform-wide config)
// ---------------------------------------------------------------------------
router.get('/admin/languages', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const languages = await db.query(
      'SELECT id, code, name, native_name, direction, is_enabled, sort_order FROM languages ORDER BY sort_order ASC, name ASC'
    );
    const voices = await db.query(
      `SELECT id, language_code, voice_key, display_name, gender, provider, provider_voice_id, is_enabled, sort_order
       FROM voices
       ORDER BY language_code ASC, sort_order ASC, display_name ASC`
    );
    res.render('admin_languages', {
      title: 'Idiomas y voces · Admin',
      description: 'Gestión de idiomas y voces TTS.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      languages,
      voices,
      flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
      flashError: req.query.err ? decodeURIComponent(req.query.err) : null
    });
  } catch (err) { next(err); }
});

router.post('/admin/languages', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const nativeName = String(req.body.native_name || '').trim() || null;
    let direction = String(req.body.direction || 'ltr').trim().toLowerCase();
    if (!['ltr', 'rtl'].includes(direction)) direction = 'ltr';
    const sortOrder = parseInt(req.body.sort_order, 10) || 0;

    if (!code || !name) {
      return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('Código y nombre son obligatorios.')));
    }
    if (code.length > 8) {
      return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('Código demasiado largo.')));
    }

    try {
      const r = await db.query(
        'INSERT INTO languages (code, name, native_name, direction, is_enabled, sort_order) VALUES (?,?,?,?,1,?)',
        [code, name, nativeName, direction, sortOrder]
      );
      await logAudit(req.user.id, 'language.add', 'language', r.insertId || 0, { code, name });
      return res.redirect(adminPath('admin/languages?ok=' + encodeURIComponent('Idioma "' + name + '" añadido.')));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('Ese código de idioma ya existe.')));
      }
      throw e;
    }
  } catch (err) { next(err); }
});

router.post('/admin/languages/:id/toggle', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('ID inválido.')));
    const rows = await db.query('SELECT id, code, is_enabled FROM languages WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('No encontrado.')));
    const next_ = rows[0].is_enabled ? 0 : 1;
    await db.query('UPDATE languages SET is_enabled = ? WHERE id = ?', [next_, id]);
    await logAudit(req.user.id, 'language.toggle', 'language', id, { code: rows[0].code, is_enabled: next_ });
    return res.redirect(adminPath('admin/languages?ok=' + encodeURIComponent('Idioma ' + (next_ ? 'activado' : 'desactivado') + '.')));
  } catch (err) { next(err); }
});

router.post('/admin/voices', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const languageCode = String(req.body.language_code || '').trim().toLowerCase();
    const voiceKey = String(req.body.voice_key || '').trim();
    const displayName = String(req.body.display_name || '').trim();
    let gender = String(req.body.gender || 'neutral').trim().toLowerCase();
    if (!['male', 'female', 'neutral'].includes(gender)) gender = 'neutral';
    const provider = String(req.body.provider || 'mock').trim() || 'mock';
    const providerVoiceId = String(req.body.provider_voice_id || '').trim();

    if (!languageCode || !voiceKey || !displayName || !providerVoiceId) {
      return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('Todos los campos de la voz son obligatorios.')));
    }

    try {
      const r = await db.query(
        `INSERT INTO voices (language_code, voice_key, display_name, gender, provider, provider_voice_id, is_enabled, sort_order)
         VALUES (?,?,?,?,?,?,1,0)`,
        [languageCode, voiceKey, displayName, gender, provider, providerVoiceId]
      );
      await logAudit(req.user.id, 'voice.add', 'voice', r.insertId || 0, { languageCode, voiceKey });
      return res.redirect(adminPath('admin/languages?ok=' + encodeURIComponent('Voz añadida.')));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('Ya existe una voz con esa clave para ese idioma.')));
      }
      if (e && (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW')) {
        return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('El idioma indicado no existe.')));
      }
      throw e;
    }
  } catch (err) { next(err); }
});

router.post('/admin/voices/:id/toggle', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('ID inválido.')));
    const rows = await db.query('SELECT id, voice_key, is_enabled FROM voices WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/languages?err=' + encodeURIComponent('No encontrada.')));
    const next_ = rows[0].is_enabled ? 0 : 1;
    await db.query('UPDATE voices SET is_enabled = ? WHERE id = ?', [next_, id]);
    await logAudit(req.user.id, 'voice.toggle', 'voice', id, { voice_key: rows[0].voice_key, is_enabled: next_ });
    return res.redirect(adminPath('admin/languages?ok=' + encodeURIComponent('Voz ' + (next_ ? 'activada' : 'desactivada') + '.')));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/companies (superadmin only)
// ---------------------------------------------------------------------------
router.get('/admin/companies', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();

    const where = [];
    const params = [];
    if (search) {
      where.push('(c.code LIKE ? OR c.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status === 'active') where.push('c.is_active = 1');
    else if (status === 'inactive') where.push('c.is_active = 0');

    const sql = `
      SELECT c.id, c.code, c.name, c.is_active, c.created_at,
             (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count
      FROM companies c
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.created_at DESC
      LIMIT 200
    `;
    const companies = await db.query(sql, params);

    res.render('admin_companies', {
      title: 'Empresas · Admin · BiLingo Meet',
      description: 'Gestión de empresas.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      companies,
      search,
      status,
      flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
      flashError: req.query.err ? decodeURIComponent(req.query.err) : null
    });
  } catch (err) { next(err); }
});

router.post('/admin/companies', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!name) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('El nombre es obligatorio.')));
    if (!/^[A-Z]{6}$/.test(code)) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('El código debe tener exactamente 6 letras (A-Z).')));
    try {
      const result = await db.query('INSERT INTO companies (code, name, is_active) VALUES (?, ?, 1)', [code, name]);
      const newCompanyId = result.insertId;

      // Grant welcome bonus (500 créditos gratuitos).
      let welcomeMsg = '';
      try {
        const grant = await credits.grantWelcomeCredits(newCompanyId, req.user.id);
        if (!grant.skipped) {
          welcomeMsg = ' Se acreditaron ' + grant.credits + ' créditos de bienvenida 🎁';
          await logAudit(req.user.id, 'credit.welcome', 'company', newCompanyId, { amount: grant.credits });
        }
      } catch (we) {
        console.error('[admin] welcome credits failed for company', newCompanyId, we && we.message);
      }

      return res.redirect(adminPath('admin/companies?ok=' + encodeURIComponent(
        'Empresa "' + name + '" creada con código ' + code + '.' + welcomeMsg
      )));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('Ese código ya está en uso. Elige otro.')));
      }
      throw e;
    }
  } catch (err) { next(err); }
});

router.post('/admin/companies/:id', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('ID inválido.')));
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!name) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('El nombre es obligatorio.')));
    if (!/^[A-Z]{6}$/.test(code)) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('El código debe tener exactamente 6 letras.')));
    try {
      await db.query('UPDATE companies SET name = ?, code = ? WHERE id = ?', [name, code, id]);
      return res.redirect(adminPath('admin/companies?ok=' + encodeURIComponent('Empresa actualizada.')));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('Ese código ya está en uso.')));
      throw e;
    }
  } catch (err) { next(err); }
});

router.post('/admin/companies/:id/toggle', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('ID inválido.')));
    const rows = await db.query('SELECT id, is_active FROM companies WHERE id = ?', [id]);
    if (!rows.length) return res.redirect(adminPath('admin/companies?err=' + encodeURIComponent('No encontrada.')));
    const next_ = rows[0].is_active ? 0 : 1;
    await db.query('UPDATE companies SET is_active = ? WHERE id = ?', [next_, id]);
    return res.redirect(adminPath('admin/companies?ok=' + encodeURIComponent('Empresa ' + (next_ ? 'activada' : 'desactivada') + '.')));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/usage  (existing — visible to all admin levels)
// ---------------------------------------------------------------------------
router.get('/admin/usage', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const totalMeetingsRow = await db.query(
      "SELECT COUNT(*) AS c FROM rooms WHERE status IN ('active','ended','closed') OR started_at IS NOT NULL"
    );
    const totalMeetings = totalMeetingsRow[0].c;

    const latencySumRow = await db.query(
      "SELECT COALESCE(SUM(total_latency_ms),0) AS s, COALESCE(AVG(total_latency_ms),0) AS a FROM translation_logs"
    );
    const sumLatencyMs = Number(latencySumRow[0].s || 0);
    const avgLatencyMs = Math.round(Number(latencySumRow[0].a || 0));
    const translationMinutes = Math.round(sumLatencyMs / 60000);

    const ratingRow = await db.query(
      `SELECT COALESCE(AVG((COALESCE(translation_quality,0)+COALESCE(audio_quality,0))/
                           NULLIF((CASE WHEN translation_quality IS NOT NULL THEN 1 ELSE 0 END)
                                 +(CASE WHEN audio_quality IS NOT NULL THEN 1 ELSE 0 END),0)),0) AS r
       FROM feedback_ratings`
    );
    const avgRating = Number(ratingRow[0].r || 0).toFixed(2);

    const latencyDaily = await db.query(
      `SELECT DATE(created_at) AS d, ROUND(AVG(total_latency_ms)) AS avg_ms
       FROM translation_logs
       WHERE created_at >= NOW() - INTERVAL 14 DAY
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`
    );
    const latencyChart = {
      labels: latencyDaily.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d).slice(0,10))),
      values: latencyDaily.map(r => Number(r.avg_ms || 0))
    };

    const pairs = await db.query(
      `SELECT CONCAT(source_lang,' → ',target_lang) AS pair, COUNT(*) AS n
       FROM translation_logs
       WHERE source_lang IS NOT NULL AND target_lang IS NOT NULL
       GROUP BY source_lang, target_lang
       ORDER BY n DESC
       LIMIT 7`
    );
    const pairsChart = {
      labels: pairs.map(r => r.pair),
      values: pairs.map(r => Number(r.n || 0))
    };

    const feedback = await db.query(
      `SELECT f.id, f.room_id, f.translation_quality, f.audio_quality, f.comments, f.created_at,
              r.room_code, u.display_name AS user_name
       FROM feedback_ratings f
       LEFT JOIN rooms r ON r.id = f.room_id
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC
       LIMIT 20`
    );

    res.render('admin_usage', {
      title: 'Uso · Admin · BiLingo Meet',
      description: 'Métricas de uso y rendimiento.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      kpi: { totalMeetings, translationMinutes, avgLatencyMs, avgRating },
      latencyChart,
      pairsChart,
      feedback
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/costs  (token & USD spend panel)
//
// Visibility model:
//   - superadmin / admin → ven el COSTO CRUDO en USD (lo que pagamos a OpenAI)
//     y pueden mover el slider "margen objetivo" para simular precio sugerido.
//   - company_admin       → ven el COSTO DE SU EMPRESA, que es:
//                                cost_usd_crudo * credit_markup
//     Es decir, NO ven nunca el costo real de OpenAI ni el margen — ven
//     directamente lo que esa empresa "gasta" según el multiplicador
//     configurado por el superadmin (companies.credit_markup).
// ---------------------------------------------------------------------------
router.get('/admin/costs', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const companyId = scopeCompanyId(req); // null for superadmin
    const marginPctRaw = parseInt(req.query.margin || '100', 10);
    const marginPct = Math.max(0, Math.min(1000, isFinite(marginPctRaw) ? marginPctRaw : 100));

    // Cargar todo en paralelo
    const [totals, audioMin, byModel, topUsers, recent, daily] = await Promise.all([
      costs.getTotals(companyId),
      costs.getAudioMinutes(companyId),
      costs.getCostByModel(companyId),
      costs.getTopUsers(companyId, 10),
      costs.getRecentCalls(companyId, 100),
      costs.getDailyCost(companyId, 30)
    ]);
    const topCompanies = isSuper(req) ? await costs.getTopCompanies(10) : [];

    // ============== APLICAR MULTIPLICADOR PARA COMPANY_ADMIN ==============
    let markup = 1;
    let companyInfo = null;
    let creditBalance = null;
    if (!isSuper(req) && companyId) {
      const rows = await db.query(
        'SELECT id, code, name, credit_markup, credit_low_threshold FROM companies WHERE id = ?',
        [companyId]
      );
      if (rows.length) {
        companyInfo = rows[0];
        markup = Number(rows[0].credit_markup) || 1;
      }
      // Saldo de créditos de la empresa
      try {
        const balRows = await db.query(
          'SELECT balance, total_added, total_consumed FROM company_credits WHERE company_id = ?',
          [companyId]
        );
        if (balRows.length) creditBalance = balRows[0];
      } catch (_) {}

      // Aplicar el multiplicador a TODAS las cifras de USD que la vista muestra
      if (markup !== 1) {
        totals.cost_today = Number(totals.cost_today || 0) * markup;
        totals.cost_7d    = Number(totals.cost_7d    || 0) * markup;
        totals.cost_30d   = Number(totals.cost_30d   || 0) * markup;
        totals.cost_total = Number(totals.cost_total || 0) * markup;

        (byModel || []).forEach(m => { m.cost_usd = Number(m.cost_usd || 0) * markup; });
        (topUsers || []).forEach(u => { u.cost_usd = Number(u.cost_usd || 0) * markup; });
        (recent  || []).forEach(c => { c.total_cost_usd = Number(c.total_cost_usd || 0) * markup; });
        (daily   || []).forEach(d => { d.cost_usd = Number(d.cost_usd || 0) * markup; });
      }
    }
    // ======================================================================

    const audioMinutes = Number(audioMin || 0);
    const costPerMinute = audioMinutes > 0 ? Number(totals.cost_total || 0) / audioMinutes : 0;
    const suggestedPricePerMinute = costPerMinute * (1 + marginPct / 100);

    const dailyChart = {
      labels: daily.map(r => (r.d instanceof Date ? r.d.toISOString().slice(0,10) : String(r.d).slice(0,10))),
      values: daily.map(r => Number(r.cost_usd || 0))
    };

    res.render('admin_costs', {
      title: 'Costos · Admin · BiLingo Meet',
      description: 'Tokens y USD gastados.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      isSuper: isSuper(req),
      totals,
      audioMinutes,
      costPerMinute,
      marginPct,
      suggestedPricePerMinute,
      byModel,
      topCompanies,
      topUsers,
      recent,
      dailyChart,
      // Para company_admin: info extra para la vista
      markup,
      companyInfo,
      creditBalance
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/credits  (saldo y movimientos por empresa)
// ---------------------------------------------------------------------------
router.get('/admin/credits', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    if (isSuper(req)) {
      // Superadmin: ve TODAS las empresas con su saldo.
      const list = await credits.listCompanyBalances();
      return res.render('admin_credits_list', {
        title: 'Créditos · Admin · BiLingo Meet',
        description: 'Saldo de créditos por empresa.',
        nav: 'app',
        active: 'admin',
        user: req.user,
        isSuper: true,
        list,
        flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
        flashError: req.query.err ? decodeURIComponent(req.query.err) : null
      });
    }
    // company_admin → redirige a su propia empresa
    if (req.user.company_id) {
      return res.redirect(adminPath('admin/credits/' + req.user.company_id, req));
    }
    return res.redirect(adminPath('admin/users?err=' + encodeURIComponent('Sin empresa asignada.'), req));
  } catch (err) { next(err); }
});

// GET /admin/credits/:companyId  (detalle de una empresa)
router.get('/admin/credits/:companyId', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    if (!companyId) return res.redirect(adminPath('admin/credits?err=' + encodeURIComponent('ID inválido.'), req));
    if (!isSuper(req) && req.user.company_id !== companyId) {
      return res.status(403).render('404', {
        title: 'Sin permiso', description: '', nav: 'app', user: req.user
      });
    }
    const balance = await credits.getBalance(companyId);
    if (!balance) return res.redirect(adminPath('admin/credits?err=' + encodeURIComponent('Empresa no encontrada.'), req));
    const kind = (req.query.kind || '').trim();
    const txs = await credits.getTransactions(companyId, { limit: 200, kind: kind || null });

    res.render('admin_credits_detail', {
      title: 'Créditos · ' + balance.company.name + ' · Admin',
      description: '',
      nav: 'app',
      active: 'admin',
      user: req.user,
      isSuper: isSuper(req),
      balance,
      txs,
      kind,
      flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
      flashError: req.query.err ? decodeURIComponent(req.query.err) : null
    });
  } catch (err) { next(err); }
});

// POST /admin/credits/:companyId/topup
router.post('/admin/credits/:companyId/topup', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    const amount = Math.floor(Number(req.body.amount || 0));
    const description = String(req.body.description || '').trim() || 'Recarga manual';
    if (!companyId) return res.redirect(adminPath('admin/credits?err=' + encodeURIComponent('ID inválido.'), req));
    if (!amount || amount <= 0) {
      return res.redirect(adminPath('admin/credits/' + companyId + '?err=' + encodeURIComponent('Importe inválido (debe ser > 0).'), req));
    }
    await credits.addCredits(companyId, amount, { description, createdBy: req.user.id });
    await logAudit(req.user.id, 'credit.topup', 'company', companyId, { amount, description });
    return res.redirect(adminPath('admin/credits/' + companyId + '?ok=' + encodeURIComponent('Recargados ' + amount + ' créditos.'), req));
  } catch (err) { next(err); }
});

// POST /admin/credits/:companyId/adjust  (ajuste positivo o negativo)
router.post('/admin/credits/:companyId/adjust', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    const amount = Math.floor(Number(req.body.amount || 0));
    const description = String(req.body.description || '').trim() || 'Ajuste manual';
    if (!companyId) return res.redirect(adminPath('admin/credits?err=' + encodeURIComponent('ID inválido.'), req));
    if (!amount) {
      return res.redirect(adminPath('admin/credits/' + companyId + '?err=' + encodeURIComponent('Importe inválido (no puede ser 0).'), req));
    }
    await credits.applyAdjustment(companyId, amount, { description, createdBy: req.user.id });
    await logAudit(req.user.id, 'credit.adjustment', 'company', companyId, { amount, description });
    return res.redirect(adminPath('admin/credits/' + companyId + '?ok=' + encodeURIComponent('Ajuste de ' + amount + ' créditos aplicado.'), req));
  } catch (err) { next(err); }
});

// POST /admin/credits/:companyId/settings  (markup y umbral)
router.post('/admin/credits/:companyId/settings', requireAuth, loadAdminContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.companyId, 10);
    let markup = Number(req.body.markup);
    let threshold = parseInt(req.body.low_threshold, 10);
    if (!companyId) return res.redirect(adminPath('admin/credits?err=' + encodeURIComponent('ID inválido.'), req));
    if (!isFinite(markup) || markup < 1 || markup > 100) {
      return res.redirect(adminPath('admin/credits/' + companyId + '?err=' + encodeURIComponent('Markup inválido (debe estar entre 1.0 y 100).'), req));
    }
    if (!isFinite(threshold) || threshold < 0) threshold = 0;
    await db.query(
      'UPDATE companies SET credit_markup = ?, credit_low_threshold = ? WHERE id = ?',
      [markup, threshold, companyId]
    );
    await logAudit(req.user.id, 'credit.settings', 'company', companyId, { markup, threshold });
    return res.redirect(adminPath('admin/credits/' + companyId + '?ok=' + encodeURIComponent('Configuración actualizada.'), req));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/meetings  (listado con KPIs por llamada)
// ---------------------------------------------------------------------------
router.get('/admin/meetings', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const companyId = scopeCompanyId(req); // null para superadmin
    const search = (req.query.search || '').trim();
    const dateFrom = (req.query.from || '').trim();
    const dateTo = (req.query.to || '').trim();
    const status = (req.query.status || '').trim();
    const meetings = await credits.listMeetingsWithKpis({
      companyId, search, dateFrom, dateTo, status, limit: 200
    });

    // KPIs agregados
    const totals = {
      meetings: meetings.length,
      cost_usd: meetings.reduce((s, m) => s + Number(m.cost_usd || 0), 0),
      credits: meetings.reduce((s, m) => s + Number(m.credits_debited || 0), 0),
      avg_latency: meetings.length
        ? meetings.reduce((s, m) => s + Number(m.avg_latency_ms || 0), 0) / meetings.filter(m => Number(m.avg_latency_ms) > 0).length || 0
        : 0,
      degraded: meetings.reduce((s, m) => s + Number(m.degraded_count || 0), 0)
    };

    res.render('admin_meetings_list', {
      title: 'Llamadas · Admin · BiLingo Meet',
      description: '',
      nav: 'app',
      active: 'admin',
      user: req.user,
      isSuper: isSuper(req),
      meetings,
      totals,
      filters: { search, from: dateFrom, to: dateTo, status }
    });
  } catch (err) { next(err); }
});

// GET /admin/meetings/:id
router.get('/admin/meetings/:id', requireAuth, loadAdminContext, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect(adminPath('admin/meetings', req));
    const data = await credits.getMeetingMetrics(id);
    if (!data) return res.status(404).render('404', {
      title: 'Llamada no encontrada', description: '', nav: 'app', user: req.user
    });
    // Scoping: company_admin solo puede ver llamadas de su empresa
    if (!isSuper(req) && data.meeting.company_id !== req.user.company_id) {
      return res.status(403).render('404', {
        title: 'Sin permiso', description: '', nav: 'app', user: req.user
      });
    }
    res.render('admin_meeting_detail', {
      title: 'Llamada ' + (data.meeting.room_code || ('#' + id)) + ' · Admin',
      description: '',
      nav: 'app',
      active: 'admin',
      user: req.user,
      isSuper: isSuper(req),
      data
    });
  } catch (err) { next(err); }
});

module.exports = router;
