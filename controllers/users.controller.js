'use strict';

const usersService = require('../services/users.service');

async function updateMe(req, res, next) {
  try {
    const updated = await usersService.updateProfile(req.user.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
}

async function listPartners(req, res, next) {
  try {
    const { learning, native, online } = req.query;
    const list = await usersService.listPartners({
      excludeUserId: req.user.id,
      learningLanguage: learning || null,
      nativeLanguage: native || null,
      onlineOnly: online === 'true' || online === '1'
    });
    res.json(list);
  } catch (err) { next(err); }
}

async function getPublic(req, res, next) {
  try {
    const profile = await usersService.getPublicProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json(profile);
  } catch (err) { next(err); }
}

module.exports = { updateMe, listPartners, getPublic };
