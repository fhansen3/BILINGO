'use strict';

const db = require('../config/db');
const roomsService = require('./rooms.service');

const INVITE_TTL_MIN = 10; // pending invitation expires after 10 minutes

async function create({ roomCode, inviterId, inviteeId, message }) {
  if (!roomCode) {
    const err = new Error('roomCode required');
    err.status = 400;
    throw err;
  }
  if (!inviteeId) {
    const err = new Error('inviteeId required');
    err.status = 400;
    throw err;
  }
  if (Number(inviteeId) === Number(inviterId)) {
    const err = new Error('Cannot invite yourself');
    err.status = 400;
    throw err;
  }

  const room = await roomsService.getRoomByCode(String(roomCode).trim().toLowerCase());
  if (!room) {
    const err = new Error('Room not found');
    err.status = 404;
    throw err;
  }
  if (room.status === 'ended' || room.status === 'closed') {
    const err = new Error('Room is no longer active');
    err.status = 410;
    throw err;
  }

  // Confirm invitee exists and is not banned/suspended
  const invitees = await db.query(
    'SELECT id, display_name, status FROM users WHERE id = ?',
    [Number(inviteeId)]
  );
  if (!invitees.length) {
    const err = new Error('Invitee not found');
    err.status = 404;
    throw err;
  }
  if (invitees[0].status !== 'active') {
    const err = new Error('Invitee is not active');
    err.status = 400;
    throw err;
  }

  // Confirm inviter exists
  const inviters = await db.query(
    'SELECT id, display_name, avatar_color FROM users WHERE id = ?',
    [Number(inviterId)]
  );
  if (!inviters.length) {
    const err = new Error('Inviter not found');
    err.status = 404;
    throw err;
  }

  // Reuse a pending invitation for the same room+invitee if it exists (within TTL).
  // Otherwise create a new one.
  const existing = await db.query(
    `SELECT id FROM room_invitations
       WHERE room_id = ? AND invitee_id = ? AND status = 'pending'
         AND created_at > (NOW() - INTERVAL ? MINUTE)
       ORDER BY id DESC LIMIT 1`,
    [room.id, Number(inviteeId), INVITE_TTL_MIN]
  );

  let invitationId;
  if (existing.length) {
    invitationId = existing[0].id;
  } else {
    const result = await db.query(
      `INSERT INTO room_invitations
         (room_id, room_code, inviter_id, invitee_id, message, status, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', (NOW() + INTERVAL ? MINUTE))`,
      [room.id, room.room_code, Number(inviterId), Number(inviteeId), message || null, INVITE_TTL_MIN]
    );
    invitationId = result.insertId;
  }

  return getById(invitationId);
}

async function getById(id) {
  const rows = await db.query(
    `SELECT inv.*, r.room_code, r.topic, r.status AS room_status,
            u_from.display_name AS inviter_name, u_from.avatar_color AS inviter_color,
            u_to.display_name   AS invitee_name
       FROM room_invitations inv
       JOIN rooms r        ON r.id = inv.room_id
       JOIN users u_from   ON u_from.id = inv.inviter_id
       JOIN users u_to     ON u_to.id   = inv.invitee_id
      WHERE inv.id = ?`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function listPendingForUser(userId) {
  // Auto-expire stale ones first.
  await db.query(
    `UPDATE room_invitations
        SET status = 'expired'
      WHERE invitee_id = ? AND status = 'pending'
        AND (expires_at IS NOT NULL AND expires_at < NOW())`,
    [Number(userId)]
  );
  return db.query(
    `SELECT inv.id, inv.room_id, inv.room_code, inv.inviter_id, inv.message,
            inv.created_at, inv.expires_at,
            u.display_name AS inviter_name, u.avatar_color AS inviter_color,
            r.topic, r.status AS room_status
       FROM room_invitations inv
       JOIN users u ON u.id = inv.inviter_id
       JOIN rooms r ON r.id = inv.room_id
      WHERE inv.invitee_id = ?
        AND inv.status = 'pending'
        AND r.status NOT IN ('ended','closed')
      ORDER BY inv.created_at DESC
      LIMIT 50`,
    [Number(userId)]
  );
}

async function respond(invitationId, userId, action) {
  if (!['accepted', 'declined'].includes(action)) {
    const err = new Error('Invalid action');
    err.status = 400;
    throw err;
  }
  const rows = await db.query(
    'SELECT * FROM room_invitations WHERE id = ?',
    [Number(invitationId)]
  );
  if (!rows.length) {
    const err = new Error('Invitation not found');
    err.status = 404;
    throw err;
  }
  const inv = rows[0];
  if (inv.invitee_id !== Number(userId)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (inv.status !== 'pending') {
    const err = new Error('Invitation already ' + inv.status);
    err.status = 409;
    throw err;
  }
  await db.query(
    'UPDATE room_invitations SET status = ?, responded_at = NOW() WHERE id = ?',
    [action, inv.id]
  );
  return getById(inv.id);
}

async function cancel(invitationId, inviterId) {
  const rows = await db.query(
    'SELECT * FROM room_invitations WHERE id = ?',
    [Number(invitationId)]
  );
  if (!rows.length) return null;
  const inv = rows[0];
  if (inv.inviter_id !== Number(inviterId)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (inv.status !== 'pending') return inv;
  await db.query(
    "UPDATE room_invitations SET status = 'cancelled', responded_at = NOW() WHERE id = ?",
    [inv.id]
  );
  return getById(inv.id);
}

module.exports = { create, getById, listPendingForUser, respond, cancel };
