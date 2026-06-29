'use strict';

/**
 * Meeting Sweeper / Reaper.
 *
 * Handles the inevitable: meetings that don't get cleanly closed.
 *
 * Failure modes covered:
 *  - Host closes the browser without clicking "End meeting"
 *  - Server crashes / restarts while meetings are active
 *  - Network drops, sockets time out, the HTTP /leave never arrives
 *  - A meeting ends OK but recordRealtimeUsage / debitForMeeting throws
 *    before completing → room is 'ended' but no usage row, no debit
 *
 * Strategy:
 *  1. sweepStaleMeetings():
 *     Find rooms with status IN ('waiting','open','active') that have been
 *     idle longer than IDLE_TIMEOUT_MIN (default 60). Force-close them:
 *     compute duration_seconds, set status='ended', ended_at=NOW(), then
 *     run recordRealtimeUsage + debitForMeeting.
 *
 *  2. backfillMissingUsage():
 *     Find rooms with status='ended' and duration_seconds>0 that have NO
 *     row in meeting_token_usage. Run recordRealtimeUsage + debitForMeeting
 *     on each. Both are idempotent so re-runs are safe.
 *
 *  3. start():
 *     - One immediate boot sweep on server start (catches zombies from
 *       the previous process).
 *     - setInterval every SWEEP_INTERVAL_MIN (default 5).
 *
 * Best-effort: any per-meeting error is logged but never crashes the loop.
 */

const db = require('../config/db');
const { recordRealtimeUsage } = require('./realtimeUsage');

const IDLE_TIMEOUT_MIN = Number(process.env.MEETING_IDLE_TIMEOUT_MIN || 60);
const NO_START_TIMEOUT_MIN = Number(process.env.MEETING_NO_START_TIMEOUT_MIN || 120);
const SWEEP_INTERVAL_MIN = Number(process.env.MEETING_SWEEP_INTERVAL_MIN || 5);

let intervalHandle = null;

async function settleMeeting(meetingId) {
  // Both calls are idempotent. Order matters: usage row first, then debit
  // (the debit reads the cost from meeting_token_usage).
  try {
    const usage = await recordRealtimeUsage(meetingId);
    if (usage && !usage.skipped) {
      console.log(`[sweeper] meeting ${meetingId} usage recorded:`, JSON.stringify({
        minutes: usage.minutes, costUsd: usage.costUsd, source: usage.source
      }));
    }
  } catch (e) {
    console.error(`[sweeper] recordRealtimeUsage failed for meeting ${meetingId}:`, e && e.message || e);
  }
  try {
    const credits = require('./credits.service');
    if (typeof credits.debitForMeeting === 'function') {
      const r = await credits.debitForMeeting(meetingId);
      if (r && !r.skipped) {
        console.log(`[sweeper] meeting ${meetingId} debited:`, JSON.stringify({
          amount: r.amount, balance_after: r.balance_after
        }));
      }
    }
  } catch (e) {
    console.error(`[sweeper] debitForMeeting failed for meeting ${meetingId}:`, e && e.message || e);
  }
}

/**
 * Find and force-close stale meetings.
 */
async function sweepStaleMeetings() {
  // A meeting is "stale" if:
  //   - It's still status IN ('waiting','open','active'), AND
  //   - It started > IDLE_TIMEOUT_MIN minutes ago, OR
  //   - It never started and was created > NO_START_TIMEOUT_MIN minutes ago.
  const rows = await db.query(
    `SELECT id, room_code, status, started_at, created_at,
            TIMESTAMPDIFF(SECOND,
              COALESCE(started_at, created_at), NOW()) AS age_seconds,
            started_at IS NOT NULL AS has_started
       FROM rooms
      WHERE status IN ('waiting','open','active')
        AND (
          (started_at IS NOT NULL AND started_at < NOW() - INTERVAL ? MINUTE)
          OR
          (started_at IS NULL AND created_at < NOW() - INTERVAL ? MINUTE)
        )
      LIMIT 50`,
    [IDLE_TIMEOUT_MIN, NO_START_TIMEOUT_MIN]
  );

  if (!rows.length) return { closed: 0, settled: 0 };

  console.log(`[sweeper] found ${rows.length} stale meeting(s) to close`);

  let closed = 0;
  let settled = 0;
  for (const r of rows) {
    try {
      // If it actually started, real duration. If it never started, 0 → no
      // usage will be recorded (recordRealtimeUsage skips with no_audio).
      const durationSec = r.has_started ? Math.max(0, Number(r.age_seconds || 0)) : 0;

      await db.query(
        `UPDATE rooms
            SET status = 'ended',
                ended_at = NOW(),
                duration_seconds = ?
          WHERE id = ? AND status IN ('waiting','open','active')`,
        [durationSec, r.id]
      );
      closed++;
      console.log(`[sweeper] closed stale meeting ${r.id} (${r.room_code}) — was '${r.status}', duration ${durationSec}s`);

      if (durationSec > 0) {
        await settleMeeting(r.id);
        settled++;
      }
    } catch (e) {
      console.error(`[sweeper] failed to close meeting ${r.id}:`, e && e.message || e);
    }
  }

  return { closed, settled };
}

/**
 * Find meetings that ended OK but never got their usage/debit recorded.
 * Idempotent — safe to run repeatedly.
 */
async function backfillMissingUsage() {
  const rows = await db.query(
    `SELECT r.id, r.room_code, r.duration_seconds
       FROM rooms r
      WHERE r.status = 'ended'
        AND r.duration_seconds > 0
        AND r.ended_at > NOW() - INTERVAL 7 DAY
        AND NOT EXISTS (
          SELECT 1 FROM meeting_token_usage mtu
           WHERE mtu.meeting_id = r.id
             AND mtu.model = 'gpt-realtime-translate'
        )
      ORDER BY r.ended_at DESC
      LIMIT 50`
  );

  if (!rows.length) return { backfilled: 0 };

  console.log(`[sweeper] backfilling ${rows.length} ended meeting(s) missing usage`);

  let backfilled = 0;
  for (const r of rows) {
    try {
      await settleMeeting(r.id);
      backfilled++;
    } catch (e) {
      console.error(`[sweeper] backfill failed for meeting ${r.id}:`, e && e.message || e);
    }
  }
  return { backfilled };
}

async function runOnce(label = 'tick') {
  try {
    const t0 = Date.now();
    const stale = await sweepStaleMeetings();
    const back = await backfillMissingUsage();
    const ms = Date.now() - t0;
    if (stale.closed || back.backfilled) {
      console.log(`[sweeper] ${label}: closed=${stale.closed} settled=${stale.settled} backfilled=${back.backfilled} (${ms}ms)`);
    }
  } catch (e) {
    console.error(`[sweeper] ${label} failed:`, e && e.stack || e);
  }
}

function start() {
  if (intervalHandle) {
    console.warn('[sweeper] start() called twice — ignoring');
    return;
  }
  console.log(`[sweeper] starting — idle=${IDLE_TIMEOUT_MIN}min, no-start=${NO_START_TIMEOUT_MIN}min, interval=${SWEEP_INTERVAL_MIN}min`);

  // Boot sweep on a 5-second delay so the server finishes binding first.
  setTimeout(() => { runOnce('boot'); }, 5000);

  intervalHandle = setInterval(() => {
    runOnce('tick');
  }, SWEEP_INTERVAL_MIN * 60 * 1000);
  // Don't keep the event loop alive on shutdown.
  if (intervalHandle.unref) intervalHandle.unref();
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  start,
  stop,
  runOnce,
  sweepStaleMeetings,
  backfillMissingUsage
};
