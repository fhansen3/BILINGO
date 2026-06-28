'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

function sign(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function verify(token) {
  try {
    return jwt.verify(token, env.jwt.secret);
  } catch (err) {
    return null;
  }
}

module.exports = { sign, verify };
