'use strict';

/**
 * OpenAI Realtime API — ephemeral session minting (GA API).
 *
 * The browser never sees OPENAI_API_KEY. It POSTs to /api/realtime/session
 * and we return a short-lived client_secret ("ek_…") for direct WebRTC.
 *
 * Docs: https://platform.openai.com/docs/api-reference/realtime-sessions
 * Endpoint: POST https://api.openai.com/v1/realtime/client_secrets
 *
 * Default model: gpt-realtime-translate (dedicated simultaneous-interpretation
 * model — cheaper, doesn't "answer" the speaker, just translates).
 */

const express = require('express');
const https = require('https');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../config/db');

// HARD-CODED model. We ALWAYS use `gpt-realtime-translate` (the dedicated
// simultaneous-interpretation model — cheaper, doesn't "answer" the speaker,
// just translates). Any value of OPENAI_REALTIME_MODEL in the environment is
// intentionally ignored — it is only kept for logging/diagnostics.
const RAW_MODEL_ENV = process.env.OPENAI_REALTIME_MODEL || '';
const REALTIME_MODEL = 'gpt-realtime-translate';
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'alloy';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

console.log('[realtime] boot — model hard-coded to ' + REALTIME_MODEL +
            ' (env OPENAI_REALTIME_MODEL=' + JSON.stringify(RAW_MODEL_ENV) + ' is ignored)');

// In-memory diagnostic: last upstream error from OpenAI (for /status)
let LAST_UPSTREAM_ERROR = null;

const LANG_NAME = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French',
  de: 'German',  it: 'Italian', zh: 'Chinese',    ja: 'Japanese',
  ar: 'Arabic',  ru: 'Russian', ko: 'Korean',     nl: 'Dutch',
  pl: 'Polish',  tr: 'Turkish', hi: 'Hindi'
};
function langName(code) {
  if (!code) return 'English';
  const base = String(code).toLowerCase().split('-')[0];
  return LANG_NAME[base] || base.toUpperCase();
}

function normalizeLang(code) {
  if (!code) return 'en';
  return String(code).toLowerCase().split('-')[0];
}

function buildInstructions(nativeLang) {
  const target = langName(nativeLang);
  return [
    'You are a real-time simultaneous interpreter for an international business meeting.',
    'Your ONLY job is to translate every utterance into ' + target + '.',
    'Rules:',
    '- Detect the speaker\'s language automatically.',
    '- If they speak in ' + target + ' already, repeat the message naturally in ' + target + '.',
    '- Otherwise, translate fully into natural, fluent ' + target + '.',
    '- Preserve names, numbers, emails, URLs, product names exactly.',
    '- Keep the same register (formal / informal) as the original.',
    '- Do NOT add commentary, do NOT introduce yourself, do NOT say "the speaker said".',
    '- Output ONLY the translation, spoken in a clear meeting voice.',
    '- Start speaking as soon as you have a translatable chunk.'
  ].join('\n');
}

function postJSON(host, path, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    const req = https.request({ host, path, method: 'POST', headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, body: { raw: buf } });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function resolveNativeLang(req) {
  if (req.body && req.body.nativeLang) {
    return normalizeLang(req.body.nativeLang);
  }
  try {
    const rows = await db.query(
      'SELECT native_language FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length && rows[0].native_language) {
      return normalizeLang(rows[0].native_language);
    }
  } catch (_) { /* ignore */ }
  return 'en';
}

/**
 * Build the request payload for the Realtime session.
 *
 * - For `gpt-realtime-translate`: per official docs, the payload shape is
 *     { session: { model, audio: { output: { language } } } }
 *   (NO `type: 'realtime'`, NO `translation` wrapper, NO instructions,
 *   NO voice, NO input.transcription.) The model auto-detects the source
 *   language and streams the translation to the target language.
 *
 * - For `gpt-realtime` (general): use instructions + voice. Keeps the
 *   "assistant who happens to translate" behavior as a fallback.
 */
function buildSessionPayload(model, nativeLang) {
  const isTranslate = /translate/i.test(model);

  if (isTranslate) {
    return {
      session: {
        model: model,
        audio: {
          output: { language: nativeLang }
        }
      }
    };
  }

  // gpt-realtime (general) — instructions-driven.
  return {
    session: {
      type: 'realtime',
      model: model,
      instructions: buildInstructions(nativeLang),
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: TRANSCRIBE_MODEL },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.65,
            prefix_padding_ms: 200,
            silence_duration_ms: 700
          }
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: REALTIME_VOICE
        }
      }
    }
  };
}

/**
 * Minimal-payload fallback if the rich payload is rejected with
 * beta_api_shape_disabled / invalid_request_error.
 */
function buildMinimalPayload(model, nativeLang) {
  const isTranslate = /translate/i.test(model);
  if (isTranslate) {
    // Already minimal — same shape as buildSessionPayload for translate.
    return {
      session: {
        model: model,
        audio: { output: { language: nativeLang } }
      }
    };
  }
  return {
    session: {
      type: 'realtime',
      model: model,
      instructions: buildInstructions(nativeLang)
    }
  };
}

/**
 * Returns the OpenAI endpoint path for minting an ephemeral client_secret
 * for the given model. `gpt-realtime-translate` has its OWN endpoint.
 */
function clientSecretsPath(model) {
  return /translate/i.test(model)
    ? '/v1/realtime/translations/client_secrets'
    : '/v1/realtime/client_secrets';
}

function extractClientSecret(body) {
  if (!body) return { value: null, expiresAt: null };
  if (typeof body.value === 'string' && body.value.startsWith('ek_')) {
    return { value: body.value, expiresAt: body.expires_at || null };
  }
  if (body.client_secret) {
    if (typeof body.client_secret === 'string') {
      return { value: body.client_secret, expiresAt: body.expires_at || null };
    }
    return {
      value: body.client_secret.value || null,
      expiresAt: body.client_secret.expires_at || body.expires_at || null
    };
  }
  return { value: null, expiresAt: null };
}

/**
 * POST /api/realtime/session
 * Body (optional): { nativeLang: 'es' }
 */
router.post('/session', requireAuth, async (req, res, next) => {
  // Prevent any intermediary (or the browser itself) from caching this POST.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'translation_unavailable',
        message: 'OpenAI Realtime is not configured on this server.'
      });
    }

    const nativeLang = await resolveNativeLang(req);
    const model = REALTIME_MODEL;
    const payload = buildSessionPayload(model, nativeLang);
    const csPath = clientSecretsPath(model);

    console.log('[realtime/session] requesting model=' + model + ' target=' + nativeLang + ' path=' + csPath);

    let r = await postJSON('api.openai.com', csPath, apiKey, payload);
    console.log('[realtime/session] ' + csPath + ' ->', r.status, JSON.stringify(r.body).slice(0, 600));

    let { value: clientSecretValue, expiresAt } = extractClientSecret(r.body);

    if (r.status !== 200 || !clientSecretValue) {
      const errCode = r.body && r.body.error && r.body.error.code;
      const errType = r.body && r.body.error && r.body.error.type;
      const retryable = r.status >= 400 && (
        errCode === 'beta_api_shape_disabled' ||
        errCode === 'invalid_request_error' ||
        errType === 'invalid_request_error'
      );

      if (retryable) {
        console.warn('[realtime/session] retrying with minimal payload');
        const minimal = buildMinimalPayload(model, nativeLang);
        const r2 = await postJSON('api.openai.com', csPath, apiKey, minimal);
        console.log('[realtime/session] minimal retry ' + csPath + ' ->', r2.status, JSON.stringify(r2.body).slice(0, 600));
        const m = extractClientSecret(r2.body);
        clientSecretValue = m.value;
        expiresAt = m.expiresAt;
        if (!clientSecretValue) {
          LAST_UPSTREAM_ERROR = {
            at: new Date().toISOString(),
            model,
            nativeLang,
            attempted_payload: minimal,
            upstream_status: r2.status,
            upstream_body: r2.body
          };
          return res.status(502).json({
            error: 'session_failed',
            message: 'Could not create OpenAI Realtime session.',
            upstream_status: r2.status,
            attempted_payload: minimal,
            details: r2.body && r2.body.error ? r2.body.error : r2.body,
            upstream_body: r2.body
          });
        }
      } else {
        LAST_UPSTREAM_ERROR = {
          at: new Date().toISOString(),
          model,
          nativeLang,
          attempted_payload: payload,
          upstream_status: r.status,
          upstream_body: r.body
        };
        return res.status(502).json({
          error: 'session_failed',
          message: 'Could not create OpenAI Realtime session.',
          upstream_status: r.status,
          attempted_payload: payload,
          details: r.body && r.body.error ? r.body.error : r.body,
          upstream_body: r.body
        });
      }
    }

    return res.json({
      client_secret: clientSecretValue,
      expires_at: expiresAt,
      model: model,
      voice: REALTIME_VOICE,
      nativeLang,
      // Tell the client which SDP endpoint to use. `gpt-realtime-translate`
      // negotiates SDP at /v1/realtime/translations/calls, not /v1/realtime/calls.
      sdp_path: /translate/i.test(model) ? '/v1/realtime/translations/calls' : '/v1/realtime/calls'
    });
  } catch (err) {
    console.error('[realtime/session] exception:', err);
    next(err);
  }
});

/**
 * GET /api/realtime/status
 */
router.get('/status', requireAuth, (req, res) => {
  res.json({
    available: Boolean(process.env.OPENAI_API_KEY),
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
    env_model_raw: RAW_MODEL_ENV,
    env_model_ignored: true,
    last_upstream_error: LAST_UPSTREAM_ERROR
  });
});

/**
 * GET /api/realtime/ice-servers
 *
 * Returns the ICE server configuration the browser must use to build its
 * RTCPeerConnection. Public STUN servers are ALWAYS included; TURN servers
 * are only included when configured via env vars.
 *
 * Why this matters: corporate NATs / symmetric NATs / strict firewalls block
 * direct UDP peer-to-peer connections to OpenAI even with STUN. In those
 * cases ICE fails after a few seconds ("ICE failed — add a TURN server").
 * A TURN relay solves it by tunneling the media through a public server.
 *
 * Configuration (set these in the service env to enable TURN):
 *   TURN_URL          — e.g. "turn:turn.example.com:3478"
 *                       (can also be a comma-separated list)
 *   TURN_USERNAME     — TURN credential username
 *   TURN_CREDENTIAL   — TURN credential / secret
 *
 * Recommended TURN providers (cheap / pay-as-you-go):
 *   - Twilio Network Traversal Service
 *   - Cloudflare Calls TURN
 *   - Metered.ca (has a free tier)
 *   - Self-hosted coturn
 */
router.get('/ice-servers', requireAuth, (req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun.cloudflare.com:3478'] }
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;
  let hasTurn = false;

  if (turnUrl && turnUser && turnCred) {
    const urls = turnUrl.split(',').map((s) => s.trim()).filter(Boolean);
    iceServers.push({
      urls,
      username: turnUser,
      credential: turnCred
    });
    hasTurn = true;
  }

  res.set('Cache-Control', 'no-store');
  res.json({
    iceServers,
    has_turn: hasTurn,
    // If true, force the connection to ONLY use relay (TURN) candidates.
    // Useful for testing TURN config. Set FORCE_TURN_RELAY=1 in env.
    ice_transport_policy: process.env.FORCE_TURN_RELAY === '1' ? 'relay' : 'all'
  });
});

module.exports = router;
