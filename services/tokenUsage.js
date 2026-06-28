'use strict';

/**
 * Persistence helper for `meeting_token_usage`.
 *
 * Records ONE row per OpenAI call (or per attempted call when we fall back).
 * Aggregations (per-meeting cost, per-day cost, per-user cost) are queried
 * from this table by the admin cost dashboard.
 */

const db = require('../config/db');

async function recordUsage(row) {
  if (!row || !row.meetingId) return null;
  // Skip zero-cost no-op rows (identity translation, cache hit with no tokens):
  // they don't reflect real spend and would just clutter the table.
  const tokens = Number(row.totalTokens || 0);
  const cost = Number(row.totalCostUsd || 0);
  if (!tokens && !cost && row.provider !== 'openai') return null;

  try {
    const res = await db.query(
      `INSERT INTO meeting_token_usage
         (meeting_id, segment_id, user_id, provider, model, operation,
          source_lang, target_lang,
          prompt_tokens, completion_tokens, total_tokens,
          prompt_cost_usd, completion_cost_usd, total_cost_usd,
          latency_ms, was_cached)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.meetingId,
        row.segmentId || null,
        row.userId || null,
        row.provider || 'openai',
        row.model || '',
        row.operation || 'chat_translation',
        row.sourceLang || null,
        row.targetLang || null,
        Number(row.promptTokens || 0),
        Number(row.completionTokens || 0),
        tokens,
        Number(row.promptCostUsd || 0),
        Number(row.completionCostUsd || 0),
        cost,
        row.latencyMs != null ? Number(row.latencyMs) : null,
        row.wasCached ? 1 : 0
      ]
    );
    return res.insertId;
  } catch (e) {
    console.warn('[tokenUsage] insert failed:', e.message);
    return null;
  }
}

module.exports = { recordUsage };
