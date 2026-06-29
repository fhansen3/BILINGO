'use strict';

/**
 * BiLingo Meet — authenticated app shell (server-rendered EJS).
 *
 *   GET  /dashboard          → main panel (quick actions + upcoming + recent)
 *   GET  /profile            → edit profile + language/voice/delivery defaults
 *   POST /profile            → save profile preferences
 *   GET  /account-settings   → password change, active sessions, account deletion
 *   POST /account-settings/password   → change password
 *   POST /account-settings/delete     → delete account
 *
 * All routes are gated behind requireAuth (session-based).
 * The JSON/JWT API is NOT touched.
 */

const router = require('express').Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/requireAuth');
const { bp } = require('../middleware/basePrefix');
const { hashPassword, verifyPassword } = require('../utils/hash');
const costsService = require('../services/costs.service');
const creditsService = require('../services/credits.service');

const AVATAR_COLORS = ['#58CC02', '#1CB0F6', '#FF9600', '#CE82FF', '#FF4B4B', '#FFC800', '#2B70C9', '#4F46E5'];
const DELIVERY_MODES = ['voice', 'text', 'both'];
const VOICE_GENDERS = ['', 'male', 'female', 'neutral']; // '' = no preference
const VALID_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

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
    console.error('[app] failed to load languages', err && err.message);
    return [];
  }
}

async function loadFullUser(id) {
  const rows = await db.query(
    `SELECT id, email, display_name, bio, avatar_color, avatar_url,
            native_language, learning_language,
            preferred_voice,
            default_native_voice_gender, default_target_voice_gender,
            default_delivery_mode, default_captions_enabled,
            proficiency_level, country, company_id, role, status, plan,
            is_online, last_seen, last_login_at, created_at
     FROM users WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

function refreshSessionUser(req, full) {
  if (!full || !req.session) return;
  // Keep req.session.user minimal but consistent with what other views expect.
  req.session.user = {
    id: full.id,
    email: full.email,
    display_name: full.display_name,
    avatar_color: full.avatar_color,
    native_language: full.native_language,
    learning_language: full.learning_language,
    role: full.role,
    plan: full.plan || 'free'
  };
}

// ---------------------------------------------------------------------------
// GET /dashboard
// ---------------------------------------------------------------------------

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const full = await loadFullUser(userId);

    // Upcoming meetings:
    // The rooms table has no scheduled_start column (scheduling is out of the
    // current concept's scope — see docs/GAP_REPORT.md §4.7). We surface any
    // room the user hosts whose status is still 'waiting' as "upcoming/open".
    const upcoming = await db.query(
      `SELECT id, room_code, name, topic, language_focus, status, created_at
       FROM rooms
       WHERE host_id = ? AND status IN ('waiting','open')
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    );

    // Recent meetings: anything the user hosted or joined, most recent first.
    const recent = await db.query(
      `SELECT id, room_code, name, topic, language_focus, status,
              host_id, guest_id, started_at, ended_at, duration_seconds, created_at
       FROM rooms
       WHERE host_id = ? OR guest_id = ?
       ORDER BY COALESCE(ended_at, started_at, created_at) DESC
       LIMIT 8`,
      [userId, userId]
    );

    // Cost indicators (only for admin roles).
    // - superadmin/admin → global view (companyId = null)
    // - company_admin    → scoped to their company
    let costTotals = null;
    let audioMinutes = null;
    let creditBalance = null;
    const role = full && full.role;
    const isAdmin = role === 'superadmin' || role === 'admin' || role === 'company_admin';
    if (isAdmin) {
      try {
        const scopeCompanyId = (role === 'company_admin') ? (full.company_id || null) : null;
        const [totals, minutes] = await Promise.all([
          costsService.getTotals(scopeCompanyId),
          costsService.getAudioMinutes(scopeCompanyId)
        ]);
        costTotals = totals;
        audioMinutes = minutes;
      } catch (e) {
        console.error('[dashboard] failed to load cost totals', e && e.message);
      }
    }

    // Credit balance for any user whose company has credits (shown if low/negative).
    if (full && full.company_id) {
      try {
        creditBalance = await creditsService.getBalance(full.company_id);
      } catch (e) {
        console.error('[dashboard] failed to load credit balance', e && e.message);
      }
    }

    res.render('dashboard', {
      title: 'Panel · BiLingo Meet',
      description: 'Tu panel de BiLingo Meet: crea reuniones, programa o únete con un código.',
      nav: 'app',
      active: 'dashboard',
      user: full,
      upcoming,
      recent,
      isAdmin,
      costTotals,
      audioMinutes,
      creditBalance
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /profile
// ---------------------------------------------------------------------------

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const full = await loadFullUser(req.user.id);
    const languages = await getLanguages();
    res.render('user_profile', {
      title: 'Perfil · BiLingo Meet',
      description: 'Edita tu perfil y tus preferencias por defecto para las reuniones.',
      nav: 'app',
      active: 'profile',
      user: full,
      profile: full,
      languages,
      avatarColors: AVATAR_COLORS,
      saved: req.query.saved === '1',
      error: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /profile
// ---------------------------------------------------------------------------

router.post('/profile', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};

    const displayName = String(body.displayName || body.display_name || '').trim();
    const bio = String(body.bio || '').trim() || null;
    const avatarColor = String(body.avatarColor || body.avatar_color || '').trim() || null;
    const avatarUrl = String(body.avatarUrl || body.avatar_url || '').trim() || null;
    const country = String(body.country || '').trim() || null;

    const nativeLang = String(body.defaultNativeLanguage || body.native_language || '').trim() || null;
    const targetLang = String(body.defaultTargetLanguage || body.learning_language || '').trim() || null;

    let nativeGender = String(body.defaultNativeVoiceGender || body.default_native_voice_gender || '').trim().toLowerCase();
    let targetGender = String(body.defaultTargetVoiceGender || body.default_target_voice_gender || '').trim().toLowerCase();
    if (!VOICE_GENDERS.includes(nativeGender)) nativeGender = '';
    if (!VOICE_GENDERS.includes(targetGender)) targetGender = '';

    let preferredVoice = String(body.preferredVoice || body.preferred_voice || '').trim().toLowerCase();
    if (preferredVoice && !VALID_VOICES.includes(preferredVoice)) preferredVoice = '';
    // '' (cadena vacía) significa "automática por género" → guardamos NULL
    const preferredVoiceDb = preferredVoice || null;

    let deliveryMode = String(body.defaultDeliveryMode || body.default_delivery_mode || 'both').trim().toLowerCase();
    if (!DELIVERY_MODES.includes(deliveryMode)) deliveryMode = 'both';

    const captionsEnabled = body.defaultCaptionsEnabled === 'on'
      || body.defaultCaptionsEnabled === '1'
      || body.defaultCaptionsEnabled === 1
      || body.defaultCaptionsEnabled === true
      || body.default_captions_enabled === 'on'
      || body.default_captions_enabled === '1' ? 1 : 0;

    // Validation
    async function renderError(error) {
      const full = await loadFullUser(req.user.id);
      const languages = await getLanguages();
      // Merge submitted values back in so the user doesn't lose their edits
      const merged = Object.assign({}, full, {
        display_name: displayName || full.display_name,
        bio: bio,
        avatar_color: avatarColor || full.avatar_color,
        avatar_url: avatarUrl,
        country: country,
        native_language: nativeLang,
        learning_language: targetLang,
        default_native_voice_gender: nativeGender || null,
        default_target_voice_gender: targetGender || null,
        default_delivery_mode: deliveryMode,
        default_captions_enabled: captionsEnabled
      });
      return res.status(400).render('user_profile', {
        title: 'Perfil · BiLingo Meet',
        description: 'Edita tu perfil.',
        nav: 'app',
        active: 'profile',
        user: full,
        profile: merged,
        languages,
        avatarColors: AVATAR_COLORS,
        saved: false,
        error
      });
    }

    if (!displayName) {
      return renderError('El nombre para mostrar es obligatorio.');
    }
    if (displayName.length > 100) {
      return renderError('El nombre para mostrar no puede superar 100 caracteres.');
    }
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
      return renderError('La URL del avatar debe empezar por http:// o https://');
    }

    await db.query(
      `UPDATE users SET
         display_name = ?,
         bio = ?,
         avatar_color = COALESCE(?, avatar_color),
         avatar_url = ?,
         country = ?,
         native_language = ?,
         learning_language = ?,
         preferred_voice = ?,
         default_native_voice_gender = ?,
         default_target_voice_gender = ?,
         default_delivery_mode = ?,
         default_captions_enabled = ?
       WHERE id = ?`,
      [
        displayName,
        bio,
        avatarColor,
        avatarUrl,
        country,
        nativeLang,
        targetLang,
        preferredVoiceDb,
        nativeGender || null,
        targetGender || null,
        deliveryMode,
        captionsEnabled,
        req.user.id
      ]
    );

    const full = await loadFullUser(req.user.id);
    refreshSessionUser(req, full);

    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ ok: true, user: full });
    }
    return res.redirect(bp(req, 'profile?saved=1'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /account-settings
// ---------------------------------------------------------------------------

router.get('/account-settings', requireAuth, async (req, res, next) => {
  try {
    const full = await loadFullUser(req.user.id);

    // "Active sessions" — we use a single cookie-session in this app, so the
    // closest honest representation is the current session info.
    const sessions = [
      {
        current: true,
        userAgent: req.headers['user-agent'] || 'Navegador desconocido',
        ip: req.ip || req.headers['x-forwarded-for'] || '—',
        signedInAt: full.last_login_at || full.created_at
      }
    ];

    res.render('account_settings', {
      title: 'Configuración de la cuenta · BiLingo Meet',
      description: 'Cambia tu contraseña, revisa tus sesiones y gestiona tu cuenta.',
      nav: 'app',
      active: 'account',
      user: full,
      profile: full,
      sessions,
      passwordError: req.query.pwerr || null,
      passwordSaved: req.query.pwsaved === '1',
      voiceSaved: req.query.voicesaved === '1',
      voiceError: req.query.voiceerr || null,
      deleteError: req.query.delerr || null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /account-settings/voice  — actualiza preferred_voice
// ---------------------------------------------------------------------------

router.post('/account-settings/voice', requireAuth, async (req, res, next) => {
  try {
    let v = String(req.body.preferredVoice || req.body.preferred_voice || '').trim().toLowerCase();
    if (v === 'auto' || v === '') {
      v = null; // automática por género
    } else if (!VALID_VOICES.includes(v)) {
      return res.redirect(bp(req, 'account-settings?voiceerr=' + encodeURIComponent('Voz no válida.')));
    }
    await db.query('UPDATE users SET preferred_voice = ? WHERE id = ?', [v, req.user.id]);
    return res.redirect(bp(req, 'account-settings?voicesaved=1'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /account-settings/password
// ---------------------------------------------------------------------------

router.post('/account-settings/password', requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body.currentPassword || req.body.current_password || '');
    const next_ = String(req.body.newPassword || req.body.new_password || '');
    const confirm = String(req.body.confirmPassword || req.body.confirm_password || '');

    if (!current || !next_) {
      return res.redirect(bp(req, 'account-settings?pwerr=' + encodeURIComponent('Introduce la contraseña actual y la nueva.')));
    }
    if (next_.length < 6) {
      return res.redirect(bp(req, 'account-settings?pwerr=' + encodeURIComponent('La nueva contraseña debe tener al menos 6 caracteres.')));
    }
    if (next_ !== confirm) {
      return res.redirect(bp(req, 'account-settings?pwerr=' + encodeURIComponent('La confirmación no coincide.')));
    }

    const rows = await db.query('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.redirect(bp(req, 'account-settings?pwerr=' + encodeURIComponent('Usuario no encontrado.')));
    }
    const ok = await verifyPassword(current, rows[0].password_hash);
    if (!ok) {
      return res.redirect(bp(req, 'account-settings?pwerr=' + encodeURIComponent('La contraseña actual no es correcta.')));
    }

    const hash = await hashPassword(next_);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

    return res.redirect(bp(req, 'account-settings?pwsaved=1'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /account-settings/delete
// ---------------------------------------------------------------------------

router.post('/account-settings/delete', requireAuth, async (req, res, next) => {
  try {
    const confirmText = String(req.body.confirm || '').trim().toUpperCase();
    const password = String(req.body.password || '');

    if (confirmText !== 'ELIMINAR') {
      return res.redirect(bp(req, 'account-settings?delerr=' + encodeURIComponent('Para confirmar, escribe ELIMINAR.')));
    }

    const rows = await db.query('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.redirect(bp(req, 'account-settings?delerr=' + encodeURIComponent('Usuario no encontrado.')));
    }
    if (!password) {
      return res.redirect(bp(req, 'account-settings?delerr=' + encodeURIComponent('Introduce tu contraseña para confirmar.')));
    }
    const ok = await verifyPassword(password, rows[0].password_hash);
    if (!ok) {
      return res.redirect(bp(req, 'account-settings?delerr=' + encodeURIComponent('La contraseña no es correcta.')));
    }

    await db.query('DELETE FROM users WHERE id = ?', [req.user.id]);
    if (req.session) req.session = null;
    res.clearCookie('token');
    return res.redirect(bp(req, '?deleted=1'));
  } catch (err) { next(err); }
});

module.exports = router;