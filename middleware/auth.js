'use strict';

const { verify } = require('../utils/jwt');
const db = require('../config/db');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const payload = verify(token);
    if (!payload) return res.status(401).json({ error: 'Invalid token' });

    const users = await db.query('SELECT id, email, display_name, role, status FROM users WHERE id = ?', [payload.id]);
    if (!users.length) return res.status(401).json({ error: 'User not found' });
    if (users[0].status === 'banned') return res.status(403).json({ error: 'Account banned' });

    req.user = users[0];
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
