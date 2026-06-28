'use strict';

const roomsService = require('../services/rooms.service');
const invitationsService = require('../services/invitations.service');
const { getIO } = require('../sockets/io');

async function create(req, res, next) {
  try {
    const room = await roomsService.createRoom({
      hostId: req.user.id,
      topic: req.body.topic,
      languageFocus: req.body.languageFocus
    });
    res.json(room);
  } catch (err) { next(err); }
}

async function getByCode(req, res, next) {
  try {
    const room = await roomsService.getRoomByCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (err) { next(err); }
}

async function join(req, res, next) {
  try {
    const room = await roomsService.joinRoom(req.params.code, req.user.id);
    res.json(room);
  } catch (err) { next(err); }
}

async function end(req, res, next) {
  try {
    const result = await roomsService.endRoom(parseInt(req.params.id, 10), req.user.id);
    res.json(result);
  } catch (err) { next(err); }
}

async function listMine(req, res, next) {
  try {
    const rooms = await roomsService.listMyRooms(req.user.id);
    res.json(rooms);
  } catch (err) { next(err); }
}

async function getMessages(req, res, next) {
  try {
    const messages = await roomsService.getMessages(parseInt(req.params.id, 10));
    res.json(messages);
  } catch (err) { next(err); }
}

async function invite(req, res, next) {
  try {
    const { user_id, userId, message } = req.body || {};
    const inviteeId = user_id || userId;
    const inv = await invitationsService.create({
      roomCode: req.params.code,
      inviterId: req.user.id,
      inviteeId,
      message
    });
    const io = getIO();
    if (io && inv) {
      io.to('user:' + inv.invitee_id).emit('invite:incoming', {
        invitationId: inv.id,
        roomCode: inv.room_code,
        topic: inv.topic,
        message: inv.message,
        inviter: {
          id: inv.inviter_id,
          name: inv.inviter_name,
          avatarColor: inv.inviter_color
        },
        expiresAt: inv.expires_at,
        createdAt: inv.created_at
      });
    }
    res.json({ ok: true, invitation: inv });
  } catch (err) { next(err); }
}

module.exports = { create, getByCode, join, end, listMine, getMessages, invite };
