#!/usr/bin/env node
/**
 * scripts/db-dump.js
 *
 * Genera dos archivos:
 *   - db/schema.sql               → estructura (CREATE TABLE) en orden de dependencias
 *   - bilingo-meet-dump.sql       → estructura + datos (INSERT)
 *
 * No usa mysqldump (no está disponible en el sandbox). Genera SQL portable
 * leyendo el schema con SHOW CREATE TABLE y los datos con SELECT *.
 *
 * Variables de entorno requeridas (inyectadas por el runtime):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.DB_DATABASE;

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: DB_NAME,
    multipleStatements: true,
    dateStrings: true,
  });

  console.log(`[dump] Conectado a ${DB_NAME}`);

  // 1) Lista de tablas
  const [tablesRows] = await conn.query(
    `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
    [DB_NAME]
  );
  const tables = tablesRows.map(r => r.name);
  console.log(`[dump] ${tables.length} tablas: ${tables.join(', ')}`);

  // 2) Resolver orden de dependencias por FK (parent → child)
  const [fkRows] = await conn.query(
    `SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [DB_NAME]
  );
  const deps = new Map(tables.map(t => [t, new Set()]));
  for (const { child, parent } of fkRows) {
    if (child === parent) continue;
    if (deps.has(child) && tables.includes(parent)) deps.get(child).add(parent);
  }
  const ordered = [];
  const visited = new Set();
  const tempMark = new Set();
  function visit(t) {
    if (visited.has(t)) return;
    if (tempMark.has(t)) return; // ciclo, ignorar
    tempMark.add(t);
    for (const p of deps.get(t) || []) visit(p);
    tempMark.delete(t);
    visited.add(t);
    ordered.push(t);
  }
  for (const t of tables) visit(t);

  // 3) SHOW CREATE TABLE para cada tabla
  const createStatements = {};
  for (const t of ordered) {
    const [rows] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    let ddl = rows[0]['Create Table'];
    // Normalizar: quitar AUTO_INCREMENT=N para que el schema sea reproducible
    ddl = ddl.replace(/\s+AUTO_INCREMENT=\d+/g, '');
    createStatements[t] = ddl;
  }

  // 4) Generar db/schema.sql
  const schemaHeader =
`-- ============================================================================
--  BiLingo Meet — Database Schema
--  Generado automáticamente por scripts/db-dump.js
--  Fecha: ${new Date().toISOString()}
--  Base de datos: ${DB_NAME}
--  Tablas: ${tables.length}
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

`;
  const schemaBody = ordered
    .map(t => `-- ---------- Tabla: ${t} ----------\nDROP TABLE IF EXISTS \`${t}\`;\n${createStatements[t]};\n`)
    .join('\n');
  const schemaFooter = `\nSET FOREIGN_KEY_CHECKS = 1;\n`;

  const schemaPath = path.join('db', 'schema.sql');
  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(schemaPath, schemaHeader + schemaBody + schemaFooter, 'utf8');
  console.log(`[dump] ✓ Generado ${schemaPath} (${ordered.length} tablas)`);

  // 5) Generar bilingo-meet-dump.sql (schema + datos)
  const dumpHeader =
`-- ============================================================================
--  BiLingo Meet — Full Database Dump (schema + data)
--  Generado automáticamente por scripts/db-dump.js
--  Fecha: ${new Date().toISOString()}
--  Base de datos: ${DB_NAME}
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

`;
  let dumpBody = '';
  let totalRows = 0;

  for (const t of ordered) {
    dumpBody += `\n-- ============================================================\n`;
    dumpBody += `-- Tabla: ${t}\n`;
    dumpBody += `-- ============================================================\n`;
    dumpBody += `DROP TABLE IF EXISTS \`${t}\`;\n${createStatements[t]};\n\n`;

    const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
    if (rows.length === 0) {
      dumpBody += `-- (sin datos)\n`;
      continue;
    }
    totalRows += rows.length;

    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [DB_NAME, t]
    );
    const colNames = cols.map(c => `\`${c.COLUMN_NAME}\``).join(', ');

    // Insertar en bloques de 50 filas para que el archivo sea legible
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values = slice.map(row => {
        const vals = cols.map(c => formatValue(row[c.COLUMN_NAME]));
        return `(${vals.join(', ')})`;
      }).join(',\n  ');
      dumpBody += `INSERT INTO \`${t}\` (${colNames}) VALUES\n  ${values};\n`;
    }
    dumpBody += `-- (${rows.length} filas)\n`;
  }

  const dumpFooter = `\nSET FOREIGN_KEY_CHECKS = 1;\n`;
  const dumpPath = 'bilingo-meet-dump.sql';
  fs.writeFileSync(dumpPath, dumpHeader + dumpBody + dumpFooter, 'utf8');
  console.log(`[dump] ✓ Generado ${dumpPath} (${ordered.length} tablas, ${totalRows} filas totales)`);

  await conn.end();
  console.log('[dump] Listo.');
}

function formatValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NULL';
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 19).replace('T', ' ');
    return `'${iso}'`;
  }
  if (typeof v === 'object') {
    // JSON
    return `'${escapeStr(JSON.stringify(v))}'`;
  }
  return `'${escapeStr(String(v))}'`;
}

function escapeStr(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z')
    .replace(/\x00/g, '\\0');
}

main().catch(err => {
  console.error('[dump] ERROR:', err);
  process.exit(1);
});
