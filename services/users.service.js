'use strict';

const db = require('../config/db');

async function updateProfile(userId, data) {
  const allowed = ['display_name', 'bio', 'native_language', 'learning_language', 'proficiency_level', 'country', 'avatar_color'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (!fields.length) return null;
  values.push(userId);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  const updated = await db.query(
    `SELECT id, email, display_name, bio, avatar_color, native_language, learning_language,
            proficiency_level, country, role FROM users WHERE id = ?`,
    [userId]
  );
  return updated[0];
}

/**
 * List "partners" (other users) FILTERED BY THE CALLER'S COMPANY.
 *
 * A user can only see/connect with users from their own company. If the
 * caller has no company_id assigned, the result is empty (defensive default
 * — an unassigned user should not be able to harvest the global user list).
 */
async function listPartners({ excludeUserId, callerCompanyId, nativeLanguage, onlineOnly, limit = 50 }) {
  // No company → no results. This is the security boundary.
  if (!callerCompanyId) return [];

  const where = ['u.id != ?', "u.status = 'active'", 'u.company_id = ?'];
  const params = [excludeUserId, callerCompanyId];

  if (nativeLanguage) {
    where.push('u.native_language = ?');
    params.push(nativeLanguage);
  }
  if (onlineOnly) {
    where.push('u.is_online = 1');
  }

  const sql = `
    SELECT u.id, u.display_name, u.bio, u.avatar_color,
           u.native_language, u.learning_language,
           u.proficiency_level, u.country, u.is_online, u.last_seen,
           c.code AS company_code, c.name AS company_name
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY u.is_online DESC, u.last_seen DESC
    LIMIT ${parseInt(limit, 10)}
  `;
  return db.query(sql, params);
}

async function getPublicProfile(userId) {
  const users = await db.query(
    `SELECT u.id, u.display_name, u.bio, u.avatar_color, u.native_language, u.learning_language,
            u.proficiency_level, u.country, u.is_online, u.last_seen, u.created_at,
            u.company_id, c.code AS company_code, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.id = ? AND u.status = 'active'`,
    [userId]
  );
  return users[0] || null;
}

module.exports = { updateProfile, listPartners, getPublicProfile };
