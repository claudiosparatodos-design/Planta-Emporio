import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { config } from './config.js';
import { startScheduler } from './lib/scheduler.js';

openDatabase();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Planta-Emporio escuchando en http://localhost:${config.port}`);
});
if (!config.disableScheduler) startScheduler();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
