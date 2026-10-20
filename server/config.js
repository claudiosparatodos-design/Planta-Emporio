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
  /** URL pública con la que se generan enlaces de invitación y recuperación. */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
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
