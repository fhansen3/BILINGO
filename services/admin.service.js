'use strict';

const db = require('../config/db');

async function getStats() {
  const [users] = await db.query('SELECT COUNT(*) as c FROM users');
  const [active] = await db.query("SELECT COUNT(*) as c FROM users WHERE status = 'active'");
  const [online] = await db.query('SELECT COUNT(*) as c FROM users WHERE is_online = 1');
  const [rooms] = await db.query('SELECT COUNT(*) as c FROM rooms');
  const [activeRooms] = await db.query("SELECT COUNT(*) as c FROM rooms WHERE status = 'active'");
  const [sessions] = await db.query('SELECT COUNT(*) as c, COALESCE(SUM(duration_seconds),0) as total_s FROM session_history');
  const [pendingReports] = await db.query("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'");
  const [messages] = await db.query('SELECT COUNT(*) as c FROM messages');

  return {
    totalUsers: users.c,
    activeUsers: active.c,
    onlineUsers: online.c,
    totalRooms: rooms.c,
    activeRooms: activeRooms.c,
    totalSessions: sessions.c,
    totalMinutes: Math.floor(sessions.total_s / 60),
    pendingReports: pendingReports.c,
    totalMessages: messages.c
  };
}

async function listUsers({ search, status }) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(email LIKE ? OR display_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const sql = `
    SELECT id, email, display_name, role, status, is_online, native_language, learning_language, created_at
    FROM users
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT 200
  `;
  return db.query(sql, params);
}

async function updateUserStatus(userId, status) {
  const allowed = ['active', 'banned', 'suspended'];
  if (!allowed.includes(status)) {
    const err = new Error('Invalid status');
    err.status = 400;
    throw err;
  }
  await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
  return { id: userId, status };
}

async function listReports() {
  return db.query(
    `SELECT r.*,
            u1.display_name as reporter_name,
            u2.display_name as reported_name,
            u2.email as reported_email
     FROM reports r
     JOIN users u1 ON r.reporter_id = u1.id
     JOIN users u2 ON r.reported_user_id = u2.id
     ORDER BY r.created_at DESC LIMIT 100`
  );
}

async function updateReport(reportId, status) {
  const allowed = ['pending', 'reviewed', 'resolved', 'dismissed'];
  if (!allowed.includes(status)) {
    const err = new Error('Invalid status');
    err.status = 400;
    throw err;
  }
  await db.query('UPDATE reports SET status = ?, reviewed_at = NOW() WHERE id = ?', [status, reportId]);
  return { id: reportId, status };
}

async function createReport({ reporterId, reportedUserId, roomId, reason, details }) {
  if (!reportedUserId || !reason) {
    const err = new Error('reportedUserId and reason required');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `INSERT INTO reports (reporter_id, reported_user_id, room_id, reason, details) VALUES (?, ?, ?, ?, ?)`,
    [reporterId, reportedUserId, roomId || null, reason, details || null]
  );
  return { id: result.insertId };
}

async function listRooms() {
  return db.query(
    `SELECT r.*, h.display_name as host_name, g.display_name as guest_name
     FROM rooms r
     LEFT JOIN users h ON r.host_id = h.id
     LEFT JOIN users g ON r.guest_id = g.id
     ORDER BY r.created_at DESC LIMIT 100`
  );
}

module.exports = {
  getStats, listUsers, updateUserStatus, listReports, updateReport, createReport, listRooms
};
