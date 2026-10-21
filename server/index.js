import { createApp } from './app.js';
import { openDatabase, rawDatabase } from './db/index.js';
import { config } from './config.js';
import { startScheduler } from './lib/scheduler.js';
import { flushMirror, mirrorEnabled, restoreFromMirror, startMirror } from './lib/mirror.js';
import { reindexAll } from './lib/search.js';

if (mirrorEnabled()) {
  const r = await restoreFromMirror(config.dbFile);
  console.log(`[turso] Datos restaurados (${r.fromSnapshot ? `copia + ${r.changes} cambios` : 'espacio nuevo'})`);
}
openDatabase();
if (mirrorEnabled()) {
  reindexAll();
  await startMirror(rawDatabase());
  console.log('[turso] Respaldo continuo activo');
} else if (config.ephemeralHost) {
  console.warn('[aviso] Este alojamiento borra el disco y TURSO_DATABASE_URL no está configurado: los datos NO son permanentes.');
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Planta-Emporio escuchando en http://localhost:${config.port}`);
});
if (!config.disableScheduler) startScheduler();

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    if (mirrorEnabled()) await flushMirror();
    process.exit(0);
  });
}
