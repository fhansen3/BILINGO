
'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// NOTE: we use pool.query() instead of pool.execute() because mysql2's
// prepared-statement protocol (execute) does NOT accept bound parameters
// for LIMIT / OFFSET / INTERVAL ? DAY — MySQL rejects them with
// ER_WRONG_ARGUMENTS ("Incorrect arguments to mysqld_stmt_execute").
// pool.query() still escapes parameters safely via the text protocol.
async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaction };
