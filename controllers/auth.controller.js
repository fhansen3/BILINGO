'use strict';

const authService = require('../services/auth.service');

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    setAuthCookie(res, result.token);
    res.json(result);
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    setAuthCookie(res, result.token);
    res.json(result);
  } catch (err) { next(err); }
}

async function logout(req, res) {
  res.clearCookie('token');
  res.json({ ok: true });
}

async function me(req, res, next) {
  try {
    const profile = await authService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) { next(err); }
}

module.exports = { register, login, logout, me };
