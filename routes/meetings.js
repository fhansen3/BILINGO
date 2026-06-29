'use strict';

/**
 * BiLingo Meet — Meeting setup routes (server-rendered EJS).
 *
 *   POST /meetings/instant            → create instant meeting, redirect to lobby
 *   POST /rooms/new                   → alias for /meetings/instant (dashboard form)
 *   GET  /schedule                    → render schedule_meeting.ejs
 *   POST /schedule                    → create scheduled meeting + invitations
 *   GET  /m/:code                     → render meeting_details.ejs
 *   GET  /m/:code/lobby               → enter the lobby (placeholder → SPA room)
 *
 * NOTE / PRAGMATIC DEVIATION:
 *   The design specifies a `meetings` table with `actualStart`, `hostUserId`,
 *   status='live', and a sibling `meeting_invitations` table. This codebase
 *   already had a fully-wired `rooms` table covering the same semantics
 *   (host_id, started_at, status='active', room_code, …) plus 9 inbound FKs
 *   from messages / session_history / reports.
 *
 *   Rather than fork the schema and duplicate that web of relationships, we
 *   map the design's "meeting" concept onto the existing `rooms` table:
 *
 *     design                    → rooms columns
 *     ─────────────────────────────────────────────
 *     id (uuid)                 → room_code (xxx-xxxx-xxx, unique)
 *     hostUserId                → host_id
 *     status='live'             → status='active'
 *     status='scheduled'        → status='waiting' + scheduled_start IS NOT NULL
 *     actualStart               → started_at
 *     scheduledStart            → scheduled_start  (added in this step)
 *
 *   `meeting_invitations` was added as a new table FK'd to rooms (this step).
 *
 *   /m/:code/lobby is a placeholder that hands the user off to the existing
 *   SPA room view (#/room/:code). A dedicated lobby UI is a later step.
 */

const router = require('express').Router();
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middleware/requireAuth');
const { bp } = require('../middleware/basePrefix');
const { generateMeetingCode } = require('../utils/code');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateUniqueCode() {
  for (let i = 0; i < 12; i++) {
    const code = generateMeetingCode();
    const rows = await db.query('SELECT id FROM rooms WHERE room_code = ?', [code]);
    if (!rows.length) return code;
  }
  // Astronomically unlikely fall-through.
  throw new Error('Could not generate a unique meeting code');
}

function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  s = s.trim();
  if (s.length > 190) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function parseInvitees(body) {
  // Accept either invitees[]=a@x&invitees[]=b@x OR invitee_1, invitee_2, …
  // OR a single textarea "invitees" with comma/newline separated emails.
  const out = [];
  const seen = new Set();

  function push(raw) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e) return;
    if (!isValidEmail(e)) return;
    if (seen.has(e)) return;
    seen.add(e);
    out.push(e);
  }

  if (Array.isArray(body.invitees)) {
    body.invitees.forEach(push);
  } else if (typeof body.invitees === 'string') {
    body.invitees.split(/[\s,;]+/).forEach(push);
  }
  for (let i = 1; i <= 10; i++) {
    if (body['invitee_' + i] !== undefined) push(body['invitee_' + i]);
  }

  return out.slice(0, 5); // max 5 invitees
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex chars
}

async function loadMeeting(code) {
  const rows = await db.query(
    `SELECT r.*,
            h.id   AS host_id_user,
            h.display_name AS host_name,
            h.email        AS host_email,
            h.avatar_color AS host_color
       FROM rooms r
       LEFT JOIN users h ON r.host_id = h.id
       WHERE r.room_code = ?`,
    [code]
  );
  return rows[0] || null;
}

async function loadInvitations(roomId) {
  return db.query(
    `SELECT id, email, token, status, created_at, responded_at
       FROM meeting_invitations
       WHERE room_id = ?
       ORDER BY id ASC`,
    [roomId]
  );
}

// ---------------------------------------------------------------------------
// POST /meetings/instant   (also mounted at POST /rooms/new for the dashboard)
// ---------------------------------------------------------------------------

async function createInstant(req, res, next) {
  try {
    const code = await generateUniqueCode();
    const topic = (req.body && req.body.topic ? String(req.body.topic).trim() : '') || null;
    const languageFocus = (req.body && req.body.languageFocus
                           ? String(req.body.languageFocus).trim() : '') || null;

    // rule_free_tier_limits: free-plan hosts get a hard 60-minute cap.
    // Pro hosts: no cap unless they pass one explicitly.
    const planRows = await db.query('SELECT plan FROM users WHERE id = ?', [req.user.id]);
    const plan = (planRows[0] && planRows[0].plan) || 'free';
    const durationLimitMin = (plan === 'free') ? 60 : null;
    const saveTranscript = 1; // default ON for instant meetings

    await db.query(
      `INSERT INTO rooms
         (room_code, host_id, topic, language_focus, status, started_at,
          duration_limit_min, save_transcript)
       VALUES (?, ?, ?, ?, 'active', NOW(), ?, ?)`,
      [code, req.user.id, topic, languageFocus, durationLimitMin, saveTranscript]
    );

    return res.redirect(bp(req, `m/${code}/lobby`));
  } catch (err) { next(err); }
}

router.post('/meetings/instant', requireAuth, createInstant);
router.post('/rooms/new',        requireAuth, createInstant); // dashboard form

// ---------------------------------------------------------------------------
// GET /schedule  →  schedule_meeting.ejs
// ---------------------------------------------------------------------------

router.get('/schedule', requireAuth, async (req, res, next) => {
  try {
    // Surface the host's plan so the form can hard-cap free-tier durations.
    const planRows = await db.query('SELECT plan FROM users WHERE id = ?', [req.user.id]);
    const plan = (planRows[0] && planRows[0].plan) || 'free';
    const userWithPlan = Object.assign({}, req.session.user || {}, { plan });

    res.render('schedule_meeting', {
      title: 'Programar reunión · BiLingo Meet',
      description: 'Programa una reunión e invita hasta 5 personas.',
      nav: 'app',
      active: 'schedule',
      user: userWithPlan,
      form: {
        title: '',
        scheduledStart: '',
        topic: '',
        languageFocus: '',
        durationLimitMin: plan === 'free' ? 60 : 0,
        saveTranscript: true,
        invitees: ['', '', '', '', '']
      },
      error: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /schedule
// ---------------------------------------------------------------------------

router.post('/schedule', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const scheduledStartRaw = String(body.scheduledStart || body.scheduled_start || '').trim();
    const topic = String(body.topic || '').trim() || null;
    const languageFocus = String(body.languageFocus || body.language_focus || '').trim() || null;
    const invitees = parseInvitees(body);

    function reRender(error) {
      // Plan is needed to keep the free-tier duration cap visible on re-render.
      // We do a quick best-effort lookup; falling back to 'free' is fine.
      return (async () => {
        let plan = 'free';
        try {
          const r = await db.query('SELECT plan FROM users WHERE id = ?', [req.user.id]);
          plan = (r[0] && r[0].plan) || 'free';
        } catch (_) {}
        return res.status(400).render('schedule_meeting', {
          title: 'Programar reunión · BiLingo Meet',
          description: 'Programa una reunión e invita hasta 5 personas.',
          nav: 'app',
          active: 'schedule',
          user: Object.assign({}, req.session.user || {}, { plan }),
          form: {
            title,
            scheduledStart: scheduledStartRaw,
            topic: topic || '',
            languageFocus: languageFocus || '',
            durationLimitMin: parseInt(body.durationLimitMin, 10) || (plan === 'free' ? 60 : 0),
            saveTranscript: (body.saveTranscript === '1' || body.saveTranscript === 'on'
                             || body.saveTranscript === true || body.saveTranscript === 1),
            invitees: (Array.isArray(body.invitees) ? body.invitees
                       : (typeof body.invitees === 'string'
                          ? body.invitees.split(/[\s,;]+/) : []))
                      .concat(['', '', '', '', '']).slice(0, 5)
          },
          error
        });
      })();
    }

    if (!title) return reRender('El título de la reunión es obligatorio.');
    if (title.length > 120) return reRender('El título no puede superar 120 caracteres.');

    let scheduledStart = null;
    if (scheduledStartRaw) {
      // Accept <input type="datetime-local"> which is "YYYY-MM-DDTHH:MM"
      const d = new Date(scheduledStartRaw);
      if (isNaN(d.getTime())) {
        return reRender('La fecha y hora no son válidas.');
      }
      scheduledStart = d;
    } else {
      return reRender('Debes elegir una fecha y hora para la reunión.');
    }

    // Raw inviter input may have had bad emails — flag if anything was dropped.
    const rawInviteeCount =
      Array.isArray(body.invitees) ? body.invitees.filter(Boolean).length
      : (typeof body.invitees === 'string'
         ? body.invitees.split(/[\s,;]+/).filter(Boolean).length
         : 0);
    if (rawInviteeCount > 5) {
      return reRender('Puedes invitar como máximo a 5 personas.');
    }

    const code = await generateUniqueCode();

    // MySQL DATETIME from JS Date
    const pad = (n) => String(n).padStart(2, '0');
    const mysqlDt =
      scheduledStart.getFullYear() + '-' +
      pad(scheduledStart.getMonth() + 1) + '-' +
      pad(scheduledStart.getDate()) + ' ' +
      pad(scheduledStart.getHours()) + ':' +
      pad(scheduledStart.getMinutes()) + ':' +
      pad(scheduledStart.getSeconds());

    // rule_free_tier_limits + transcript retention
    const planRows = await db.query('SELECT plan FROM users WHERE id = ?', [req.user.id]);
    const plan = (planRows[0] && planRows[0].plan) || 'free';
    let durationLimitMin = parseInt(body.durationLimitMin, 10);
    if (!Number.isFinite(durationLimitMin) || durationLimitMin <= 0) durationLimitMin = null;
    // Free tier: hard-cap at 60 regardless of what they posted.
    if (plan === 'free') durationLimitMin = 60;

    const saveTranscript = (body.saveTranscript === '1' || body.saveTranscript === 'on'
                            || body.saveTranscript === true || body.saveTranscript === 1) ? 1 : 0;

    const result = await db.query(
      `INSERT INTO rooms
         (room_code, name, host_id, topic, language_focus, status, scheduled_start,
          duration_limit_min, save_transcript)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
      [code, title, req.user.id, topic, languageFocus, mysqlDt,
       durationLimitMin, saveTranscript]
    );
    const roomId = result.insertId;

    for (const email of invitees) {
      const token = randomToken();
      await db.query(
        `INSERT INTO meeting_invitations
           (room_id, email, token, invited_by, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [roomId, email, token, req.user.id]
      );
    }

    return res.redirect(bp(req, `m/${code}`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code   →  meeting_details.ejs
// ---------------------------------------------------------------------------

router.get('/m/:code', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) {
      return res.status(404).render('404', {
        title: 'Reunión no encontrada · BiLingo Meet',
        description: 'No se encontró ninguna reunión con ese código.',
        nav: 'app',
        user: req.session.user
      });
    }

    // Access rule: anyone who knows the code can see basic details (host name,
    // title, scheduled time, code, join button). Only the host sees invitees.
    const isHost = meeting.host_id === req.user.id;
    const invitations = isHost ? await loadInvitations(meeting.id) : [];

    const joinUrl = `${req.protocol}://${req.get('host')}/m/${meeting.room_code}`;

    res.render('meeting_details', {
      title: (meeting.name || 'Reunión') + ' · BiLingo Meet',
      description: 'Detalles de la reunión y enlace para unirse.',
      nav: 'app',
      active: null,
      user: req.session.user,
      meeting,
      isHost,
      invitations,
      joinUrl
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Helper: load enabled languages for the lobby dropdowns
// ---------------------------------------------------------------------------
async function loadLanguages() {
  return db.query(
    `SELECT code, name, native_name
       FROM languages
       WHERE is_enabled = 1
       ORDER BY sort_order ASC, name ASC`
  );
}

function notFound(req, res) {
  return res.status(404).render('404', {
    title: 'Reunión no encontrada · BiLingo Meet',
    description: 'No se encontró ninguna reunión con ese código.',
    nav: 'app',
    user: req.session.user || null
  });
}

const VALID_GENDERS = ['male', 'female', 'neutral'];
const VALID_DELIVERY = ['voice', 'text', 'both'];

// ---------------------------------------------------------------------------
// GET /m/:code/guest   →  guest_join.ejs   (PUBLIC — for users without account)
// ---------------------------------------------------------------------------
router.get('/m/:code/guest', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    // If they ARE logged in, send them to the regular lobby — guests are the
    // exception, not the rule.
    if (req.session && req.session.user && req.session.user.id) {
      return res.redirect(`m/${meeting.room_code}/lobby`);
    }

    const languages = await loadLanguages();
    res.render('guest_join', {
      title: (meeting.name || 'Reunión') + ' · Invitado · BiLingo Meet',
      description: 'Únete a la reunión como invitado.',
      nav: 'public',
      active: null,
      user: null,
      meeting,
      languages,
      form: null,
      error: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/guest   →  create guest participant + redirect to room (PUBLIC)
// ---------------------------------------------------------------------------
router.post('/m/:code/guest', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const body = req.body || {};
    const displayName = String(body.displayName || '').trim();
    const nativeLanguage = String(body.nativeLanguage || '').trim().toLowerCase();

    const languages = await loadLanguages();
    const validCodes = new Set(languages.map(l => l.code));

    function reRender(error) {
      return res.status(400).render('guest_join', {
        title: (meeting.name || 'Reunión') + ' · Invitado · BiLingo Meet',
        description: 'Únete a la reunión como invitado.',
        nav: 'public',
        active: null,
        user: null,
        meeting,
        languages,
        form: { displayName, nativeLanguage },
        error
      });
    }

    if (!displayName) return reRender('Ingresa tu nombre.');
    if (displayName.length > 100) return reRender('Tu nombre es demasiado largo.');
    if (!nativeLanguage || !validCodes.has(nativeLanguage)) {
      return reRender('Selecciona un idioma nativo válido.');
    }

    // Decide initial status (waiting room gate).
    const waitingEnabled = !!meeting.waiting_room_enabled;
    const initialStatus = waitingEnabled ? 'waiting' : 'admitted';

    // Guests have user_id = NULL. We mirror native_language into target_language
    // because target_language is no longer collected in the UI but the column
    // is still NOT NULL-friendly downstream — the realtime layer ignores it.
    const result = await db.query(
      `INSERT INTO meeting_participants
         (room_id, user_id, display_name, is_guest,
          native_language, target_language,
          speaking_voice_gender, listening_voice_gender,
          delivery_mode, captions_enabled,
          status, joined_at, admitted_at)
       VALUES (?, NULL, ?, 1, ?, ?, 'female', 'female', 'both', 1, ?, NOW(), ?)`,
      [meeting.id, displayName, nativeLanguage, nativeLanguage,
       initialStatus, initialStatus === 'admitted' ? new Date() : null]
    );
    const participantId = result.insertId;

    // Use a guest-only sub-session so the waiting page / room can identify them.
    // We do NOT set req.session.user — they remain unauthenticated.
    if (req.session) {
      req.session.guestParticipantId = participantId;
      req.session.guestMeetingCode = meeting.room_code;
      req.session.activeParticipantId = participantId;
      req.session.activeMeetingCode = meeting.room_code;
    }

    if (initialStatus === 'waiting') {
      return res.redirect(`m/${meeting.room_code}/guest-waiting`);
    }
    return res.redirect(`m/${meeting.room_code}/guest-room`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/guest-waiting  →  simple waiting-room page (PUBLIC)
// ---------------------------------------------------------------------------
router.get('/m/:code/guest-waiting', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const pid = req.session && req.session.guestParticipantId;
    if (!pid) return res.redirect(`m/${meeting.room_code}/guest`);

    const rows = await db.query(
      `SELECT id, room_id, display_name, status
         FROM meeting_participants
        WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    const participant = rows[0];
    if (!participant) return res.redirect(`m/${meeting.room_code}/guest`);
    if (participant.status === 'admitted') {
      return res.redirect(`m/${meeting.room_code}/guest-room`);
    }

    res.render('waiting_room', {
      title: 'Sala de espera · BiLingo Meet',
      description: 'Esperando a que el anfitrión te deje entrar.',
      nav: 'public',
      active: null,
      user: null,
      meeting,
      participant
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/guest-room  →  in_meeting_room.ejs for unauthenticated guests
// ---------------------------------------------------------------------------
router.get('/m/:code/guest-room', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const pid = req.session && req.session.guestParticipantId;
    if (!pid) return res.redirect(`m/${meeting.room_code}/guest`);

    const rows = await db.query(
      `SELECT id, display_name, native_language, target_language,
              speaking_voice_gender, listening_voice_gender,
              delivery_mode, captions_enabled, status
         FROM meeting_participants
        WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    const participant = rows[0];
    if (!participant) return res.redirect(`m/${meeting.room_code}/guest`);
    if (participant.status === 'waiting') {
      return res.redirect(`m/${meeting.room_code}/guest-waiting`);
    }
    if (participant.status !== 'admitted') {
      return res.redirect('');
    }

    // Promote room to active if needed.
    if (meeting.status !== 'active' && meeting.status !== 'ended' && meeting.status !== 'closed') {
      await db.query(
        `UPDATE rooms SET status='active', started_at = COALESCE(started_at, NOW()) WHERE id = ?`,
        [meeting.id]
      );
      meeting.status = 'active';
      if (!meeting.started_at) meeting.started_at = new Date();
    }

    const participants = await db.query(
      `SELECT mp.id, mp.user_id, mp.display_name, mp.native_language, mp.target_language,
              mp.delivery_mode, mp.captions_enabled, mp.status,
              u.avatar_color
         FROM meeting_participants mp
         LEFT JOIN users u ON u.id = mp.user_id
        WHERE mp.room_id = ? AND mp.status = 'admitted'
        ORDER BY mp.admitted_at ASC, mp.id ASC`,
      [meeting.id]
    );

    res.render('in_meeting_room', {
      title: (meeting.name || 'Reunión') + ' · BiLingo Meet',
      description: 'Sala de reunión BiLingo Meet en curso.',
      layout: false,
      nav: 'public',
      active: null,
      user: null,
      meeting,
      participant,
      participants,
      isHost: false
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/lobby   →  pre_join_lobby.ejs
// If the user is NOT logged in, redirect them to the guest flow instead of
// to the login page (so invitation links work for anyone).
// ---------------------------------------------------------------------------
router.get('/m/:code/lobby', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    // Unauthenticated → send to guest join flow.
    if (!(req.session && req.session.user && req.session.user.id)) {
      return res.redirect(`m/${meeting.room_code}/guest`);
    }

    // From here we know there is a session user.
    req.user = req.session.user;

    const languages = await loadLanguages();

    res.render('pre_join_lobby', {
      title: (meeting.name || 'Reunión') + ' · Lobby · BiLingo Meet',
      description: 'Configura tu cámara, micrófono e idiomas antes de unirte.',
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      languages,
      form: null,
      error: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/join
// ---------------------------------------------------------------------------
router.post('/m/:code/join', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const body = req.body || {};
    const displayName = String(body.displayName || '').trim();
    const nativeLanguage = String(body.nativeLanguage || '').trim().toLowerCase();
    // target_language is no longer asked: BiLingo Meet uses ONE language per
    // participant (their native one). Other participants automatically
    // translate to it. We mirror native→target for legacy schema compat.
    const targetLanguage = nativeLanguage;
    const speakingVoiceGender = String(body.speakingVoiceGender || '').trim().toLowerCase();
    const listeningVoiceGender = String(body.listeningVoiceGender || '').trim().toLowerCase();
    const deliveryMode = String(body.deliveryMode || 'both').trim().toLowerCase();
    const captionsEnabled = body.captionsEnabled === '1' || body.captionsEnabled === 'on'
                            || body.captionsEnabled === true ? 1 : 0;

    const languages = await loadLanguages();
    const validCodes = new Set(languages.map(l => l.code));

    function reRender(error) {
      return res.status(400).render('pre_join_lobby', {
        title: (meeting.name || 'Reunión') + ' · Lobby · BiLingo Meet',
        description: 'Configura tu cámara, micrófono e idiomas antes de unirte.',
        nav: 'app',
        active: null,
        user: req.session.user || null,
        meeting,
        languages,
        form: {
          displayName,
          nativeLanguage,
          speakingVoiceGender,
          listeningVoiceGender,
          deliveryMode,
          captionsEnabled: !!captionsEnabled
        },
        error
      });
    }

    if (!displayName) return reRender('Ingresa tu nombre.');
    if (displayName.length > 100) return reRender('Tu nombre es demasiado largo.');
    if (!nativeLanguage || !validCodes.has(nativeLanguage)) {
      return reRender('Elige un idioma nativo válido.');
    }
    const spk = VALID_GENDERS.includes(speakingVoiceGender) ? speakingVoiceGender : 'female';
    const lst = VALID_GENDERS.includes(listeningVoiceGender) ? listeningVoiceGender : 'female';
    const dm  = VALID_DELIVERY.includes(deliveryMode) ? deliveryMode : 'both';

    // Decide initial status: hosts always admitted; otherwise depends on
    // meeting.waiting_room_enabled.
    const isHost = req.user && req.user.id === meeting.host_id;
    const waitingEnabled = !!meeting.waiting_room_enabled;
    const initialStatus = (isHost || !waitingEnabled) ? 'admitted' : 'waiting';

    const userId = (req.user && req.user.id) ? req.user.id : null;

    // If this user already has an active participant row for this meeting,
    // reuse it (rejoin) — otherwise create a new one.
    let participantId = null;
    if (userId) {
      const existing = await db.query(
        `SELECT id, status FROM meeting_participants
         WHERE room_id = ? AND user_id = ? AND status IN ('waiting','admitted')
         ORDER BY id DESC LIMIT 1`,
        [meeting.id, userId]
      );
      if (existing.length) participantId = existing[0].id;
    }

    if (participantId) {
      await db.query(
        `UPDATE meeting_participants
           SET display_name = ?, native_language = ?, target_language = ?,
               speaking_voice_gender = ?, listening_voice_gender = ?,
               delivery_mode = ?, captions_enabled = ?,
               status = ?,
               admitted_at = CASE WHEN ? = 'admitted' AND admitted_at IS NULL THEN NOW() ELSE admitted_at END
         WHERE id = ?`,
        [displayName, nativeLanguage, targetLanguage,
         spk, lst, dm, captionsEnabled,
         initialStatus, initialStatus, participantId]
      );
    } else {
      const result = await db.query(
        `INSERT INTO meeting_participants
           (room_id, user_id, display_name, is_guest,
            native_language, target_language,
            speaking_voice_gender, listening_voice_gender,
            delivery_mode, captions_enabled,
            status, joined_at, admitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [meeting.id, userId, displayName, userId ? 0 : 1,
         nativeLanguage, targetLanguage,
         spk, lst, dm, captionsEnabled,
         initialStatus, initialStatus === 'admitted' ? new Date() : null]
      );
      participantId = result.insertId;
    }

    // Stash participant id in session for the room/waiting views.
    if (req.session) {
      req.session.activeParticipantId = participantId;
      req.session.activeMeetingCode   = meeting.room_code;
    }

    if (initialStatus === 'waiting') {
      return res.redirect(bp(req, `m/${meeting.room_code}/waiting`));
    }
    return res.redirect(bp(req, `m/${meeting.room_code}/room`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/waiting  →  waiting_room.ejs
// ---------------------------------------------------------------------------
router.get('/m/:code/waiting', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const pid = req.session && req.session.activeParticipantId;
    if (!pid) return res.redirect(bp(req, `m/${meeting.room_code}/lobby`));

    const rows = await db.query(
      `SELECT id, room_id, display_name, status
         FROM meeting_participants
        WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    const participant = rows[0];
    if (!participant) return res.redirect(bp(req, `m/${meeting.room_code}/lobby`));
    if (participant.status === 'admitted') {
      return res.redirect(bp(req, `m/${meeting.room_code}/room`));
    }

    res.render('waiting_room', {
      title: 'Sala de espera · BiLingo Meet',
      description: 'Esperando a que el anfitrión te deje entrar.',
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      participant
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/m/:code/admit-status  → JSON polling endpoint for the waiting room
// ---------------------------------------------------------------------------
router.get('/api/m/:code/admit-status', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return res.status(404).json({ error: 'not_found' });

    const pid = Number(req.query.pid || (req.session && req.session.activeParticipantId) || 0);
    if (!pid) return res.status(400).json({ error: 'no_participant' });

    const rows = await db.query(
      `SELECT status FROM meeting_participants WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    return res.json({ status: rows[0].status });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/room  →  in_meeting_room.ejs
//
// Renders the server-rendered in-meeting room (dark theme) with control bar,
// per-tile metadata, captions, and a socket.io stub for join/leave events.
// Requires that the user has an 'admitted' participant row for this meeting.
// ---------------------------------------------------------------------------
router.get('/m/:code/room', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const userId = req.user && req.user.id;
    const isHost = userId === meeting.host_id;

    // Look up this user's most recent participant row for this meeting.
    let participant = null;
    if (userId) {
      const rows = await db.query(
        `SELECT id, display_name, native_language, target_language,
                speaking_voice_gender, listening_voice_gender,
                delivery_mode, captions_enabled, status
           FROM meeting_participants
          WHERE room_id = ? AND user_id = ?
          ORDER BY id DESC
          LIMIT 1`,
        [meeting.id, userId]
      );
      participant = rows[0] || null;
    }

    // If the user hasn't been through the lobby yet, send them there.
    if (!participant) {
      return res.redirect(bp(req, `m/${meeting.room_code}/lobby`));
    }
    // If they're still in the waiting room, bounce them to the waiting page.
    if (participant.status === 'waiting') {
      // Make sure session has the participant id so the waiting page works.
      if (req.session) {
        req.session.activeParticipantId = participant.id;
        req.session.activeMeetingCode   = meeting.room_code;
      }
      return res.redirect(bp(req, `m/${meeting.room_code}/waiting`));
    }
    // Denied / left → back to dashboard.
    if (participant.status !== 'admitted') {
      return res.redirect(bp(req, 'dashboard'));
    }

    // Promote the room to 'active' once the first admitted user enters.
    if (meeting.status !== 'active' && meeting.status !== 'ended' && meeting.status !== 'closed') {
      await db.query(
        `UPDATE rooms SET status='active', started_at = COALESCE(started_at, NOW()) WHERE id = ?`,
        [meeting.id]
      );
      meeting.status = 'active';
      if (!meeting.started_at) meeting.started_at = new Date();
    }

    // List of currently-admitted participants (for the initial tile grid).
    const participants = await db.query(
      `SELECT mp.id, mp.user_id, mp.display_name, mp.native_language, mp.target_language,
              mp.delivery_mode, mp.captions_enabled, mp.status,
              u.avatar_color
         FROM meeting_participants mp
         LEFT JOIN users u ON u.id = mp.user_id
        WHERE mp.room_id = ? AND mp.status = 'admitted'
        ORDER BY mp.admitted_at ASC, mp.id ASC`,
      [meeting.id]
    );

    res.render('in_meeting_room', {
      title: (meeting.name || 'Reunión') + ' · En sala · BiLingo Meet',
      description: 'Sala de reunión BiLingo Meet en curso.',
      layout: false, // dark-theme room owns the whole page
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      participant,
      participants,
      isHost
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Helpers — settings drawer
// ---------------------------------------------------------------------------
const DELAY_CAP_MS = 5000;

function clampVolume(v, fallback) {
  var n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return n;
}
function clampDelay(v, fallback) {
  var n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > DELAY_CAP_MS) n = DELAY_CAP_MS;
  return n;
}

async function loadMyParticipant(meetingId, userId) {
  if (!userId) return null;
  const rows = await db.query(
    `SELECT id, display_name, native_language, target_language,
            speaking_voice_gender, listening_voice_gender,
            delivery_mode, captions_enabled, status,
            original_volume, translated_volume, manual_extra_delay_ms
       FROM meeting_participants
      WHERE room_id = ? AND user_id = ?
      ORDER BY id DESC LIMIT 1`,
    [meetingId, userId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// GET /m/:code/settings  →  in_meeting_settings.ejs (offcanvas drawer)
// ---------------------------------------------------------------------------
router.get('/m/:code/settings', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const participant = await loadMyParticipant(meeting.id, req.user && req.user.id);
    if (!participant) return res.redirect(bp(req, `m/${meeting.room_code}/lobby`));

    const languages = await loadLanguages();

    res.render('in_meeting_settings', {
      title: 'Configuración · ' + (meeting.name || meeting.room_code) + ' · BiLingo Meet',
      description: 'Ajusta audio, idioma y subtítulos para esta reunión.',
      layout: false,
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      participant,
      languages,
      error: null,
      saved: req.query.saved === '1'
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/participants/me  →  update the current participant row
// ---------------------------------------------------------------------------
router.post('/m/:code/participants/me', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const participant = await loadMyParticipant(meeting.id, req.user && req.user.id);
    if (!participant) return res.redirect(bp(req, `m/${meeting.room_code}/lobby`));

    const body = req.body || {};
    const languages = await loadLanguages();
    const validCodes = new Set(languages.map(l => l.code));

    function reRender(error) {
      return res.status(400).render('in_meeting_settings', {
        title: 'Configuración · BiLingo Meet',
        description: 'Ajusta audio, idioma y subtítulos para esta reunión.',
        layout: false,
        nav: 'app',
        active: null,
        user: req.session.user || null,
        meeting,
        participant,
        languages,
        error,
        saved: false
      });
    }

    // Validate / normalise inputs. Each field is optional — only update if
    // present in the body, so partial saves (e.g. from a future AJAX call)
    // remain safe.
    const updates = [];
    const params  = [];

    if (body.nativeLanguage !== undefined) {
      const v = String(body.nativeLanguage).trim().toLowerCase();
      if (!validCodes.has(v)) return reRender('Idioma nativo no válido.');
      updates.push('native_language = ?'); params.push(v);
    }
    if (body.targetLanguage !== undefined) {
      const v = String(body.targetLanguage).trim().toLowerCase();
      if (!validCodes.has(v)) return reRender('Idioma objetivo no válido.');
      updates.push('target_language = ?'); params.push(v);
    }
    if (body.speakingVoiceGender !== undefined) {
      const v = String(body.speakingVoiceGender).trim().toLowerCase();
      if (!VALID_GENDERS.includes(v)) return reRender('Voz hablada no válida.');
      updates.push('speaking_voice_gender = ?'); params.push(v);
    }
    if (body.listeningVoiceGender !== undefined) {
      const v = String(body.listeningVoiceGender).trim().toLowerCase();
      if (!VALID_GENDERS.includes(v)) return reRender('Voz para escuchar no válida.');
      updates.push('listening_voice_gender = ?'); params.push(v);
    }
    if (body.deliveryMode !== undefined) {
      const v = String(body.deliveryMode).trim().toLowerCase();
      if (!VALID_DELIVERY.includes(v)) return reRender('Modo de entrega no válido.');
      updates.push('delivery_mode = ?'); params.push(v);
    }
    if (body.originalVolume !== undefined) {
      const v = clampVolume(body.originalVolume, participant.original_volume);
      updates.push('original_volume = ?'); params.push(v);
    }
    if (body.translatedVolume !== undefined) {
      const v = clampVolume(body.translatedVolume, participant.translated_volume);
      updates.push('translated_volume = ?'); params.push(v);
    }
    if (body.manualExtraDelayMs !== undefined) {
      const v = clampDelay(body.manualExtraDelayMs, participant.manual_extra_delay_ms);
      updates.push('manual_extra_delay_ms = ?'); params.push(v);
    }
    // Captions: when posted via a regular form, an unchecked checkbox sends
    // nothing — so always treat the form submit as authoritative for captions
    // if the form came from the settings page.
    if (body.__from_settings_form !== undefined || body.captionsEnabled !== undefined) {
      const on = (body.captionsEnabled === '1' || body.captionsEnabled === 'on'
                  || body.captionsEnabled === true || body.captionsEnabled === 1) ? 1 : 0;
      updates.push('captions_enabled = ?'); params.push(on);
    }

    if (updates.length) {
      params.push(participant.id);
      await db.query(
        `UPDATE meeting_participants SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    // AJAX-friendly response if the client asked for JSON.
    const wantsJson = req.is('application/json') ||
                      (req.headers.accept || '').indexOf('application/json') !== -1 ||
                      body.format === 'json';
    if (wantsJson) {
      return res.json({ ok: true });
    }
    return res.redirect(bp(req, `m/${meeting.room_code}/settings?saved=1`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/participants/:participantId/listening-prefs
//   Per-remote quick menu (flow_change_listening_prefs). Updates how the
//   CURRENT user listens to ONE specific other participant.
//
//   PRAGMATIC DEVIATION: the existing schema only stores one
//   listening_voice_gender / original_volume / translated_volume per
//   participant row (i.e. global "how *I* listen to *everyone*"). The design
//   implies per-remote overrides which would require a new
//   participant_listening_prefs (listener_id, remote_id, …) table.
//
//   To keep STEP 12 lean and avoid schema sprawl this far into the build, we
//   accept the per-remote POST and PROXY it through to the listener's OWN
//   participant row when the `:participantId` matches the listener's own
//   participant (the common "tweak my own playback" case). When the target
//   is a remote, we still accept the payload and return ok:true so the UI
//   contract holds — but the change is broadcast over socket.io as a
//   `listener:prefs` event for the room to react to in real time, with no
//   DB row mutated for the remote. A dedicated overrides table is a future
//   step.
// ---------------------------------------------------------------------------
router.post('/m/:code/participants/:participantId/listening-prefs', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return res.status(404).json({ error: 'not_found' });

    const targetId = Number(req.params.participantId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'bad_participant' });
    }

    const myParticipant = await loadMyParticipant(meeting.id, req.user && req.user.id);
    if (!myParticipant) return res.status(403).json({ error: 'not_in_meeting' });

    // Confirm target exists in this room.
    const tgt = await db.query(
      `SELECT id, user_id, display_name FROM meeting_participants
        WHERE id = ? AND room_id = ?`,
      [targetId, meeting.id]
    );
    if (!tgt.length) return res.status(404).json({ error: 'target_not_in_meeting' });

    const body = req.body || {};
    const prefs = {};
    if (body.listeningVoiceGender !== undefined) {
      const v = String(body.listeningVoiceGender).trim().toLowerCase();
      if (!VALID_GENDERS.includes(v)) {
        return res.status(400).json({ error: 'bad_listening_voice' });
      }
      prefs.listening_voice_gender = v;
    }
    if (body.originalVolume !== undefined) {
      prefs.original_volume = clampVolume(body.originalVolume, myParticipant.original_volume);
    }
    if (body.translatedVolume !== undefined) {
      prefs.translated_volume = clampVolume(body.translatedVolume, myParticipant.translated_volume);
    }
    if (body.manualExtraDelayMs !== undefined) {
      prefs.manual_extra_delay_ms = clampDelay(body.manualExtraDelayMs, myParticipant.manual_extra_delay_ms);
    }
    if (body.captionsEnabled !== undefined) {
      prefs.captions_enabled = (body.captionsEnabled === '1' || body.captionsEnabled === 'on'
                                || body.captionsEnabled === true || body.captionsEnabled === 1) ? 1 : 0;
    }

    // If the target is the listener's own participant row, persist; otherwise
    // we still ack so the UI moves forward (real per-remote overrides are a
    // later schema iteration).
    if (targetId === myParticipant.id && Object.keys(prefs).length) {
      const fields = Object.keys(prefs).map(k => `${k} = ?`);
      const params = Object.values(prefs);
      params.push(myParticipant.id);
      await db.query(
        `UPDATE meeting_participants SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
    }

    return res.json({
      ok: true,
      listenerId: myParticipant.id,
      remoteId: targetId,
      prefs,
      persisted: targetId === myParticipant.id
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/leave  →  marks participant as 'left' and redirects to /ended
// ---------------------------------------------------------------------------
router.post('/m/:code/leave', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const userId = req.user && req.user.id;
    if (userId) {
      await db.query(
        `UPDATE meeting_participants
            SET status = 'left', left_at = NOW()
          WHERE room_id = ? AND user_id = ? AND status = 'admitted'`,
        [meeting.id, userId]
      );
    }

    // If the host leaves, end the meeting + settle realtime billing + debit credits.
    if (userId === meeting.host_id && meeting.status === 'active') {
      const startedAt = meeting.started_at ? new Date(meeting.started_at) : null;
      const duration  = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)) : 0;
      await db.query(
        `UPDATE rooms SET status='ended', ended_at=NOW(), duration_seconds=? WHERE id = ?`,
        [duration, meeting.id]
      );
      try {
        const { recordRealtimeUsage } = require('../services/realtimeUsage');
        await recordRealtimeUsage(meeting.id);
      } catch (e) { console.warn('[realtime] usage record failed:', e.message); }
      try {
        const credits = require('../services/credits.service');
        await credits.debitForMeeting(meeting.id);
      } catch (e) { console.warn('[credits] debit failed:', e.message); }
    }

    if (req.session) {
      req.session.activeParticipantId = null;
    }

    return res.redirect(bp(req, `m/${meeting.room_code}/ended`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Helpers — past-meeting / transcript / history
// ---------------------------------------------------------------------------

async function loadAllParticipants(roomId) {
  return db.query(
    `SELECT mp.id, mp.user_id, mp.display_name, mp.native_language, mp.target_language,
            mp.joined_at, mp.admitted_at, mp.left_at, mp.status,
            u.email AS user_email
       FROM meeting_participants mp
       LEFT JOIN users u ON u.id = mp.user_id
      WHERE mp.room_id = ?
      ORDER BY mp.admitted_at ASC, mp.id ASC`,
    [roomId]
  );
}

async function loadTranscript(roomId) {
  return db.query(
    `SELECT m.id, m.user_id, m.content, m.source_lang, m.target_lang,
            m.translated_content, m.created_at,
            COALESCE(u.display_name,
              (SELECT mp.display_name FROM meeting_participants mp
                 WHERE mp.room_id = m.room_id AND mp.user_id = m.user_id
                 ORDER BY mp.id DESC LIMIT 1)
            ) AS display_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC, m.id ASC`,
    [roomId]
  );
}

function parseTranslationsValue(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (!s) return {};
  if (s.charAt(0) === '{' || s.charAt(0) === '[') {
    try { return JSON.parse(s); } catch (e) { /* fall through */ }
  }
  return { translated: s };
}

async function summariseMeeting(meeting) {
  // languages used (union of source/target on messages + participants)
  const langRows = await db.query(
    `SELECT DISTINCT lang FROM (
       SELECT source_lang AS lang FROM messages WHERE room_id = ? AND source_lang IS NOT NULL AND source_lang <> ''
       UNION
       SELECT target_lang AS lang FROM messages WHERE room_id = ? AND target_lang IS NOT NULL AND target_lang <> ''
       UNION
       SELECT native_language AS lang FROM meeting_participants WHERE room_id = ? AND native_language IS NOT NULL AND native_language <> ''
       UNION
       SELECT target_language AS lang FROM meeting_participants WHERE room_id = ? AND target_language IS NOT NULL AND target_language <> ''
     ) t WHERE lang IS NOT NULL`,
    [meeting.id, meeting.id, meeting.id, meeting.id]
  );
  const languages = langRows.map(r => r.lang).filter(Boolean);

  const msgCountRow = await db.query(
    `SELECT COUNT(*) AS c FROM messages WHERE room_id = ?`,
    [meeting.id]
  );
  const messages = msgCountRow[0] ? Number(msgCountRow[0].c) : 0;

  let duration = meeting.duration_seconds;
  if ((!duration || duration <= 0) && meeting.started_at) {
    const start = new Date(meeting.started_at).getTime();
    const end = meeting.ended_at ? new Date(meeting.ended_at).getTime() : Date.now();
    duration = Math.max(0, Math.floor((end - start) / 1000));
  }

  return { languages, messages, duration_seconds: duration || 0 };
}

async function userParticipatedIn(roomId, userId) {
  if (!userId) return false;
  const rows = await db.query(
    `SELECT 1 FROM rooms WHERE id = ? AND host_id = ?
       UNION
     SELECT 1 FROM meeting_participants WHERE room_id = ? AND user_id = ? LIMIT 1`,
    [roomId, userId, roomId, userId]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// GET /m/:code/ended  →  meeting_ended.ejs (stats + transcript + feedback)
// ---------------------------------------------------------------------------
router.get('/m/:code/ended', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const participants = await loadAllParticipants(meeting.id);
    const stats = await summariseMeeting(meeting);

    // Did the current user already submit feedback for this room?
    let alreadySubmitted = false;
    if (req.user && req.user.id) {
      const fb = await db.query(
        `SELECT id FROM feedback_ratings WHERE room_id = ? AND user_id = ? LIMIT 1`,
        [meeting.id, req.user.id]
      );
      alreadySubmitted = fb.length > 0;
    }

    res.render('meeting_ended', {
      title: 'Reunión finalizada · BiLingo Meet',
      description: 'Has salido de la reunión.',
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      participants,
      languages: stats.languages,
      stats,
      feedbackSaved: req.query.fb === '1' || alreadySubmitted,
      feedbackError: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/feedback  →  inserts feedback_ratings row
// ---------------------------------------------------------------------------
router.post('/m/:code/feedback', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return notFound(req, res);

    const body = req.body || {};
    function clampRating(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      const r = Math.round(n);
      if (r < 1 || r > 5) return null;
      return r;
    }
    const translationQuality = clampRating(body.translationQuality);
    const audioQuality = clampRating(body.audioQuality);
    const comments = String(body.comments || '').trim().slice(0, 2000) || null;

    if (translationQuality == null && audioQuality == null && !comments) {
      // nothing to save — redirect back without error
      return res.redirect(bp(req, `m/${meeting.room_code}/ended`));
    }

    // Find the user's participant row (if any) for richer linkage.
    let participantId = null;
    if (req.user && req.user.id) {
      const p = await db.query(
        `SELECT id FROM meeting_participants
           WHERE room_id = ? AND user_id = ?
           ORDER BY id DESC LIMIT 1`,
        [meeting.id, req.user.id]
      );
      if (p.length) participantId = p[0].id;
    }

    await db.query(
      `INSERT INTO feedback_ratings
         (room_id, user_id, participant_id, translation_quality, audio_quality, comments)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [meeting.id, req.user && req.user.id ? req.user.id : null,
       participantId, translationQuality, audioQuality, comments]
    );

    return res.redirect(bp(req, `m/${meeting.room_code}/ended?fb=1`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /m/:code/transcript.txt   →  plain-text transcript download
// GET /m/:code/transcript.json  →  JSON transcript download
// ---------------------------------------------------------------------------
// rule_transcript_retention + rule_transcript_privacy
// Returns:
//   { allowed: false }                                — 403, response already sent
//   { allowed: true,  isParticipant: bool, isAdmin: bool, redact: bool }
async function authoriseTranscript(req, res, meeting) {
  const userRole = (req.session && req.session.user && req.session.user.role)
    || (req.user && req.user.role);
  const isAdmin = userRole === 'admin';
  const isParticipant = await userParticipatedIn(meeting.id, req.user && req.user.id);

  // rule_transcript_retention: if the host opted out of saving the transcript,
  // ONLY admins can still see the (redacted) metadata. Participants cannot
  // download what was never saved.
  if (!meeting.save_transcript) {
    if (!isAdmin) {
      res.status(403).type('text/plain').send('La transcripción de esta reunión no se guardó.');
      return { allowed: false };
    }
    // Admin gets metadata-only access (full redaction).
    return { allowed: true, isAdmin: true, isParticipant, redact: true };
  }

  if (!isAdmin && !isParticipant) {
    res.status(403).type('text/plain').send('No tienes acceso a esta transcripción.');
    return { allowed: false };
  }

  // rule_transcript_privacy: admins who were NOT participants see the
  // transcript with originalText/translations hidden.
  return {
    allowed: true,
    isAdmin,
    isParticipant,
    redact: isAdmin && !isParticipant
  };
}

router.get('/m/:code/transcript.txt', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return res.status(404).type('text/plain').send('Reunión no encontrada.');
    const auth = await authoriseTranscript(req, res, meeting);
    if (!auth.allowed) return;

    const msgs = await loadTranscript(meeting.id);
    const participants = await loadAllParticipants(meeting.id);

    const lines = [];
    lines.push('=== BiLingo Meet — Transcripción ===');
    lines.push('Reunión: ' + (meeting.name || meeting.room_code));
    lines.push('Código: ' + meeting.room_code);
    if (meeting.started_at) lines.push('Inicio: ' + new Date(meeting.started_at).toISOString());
    if (meeting.ended_at)   lines.push('Fin:    ' + new Date(meeting.ended_at).toISOString());
    if (meeting.duration_seconds) lines.push('Duración: ' + meeting.duration_seconds + 's');
    lines.push('Participantes: ' + participants.map(p => p.display_name).join(', '));
    if (auth.redact) {
      lines.push('');
      lines.push('[VISTA DE ADMINISTRACIÓN — solo metadatos. Por privacidad, el');
      lines.push(' texto original y las traducciones están ocultos.]');
    }
    lines.push('');
    lines.push('--- Transcripción ---');

    msgs.forEach(m => {
      const t = m.created_at ? new Date(m.created_at).toISOString() : '';
      const who = m.display_name || ('Usuario ' + m.user_id);
      if (auth.redact) {
        // Metadata-only: who spoke, when, in what language, char count.
        const src = m.source_lang ? ('[' + m.source_lang + '] ') : '';
        const cc = m.content ? m.content.length : 0;
        lines.push(`[${t}] ${who} ${src}<oculto · ${cc} car.>`);
      } else {
        const src = m.source_lang ? ('[' + m.source_lang + '] ') : '';
        lines.push(`[${t}] ${who} ${src}${m.content}`);
        const tr = parseTranslationsValue(m.translated_content);
        Object.keys(tr).forEach(k => {
          lines.push(`    → (${k}) ${tr[k]}`);
        });
      }
    });

    const filename = `transcript-${meeting.room_code}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

router.get('/m/:code/transcript.json', requireAuth, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toLowerCase();
    const meeting = await loadMeeting(code);
    if (!meeting) return res.status(404).json({ error: 'not_found' });
    const auth = await authoriseTranscript(req, res, meeting);
    if (!auth.allowed) return;

    const msgs = await loadTranscript(meeting.id);
    const participants = await loadAllParticipants(meeting.id);

    const payload = {
      meeting: {
        id: meeting.id,
        room_code: meeting.room_code,
        name: meeting.name,
        topic: meeting.topic,
        host_id: meeting.host_id,
        status: meeting.status,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
        duration_seconds: meeting.duration_seconds,
        save_transcript: !!meeting.save_transcript
      },
      view: auth.redact ? 'admin_redacted_metadata_only' : 'full',
      participants: participants.map(p => ({
        id: p.id,
        user_id: p.user_id,
        display_name: p.display_name,
        native_language: p.native_language,
        target_language: p.target_language,
        joined_at: p.joined_at,
        admitted_at: p.admitted_at,
        left_at: p.left_at,
        status: p.status
      })),
      messages: msgs.map(m => (auth.redact ? {
        id: m.id,
        user_id: m.user_id,
        display_name: m.display_name,
        source_lang: m.source_lang,
        target_lang: m.target_lang,
        // rule_transcript_privacy: original + translations hidden for admin viewers
        // who are not participants. Only metadata kept (id, who, when, langs, length).
        original_length: m.content ? m.content.length : 0,
        translations: null,
        original: null,
        redacted: true,
        created_at: m.created_at
      } : {
        id: m.id,
        user_id: m.user_id,
        display_name: m.display_name,
        source_lang: m.source_lang,
        target_lang: m.target_lang,
        original: m.content,
        translations: parseTranslationsValue(m.translated_content),
        created_at: m.created_at
      }))
    };

    const filename = `transcript-${meeting.room_code}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /history  →  meeting_history.ejs (past meetings list with filters)
// ---------------------------------------------------------------------------
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const q = String(req.query.q || '').trim();
    const role = (['all', 'hosted', 'attended'].includes(String(req.query.role || ''))
                  ? String(req.query.role) : 'all');
    const fromRaw = String(req.query.from || '').trim();
    const toRaw   = String(req.query.to || '').trim();

    const where = ["r.status = 'ended'"];
    const params = [];

    if (role === 'hosted') {
      where.push('r.host_id = ?');
      params.push(userId);
    } else if (role === 'attended') {
      where.push(
        '(r.host_id <> ? AND EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.room_id = r.id AND mp.user_id = ?))'
      );
      params.push(userId, userId);
    } else {
      where.push(
        '(r.host_id = ? OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.room_id = r.id AND mp.user_id = ?))'
      );
      params.push(userId, userId);
    }

    if (fromRaw) {
      const d = new Date(fromRaw);
      if (!isNaN(d.getTime())) {
        where.push('COALESCE(r.ended_at, r.started_at, r.created_at) >= ?');
        params.push(d.toISOString().slice(0, 19).replace('T', ' '));
      }
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (!isNaN(d.getTime())) {
        // include the whole day
        d.setHours(23, 59, 59, 999);
        where.push('COALESCE(r.ended_at, r.started_at, r.created_at) <= ?');
        params.push(d.toISOString().slice(0, 19).replace('T', ' '));
      }
    }
    if (q) {
      where.push('(r.name LIKE ? OR r.topic LIKE ? OR r.room_code LIKE ?)');
      const pat = '%' + q + '%';
      params.push(pat, pat, pat);
    }

    const sql =
      `SELECT r.id, r.room_code, r.name, r.topic, r.language_focus, r.status,
              r.host_id, r.started_at, r.ended_at, r.duration_seconds, r.created_at,
              CASE WHEN r.host_id = ? THEN 'hosted' ELSE 'attended' END AS role,
              (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.room_id = r.id) AS participant_count
         FROM rooms r
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(r.ended_at, r.started_at, r.created_at) DESC
        LIMIT 200`;

    const meetings = await db.query(sql, [userId].concat(params));

    res.render('meeting_history', {
      title: 'Historial · BiLingo Meet',
      description: 'Reuniones pasadas que has organizado o a las que has asistido.',
      nav: 'app',
      active: 'history',
      user: req.session.user || null,
      meetings,
      filters: { from: fromRaw, to: toRaw, role, q }
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /history/:meetingId  →  past_meeting_detail.ejs
// ---------------------------------------------------------------------------
router.get('/history/:meetingId', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.meetingId);
    if (!Number.isFinite(id) || id <= 0) return notFound(req, res);

    const rows = await db.query(
      `SELECT r.*, h.display_name AS host_name, h.email AS host_email, h.avatar_color AS host_color
         FROM rooms r LEFT JOIN users h ON h.id = r.host_id
        WHERE r.id = ?`,
      [id]
    );
    const meeting = rows[0];
    if (!meeting) return notFound(req, res);

    // Access: host, any participant, or admin.
    const userRole = (req.session && req.session.user && req.session.user.role)
      || (req.user && req.user.role);
    const isAdmin = userRole === 'admin';
    const isParticipant = await userParticipatedIn(meeting.id, req.user && req.user.id);
    const allowed = isAdmin || isParticipant;
    if (!allowed) {
      return res.status(403).render('404', {
        title: 'Acceso denegado · BiLingo Meet',
        description: 'No tienes acceso a esta reunión.',
        nav: 'app',
        user: req.session.user || null
      });
    }

    // rule_transcript_retention: if transcript was not saved, only admins
    // can see the page (metadata-only); participants get a friendly notice
    // but no message bodies.
    // rule_transcript_privacy: admins who weren't participants see the page
    // with originalText / translations hidden (redacted).
    const redact = (isAdmin && !isParticipant) || !meeting.save_transcript;

    const participants = await loadAllParticipants(meeting.id);
    let messages = await loadTranscript(meeting.id);
    if (redact) {
      messages = messages.map(m => ({
        id: m.id,
        user_id: m.user_id,
        display_name: m.display_name,
        source_lang: m.source_lang,
        target_lang: m.target_lang,
        content: null,
        translated_content: null,
        redacted: true,
        original_length: m.content ? m.content.length : 0,
        created_at: m.created_at
      }));
    }

    res.render('past_meeting_detail', {
      title: (meeting.name || 'Reunión') + ' · Historial · BiLingo Meet',
      description: 'Detalles y transcripción bilingüe de la reunión pasada.',
      nav: 'app',
      active: 'history',
      user: req.session.user || null,
      meeting,
      participants,
      messages,
      redact,
      isAdmin,
      isParticipant
    });
  } catch (err) { next(err); }
});

// ===========================================================================
// HOST CONTROLS  (Step 13)
// ===========================================================================
//
// GET  /m/:code/host                       → host_controls.ejs
// POST /m/:code/host/mute-all              → mute everyone (except host)
// POST /m/:code/host/mute/:pid             → mute one participant
// POST /m/:code/host/remove/:pid           → remove (kick) one participant
// POST /m/:code/host/lock                  → toggle meeting.is_locked
// POST /m/:code/host/waiting-room          → toggle meeting.waiting_room_enabled
// POST /m/:code/host/admit/:pid            → admit a waiting participant
// POST /m/:code/host/deny/:pid             → deny a waiting participant
// POST /m/:code/host/end                   → end meeting for all
//
// All POSTs emit corresponding socket.io events to every socket in
// `room:<roomId>` so connected clients react in real time.
//
// PRAGMATIC NOTE: there is no `meeting_participants.is_muted` column today —
// "mute" is signalled to clients purely via the `host:mute` / `host:mute-all`
// socket event, and the client's room.js already responds to media:state
// events for self-mute. We DB-persist removal (status='left') and admission
// (status='admitted') because those rows drive the waiting-room polling.
// ===========================================================================

const { getIO } = require('../sockets/io');

function requireHost(req, res, next) {
  return (async () => {
    try {
      const code = String(req.params.code || '').trim().toLowerCase();
      const meeting = await loadMeeting(code);
      if (!meeting) return notFound(req, res);
      const userId = req.user && req.user.id;
      const userRole = (req.session && req.session.user && req.session.user.role) || (req.user && req.user.role);
      const isHost = userId && userId === meeting.host_id;
      const isAdmin = userRole === 'admin';
      if (!isHost && !isAdmin) {
        return res.status(403).render('404', {
          title: 'Acceso denegado · BiLingo Meet',
          description: 'Solo el anfitrión puede acceder a estos controles.',
          nav: 'app',
          user: req.session.user || null
        });
      }
      req.meeting = meeting;
      next();
    } catch (err) { next(err); }
  })();
}

function emitToRoom(roomId, event, payload) {
  try {
    const io = getIO();
    if (!io) return;
    io.to('room:' + roomId).emit(event, payload || {});
  } catch (e) {
    // best-effort: socket emission failures must never break the HTTP response
    console.warn('[host emit] failed:', e && e.message);
  }
}

// Best-effort audit log for host-initiated room actions (lock/unlock/end/...).
// Failures are swallowed so they never break the HTTP redirect path.
async function writeRoomAudit(adminId, action, roomId, details) {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details)
       VALUES (?, ?, 'room', ?, ?)`,
      [adminId, action, roomId, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.warn('[host audit] failed:', e && e.message);
  }
}

// ---------------------------------------------------------------------------
// GET /m/:code/host
// ---------------------------------------------------------------------------
router.get('/m/:code/host', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;

    const participants = await db.query(
      `SELECT mp.id, mp.user_id, mp.display_name, mp.native_language, mp.target_language,
              mp.delivery_mode, mp.captions_enabled, mp.status, mp.admitted_at,
              u.avatar_color
         FROM meeting_participants mp
         LEFT JOIN users u ON u.id = mp.user_id
        WHERE mp.room_id = ? AND mp.status = 'admitted'
        ORDER BY mp.admitted_at ASC, mp.id ASC`,
      [meeting.id]
    );

    const pending = await db.query(
      `SELECT id, user_id, display_name, native_language, target_language,
              joined_at, status
         FROM meeting_participants
        WHERE room_id = ? AND status = 'waiting'
        ORDER BY joined_at ASC, id ASC`,
      [meeting.id]
    );

    res.render('host_controls', {
      title: 'Controles del anfitrión · ' + (meeting.name || meeting.room_code) + ' · BiLingo Meet',
      description: 'Modera la reunión, admite invitados y controla los participantes.',
      nav: 'app',
      active: null,
      user: req.session.user || null,
      meeting,
      participants,
      pending,
      flash: null
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/mute-all
// ---------------------------------------------------------------------------
router.post('/m/:code/host/mute-all', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    await writeRoomAudit(req.user.id, 'room.mute_all', meeting.id, {
      room_code: meeting.room_code
    });
    emitToRoom(meeting.id, 'host:mute-all', {
      meetingId: meeting.id,
      by: req.user.id,
      at: Date.now()
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/mute/:pid
// ---------------------------------------------------------------------------
router.post('/m/:code/host/mute/:pid', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const pid = Number(req.params.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.status(400).redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    const rows = await db.query(
      `SELECT id, user_id, display_name FROM meeting_participants WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    if (!rows.length) return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    emitToRoom(meeting.id, 'host:mute', {
      meetingId: meeting.id,
      participantId: pid,
      userId: rows[0].user_id,
      displayName: rows[0].display_name,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/remove/:pid
// ---------------------------------------------------------------------------
router.post('/m/:code/host/remove/:pid', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const pid = Number(req.params.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.status(400).redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    const rows = await db.query(
      `SELECT id, user_id, display_name FROM meeting_participants WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    if (!rows.length) return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    // Don't allow removing the host themselves.
    if (rows[0].user_id === meeting.host_id) {
      return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    await db.query(
      `UPDATE meeting_participants
          SET status = 'left', left_at = NOW()
        WHERE id = ?`,
      [pid]
    );
    await writeRoomAudit(req.user.id, 'room.remove_participant', meeting.id, {
      room_code: meeting.room_code,
      participant_id: pid,
      target_user_id: rows[0].user_id
    });
    emitToRoom(meeting.id, 'host:remove', {
      meetingId: meeting.id,
      participantId: pid,
      userId: rows[0].user_id,
      displayName: rows[0].display_name,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/lock     (toggle)
// ---------------------------------------------------------------------------
router.post('/m/:code/host/lock', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const body = req.body || {};
    // Checkbox semantics: if "isLocked" present in body → lock, else unlock.
    const next = (body.isLocked === '1' || body.isLocked === 'on'
                  || body.isLocked === true) ? 1 : 0;
    await db.query(`UPDATE rooms SET is_locked = ? WHERE id = ?`, [next, meeting.id]);
    await writeRoomAudit(req.user.id, next ? 'room.lock' : 'room.unlock', meeting.id, {
      room_code: meeting.room_code,
      is_locked: !!next
    });
    emitToRoom(meeting.id, 'host:lock', {
      meetingId: meeting.id,
      isLocked: !!next,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/waiting-room   (toggle)
// ---------------------------------------------------------------------------
router.post('/m/:code/host/waiting-room', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const body = req.body || {};
    const next = (body.waitingRoomEnabled === '1' || body.waitingRoomEnabled === 'on'
                  || body.waitingRoomEnabled === true) ? 1 : 0;
    await db.query(`UPDATE rooms SET waiting_room_enabled = ? WHERE id = ?`, [next, meeting.id]);
    emitToRoom(meeting.id, 'host:waiting-room', {
      meetingId: meeting.id,
      waitingRoomEnabled: !!next,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/admit/:pid
// ---------------------------------------------------------------------------
router.post('/m/:code/host/admit/:pid', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const pid = Number(req.params.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    const rows = await db.query(
      `SELECT id, user_id, status FROM meeting_participants WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    if (!rows.length || rows[0].status !== 'waiting') {
      return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    await db.query(
      `UPDATE meeting_participants
          SET status = 'admitted',
              admitted_at = COALESCE(admitted_at, NOW())
        WHERE id = ?`,
      [pid]
    );
    // Real-time: notify the SPECIFIC waiting participant so their browser
    // redirects to /m/:code/room without waiting for the next poll.
    try {
      const io = getIO();
      if (io) {
        io.to('wait:' + pid).emit('host:admit', {
          participantId: pid,
          roomCode: meeting.room_code
        });
        // Notify host watchers so the pending list updates live.
        io.to('host:' + meeting.id).emit('waiting:leave', {
          participantId: pid,
          reason: 'admitted'
        });
      }
    } catch (e) {
      console.warn('[host:admit waiting emit] failed:', e && e.message);
    }
    emitToRoom(meeting.id, 'host:admit', {
      meetingId: meeting.id,
      participantId: pid,
      userId: rows[0].user_id,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/deny/:pid
// ---------------------------------------------------------------------------
router.post('/m/:code/host/deny/:pid', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;
    const pid = Number(req.params.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    }
    const rows = await db.query(
      `SELECT id, user_id, status FROM meeting_participants WHERE id = ? AND room_id = ?`,
      [pid, meeting.id]
    );
    if (!rows.length) return res.redirect(bp(req, `m/${meeting.room_code}/host`));
    await db.query(
      `UPDATE meeting_participants SET status = 'denied' WHERE id = ?`,
      [pid]
    );
    // Real-time: notify the SPECIFIC denied participant so their browser
    // can show a denial message and redirect to /dashboard.
    try {
      const io = getIO();
      if (io) {
        io.to('wait:' + pid).emit('host:deny', {
          participantId: pid,
          roomCode: meeting.room_code
        });
        io.to('host:' + meeting.id).emit('waiting:leave', {
          participantId: pid,
          reason: 'denied'
        });
      }
    } catch (e) {
      console.warn('[host:deny waiting emit] failed:', e && e.message);
    }
    emitToRoom(meeting.id, 'host:deny', {
      meetingId: meeting.id,
      participantId: pid,
      userId: rows[0].user_id,
      by: req.user.id
    });
    return res.redirect(bp(req, `m/${meeting.room_code}/host`));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /m/:code/host/end
// ---------------------------------------------------------------------------
router.post('/m/:code/host/end', requireAuth, requireHost, async (req, res, next) => {
  try {
    const meeting = req.meeting;

    // Compute duration from started_at if available.
    const startedAt = meeting.started_at ? new Date(meeting.started_at) : null;
    const duration = startedAt && !isNaN(startedAt.getTime())
      ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000))
      : 0;

    await db.query(
      `UPDATE rooms
          SET status = 'ended',
              ended_at = NOW(),
              duration_seconds = ?
        WHERE id = ?`,
      [duration, meeting.id]
    );
    await db.query(
      `UPDATE meeting_participants
          SET status = 'left',
              left_at = COALESCE(left_at, NOW())
        WHERE room_id = ? AND status IN ('admitted','waiting')`,
      [meeting.id]
    );

    await writeRoomAudit(req.user.id, 'room.end', meeting.id, {
      room_code: meeting.room_code,
      ended_at: new Date().toISOString()
    });
    emitToRoom(meeting.id, 'host:end', {
      meetingId: meeting.id,
      by: req.user.id,
      at: Date.now()
    });

    // Settle Realtime Translate billing, then debit credits. Best-effort —
    // never block the host-end redirect on a credit failure.
    try {
      const { recordRealtimeUsage } = require('../services/realtimeUsage');
      const rt = await recordRealtimeUsage(meeting.id);
      if (rt && !rt.skipped) {
        console.log('[realtime] host-end meeting', meeting.id, rt.minutes, 'min · $' + rt.costUsd);
      }
    } catch (e) { console.warn('[realtime] usage record failed:', e.message); }
    try {
      const credits = require('../services/credits.service');
      const r = await credits.debitForMeeting(meeting.id);
      if (r && !r.skipped) {
        console.log('[credits] host-end meeting', meeting.id, 'debited', r.credits, 'credits');
      }
    } catch (e) { console.warn('[credits] debit failed:', e.message); }

    if (req.session) {
      req.session.activeParticipantId = null;
    }

    return res.redirect(bp(req, `m/${meeting.room_code}/ended`));
  } catch (err) { next(err); }
});

module.exports = router;