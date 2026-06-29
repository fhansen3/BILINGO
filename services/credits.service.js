'use strict';

/**
 * Credits service.
 *
 * Domain rules:
 *   - 1 crédito = 0.01 USD (i.e. 100 créditos = 1 USD).
 *   - Per-company `credit_markup` multiplier (DECIMAL, default 1.500) is
 *     applied to the raw IA cost (USD) when computing meeting debits.
 *   - Balance is allowed to go negative (the company "owes" credits).
 *   - Each meeting can be debited AT MOST ONCE — guarded by the existence of
 *     a `credit_transactions` row with kind='debit' and matching meeting_id.
 *
 * Money math:
 *   credits = ceil( cost_usd * markup * 100 )
 *
 * Schema notes:
 *   - translation_logs uses room_id (NOT meeting_id) and exposes
 *     stt_latency_ms + mt_latency_ms + tts_latency_ms + total_latency_ms.
 *     There's no "is_degraded" column — we derive it from total_latency_ms > 3000.
 *   - meeting_token_usage uses meeting_id and has total_cost_usd.
 */

const db = require('../config/db');

const CREDITS_PER_USD = 100;
const DEGRADED_LATENCY_MS = 3000;
const WELCOME_CREDITS = 500;

function usdToCredits(usd, markup) {
  const raw = Number(usd || 0) * Number(markup || 1) * CREDITS_PER_USD;
  if (!isFinite(raw) || raw <= 0) return 0;
  return Math.ceil(raw);
}

async function ensureRow(companyId) {
  if (!companyId) return null;
  const rows = await db.query(
    'SELECT company_id, balance, total_added, total_consumed FROM company_credits WHERE company_id = ?',
    [companyId]
  );
  if (rows.length) return rows[0];
  await db.query(
    'INSERT IGNORE INTO company_credits (company_id, balance) VALUES (?, 0)',
    [companyId]
  );
  return { company_id: companyId, balance: 0, total_added: 0, total_consumed: 0 };
}

async function getBalance(companyId) {
  const row = await ensureRow(companyId);
  if (!row) return null;
  const company = await db.query(
    'SELECT id, code, name, credit_markup, credit_low_threshold FROM companies WHERE id = ?',
    [companyId]
  );
  if (!company.length) return null;
  return {
    company: company[0],
    balance: Number(row.balance || 0),
    totalAdded: Number(row.total_added || 0),
    totalConsumed: Number(row.total_consumed || 0),
    lowThreshold: Number(company[0].credit_low_threshold || 0),
    isLow: Number(row.balance || 0) < Number(company[0].credit_low_threshold || 0),
    isNegative: Number(row.balance || 0) < 0
  };
}

async function listCompanyBalances() {
  return db.query(
    `SELECT c.id AS company_id, c.code, c.name, c.is_active,
            c.credit_markup, c.credit_low_threshold,
            COALESCE(cc.balance, 0) AS balance,
            COALESCE(cc.total_added, 0) AS total_added,
            COALESCE(cc.total_consumed, 0) AS total_consumed,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count
       FROM companies c
       LEFT JOIN company_credits cc ON cc.company_id = c.id
      ORDER BY c.is_active DESC, c.name ASC`
  );
}

async function getTransactions(companyId, { limit = 100, kind = null } = {}) {
  const where = ['ct.company_id = ?'];
  const params = [companyId];
  if (kind) {
    where.push('ct.kind = ?');
    params.push(kind);
  }
  const sql = `
    SELECT ct.id, ct.kind, ct.amount, ct.balance_after, ct.meeting_id,
           ct.cost_usd, ct.markup, ct.description, ct.created_at,
           ct.created_by, u.display_name AS created_by_name, u.email AS created_by_email,
           r.room_code, r.topic
      FROM credit_transactions ct
      LEFT JOIN users u ON u.id = ct.created_by
      LEFT JOIN rooms r ON r.id = ct.meeting_id
     WHERE ${where.join(' AND ')}
     ORDER BY ct.id DESC
     LIMIT ?`;
  return db.query(sql, [...params, limit]);
}

async function _applyDelta(companyId, amount, kind, extra = {}) {
  if (!companyId) throw new Error('companyId required');
  await ensureRow(companyId);

  await db.query('UPDATE company_credits SET balance = balance + ? WHERE company_id = ?', [amount, companyId]);
  if (amount > 0) {
    await db.query('UPDATE company_credits SET total_added = total_added + ? WHERE company_id = ?', [amount, companyId]);
  } else if (amount < 0) {
    await db.query('UPDATE company_credits SET total_consumed = total_consumed + ? WHERE company_id = ?', [-amount, companyId]);
  }

  const rows = await db.query('SELECT balance FROM company_credits WHERE company_id = ?', [companyId]);
  const balanceAfter = rows.length ? Number(rows[0].balance) : 0;

  await db.query(
    `INSERT INTO credit_transactions
        (company_id, kind, amount, balance_after, meeting_id, cost_usd, markup, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, kind, amount, balanceAfter,
      extra.meetingId || null,
      extra.costUsd != null ? Number(extra.costUsd) : null,
      extra.markup != null ? Number(extra.markup) : null,
      extra.description || null,
      extra.createdBy || null
    ]
  );

  return balanceAfter;
}

async function addCredits(companyId, amount, { description, createdBy } = {}) {
  amount = Math.floor(Number(amount));
  if (!amount || amount <= 0) throw new Error('amount must be > 0');
  const balanceAfter = await _applyDelta(companyId, amount, 'topup', { description, createdBy });
  return { balance: balanceAfter, added: amount };
}

async function applyAdjustment(companyId, amount, { description, createdBy } = {}) {
  amount = Math.floor(Number(amount));
  if (!amount) throw new Error('amount must be != 0');
  const balanceAfter = await _applyDelta(companyId, amount, 'adjustment', { description, createdBy });
  return { balance: balanceAfter, applied: amount };
}

/**
 * Grant the one-time welcome bonus of WELCOME_CREDITS to a newly created
 * company. Idempotent: if a 'welcome' transaction already exists for this
 * company (or any topup with the welcome description), we do nothing.
 *
 * Recorded as kind='topup' with a stable description so it shows up
 * naturally in the company's credit ledger as a bonus.
 */
async function grantWelcomeCredits(companyId, createdBy = null) {
  if (!companyId) return { skipped: true, reason: 'no_company' };

  // Idempotency check — match by stable marker in description.
  const existing = await db.query(
    `SELECT id, amount, balance_after FROM credit_transactions
      WHERE company_id = ?
        AND kind = 'topup'
        AND description LIKE 'Bono de bienvenida%'
      LIMIT 1`,
    [companyId]
  );
  if (existing.length) {
    return {
      skipped: true,
      alreadyGranted: true,
      txId: existing[0].id,
      credits: Number(existing[0].amount),
      balance: Number(existing[0].balance_after)
    };
  }

  const description = `Bono de bienvenida — ${WELCOME_CREDITS} créditos gratuitos`;
  const balanceAfter = await _applyDelta(companyId, WELCOME_CREDITS, 'topup', {
    description, createdBy
  });
  return {
    skipped: false,
    credits: WELCOME_CREDITS,
    balance: balanceAfter
  };
}

/**
 * Compute the total IA cost for a meeting and debit the company.
 * Idempotent: if a debit row already exists for this meeting, returns it
 * without double-charging.
 */
async function debitForMeeting(meetingId) {
  if (!meetingId) return { skipped: true, reason: 'no_meeting_id' };

  const existing = await db.query(
    `SELECT id, amount, cost_usd, markup, balance_after, company_id
       FROM credit_transactions
      WHERE meeting_id = ? AND kind = 'debit'
      LIMIT 1`,
    [meetingId]
  );
  if (existing.length) {
    return {
      skipped: true,
      alreadyDebited: true,
      txId: existing[0].id,
      credits: Number(existing[0].amount),
      costUsd: Number(existing[0].cost_usd || 0),
      markup: Number(existing[0].markup || 0),
      balance: Number(existing[0].balance_after || 0),
      companyId: existing[0].company_id
    };
  }

  const roomRows = await db.query(
    `SELECT r.id, r.room_code, r.host_id, r.duration_seconds, u.company_id, c.credit_markup
       FROM rooms r
       LEFT JOIN users u ON u.id = r.host_id
       LEFT JOIN companies c ON c.id = u.company_id
      WHERE r.id = ?
      LIMIT 1`,
    [meetingId]
  );
  if (!roomRows.length || !roomRows[0].company_id) {
    return { skipped: true, reason: 'no_company' };
  }
  const companyId = roomRows[0].company_id;
  const markup = Number(roomRows[0].credit_markup || 1.5);

  const costRow = await db.query(
    `SELECT COALESCE(SUM(total_cost_usd), 0) AS cost_usd,
            COALESCE(SUM(total_tokens), 0) AS tokens,
            COUNT(*) AS calls
       FROM meeting_token_usage
      WHERE meeting_id = ?`,
    [meetingId]
  );
  const costUsd = Number(costRow[0].cost_usd || 0);
  const credits = usdToCredits(costUsd, markup);

  if (credits <= 0) {
    return { skipped: true, reason: 'no_cost', costUsd: 0, credits: 0, companyId };
  }

  const description = `Llamada ${roomRows[0].room_code || ('#' + meetingId)} · ${costRow[0].calls} llamadas IA`;
  const balanceAfter = await _applyDelta(companyId, -credits, 'debit', {
    meetingId, costUsd, markup, description
  });

  return {
    skipped: false,
    companyId, credits, costUsd, markup,
    balance: balanceAfter,
    calls: Number(costRow[0].calls || 0),
    tokens: Number(costRow[0].tokens || 0)
  };
}

/**
 * Aggregate quality + cost metrics for ONE meeting.
 */
async function getMeetingMetrics(meetingId) {
  const rooms = await db.query(
    `SELECT r.id, r.room_code, r.topic, r.language_focus, r.status,
            r.host_id, r.guest_id, r.started_at, r.ended_at, r.duration_seconds,
            r.created_at,
            h.display_name AS host_name, h.email AS host_email,
            g.display_name AS guest_name,
            u.company_id, c.code AS company_code, c.name AS company_name
       FROM rooms r
       LEFT JOIN users h ON h.id = r.host_id
       LEFT JOIN users g ON g.id = r.guest_id
       LEFT JOIN users u ON u.id = r.host_id
       LEFT JOIN companies c ON c.id = u.company_id
      WHERE r.id = ?
      LIMIT 1`,
    [meetingId]
  );
  if (!rooms.length) return null;
  const meeting = rooms[0];

  const cost = await db.query(
    `SELECT COALESCE(SUM(total_cost_usd),0) AS cost_usd,
            COALESCE(SUM(total_tokens),0)   AS tokens,
            COALESCE(SUM(prompt_tokens),0)  AS prompt_tokens,
            COALESCE(SUM(completion_tokens),0) AS completion_tokens,
            COUNT(*) AS calls,
            COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
            COALESCE(SUM(CASE WHEN was_cached THEN 1 ELSE 0 END),0) AS cached_calls
       FROM meeting_token_usage
      WHERE meeting_id = ?`,
    [meetingId]
  );

  const latency = await db.query(
    `SELECT COALESCE(AVG(total_latency_ms),0) AS avg_total,
            COALESCE(AVG(stt_latency_ms),0) AS avg_stt,
            COALESCE(AVG(mt_latency_ms),0) AS avg_mt,
            COALESCE(AVG(tts_latency_ms),0) AS avg_tts,
            COALESCE(SUM(CASE WHEN total_latency_ms > ? THEN 1 ELSE 0 END),0) AS degraded_count,
            COUNT(*) AS log_count
       FROM translation_logs
      WHERE room_id = ?`,
    [DEGRADED_LATENCY_MS, meetingId]
  );

  const allLatencies = await db.query(
    `SELECT total_latency_ms FROM translation_logs
      WHERE room_id = ? AND total_latency_ms IS NOT NULL
      ORDER BY total_latency_ms ASC`,
    [meetingId]
  );
  const lats = allLatencies.map(r => Number(r.total_latency_ms || 0));
  function pct(arr, p) {
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.floor((arr.length - 1) * p));
    return arr[idx];
  }
  const p50 = pct(lats, 0.5);
  const p95 = pct(lats, 0.95);
  const p99 = pct(lats, 0.99);

  const pairs = await db.query(
    `SELECT CONCAT(source_lang,' → ',target_lang) AS pair, COUNT(*) AS n,
            COALESCE(AVG(total_latency_ms),0) AS avg_ms
       FROM translation_logs
      WHERE room_id = ?
      GROUP BY source_lang, target_lang
      ORDER BY n DESC`,
    [meetingId]
  );

  const participants = await db.query(
    `SELECT id, user_id, display_name, native_language, target_language,
            status, joined_at, left_at
       FROM meeting_participants
      WHERE room_id = ?
      ORDER BY joined_at ASC, id ASC`,
    [meetingId]
  );

  const debit = await db.query(
    `SELECT id, amount, balance_after, cost_usd, markup, created_at
       FROM credit_transactions
      WHERE meeting_id = ? AND kind = 'debit'
      LIMIT 1`,
    [meetingId]
  );

  const logs = await db.query(
    `SELECT id, created_at, source_lang, target_lang,
            stt_latency_ms, mt_latency_ms, tts_latency_ms, total_latency_ms,
            char_count,
            (total_latency_ms > ?) AS is_degraded
       FROM translation_logs
      WHERE room_id = ?
      ORDER BY created_at ASC
      LIMIT 500`,
    [DEGRADED_LATENCY_MS, meetingId]
  );

  return {
    meeting,
    cost: cost[0] || {},
    latency: {
      ...(latency[0] || {}),
      p50, p95, p99,
      sampleCount: lats.length,
      degradedThresholdMs: DEGRADED_LATENCY_MS
    },
    pairs,
    participants,
    debit: debit[0] || null,
    logs
  };
}

/**
 * List meetings with KPIs (for /admin/meetings).
 */
async function listMeetingsWithKpis({ companyId = null, search = '', dateFrom = '', dateTo = '', status = '', limit = 200 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (companyId) {
    where.push('host.company_id = ?');
    params.push(companyId);
  }
  if (search) {
    where.push('(r.room_code LIKE ? OR r.topic LIKE ? OR host.display_name LIKE ? OR host.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (dateFrom) {
    where.push('COALESCE(r.ended_at, r.started_at, r.created_at) >= ?');
    params.push(dateFrom + ' 00:00:00');
  }
  if (dateTo) {
    where.push('COALESCE(r.ended_at, r.started_at, r.created_at) <= ?');
    params.push(dateTo + ' 23:59:59');
  }
  if (status && ['waiting','active','ended','closed','open'].includes(status)) {
    where.push('r.status = ?');
    params.push(status);
  }

  const sql = `
    SELECT r.id, r.room_code, r.topic, r.language_focus, r.status,
           r.started_at, r.ended_at, r.duration_seconds, r.created_at,
           host.display_name AS host_name, host.email AS host_email,
           host.company_id, c.code AS company_code, c.name AS company_name,
           (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.room_id = r.id) AS participant_count,
           (SELECT COALESCE(SUM(total_cost_usd),0) FROM meeting_token_usage mtu WHERE mtu.meeting_id = r.id) AS cost_usd,
           (SELECT COUNT(*) FROM meeting_token_usage mtu WHERE mtu.meeting_id = r.id) AS calls,
           (SELECT COALESCE(AVG(total_latency_ms),0) FROM translation_logs tl WHERE tl.room_id = r.id) AS avg_latency_ms,
           (SELECT COALESCE(SUM(CASE WHEN total_latency_ms > ${DEGRADED_LATENCY_MS} THEN 1 ELSE 0 END),0) FROM translation_logs tl WHERE tl.room_id = r.id) AS degraded_count,
           (SELECT amount FROM credit_transactions ct WHERE ct.meeting_id = r.id AND ct.kind='debit' LIMIT 1) AS credits_debited
      FROM rooms r
      LEFT JOIN users host ON host.id = r.host_id
      LEFT JOIN companies c ON c.id = host.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(r.ended_at, r.started_at, r.created_at) DESC
     LIMIT ?`;
  return db.query(sql, [...params, limit]);
}

module.exports = {
  CREDITS_PER_USD,
  DEGRADED_LATENCY_MS,
  WELCOME_CREDITS,
  usdToCredits,
  getBalance,
  listCompanyBalances,
  getTransactions,
  addCredits,
  applyAdjustment,
  grantWelcomeCredits,
  debitForMeeting,
  getMeetingMetrics,
  listMeetingsWithKpis
};
