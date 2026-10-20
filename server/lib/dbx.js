// Atajo para importar la base de datos y utilidades comunes desde las rutas.
export { db, transaction, getSetting, setSetting, backupTo } from '../db/index.js';
export { now } from './http.js';
