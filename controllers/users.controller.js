'use strict';

const db = require('../config/db');
const usersService = require('../services/users.service');

async function updateMe(req, res, next) {
  try {
    const updated = await usersService.updateProfile(req.user.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
}

async function getCallerCompanyId(userId) {
  const rows = await db.query('SELECT company_id FROM users WHERE id = ?', [userId]);
  return rows.length ? rows[0].company_id : null;
}

async function listPartners(req, res, next) {
  try {
    const { native, online } = req.query;
    const callerCompanyId = await getCallerCompanyId(req.user.id);

    const list = await usersService.listPartners({
      excludeUserId: req.user.id,
      callerCompanyId,
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

    // Cross-company isolation: callers can only see profiles from their own
    // company. Admins (req.user.role==='admin') bypass this guard.
    if (req.user && req.user.role !== 'admin') {
      const callerCompanyId = await getCallerCompanyId(req.user.id);
      if (!callerCompanyId || profile.company_id !== callerCompanyId) {
        return res.status(403).json({ error: 'Cross-company access denied' });
      }
    }

    res.json(profile);
  } catch (err) { next(err); }
}

module.exports = { updateMe, listPartners, getPublic };
