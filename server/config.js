import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  root,
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'planta.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  backupsDir: path.join(dataDir, 'backups'),
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  /** URL pública con la que se generan enlaces de invitación y recuperación (Render la define sola). */
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  /**
   * Respaldo continuo en Turso (base de datos SQLite gratuita en la nube). Necesario en alojamientos sin
   * disco permanente, como el plan gratuito de Render: cada cambio se copia y se restaura al arrancar.
   */
  turso: process.env.TURSO_DATABASE_URL ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN } : null,
  /** Alojamiento cuyo disco se borra (Render). Sin Turso, los datos se perderían: se avisa en la interfaz. */
  ephemeralHost: process.env.RENDER === 'true' || process.env.EPHEMERAL_DISK === 'true',
  /** Correo por API HTTPS de Brevo (plan gratuito); funciona aunque el alojamiento bloquee SMTP. */
  brevo: process.env.BREVO_API_KEY ? { apiKey: process.env.BREVO_API_KEY } : null,
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '',
  maxFileMb: Number(process.env.MAX_FILE_MB || 25),
  storageQuotaMb: Number(process.env.STORAGE_QUOTA_MB || 5120),
  sessionDays: 30,
  backupsToKeep: Number(process.env.BACKUPS_TO_KEEP || 14),
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
      }
    : null,
  disableScheduler: process.env.DISABLE_SCHEDULER === 'true',
};
