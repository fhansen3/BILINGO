'use strict';

/**
 * Server-rendered auth flows for BiLingo Meet.
 *
 *   GET  /signup            → render signup form
 *   POST /signup            → create user, set session, redirect /dashboard
 *   GET  /login             → render login form
 *   POST /login             → verify creds, set session, redirect /dashboard (or ?next=)
 *   POST /logout            → clear session, redirect /
 *   GET  /forgot-password   → render forgot form
 *   POST /forgot-password   → issue reset token, render confirmation
 *   GET  /reset-password/:token → render reset form (or error if invalid/expired)
 *   POST /reset-password/:token → update password, redirect /login
 *
 * Sessions: uses req.session (cookie-session, configured in server.js).
 * Passwords: bcryptjs via utils/hash.
 * Languages dropdown: pulled from MySQL `languages` table.
 *
 * The JSON/JWT API in routes/auth.routes.js is kept untouched for the SPA.
 */

const router = require('express').Router();
const crypto = require('crypto');
const db = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/hash');
const { redirectIfAuthed } = require('../middleware/requireAuth');
const activation = require('../services/activation.service');
const credits = require('../services/credits.service');

const AVATAR_COLORS = ['#58CC02', '#1CB0F6', '#FF9600', '#CE82FF', '#FF4B4B', '#FFC800', '#2B70C9'];
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getLanguages() {
  try {
    return await db.query(
      `SELECT code, name, native_name
       FROM languages
       WHERE is_enabled = 1
       ORDER BY sort_order ASC, name ASC`
    );
  } catch (err) {
    console.error('[auth] failed to load languages', err && err.message);
    return [];
  }
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    native_language: row.native_language,
    learning_language: row.learning_language,
    company_id: row.company_id || null,
    role: row.role,
    plan: row.plan || 'free'
  };
}

// Returns a same-origin path WITHOUT a leading slash, so it can be used
// directly in res.redirect() under the reverse-proxy at /run/<id>/.
// Accepts inputs with or without a leading slash; rejects protocol-relative
// (//evil.com) and absolute URLs.
function safeNext(input) {
  if (!input) return 'dashboard';
  let s = String(input);
  // Reject protocol-relative or absolute URLs.
  if (s.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(s)) return 'dashboard';
  // Strip ONE leading slash if present.
  if (s.startsWith('/')) s = s.slice(1);
  if (!s) return 'dashboard';
  return s;
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

router.get('/signup', redirectIfAuthed, async (req, res) => {
  const languages = await getLanguages();
  res.render('signup', {
    title: 'Crear cuenta · BiLingo Meet',
    description: 'Únete a BiLingo Meet y empieza a reunirte sin barreras de idioma.',
    nav: 'auth-back',
    user: null,
    languages,
    form: { email: '', displayName: '', nativeLanguage: '', companyCode: '' },
    error: null
  });
});

router.post('/signup', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || req.body.display_name || '').trim();
  const nativeLanguage = String(req.body.nativeLanguage || req.body.native_language || '').trim() || null;
  const companyCode = String(req.body.companyCode || req.body.company_code || '').trim().toUpperCase();

  const form = { email, displayName, nativeLanguage: nativeLanguage || '', companyCode };

  async function renderError(error) {
    const languages = await getLanguages();
    return res.status(400).render('signup', {
      title: 'Crear cuenta · BiLingo Meet',
      description: 'Únete a BiLingo Meet.',
      nav: 'auth-back',
      user: null,
      languages,
      form,
      error
    });
  }

  try {
    if (!email || !password || !displayName) {
      return renderError('Email, contraseña y nombre son obligatorios.');
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return renderError('Introduce un email válido.');
    }
    if (password.length < 6) {
      return renderError('La contraseña debe tener al menos 6 caracteres.');
    }
    if (!nativeLanguage) {
      return renderError('Selecciona tu idioma nativo.');
    }
    if (!/^[A-Z]{6}$/.test(companyCode)) {
      return renderError('El código de empresa debe tener exactamente 6 letras.');
    }

    // Resolve company by code.
    //
    // Business rule (decidido con el usuario):
    //   • Si el código YA pertenece a una empresa existente → NO permitimos
    //     auto-registro silencioso. Mostramos el/los email(s) del/los
    //     administrador(es) de esa empresa para que el usuario solicite el
    //     alta. Esto evita que cualquiera con el código se cuele.
    //   • Si el código está libre → se crea una nueva empresa y este usuario
    //     queda como company_admin (primer usuario de la empresa) + 500
    //     créditos de bienvenida.
    //   • Si el código pertenece a una empresa desactivada → bloqueamos.
    let companyId;
    let companyJustCreated = false;

    const existingCompany = await db.query(
      'SELECT id, name, is_active FROM companies WHERE code = ?',
      [companyCode]
    );

    if (existingCompany.length && existingCompany[0].is_active) {
      // Empresa existente: buscar admins para que el usuario los contacte.
      const admins = await db.query(
        `SELECT email, display_name
           FROM users
          WHERE company_id = ?
            AND role IN ('company_admin','admin','superadmin')
            AND status = 'active'
          ORDER BY (role = 'company_admin') DESC, display_name ASC
          LIMIT 3`,
        [existingCompany[0].id]
      );
      let msg;
      if (admins.length) {
        const list = admins.map(a => a.email).join(', ');
        msg = 'El código <strong>' + companyCode + '</strong> ya pertenece a la empresa "' +
              existingCompany[0].name + '". Para unirte, solicita tu alta al administrador de la empresa: <strong>' +
              list + '</strong>.';
      } else {
        msg = 'El código <strong>' + companyCode + '</strong> ya está registrado pero aún no tiene administradores activos. Contacta con soporte.';
      }
      return renderError(msg);
    } else if (existingCompany.length && !existingCompany[0].is_active) {
      // Code exists but the company is disabled — don't silently revive it.
      return renderError('Ese código pertenece a una empresa desactivada. Contacta con soporte o usa otro código.');
    } else {
      // Code is free → create a brand-new company for this user.
      try {
        const ins = await db.query(
          'INSERT INTO companies (code, name, is_active) VALUES (?, ?, 1)',
          [companyCode, 'Empresa ' + companyCode]
        );
        companyId = ins.insertId;
        companyJustCreated = true;
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          // Race: another signup created the same company in parallel. Treat
          // it the same as "code already in use" — ask the new user to
          // contact its admin instead of joining silently.
          const again = await db.query(
            'SELECT id, name, is_active FROM companies WHERE code = ?',
            [companyCode]
          );
          if (!again.length || !again[0].is_active) {
            return renderError('No se pudo registrar la empresa. Inténtalo de nuevo.');
          }
          const admins = await db.query(
            `SELECT email FROM users
              WHERE company_id = ?
                AND role IN ('company_admin','admin','superadmin')
                AND status = 'active'
              LIMIT 3`,
            [again[0].id]
          );
          const list = admins.length ? admins.map(a => a.email).join(', ') : '(sin administradores aún)';
          return renderError('El código <strong>' + companyCode + '</strong> ya está en uso. Solicita tu alta al administrador: <strong>' + list + '</strong>.');
        } else {
          throw e;
        }
      }
    }

    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return renderError('Ya existe una cuenta con este email.');
    }

    const hash = await hashPassword(password);
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // Default voice preference: first enabled voice for the native language (if any).
    let preferredVoice = null;
    if (nativeLanguage) {
      const voices = await db.query(
        `SELECT voice_key FROM voices
         WHERE language_code = ? AND is_enabled = 1
         ORDER BY sort_order ASC, id ASC LIMIT 1`,
        [nativeLanguage]
      );
      if (voices.length) preferredVoice = voices[0].voice_key;
    }

    // If this signup is creating a brand-new company, the first user becomes
    // its company_admin. Otherwise (joining an existing company) → default role.
    const newUserRole = companyJustCreated ? 'company_admin' : 'user';

    const result = await db.query(
      `INSERT INTO users
         (email, password_hash, display_name, avatar_color,
          native_language, preferred_voice, company_id, role, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [email, hash, displayName, color, nativeLanguage, preferredVoice, companyId, newUserRole]
    );

    const rows = await db.query(
      `SELECT id, email, display_name, avatar_color, native_language, learning_language,
              company_id, role, plan
       FROM users WHERE id = ?`,
      [result.insertId]
    );
    const user = publicUser(rows[0]);

    // If this signup created the company, grant the welcome bonus now.
    // We do it AFTER the user row exists so createdBy points to a real user.
    if (companyJustCreated) {
      try {
        await credits.grantWelcomeCredits(companyId, user.id);
        console.log(`[auth] welcome credits granted to new company ${companyId} (code ${companyCode}) by user ${user.id}`);
      } catch (we) {
        console.error('[auth] welcome credits failed for company', companyId, we && we.message);
      }
    }

    req.session.user = user;

    // Honor JSON clients (curl, fetch with Accept: application/json)
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(201).json({
        ok: true,
        user,
        company: { id: companyId, code: companyCode, justCreated: companyJustCreated },
        redirect: 'dashboard'
      });
    }
    return res.redirect('dashboard');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', {
    title: 'Iniciar sesión · BiLingo Meet',
    description: 'Accede a tu cuenta de BiLingo Meet.',
    nav: 'auth-back',
    user: null,
    form: { email: '' },
    next: safeNext(req.query.next),
    error: null,
    info: req.query.reset === '1' ? 'Tu contraseña ha sido actualizada. Inicia sesión con la nueva.' : null
  });
});

router.post('/login', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = safeNext(req.body.next || req.query.next);

  function renderError(error, status = 401) {
    return res.status(status).render('login', {
      title: 'Iniciar sesión · BiLingo Meet',
      description: 'Accede a tu cuenta.',
      nav: 'auth-back',
      user: null,
      form: { email },
      next: nextUrl,
      error,
      info: null
    });
  }

  try {
    if (!email || !password) {
      return renderError('Introduce email y contraseña.', 400);
    }

    const rows = await db.query(
      `SELECT u.*, c.code AS company_code, c.name AS company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.email = ?`,
      [email]
    );
    if (!rows.length) {
      return renderError('Email o contraseña incorrectos.');
    }
    const row = rows[0];

    if (row.status === 'banned') {
      return renderError('Esta cuenta ha sido suspendida. Contacta con soporte.', 403);
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      return renderError('Email o contraseña incorrectos.');
    }

    await db.query(
      'UPDATE users SET last_login_at = NOW(), last_seen = NOW() WHERE id = ?',
      [row.id]
    );

    const user = publicUser(row);
    req.session.user = user;

    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ ok: true, user, redirect: nextUrl });
    }
    return res.redirect(nextUrl);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

router.post('/logout', (req, res) => {
  if (req.session) req.session = null;
  res.clearCookie('token'); // also clear JWT cookie if present, for a clean logout
  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({ ok: true, redirect: '.' });
  }
  return res.redirect('.');
});

// Convenience: allow GET /logout too (some links use plain anchors).
router.get('/logout', (req, res) => {
  if (req.session) req.session = null;
  res.clearCookie('token');
  return res.redirect('.');
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', {
    title: 'Recuperar contraseña · BiLingo Meet',
    description: 'Recupera el acceso a tu cuenta de BiLingo Meet.',
    nav: 'auth-back',
    user: null,
    form: { email: '' },
    error: null,
    sent: false,
    devToken: null
  });
});

router.post('/forgot-password', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  try {
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).render('forgot_password', {
        title: 'Recuperar contraseña · BiLingo Meet',
        description: 'Recupera el acceso a tu cuenta.',
        nav: 'auth-back',
        user: null,
        form: { email },
        error: 'Introduce un email válido.',
        sent: false,
        devToken: null
      });
    }

    const rows = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);

    // Always render the same "we sent you an email" UI to avoid email enumeration.
    let devToken = null;

    if (rows.length) {
      const userId = rows[0].id;
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      // Invalidate previous unused tokens for this user.
      await db.query(
        'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [userId]
      );
      await db.query(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
        [userId, token, expiresAt]
      );

      // No email transport configured in this project — surface the link in dev.
      devToken = token;
      console.log(`[auth] password reset issued for user ${userId}: /reset-password/${token}`);
    }

    return res.render('forgot_password', {
      title: 'Recuperar contraseña · BiLingo Meet',
      description: 'Recupera el acceso a tu cuenta.',
      nav: 'auth-back',
      user: null,
      form: { email },
      error: null,
      sent: true,
      devToken
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

async function findValidReset(token) {
  if (!token || !/^[a-f0-9]{8,128}$/i.test(token)) return null;
  const rows = await db.query(
    `SELECT id, user_id, expires_at, used_at
     FROM password_resets WHERE token = ?`,
    [token]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.used_at) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return r;
}

router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const reset = await findValidReset(req.params.token);
    return res.render('reset_password', {
      title: 'Nueva contraseña · BiLingo Meet',
      description: 'Elige una nueva contraseña para tu cuenta.',
      nav: 'auth-back',
      user: null,
      token: req.params.token,
      valid: !!reset,
      error: reset ? null : 'Este enlace de recuperación no es válido o ha caducado.'
    });
  } catch (err) { next(err); }
});

router.post('/reset-password/:token', async (req, res, next) => {
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || req.body.password_confirm || '');

  try {
    const reset = await findValidReset(req.params.token);
    if (!reset) {
      return res.status(400).render('reset_password', {
        title: 'Nueva contraseña · BiLingo Meet',
        description: 'Elige una nueva contraseña.',
        nav: 'auth-back',
        user: null,
        token: req.params.token,
        valid: false,
        error: 'Este enlace de recuperación no es válido o ha caducado.'
      });
    }

    if (password.length < 6) {
      return res.status(400).render('reset_password', {
        title: 'Nueva contraseña · BiLingo Meet',
        description: 'Elige una nueva contraseña.',
        nav: 'auth-back',
        user: null,
        token: req.params.token,
        valid: true,
        error: 'La contraseña debe tener al menos 6 caracteres.'
      });
    }
    if (password !== confirm) {
      return res.status(400).render('reset_password', {
        title: 'Nueva contraseña · BiLingo Meet',
        description: 'Elige una nueva contraseña.',
        nav: 'auth-back',
        user: null,
        token: req.params.token,
        valid: true,
        error: 'Las contraseñas no coinciden.'
      });
    }

    const hash = await hashPassword(password);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, reset.user_id]);
    await db.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [reset.id]);

    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ ok: true, redirect: 'login?reset=1' });
    }
    return res.redirect('../login?reset=1');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Account activation (magic link issued by admin)
// ---------------------------------------------------------------------------

router.get('/activate/:token', async (req, res, next) => {
  try {
    const t = await activation.findValidToken(req.params.token);
    return res.render('activate', {
      title: 'Activar cuenta · BiLingo Meet',
      description: 'Activa tu cuenta y elige una contraseña.',
      nav: 'auth-back',
      user: null,
      token: req.params.token,
      valid: !!t,
      activationEmail: t ? t.email : null,
      activationName: t ? t.display_name : null,
      error: t ? null : 'Este enlace de activación no es válido o ha caducado.'
    });
  } catch (err) { next(err); }
});

router.post('/activate/:token', async (req, res, next) => {
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || req.body.password_confirm || '');
  try {
    const t = await activation.findValidToken(req.params.token);
    if (!t) {
      return res.status(400).render('activate', {
        title: 'Activar cuenta · BiLingo Meet',
        description: 'Activa tu cuenta.',
        nav: 'auth-back', user: null,
        token: req.params.token, valid: false,
        activationEmail: null, activationName: null,
        error: 'Este enlace de activación no es válido o ha caducado.'
      });
    }
    if (password.length < 6) {
      return res.status(400).render('activate', {
        title: 'Activar cuenta · BiLingo Meet',
        description: 'Activa tu cuenta.',
        nav: 'auth-back', user: null,
        token: req.params.token, valid: true,
        activationEmail: t.email, activationName: t.display_name,
        error: 'La contraseña debe tener al menos 6 caracteres.'
      });
    }
    if (password !== confirm) {
      return res.status(400).render('activate', {
        title: 'Activar cuenta · BiLingo Meet',
        description: 'Activa tu cuenta.',
        nav: 'auth-back', user: null,
        token: req.params.token, valid: true,
        activationEmail: t.email, activationName: t.display_name,
        error: 'Las contraseñas no coinciden.'
      });
    }
    await activation.consumeToken(t.id, t.user_id, password);
    return res.redirect('login?reset=1');
  } catch (err) { next(err); }
});

module.exports = router;