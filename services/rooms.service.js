'use strict';

const db = require('../config/db');
const { generateRoomCode } = require('../utils/code');

async function createRoom({ hostId, topic, languageFocus }) {
  let code;
  for (let i = 0; i < 10; i++) {
    code = generateRoomCode();
    const existing = await db.query('SELECT id FROM rooms WHERE room_code = ?', [code]);
    if (!existing.length) break;
  }
  const result = await db.query(
    `INSERT INTO rooms (room_code, host_id, topic, language_focus, status) VALUES (?, ?, ?, ?, 'waiting')`,
    [code, hostId, topic || null, languageFocus || null]
  );
  const rooms = await db.query('SELECT * FROM rooms WHERE id = ?', [result.insertId]);
  return rooms[0];
}

async function getRoomByCode(code) {
  const rooms = await db.query(
    `SELECT r.*, h.display_name as host_name, h.avatar_color as host_color,
            g.display_name as guest_name, g.avatar_color as guest_color
     FROM rooms r
     LEFT JOIN users h ON r.host_id = h.id
     LEFT JOIN users g ON r.guest_id = g.id
     WHERE r.room_code = ?`,
    [code]
  );
  return rooms[0] || null;
}

async function joinRoom(code, userId) {
  const room = await getRoomByCode(code);
  if (!room) {
    const err = new Error('Room not found');
    err.status = 404;
    throw err;
  }
  if (room.status === 'ended') {
    const err = new Error('Room has ended');
    err.status = 410;
    throw err;
  }
  // rule_languages_required — joiner must have BOTH native and learning lang set.
  const me = await db.query(
    'SELECT id, native_language, learning_language FROM users WHERE id = ?',
    [userId]
  );
  if (!me.length) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const u = me[0];
  if (!u.native_language || !u.learning_language) {
    const err = new Error('languages_required');
    err.status = 400;
    err.code = 'LANGUAGES_REQUIRED';
    err.message = 'Debes configurar tu idioma nativo y objetivo antes de unirte a una sala.';
    throw err;
  }
  if (room.host_id === userId) {
    return room;
  }
  if (room.guest_id && room.guest_id !== userId) {
    const err = new Error('Room is full');
    err.status = 409;
    throw err;
  }
  await db.query(
    `UPDATE rooms SET guest_id = ?, status = 'active', started_at = COALESCE(started_at, NOW()) WHERE id = ?`,
    [userId, room.id]
  );
  return getRoomByCode(code);
}

async function endRoom(roomId, userId) {
  const rooms = await db.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!rooms.length) return null;
  const room = rooms[0];
  if (room.host_id !== userId && room.guest_id !== userId) {
    const err = new Error('Not a participant');
    err.status = 403;
    throw err;
  }
  const duration = room.started_at
    ? Math.floor((Date.now() - new Date(room.started_at).getTime()) / 1000)
    : 0;
  await db.query(
    `UPDATE rooms SET status = 'ended', ended_at = NOW(), duration_seconds = ? WHERE id = ?`,
    [duration, roomId]
  );

  // record history for both participants
  if (room.host_id) {
    await db.query(
      `INSERT INTO session_history (room_id, user_id, partner_id, duration_seconds) VALUES (?, ?, ?, ?)`,
      [room.id, room.host_id, room.guest_id, duration]
    );
  }
  if (room.guest_id) {
    await db.query(
      `INSERT INTO session_history (room_id, user_id, partner_id, duration_seconds) VALUES (?, ?, ?, ?)`,
      [room.id, room.guest_id, room.host_id, duration]
    );
  }

  // Step 1: settle Realtime Translate billing — write a single row to
  // meeting_token_usage with the OpenAI flat per-minute cost. Best-effort.
  try {
    const { recordRealtimeUsage } = require('./realtimeUsage');
    const rt = await recordRealtimeUsage(room.id);
    if (rt && !rt.skipped) {
      console.log('[realtime] meeting', room.id, 'recorded', rt.minutes, 'min · $' + rt.costUsd);
    }
  } catch (e) {
    console.warn('[realtime] usage record failed for room', room.id, e.message);
  }

  // Step 2: debit IA cost from the host's company credit balance.
  // Best-effort: never let a credit-debit failure break the end-room flow.
  try {
    const credits = require('./credits.service');
    const result = await credits.debitForMeeting(room.id);
    if (result && !result.skipped) {
      console.log('[credits] meeting', room.id, 'debited', result.credits, 'credits (balance:', result.balance, ')');
    }
  } catch (e) {
    console.warn('[credits] debit failed for room', room.id, e.message);
  }

  return { ended: true, duration };
}

async function listMyRooms(userId) {
  return db.query(
    `SELECT r.*, h.display_name as host_name, g.display_name as guest_name
     FROM rooms r
     LEFT JOIN users h ON r.host_id = h.id
     LEFT JOIN users g ON r.guest_id = g.id
     WHERE r.host_id = ? OR r.guest_id = ?
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [userId, userId]
  );
}

async function getMessages(roomId) {
  return db.query(
    `SELECT m.*, u.display_name, u.avatar_color
     FROM messages m
     JOIN users u ON m.user_id = u.id
     WHERE m.room_id = ?
     ORDER BY m.created_at ASC
     LIMIT 500`,
    [roomId]
  );
}

async function addMessage(roomId, userId, content, opts = {}) {
  const { sourceLang = null, targetLang = null, translatedContent = null } = opts;
  const result = await db.query(
    `INSERT INTO messages (room_id, user_id, content, source_lang, target_lang, translated_content)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [roomId, userId, content, sourceLang, targetLang, translatedContent]
  );
  const messages = await db.query(
    `SELECT m.*, u.display_name, u.avatar_color
     FROM messages m JOIN users u ON m.user_id = u.id
     WHERE m.id = ?`,
    [result.insertId]
  );
  return messages[0];
}

module.exports = {
  createRoom, getRoomByCode, joinRoom, endRoom, listMyRooms,
  getMessages, addMessage
};
