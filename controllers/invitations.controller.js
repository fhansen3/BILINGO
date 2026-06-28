'use strict';

const svc = require('../services/invitations.service');
const { getIO } = require('../sockets/io');

async function listMine(req, res, next) {
  try {
    const list = await svc.listPendingForUser(req.user.id);
    res.json(list);
  } catch (err) { next(err); }
}

async function accept(req, res, next) {
  try {
    const inv = await svc.respond(parseInt(req.params.id, 10), req.user.id, 'accepted');
    const io = getIO();
    if (io && inv) {
      io.to('user:' + inv.inviter_id).emit('invite:response', {
        invitationId: inv.id,
        roomCode: inv.room_code,
        inviteeId: inv.invitee_id,
        inviteeName: inv.invitee_name,
        status: 'accepted'
      });
    }
    res.json({ ok: true, invitation: inv });
  } catch (err) { next(err); }
}

async function decline(req, res, next) {
  try {
    const inv = await svc.respond(parseInt(req.params.id, 10), req.user.id, 'declined');
    const io = getIO();
    if (io && inv) {
      io.to('user:' + inv.inviter_id).emit('invite:response', {
        invitationId: inv.id,
        roomCode: inv.room_code,
        inviteeId: inv.invitee_id,
        inviteeName: inv.invitee_name,
        status: 'declined'
      });
    }
    res.json({ ok: true, invitation: inv });
  } catch (err) { next(err); }
}

async function cancel(req, res, next) {
  try {
    const inv = await svc.cancel(parseInt(req.params.id, 10), req.user.id);
    const io = getIO();
    if (io && inv) {
      io.to('user:' + inv.invitee_id).emit('invite:cancelled', {
        invitationId: inv.id,
        roomCode: inv.room_code
      });
    }
    res.json({ ok: true, invitation: inv });
  } catch (err) { next(err); }
}

module.exports = { listMine, accept, decline, cancel };
