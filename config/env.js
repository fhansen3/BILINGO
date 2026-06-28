'use strict';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = {
  port: parseInt(required('PORT'), 10),
  basePath: process.env.BASE_PATH || '',
  db: {
    host: required('DB_HOST'),
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME')
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'bilingo-meet-dev-secret-change-in-prod',
    expiresIn: '7d'
  }
};
