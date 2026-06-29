'use strict';

/**
 * Realtime Translate usage recorder.
 *
 * BiLingo Meet uses OpenAI's `gpt-realtime-translate` model exclusively for
 * live simultaneous interpretation. That model is billed at a FLAT per-minute
 * rate ($0.034 USD / minute of audio processed) — it does NOT bill per token
 * the way `gpt-4o` / `whisper` / `tts-1` did under the legacy STT→MT→TTS
 * architecture.
 *
 * Because the browser connects directly to OpenAI via WebRTC (the server
 * only mints an ephemeral session token in routes/realtime.routes.js), there
 * is no per-call hook to write to `meeting_token_usage`. Instead, we settle
 * the bill ONCE per meeting when it ends:
 *
 *   recordRealtimeUsage(meetingId) →
 *     1. Reads total audio duration from transcript_segments (preferred),
 *        falling back to rooms.duration_seconds if no segments exist.
 *     2. Computes cost_usd = minutes * REALTIME_RATE_PER_MIN_USD.
 *     3. Inserts ONE row in meeting_token_usage with model
 *        'gpt-realtime-translate' and operation 'realtime_audio'.
 *
 * Idempotent: if a row with model='gpt-realtime-translate' already exists
 * for this meeting_id, returns without inserting.
 *
 * This function is called BEFORE credits.debitForMeeting() so that the
 * debit reflects the real Realtime Translate cost.
 */

const db = require('../config/db');

const REALTIME_MODEL = 'gpt-realtime-translate';
const REALTIME_OPERATION = 'realtime_audio';
const REALTIME_RATE_PER_MIN_USD = 0.034; // OpenAI official rate

async function recordRealtimeUsage(meetingId) {
  if (!meetingId) return { skipped: true, reason: 'no_meeting_id' };

  // Idempotency: if we've already recorded realtime usage for this meeting, bail.
  const existing = await db.query(
    `SELECT id, total_cost_usd, total_tokens
       FROM meeting_token_usage
      WHERE meeting_id = ? AND model = ? AND operation = ?
      LIMIT 1`,
    [meetingId, REALTIME_MODEL, REALTIME_OPERATION]
  );
  if (existing.length) {
    return {
      skipped: true,
      alreadyRecorded: true,
      id: existing[0].id,
      costUsd: Number(existing[0].total_cost_usd || 0)
    };
  }

  // 1) Try transcript_segments first (most accurate — real audio durations).
  const segRows = await db.query(
    `SELECT COALESCE(SUM(audio_duration_ms), 0) AS total_ms
       FROM transcript_segments
      WHERE meeting_id = ?`,
    [meetingId]
  );
  let audioMs = Number(segRows[0] && segRows[0].total_ms || 0);
  let source = 'transcript_segments';

  // 2) Fallback: if no segments, use room duration_seconds × number of
  //    admitted participants (since each participant streams their own audio).
  if (audioMs <= 0) {
    const roomRows = await db.query(
      `SELECT r.duration_seconds,
              (SELECT COUNT(*) FROM meeting_participants mp
                WHERE mp.room_id = r.id AND mp.status IN ('admitted','left')) AS n_participants
         FROM rooms r
        WHERE r.id = ?
        LIMIT 1`,
      [meetingId]
    );
    if (!roomRows.length) return { skipped: true, reason: 'no_room' };
    const durSec = Number(roomRows[0].duration_seconds || 0);
    const nParts = Math.max(1, Number(roomRows[0].n_participants || 1));
    audioMs = durSec * 1000 * nParts;
    source = 'room_duration';
  }

  if (audioMs <= 0) return { skipped: true, reason: 'no_audio' };

  const minutes = audioMs / 60000;
  const costUsd = Number((minutes * REALTIME_RATE_PER_MIN_USD).toFixed(6));

  // Find a user_id to attribute this to (the host) for the dashboard's
  // "top users" view. NULL is acceptable but the dashboard groups by user.
  const hostRow = await db.query(
    `SELECT host_id FROM rooms WHERE id = ? LIMIT 1`,
    [meetingId]
  );
  const userId = hostRow.length ? hostRow[0].host_id : null;

  await db.query(
    `INSERT INTO meeting_token_usage
       (meeting_id, user_id, provider, model, operation,
        prompt_tokens, completion_tokens, total_tokens,
        prompt_cost_usd, completion_cost_usd, total_cost_usd,
        latency_ms, was_cached)
     VALUES (?, ?, 'openai', ?, ?, 0, 0, ?, 0, 0, ?, NULL, 0)`,
    [
      meetingId, userId, REALTIME_MODEL, REALTIME_OPERATION,
      Math.round(audioMs / 1000), // total_tokens = seconds of audio (for display)
      costUsd
    ]
  );

  return {
    skipped: false,
    meetingId,
    audioMs,
    minutes: Number(minutes.toFixed(3)),
    costUsd,
    source,
    ratePerMin: REALTIME_RATE_PER_MIN_USD
  };
}

module.exports = {
  recordRealtimeUsage,
  REALTIME_MODEL,
  REALTIME_OPERATION,
  REALTIME_RATE_PER_MIN_USD
};
