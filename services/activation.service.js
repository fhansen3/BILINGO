'use strict';

/**
 * Magic-link activation flow.
 *
 * Used when an admin creates a user: instead of choosing a password for them,
 * the user gets an activation link they use to set their own password.
 *
 * Token storage: `user_activation_tokens` (24h TTL).
 * The newly created user is stored with a random unusable password_hash —
 * they can only log in after activating.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { hashPassword } = require('../utils/hash');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function issueToken(userId, createdByUserId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  // Invalidate previous unused tokens
  await db.query(
    'UPDATE user_activation_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
  await db.query(
    'INSERT INTO user_activation_tokens (user_id, token, created_by, expires_at) VALUES (?, ?, ?, ?)',
    [userId, token, createdByUserId || null, expiresAt]
  );
  return token;
}

async function findValidToken(token) {
  if (!token || !/^[a-f0-9]{8,128}$/i.test(token)) return null;
  const rows = await db.query(
    `SELECT t.id, t.user_id, t.expires_at, t.used_at,
            u.email, u.display_name, u.status
       FROM user_activation_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token = ?`,
    [token]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.used_at) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return r;
}

async function consumeToken(tokenId, userId, newPassword) {
  const hash = await hashPassword(newPassword);
  await db.query('UPDATE users SET password_hash = ?, status = "active" WHERE id = ?', [hash, userId]);
  await db.query('UPDATE user_activation_tokens SET used_at = NOW() WHERE id = ?', [tokenId]);
}

module.exports = { issueToken, findValidToken, consumeToken };
