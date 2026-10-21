// Respaldo continuo en Turso para alojamientos sin disco permanente (p. ej. el plan gratuito de Render).
//
// Cómo funciona:
//  1. La aplicación sigue usando SQLite local (rápido y síncrono).
//  2. Una "sesión" de SQLite registra cada cambio; cada 1.5 s los cambios se envían a Turso como
//     un registro ordenado (pe_changes).
//  3. Periódicamente se sube una copia completa (pe_snapshots) y se borran los cambios ya incluidos.
//  4. Al arrancar: se descarga la última copia, se aplican los cambios posteriores y se reconstruye
//     el índice de búsqueda. Los archivos subidos se guardan en pe_files y se descargan bajo demanda.
//
// Antes de responder a una subida de archivo, el archivo ya está en Turso. Los cambios de datos se
// envían en segundos; al apagarse (Render envía SIGTERM) se vacía la cola antes de salir.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const CHUNK = 1024 * 1024; // 1 MB por fila
const COMPACT_EVERY_CHANGES = 300;
const COMPACT_EVERY_MS = 30 * 60_000;

let client = null;
let database = null;
let session = null;
let timer = null;
let lastSeq = 0;
let queue = [];
let pumping = null;
let compacting = null;
let changesSinceSnapshot = 0;
let lastSnapshotAt = 0;
const status = { enabled: false, lastSyncAt: null, lastSnapshotAt: null, error: null, restored: null };

export const mirrorEnabled = () => Boolean(config.turso);
export const mirrorStatus = () => ({ ...status, pending: queue.length });

async function getClient() {
  if (client) return client;
  const { createClient } = await import('@libsql/client');
  client = createClient({ url: config.turso.url, authToken: config.turso.authToken });
  await client.batch(
    [
      'CREATE TABLE IF NOT EXISTS pe_snapshots (id INTEGER PRIMARY KEY, base_seq INTEGER NOT NULL, chunks INTEGER NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS pe_snapshot_chunks (snapshot_id INTEGER NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (snapshot_id, idx))',
      'CREATE TABLE IF NOT EXISTS pe_changes (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, created_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS pe_files (stored_name TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (stored_name, idx))',
    ],
    'write',
  );
  return client;
}

const toBuffer = (v) => (v instanceof ArrayBuffer ? Buffer.from(v) : Buffer.from(v.buffer, v.byteOffset, v.byteLength));
const chunksOf = (buf) => {
  const out = [];
  for (let i = 0; i < buf.length; i += CHUNK) out.push(buf.subarray(i, i + CHUNK));
  return out.length ? out : [Buffer.alloc(0)];
};

/** Restaura la base local desde Turso. Se llama antes de abrir la base de datos. */
export async function restoreFromMirror(dbFile) {
  const c = await getClient();
  status.enabled = true;
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const snap = (await c.execute('SELECT id, base_seq, chunks FROM pe_snapshots ORDER BY id DESC LIMIT 1')).rows[0];
  let base = 0;
  if (snap) {
    const rows = (await c.execute({ sql: 'SELECT data FROM pe_snapshot_chunks WHERE snapshot_id = ? ORDER BY idx', args: [snap.id] })).rows;
    if (rows.length !== Number(snap.chunks)) throw new Error('La copia en Turso está incompleta.');
    fs.writeFileSync(dbFile, Buffer.concat(rows.map((r) => toBuffer(r.data))));
    base = Number(snap.base_seq);
  }
  const changes = (await c.execute({ sql: 'SELECT seq, data FROM pe_changes WHERE seq > ? ORDER BY seq', args: [base] })).rows;
  if (changes.length) {
    if (!snap) throw new Error('Hay cambios en Turso pero ninguna copia base; no se puede restaurar con seguridad.');
    const d = new DatabaseSync(dbFile);
    d.exec('PRAGMA foreign_keys = OFF');
    for (const ch of changes) d.applyChangeset(toBuffer(ch.data));
    d.close();
  }
  const maxSeq = Number((await c.execute('SELECT MAX(seq) AS m FROM pe_changes')).rows[0].m || 0);
  lastSeq = Math.max(base, maxSeq);
  status.restored = { fromSnapshot: Boolean(snap), changes: changes.length, at: new Date().toISOString() };
  return status.restored;
}

/** Empieza a registrar y enviar cambios. Sube una copia completa inicial antes de aceptar peticiones. */
export async function startMirror(db) {
  database = db;
  session = database.createSession();
  await compact();
  timer = setInterval(tick, 1500);
  timer.unref();
}

function capture() {
  if (!session) return null;
  const cs = session.changeset();
  if (!cs.length) return null;
  session.close();
  session = database.createSession();
  lastSeq += 1;
  queue.push({ seq: lastSeq, data: Buffer.from(cs) });
  changesSinceSnapshot += 1;
  return lastSeq;
}

function pump() {
  if (pumping) return pumping;
  pumping = (async () => {
    try {
      const c = await getClient();
      while (queue.length) {
        const item = queue[0];
        await c.execute({ sql: 'INSERT OR REPLACE INTO pe_changes (seq, data, created_at) VALUES (?, ?, ?)', args: [item.seq, item.data, new Date().toISOString()] });
        queue.shift();
      }
      status.lastSyncAt = new Date().toISOString();
      status.error = null;
    } catch (err) {
      status.error = err.message;
      console.error('[turso] No se pudieron enviar cambios (se reintentará):', err.message);
    } finally {
      pumping = null;
    }
  })();
  return pumping;
}

function tick() {
  try {
    capture();
  } catch (err) {
    console.error('[turso] Error al registrar cambios:', err.message);
  }
  pump();
  const due = changesSinceSnapshot >= COMPACT_EVERY_CHANGES || (changesSinceSnapshot > 0 && Date.now() - lastSnapshotAt > COMPACT_EVERY_MS);
  if (due) compact();
}

/** Copia completa + limpieza de cambios ya incluidos. Conserva una copia por día de la última semana. */
function compact() {
  if (compacting) return compacting;
  compacting = (async () => {
    try {
      // Todo esto es síncrono: ninguna escritura se cuela entre el registro y la copia.
      capture();
      const base = lastSeq;
      const tmp = path.join(path.dirname(config.dbFile), `mirror-${Date.now()}.db`);
      database.prepare('VACUUM INTO ?').run(tmp);
      const buf = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
      changesSinceSnapshot = 0;
      lastSnapshotAt = Date.now();

      const c = await getClient();
      const id = Date.now();
      const parts = chunksOf(buf);
      for (let i = 0; i < parts.length; i++) {
        await c.execute({ sql: 'INSERT INTO pe_snapshot_chunks (snapshot_id, idx, data) VALUES (?, ?, ?)', args: [id, i, parts[i]] });
      }
      // La fila de la copia se escribe al final: si existe, la copia está completa.
      await c.execute({ sql: 'INSERT INTO pe_snapshots (id, base_seq, chunks, size, created_at) VALUES (?, ?, ?, ?, ?)', args: [id, base, parts.length, buf.length, new Date(id).toISOString()] });
      await pump();
      await c.execute({ sql: 'DELETE FROM pe_changes WHERE seq <= ?', args: [base] });
      // Retención: la más reciente y la última de cada uno de los 7 días anteriores.
      const snaps = (await c.execute('SELECT id, created_at FROM pe_snapshots ORDER BY id DESC')).rows;
      const keep = new Set([Number(snaps[0].id)]);
      const days = new Set();
      for (const s of snaps.slice(1)) {
        const day = String(s.created_at).slice(0, 10);
        if (!days.has(day) && days.size < 7 && day !== String(snaps[0].created_at).slice(0, 10)) {
          days.add(day);
          keep.add(Number(s.id));
        }
      }
      for (const s of snaps) {
        if (keep.has(Number(s.id))) continue;
        await c.batch([
          { sql: 'DELETE FROM pe_snapshots WHERE id = ?', args: [s.id] },
          { sql: 'DELETE FROM pe_snapshot_chunks WHERE snapshot_id = ?', args: [s.id] },
        ], 'write');
      }
      status.lastSnapshotAt = new Date(id).toISOString();
      status.error = null;
    } catch (err) {
      status.error = err.message;
      console.error('[turso] No se pudo crear la copia completa:', err.message);
      lastSnapshotAt = Date.now() - COMPACT_EVERY_MS + 60_000; // reintentar en ~1 min
      if (!status.lastSnapshotAt) throw err;
    } finally {
      compacting = null;
    }
  })();
  return compacting;
}

/** Al apagar: envía los cambios pendientes (máx. ~20 s). */
export async function flushMirror() {
  if (!session) return;
  clearInterval(timer);
  try {
    capture();
  } catch {
    /* ignorar */
  }
  const deadline = Date.now() + 20_000;
  while (queue.length && Date.now() < deadline) {
    await pump();
    if (queue.length) await new Promise((r) => setTimeout(r, 500));
  }
  session.close();
  session = null;
}

// ───────── Archivos ─────────

export async function storeFileRemote(storedName, filePath) {
  if (!mirrorEnabled()) return;
  const c = await getClient();
  const parts = chunksOf(fs.readFileSync(filePath));
  await c.execute({ sql: 'DELETE FROM pe_files WHERE stored_name = ?', args: [storedName] });
  for (let i = 0; i < parts.length; i++) {
    await c.execute({ sql: 'INSERT INTO pe_files (stored_name, idx, data) VALUES (?, ?, ?)', args: [storedName, i, parts[i]] });
  }
}

/** Descarga un archivo de Turso al disco local (caché). Devuelve false si no existe. */
export async function fetchFileRemote(storedName, destPath) {
  if (!mirrorEnabled()) return false;
  const c = await getClient();
  const rows = (await c.execute({ sql: 'SELECT data FROM pe_files WHERE stored_name = ? ORDER BY idx', args: [storedName] })).rows;
  if (!rows.length) return false;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.concat(rows.map((r) => toBuffer(r.data))));
  return true;
}

export async function deleteFileRemote(storedName) {
  if (!mirrorEnabled()) return;
  const c = await getClient();
  await c.execute({ sql: 'DELETE FROM pe_files WHERE stored_name = ?', args: [storedName] });
}

/** Solo para pruebas: cierra la conexión y reinicia el estado interno. */
export function resetMirrorForTests() {
  clearInterval(timer);
  session?.close();
  session = null;
  client?.close();
  client = null;
  queue = [];
  lastSeq = 0;
  database = null;
}
