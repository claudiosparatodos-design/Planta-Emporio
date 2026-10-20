import { getSetting } from './dbx.js';
import { config } from '../config.js';

export function workspaceInfo() {
  return {
    name: getSetting('workspace_name', 'Planta-Emporio'),
    currency: getSetting('currency', 'MXN'),
    locale: getSetting('locale', 'es-MX'),
    timezone: getSetting('timezone', 'America/Mexico_City'),
  };
}

export function publicUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const origin = req.get('origin');
  if (origin) return origin;
  return `${req.protocol}://${req.get('host')}`;
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del espacio. */
export function today(offsetDays = 0) {
  const tz = getSetting('timezone', 'America/Mexico_City');
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
