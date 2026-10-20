import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';

let currency = 'MXN';
export function setCurrency(c) {
  currency = c || 'MXN';
}
export const getCurrency = () => currency;

export function money(cents, { sign = false, compact = false } = {}) {
  if (cents === null || cents === undefined) return '—';
  const v = cents / 100;
  const f = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    notation: compact && Math.abs(v) >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: compact && Math.abs(v) >= 1000 ? 0 : 2,
  }).format(Math.abs(v));
  if (sign && cents > 0) return `+${f}`;
  if (cents < 0) return `−${f}`;
  return f;
}

/** Convierte texto como "1,250.50" a centavos enteros; devuelve null si no es válido. */
export function parseMoney(text) {
  if (text === null || text === undefined) return null;
  const clean = String(text).replace(/[\s$,]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [i, d = ''] = clean.split('.');
  return Number(i) * 100 + Number(d.padEnd(2, '0'));
}

export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2));

const toDate = (v) => (v instanceof Date ? v : v.length === 10 ? parseISO(`${v}T12:00:00`) : parseISO(v));

export function fmtDate(v, pattern = "d 'de' MMM") {
  if (!v) return '';
  return format(toDate(v), pattern, { locale: es });
}

/** Primera letra en mayúscula (sin afectar «de», como en español). */
export const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtDateTime(v) {
  if (!v) return '';
  return format(toDate(v), "d MMM yyyy, HH:mm", { locale: es });
}

export function fmtTime(v) {
  if (!v) return '';
  return format(toDate(v), 'HH:mm', { locale: es });
}

/** "hoy", "mañana", "ayer", "en 3 días", "hace 2 días" o fecha corta. */
export function relativeDay(v) {
  if (!v) return '';
  const d = toDate(v);
  if (isToday(d)) return 'Hoy';
  if (isTomorrow(d)) return 'Mañana';
  if (isYesterday(d)) return 'Ayer';
  const diff = differenceInCalendarDays(d, new Date());
  if (diff > 1 && diff < 7) return format(d, 'EEEE', { locale: es }).replace(/^./, (c) => c.toUpperCase());
  return format(d, d.getFullYear() === new Date().getFullYear() ? "d 'de' MMM" : "d MMM yyyy", { locale: es });
}

export function timeAgo(v) {
  if (!v) return '';
  const d = toDate(v);
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 45) return 'hace un momento';
  return `hace ${formatDistanceToNowStrict(d, { locale: es })}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso, n) {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function dueState(task) {
  if (!task.due_date || task.status === 'done') return null;
  const t = todayIso();
  if (task.due_date < t) return 'overdue';
  if (task.due_date === t) return 'today';
  if (task.due_date <= addDaysIso(t, 2)) return 'soon';
  return null;
}

export function fileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function minutes(m) {
  if (!m) return '0 min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
