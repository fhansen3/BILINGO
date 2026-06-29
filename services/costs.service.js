'use strict';

/**
 * Cost dashboard service.
 *
 * Reads aggregations from `meeting_token_usage` (the source of truth for
 * what every OpenAI call cost in USD) and combines them with audio minutes
 * derived from `translation_logs.total_latency_ms` and
 * `transcript_segments.audio_duration_ms`.
 *
 * Scoping:
 *   - If companyId is null/undefined → global view (superadmin).
 *   - Otherwise we restrict to meetings hosted by users of that company.
 *     We join through `rooms` (room_id = meeting_id) → users (host_id).
 */

const db = require('../config/db');

// Build a "AND room/host filter" SQL snippet + params for a query that has
// `meeting_token_usage` aliased as `mtu`.
function companyJoin(companyId) {
  if (!companyId) {
    return { join: '', where: '', params: [] };
  }
  return {
    join: ' JOIN rooms r ON r.id = mtu.meeting_id JOIN users u ON u.id = r.host_id ',
    where: ' AND u.company_id = ? ',
    params: [companyId]
  };
}

async function getTotals(companyId) {
  const { join, where, params } = companyJoin(companyId);

  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN DATE(mtu.created_at) = CURDATE()                          THEN mtu.total_cost_usd END), 0) AS cost_today,
      COALESCE(SUM(CASE WHEN mtu.created_at >= NOW() - INTERVAL 7  DAY                  THEN mtu.total_cost_usd END), 0) AS cost_7d,
      COALESCE(SUM(CASE WHEN mtu.created_at >= NOW() - INTERVAL 30 DAY                  THEN mtu.total_cost_usd END), 0) AS cost_30d,
      COALESCE(SUM(mtu.total_cost_usd), 0) AS cost_total,
      COALESCE(SUM(mtu.total_tokens), 0)   AS tokens_total,
      COUNT(*)                              AS calls_total
    FROM meeting_token_usage mtu
    ${join}
    WHERE 1=1 ${where}
  `;
  const rows = await db.query(sql, params);
  return rows[0] || {};
}

async function getAudioMinutes(companyId) {
  // Audio minutes ≈ SUM(audio_duration_ms) from transcript_segments, restricted
  // by company through rooms.host_id when companyId is set.
  if (!companyId) {
    const r = await db.query(
      `SELECT COALESCE(SUM(audio_duration_ms),0) AS total_ms FROM transcript_segments`
    );
    return Math.max(0, Number(r[0].total_ms || 0)) / 60000;
  }
  const r = await db.query(
    `SELECT COALESCE(SUM(ts.audio_duration_ms),0) AS total_ms
       FROM transcript_segments ts
       JOIN rooms r  ON r.id = ts.meeting_id
       JOIN users u  ON u.id = r.host_id
      WHERE u.company_id = ?`,
    [companyId]
  );
  return Math.max(0, Number(r[0].total_ms || 0)) / 60000;
}

async function getCostByModel(companyId) {
  const { join, where, params } = companyJoin(companyId);
  const sql = `
    SELECT mtu.model AS model,
           SUM(mtu.total_cost_usd) AS cost_usd,
           SUM(mtu.total_tokens)   AS tokens,
           COUNT(*)                AS calls
      FROM meeting_token_usage mtu
      ${join}
     WHERE 1=1 ${where}
     GROUP BY mtu.model
     ORDER BY cost_usd DESC
     LIMIT 20
  `;
  return db.query(sql, params);
}

async function getTopCompanies(limit = 10) {
  // Only meaningful in superadmin (global) view.
  const sql = `
    SELECT c.id AS company_id, c.code, c.name,
           SUM(mtu.total_cost_usd) AS cost_usd,
           SUM(mtu.total_tokens)   AS tokens,
           COUNT(*)                AS calls
      FROM meeting_token_usage mtu
      JOIN rooms r     ON r.id = mtu.meeting_id
      JOIN users u     ON u.id = r.host_id
      LEFT JOIN companies c ON c.id = u.company_id
     GROUP BY c.id, c.code, c.name
     ORDER BY cost_usd DESC
     LIMIT ?
  `;
  return db.query(sql, [limit]);
}

async function getTopUsers(companyId, limit = 10) {
  const { join, where, params } = companyJoin(companyId);
  // We need users joined too. If companyJoin already joined `users` as `u`, reuse it.
  // Otherwise, join here.
  let userJoin = ' JOIN users uu ON uu.id = mtu.user_id ';
  let userExpr = ' uu.id AS user_id, uu.display_name, uu.email ';
  if (companyId) {
    // companyJoin already created `u` for host. We still want PER-CALL user (mtu.user_id),
    // which may differ. Add a separate join.
    userJoin = ' JOIN users uu ON uu.id = mtu.user_id ';
    userExpr = ' uu.id AS user_id, uu.display_name, uu.email ';
  }
  const sql = `
    SELECT ${userExpr},
           SUM(mtu.total_cost_usd) AS cost_usd,
           SUM(mtu.total_tokens)   AS tokens,
           COUNT(*)                AS calls
      FROM meeting_token_usage mtu
      ${join}
      ${userJoin}
     WHERE mtu.user_id IS NOT NULL ${where}
     GROUP BY uu.id, uu.display_name, uu.email
     ORDER BY cost_usd DESC
     LIMIT ?
  `;
  return db.query(sql, [...params, limit]);
}

async function getRecentCalls(companyId, limit = 100) {
  const { join, where, params } = companyJoin(companyId);
  const sql = `
    SELECT mtu.id, mtu.meeting_id, mtu.user_id, mtu.model, mtu.operation,
           mtu.source_lang, mtu.target_lang,
           mtu.prompt_tokens, mtu.completion_tokens, mtu.total_tokens,
           mtu.total_cost_usd, mtu.latency_ms, mtu.was_cached, mtu.created_at,
           uu.email AS user_email, uu.display_name AS user_name
      FROM meeting_token_usage mtu
      ${join}
      LEFT JOIN users uu ON uu.id = mtu.user_id
     WHERE 1=1 ${where}
     ORDER BY mtu.created_at DESC
     LIMIT ?
  `;
  return db.query(sql, [...params, limit]);
}

async function getDailyCost(companyId, days = 30) {
  const { join, where, params } = companyJoin(companyId);
  const sql = `
    SELECT DATE(mtu.created_at) AS d,
           SUM(mtu.total_cost_usd) AS cost_usd,
           SUM(mtu.total_tokens)   AS tokens
      FROM meeting_token_usage mtu
      ${join}
     WHERE mtu.created_at >= NOW() - INTERVAL ? DAY ${where}
     GROUP BY DATE(mtu.created_at)
     ORDER BY DATE(mtu.created_at) ASC
  `;
  return db.query(sql, [days, ...params]);
}

module.exports = {
  getTotals,
  getAudioMinutes,
  getCostByModel,
  getTopCompanies,
  getTopUsers,
  getRecentCalls,
  getDailyCost
};
