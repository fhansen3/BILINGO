'use strict';

/**
 * BiLingo Meet — server-rendered admin pages.
 *
 *   GET  /admin                    → redirect to /admin/users
 *   GET  /admin/users              → admin_users.ejs (search/role/status filters)
 *   POST /admin/users/:id/suspend  → set status=suspended (+ audit)
 *   POST /admin/users/:id/activate → set status=active (+ audit)
 *   POST /admin/users/:id/role     → switch role user<->admin (+ audit)
 *
 *   GET  /admin/languages          → admin_languages.ejs (languages + voices)
 *   POST /admin/languages          → add language (+ audit)
 *   POST /admin/languages/:id/toggle → toggle is_enabled (+ audit)
 *   POST /admin/voices             → add voice (+ audit)
 *   POST /admin/voices/:id/toggle  → toggle is_enabled (+ audit)
 *
 *   GET  /admin/usage              → admin_usage.ejs (KPIs + charts + feedback)
 *
 * All routes are gated behind requireAuth + requireAdmin (session-based).
 * Every mutating action is logged to admin_audit_logs.
 */

const router = require('express').Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/requireAuth');

// ---------------------------------------------------------------------------
// requireAdmin (session-based)
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  // req.user is set by requireAuth from req.session.user (which is minimal —
  // refresh role from DB to guard against stale sessions).
  db.query('SELECT role, status FROM users WHERE id = ?', [req.user.id])
    .then(rows => {
      if (!rows.length) return res.status(403).render('404', { title: 'Forbidden', nav: 'app', user: req.user, layout: 'layout' });
      if (rows[0].role !== 'admin') {
        return res.status(403).render('404', {
          title: 'Acceso denegado',
          nav: 'app',
          user: req.user
        });
      }
      // Keep req.session.user.role fresh.
      if (req.session && req.session.user) req.session.user.role = 'admin';
      next();
    })
    .catch(next);
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

// ---------------------------------------------------------------------------
// GET /admin → redirect
// ---------------------------------------------------------------------------
router.get('/admin', requireAuth, requireAdmin, (req, res) => {
  return res.redirect('/admin/users');
});

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------
router.get('/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const status = (req.query.status || '').trim();

    const where = [];
    const params = [];
    if (search) {
      where.push('(email LIKE ? OR display_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (role && ['user', 'admin'].includes(role)) {
      where.push('role = ?');
      params.push(role);
    }
    if (status && ['active', 'suspended', 'banned'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }

    const sql = `
      SELECT id, email, display_name, avatar_color, role, status,
             native_language, learning_language, created_at
      FROM users
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT 200
    `;
    const users = await db.query(sql, params);

    res.render('admin_users', {
      title: 'Usuarios · Admin · BiLingo Meet',
      description: 'Gestión de usuarios.',
      nav: 'app',
      active: 'admin',
      user: req.user,
      users,
      search,
      role,
      status,
      flash: req.query.ok ? decodeURIComponent(req.query.ok) : null,
      flashError: req.query.err ? decodeURIComponent(req.query.err) : null
    });
  } catch (err) { next(err); }
});

// POST /admin/users/:id/suspend
router.post('/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect('/admin/users?err=' + encodeURIComponent('ID inválido'));
    if (id === req.user.id) {
      return res.redirect('/admin/users?err=' + encodeURIComponent('No puedes suspenderte a ti mismo.'));
    }
    await db.query("UPDATE users SET status='suspended' WHERE id = ?", [id]);
    await logAudit(req.user.id, 'user.suspend', 'user', id, { by: req.user.email });
    return res.redirect('/admin/users?ok=' + encodeURIComponent('Usuario suspendido.'));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/activate
router.post('/admin/users/:id/activate', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect('/admin/users?err=' + encodeURIComponent('ID inválido'));
    await db.query("UPDATE users SET status='active' WHERE id = ?", [id]);
    await logAudit(req.user.id, 'user.activate', 'user', id, { by: req.user.email });
    return res.redirect('/admin/users?ok=' + encodeURIComponent('Usuario activado.'));
  } catch (err) { next(err); }
});

// POST /admin/users/:id/role
router.post('/admin/users/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const newRole = String(req.body.role || '').trim();
    if (!id || !['user', 'admin'].includes(newRole)) {
      return res.redirect('/admin/users?err=' + encodeURIComponent('Datos inválidos.'));
    }
    if (id === req.user.id && newRole !== 'admin') {
      return res.redirect('/admin/users?err=' + encodeURIComponent('No puedes degradarte a ti mismo.'));
    }
    await db.query('UPDATE users SET role = ? WHERE id = ?', [newRole, id]);
    await logAudit(req.user.id, 'user.role_change', 'user', id, { newRole, by: req.user.email });
    return res.redirect('/admin/users?ok=' + encodeURIComponent('Rol actualizado a ' + newRole + '.'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/languages
// ---------------------------------------------------------------------------
router.get('/admin/languages', requireAuth, requireAdmin, async (req, res, next) => {
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

// POST /admin/languages
router.post('/admin/languages', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const nativeName = String(req.body.native_name || '').trim() || null;
    let direction = String(req.body.direction || 'ltr').trim().toLowerCase();
    if (!['ltr', 'rtl'].includes(direction)) direction = 'ltr';
    const sortOrder = parseInt(req.body.sort_order, 10) || 0;

    if (!code || !name) {
      return res.redirect('/admin/languages?err=' + encodeURIComponent('Código y nombre son obligatorios.'));
    }
    if (code.length > 8) {
      return res.redirect('/admin/languages?err=' + encodeURIComponent('Código demasiado largo.'));
    }

    try {
      const r = await db.query(
        'INSERT INTO languages (code, name, native_name, direction, is_enabled, sort_order) VALUES (?,?,?,?,1,?)',
        [code, name, nativeName, direction, sortOrder]
      );
      await logAudit(req.user.id, 'language.add', 'language', r.insertId || 0, { code, name });
      return res.redirect('/admin/languages?ok=' + encodeURIComponent('Idioma "' + name + '" añadido.'));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.redirect('/admin/languages?err=' + encodeURIComponent('Ese código de idioma ya existe.'));
      }
      throw e;
    }
  } catch (err) { next(err); }
});

// POST /admin/languages/:id/toggle
router.post('/admin/languages/:id/toggle', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect('/admin/languages?err=' + encodeURIComponent('ID inválido.'));
    const rows = await db.query('SELECT id, code, is_enabled FROM languages WHERE id = ?', [id]);
    if (!rows.length) return res.redirect('/admin/languages?err=' + encodeURIComponent('No encontrado.'));
    const next_ = rows[0].is_enabled ? 0 : 1;
    await db.query('UPDATE languages SET is_enabled = ? WHERE id = ?', [next_, id]);
    await logAudit(req.user.id, 'language.toggle', 'language', id, { code: rows[0].code, is_enabled: next_ });
    return res.redirect('/admin/languages?ok=' + encodeURIComponent('Idioma ' + (next_ ? 'activado' : 'desactivado') + '.'));
  } catch (err) { next(err); }
});

// POST /admin/voices
router.post('/admin/voices', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const languageCode = String(req.body.language_code || '').trim().toLowerCase();
    const voiceKey = String(req.body.voice_key || '').trim();
    const displayName = String(req.body.display_name || '').trim();
    let gender = String(req.body.gender || 'neutral').trim().toLowerCase();
    if (!['male', 'female', 'neutral'].includes(gender)) gender = 'neutral';
    const provider = String(req.body.provider || 'mock').trim() || 'mock';
    const providerVoiceId = String(req.body.provider_voice_id || '').trim();

    if (!languageCode || !voiceKey || !displayName || !providerVoiceId) {
      return res.redirect('/admin/languages?err=' + encodeURIComponent('Todos los campos de la voz son obligatorios.'));
    }

    try {
      const r = await db.query(
        `INSERT INTO voices (language_code, voice_key, display_name, gender, provider, provider_voice_id, is_enabled, sort_order)
         VALUES (?,?,?,?,?,?,1,0)`,
        [languageCode, voiceKey, displayName, gender, provider, providerVoiceId]
      );
      await logAudit(req.user.id, 'voice.add', 'voice', r.insertId || 0, { languageCode, voiceKey });
      return res.redirect('/admin/languages?ok=' + encodeURIComponent('Voz añadida.'));
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.redirect('/admin/languages?err=' + encodeURIComponent('Ya existe una voz con esa clave para ese idioma.'));
      }
      if (e && (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW')) {
        return res.redirect('/admin/languages?err=' + encodeURIComponent('El idioma indicado no existe.'));
      }
      throw e;
    }
  } catch (err) { next(err); }
});

// POST /admin/voices/:id/toggle
router.post('/admin/voices/:id/toggle', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect('/admin/languages?err=' + encodeURIComponent('ID inválido.'));
    const rows = await db.query('SELECT id, voice_key, is_enabled FROM voices WHERE id = ?', [id]);
    if (!rows.length) return res.redirect('/admin/languages?err=' + encodeURIComponent('No encontrada.'));
    const next_ = rows[0].is_enabled ? 0 : 1;
    await db.query('UPDATE voices SET is_enabled = ? WHERE id = ?', [next_, id]);
    await logAudit(req.user.id, 'voice.toggle', 'voice', id, { voice_key: rows[0].voice_key, is_enabled: next_ });
    return res.redirect('/admin/languages?ok=' + encodeURIComponent('Voz ' + (next_ ? 'activada' : 'desactivada') + '.'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/usage
// ---------------------------------------------------------------------------
router.get('/admin/usage', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // KPI 1: total meetings (rooms that have actually started OR ended)
    const totalMeetingsRow = await db.query(
      "SELECT COUNT(*) AS c FROM rooms WHERE status IN ('active','ended','closed') OR started_at IS NOT NULL"
    );
    const totalMeetings = totalMeetingsRow[0].c;

    // KPI 2: translation minutes = SUM(total_latency_ms) / 60000
    const latencySumRow = await db.query(
      "SELECT COALESCE(SUM(total_latency_ms),0) AS s, COALESCE(AVG(total_latency_ms),0) AS a FROM translation_logs"
    );
    const sumLatencyMs = Number(latencySumRow[0].s || 0);
    const avgLatencyMs = Math.round(Number(latencySumRow[0].a || 0));
    const translationMinutes = Math.round(sumLatencyMs / 60000);

    // KPI 3: average rating (translation_quality + audio_quality combined)
    const ratingRow = await db.query(
      `SELECT COALESCE(AVG((COALESCE(translation_quality,0)+COALESCE(audio_quality,0))/
                           NULLIF((CASE WHEN translation_quality IS NOT NULL THEN 1 ELSE 0 END)
                                 +(CASE WHEN audio_quality IS NOT NULL THEN 1 ELSE 0 END),0)),0) AS r
       FROM feedback_ratings`
    );
    const avgRating = Number(ratingRow[0].r || 0).toFixed(2);

    // Latency over time: last 14 days, daily AVG(total_latency_ms)
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

    // Most used language pairs (top 7)
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

    // Recent feedback (last 20)
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
      kpi: {
        totalMeetings,
        translationMinutes,
        avgLatencyMs,
        avgRating
      },
      latencyChart,
      pairsChart,
      feedback
    });
  } catch (err) { next(err); }
});

module.exports = router;