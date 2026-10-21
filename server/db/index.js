import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let database = null;
const cache = new Map();

export function openDatabase(file = config.dbFile) {
  if (database) return database;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate();
  return database;
}

/** Conexión nativa (para el respaldo continuo, que necesita sesiones de SQLite). */
export const rawDatabase = () => database;

export function closeDatabase() {
  if (database) database.close();
  database = null;
  cache.clear();
}

function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = database.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

/** Ejecuta consultas con parámetros posicionales o nombrados. */
export const db = {
  all: (sql, ...params) => stmt(sql).all(...params),
  get: (sql, ...params) => stmt(sql).get(...params),
  run: (sql, ...params) => stmt(sql).run(...params),
  exec: (sql) => database.exec(sql),
  insert(table, row) {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return Number(stmt(sql).run(...keys.map((k) => normalize(row[k]))).lastInsertRowid);
  },
  update(table, id, row) {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    stmt(sql).run(...keys.map((k) => normalize(row[k])), id);
  },
};

function normalize(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

let depth = 0;
/** Transacción con soporte para anidamiento (SAVEPOINT). */
export function transaction(fn) {
  const name = `sp${depth}`;
  database.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    depth--;
    database.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    depth--;
    database.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
}

const migrations = [
  () => database.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8')),
];

function migrate() {
  const { user_version: current } = database.prepare('PRAGMA user_version').get();
  for (let v = current; v < migrations.length; v++) {
    transaction(() => {
      migrations[v]();
      database.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  transaction(seed);
}

export function getSetting(key, fallback = null) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

export function backupTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.unlinkSync(file);
  database.prepare('VACUUM INTO ?').run(file);
}
