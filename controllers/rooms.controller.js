'use strict';

const roomsService = require('../services/rooms.service');

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

module.exports = { create, getByCode, join, end, listMine, getMessages };
