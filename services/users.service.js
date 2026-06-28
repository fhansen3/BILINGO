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

async function listPartners({ excludeUserId, learningLanguage, nativeLanguage, onlineOnly, limit = 50 }) {
  const where = ['id != ?', "status = 'active'"];
  const params = [excludeUserId];

  if (learningLanguage) {
    where.push('native_language = ?');
    params.push(learningLanguage);
  }
  if (nativeLanguage) {
    where.push('learning_language = ?');
    params.push(nativeLanguage);
  }
  if (onlineOnly) {
    where.push('is_online = 1');
  }

  const sql = `
    SELECT id, display_name, bio, avatar_color, native_language, learning_language,
           proficiency_level, country, is_online, last_seen
    FROM users
    WHERE ${where.join(' AND ')}
    ORDER BY is_online DESC, last_seen DESC
    LIMIT ${parseInt(limit, 10)}
  `;
  return db.query(sql, params);
}

async function getPublicProfile(userId) {
  const users = await db.query(
    `SELECT id, display_name, bio, avatar_color, native_language, learning_language,
            proficiency_level, country, is_online, last_seen, created_at
     FROM users WHERE id = ? AND status = 'active'`,
    [userId]
  );
  return users[0] || null;
}

module.exports = { updateProfile, listPartners, getPublicProfile };
