'use strict';

const db = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/hash');
const { sign } = require('../utils/jwt');

const AVATAR_COLORS = ['#58CC02', '#1CB0F6', '#FF9600', '#CE82FF', '#FF4B4B', '#FFC800', '#2B70C9'];

async function register({ email, password, displayName, nativeLanguage, learningLanguage, country }) {
  if (!email || !password || !displayName) {
    const err = new Error('Email, password and display name are required');
    err.status = 400;
    throw err;
  }
  if (password.length < 6) {
    const err = new Error('Password must be at least 6 characters');
    err.status = 400;
    throw err;
  }

  const existing = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length) {
    const err = new Error('Email already registered');
    err.status = 409;
    throw err;
  }

  const hash = await hashPassword(password);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  const result = await db.query(
    `INSERT INTO users (email, password_hash, display_name, avatar_color, native_language, learning_language, country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [email.toLowerCase(), hash, displayName, color, nativeLanguage || null, learningLanguage || null, country || null]
  );

  const token = sign({ id: result.insertId, email: email.toLowerCase() });
  const user = await db.query('SELECT id, email, display_name, avatar_color, role FROM users WHERE id = ?', [result.insertId]);
  return { token, user: user[0] };
}

async function login({ email, password }) {
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const users = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (!users.length) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const user = users[0];
  if (user.status === 'banned') {
    const err = new Error('Account banned');
    err.status = 403;
    throw err;
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  await db.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [user.id]);

  const token = sign({ id: user.id, email: user.email });
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_color: user.avatar_color,
      role: user.role
    }
  };
}

async function getProfile(userId) {
  const users = await db.query(
    `SELECT id, email, display_name, bio, avatar_color, native_language, learning_language,
            proficiency_level, country, role, created_at
     FROM users WHERE id = ?`,
    [userId]
  );
  return users[0] || null;
}

module.exports = { register, login, getProfile };
