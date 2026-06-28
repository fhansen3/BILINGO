'use strict';

// One-shot seed script: ensures the admin user has a known password.
// Run with: node db/seed-admin.js
const db = require('../config/db');
const { hashPassword } = require('../utils/hash');

(async () => {
  try {
    const hash = await hashPassword('admin1234');
    const existing = await db.query('SELECT id FROM users WHERE email = ?', ['admin@bilingo.meet']);
    if (existing.length) {
      await db.query("UPDATE users SET password_hash = ?, role = 'admin', status = 'active' WHERE email = ?", [hash, 'admin@bilingo.meet']);
      console.log('Admin password reset.');
    } else {
      await db.query(
        `INSERT INTO users (email, password_hash, display_name, avatar_color, native_language, learning_language, proficiency_level, country, role)
         VALUES (?, ?, 'Admin', '#58CC02', 'Spanish', 'English', 'advanced', 'Spain', 'admin')`,
        ['admin@bilingo.meet', hash]
      );
      console.log('Admin user created.');
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
