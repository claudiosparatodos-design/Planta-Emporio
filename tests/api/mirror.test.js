// Respaldo continuo en Turso: simula un alojamiento gratuito cuyo disco se borra al dormir/reiniciar.
// "Turso" se simula con una base libSQL en un archivo local (mismo cliente y mismas consultas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planta-mirror-'));
const dataDir = path.join(dir, 'data');
process.env.DATA_DIR = dataDir;
process.env.DISABLE_SCHEDULER = 'true';
process.env.RATE_LIMIT_AUTH = '10000';
process.env.TURSO_DATABASE_URL = `file:${path.join(dir, 'turso-remoto.db')}`;

const { openDatabase, closeDatabase, rawDatabase } = await import('../../server/db/index.js');
const { createApp } = await import('../../server/app.js');
const { config } = await import('../../server/config.js');
const mirror = await import('../../server/lib/mirror.js');
const { reindexAll } = await import('../../server/lib/search.js');

let server;
let base;

/** Arranque igual que server/index.js con Turso activo. */
async function boot() {
  const restored = await mirror.restoreFromMirror(config.dbFile);
  openDatabase();
  reindexAll();
  await mirror.startMirror(rawDatabase());
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  return restored;
}

/** Apagado como en Render (SIGTERM) y borrado total del disco local. */
async function shutdownAndWipeDisk() {
  await mirror.flushMirror();
  await new Promise((r) => server.close(r));
  closeDatabase();
  mirror.resetMirrorForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const client = () => {
  const c = new Client(base);
  return c;
};

let admin;
let cookie;
let ids = {};

before(async () => {
  const r = await boot();
  assert.equal(r.fromSnapshot, false, 'primer arranque: espacio nuevo');
});
after(async () => {
  await mirror.flushMirror();
  await new Promise((r) => server.close(r));
  closeDatabase();
  mirror.resetMirrorForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('se crean datos y se envían a Turso', async () => {
  admin = client();
  await admin.ok('POST', '/api/auth/setup', { name: 'Ana', email: 'ana@example.test', password: 'contrasena-1234' });
  cookie = admin.cookie;
  const project = await admin.ok('POST', '/api/projects', { name: 'Proyecto persistente' });
  const task = await admin.ok('POST', '/api/tasks', { title: 'Tarea con palabra zanahoria', project_id: project.id });
  const page = await admin.ok('POST', '/api/pages', { title: 'Documento', content: [{ type: 'paragraph', content: 'Texto con aguacate' }] });
  const form = new FormData();
  form.append('files', new Blob(['contenido del archivo'], { type: 'text/plain' }), 'nota.txt');
  const [file] = await admin.ok('POST', '/api/files', form);
  const meta = await admin.ok('GET', '/api/finance/meta');
  await admin.ok('POST', '/api/finance/transactions', { kind: 'income', concept: 'Venta de prueba', amount: '123.45', account_id: meta.accounts[0].id });
  ids = { project: project.id, task: task.id, page: page.id, file: file.id };
  const settings = await admin.ok('GET', '/api/settings');
  assert.equal(settings.storage.mode, 'turso');
});

test('tras borrar el disco, todo se restaura desde Turso (datos, sesión, búsqueda y archivos)', async () => {
  await shutdownAndWipeDisk();
  assert.equal(fs.existsSync(config.dbFile), false, 'el disco local quedó vacío');
  const r = await boot();
  assert.equal(r.fromSnapshot, true);
  const c = client();
  c.cookie = cookie; // la misma sesión sigue siendo válida
  assert.equal((await c.ok('GET', '/api/auth/me')).user.email, 'ana@example.test');
  assert.equal((await c.ok('GET', `/api/projects/${ids.project}`)).name, 'Proyecto persistente');
  assert.equal((await c.ok('GET', `/api/tasks/${ids.task}`)).title, 'Tarea con palabra zanahoria');
  const page = await c.ok('GET', `/api/pages/${ids.page}`);
  assert.equal(page.content[0].content, 'Texto con aguacate');
  const search = await c.ok('GET', '/api/search?q=zanahoria');
  assert.ok(search.groups.some((g) => g.type === 'task'), 'el índice de búsqueda se reconstruyó');
  const raw = await c.request('GET', `/api/files/${ids.file}/raw`, undefined, { raw: true });
  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), 'contenido del archivo');
  const summary = await c.ok('GET', '/api/finance/summary');
  assert.equal(summary.income_cents, 12345);
  admin = c;
});

test('los cambios posteriores a la última copia también se conservan', async () => {
  // Estos cambios quedan solo en el registro de cambios (no en la copia completa).
  await admin.ok('PATCH', `/api/tasks/${ids.task}`, { status: 'done' });
  await admin.ok('POST', '/api/tasks', { title: 'Tarea creada después de la copia' });
  await shutdownAndWipeDisk();
  const r = await boot();
  assert.ok(r.changes >= 1, 'se aplicaron cambios sobre la copia');
  const c = client();
  c.cookie = cookie;
  assert.equal((await c.ok('GET', `/api/tasks/${ids.task}`)).status, 'done');
  const all = await c.ok('GET', '/api/tasks?q=después');
  assert.equal(all.length, 1);
});
