export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'El elemento') => new HttpError(404, `${what} no existe o no tienes acceso.`);

/** Envuelve un manejador síncrono/asíncrono y propaga errores a Express. */
export const handler = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

export const now = () => new Date().toISOString();

// ───────── Validación ligera ─────────

export function str(value, { field = 'Campo', max = 500, required = false, trim = true } = {}) {
  if (value === undefined) {
    if (required) throw new HttpError(400, `${field} es obligatorio.`);
    return undefined;
  }
  if (value === null) {
    if (required) throw new HttpError(400, `${field} es obligatorio.`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} no es válido.`);
  const v = trim ? value.trim() : value;
  if (required && !v) throw new HttpError(400, `${field} es obligatorio.`);
  if (v.length > max) throw new HttpError(400, `${field} es demasiado largo (máximo ${max} caracteres).`);
  return v;
}

export function oneOf(value, options, field = 'Valor') {
  if (value === undefined) return undefined;
  if (!options.includes(value)) throw new HttpError(400, `${field} no es válido.`);
  return value;
}

export function date(value, field = 'Fecha') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} no es una fecha válida.`);
  }
  return value;
}

export function datetime(value, field = 'Fecha y hora') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} no es válida.`);
  }
  return new Date(value).toISOString();
}

export function int(value, { field = 'Número', min = -Infinity, max = Infinity, nullable = true } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (!nullable) throw new HttpError(400, `${field} es obligatorio.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} no es válido.`);
  return n;
}

export function ids(value, field = 'Lista') {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `${field} no es válida.`);
  return [...new Set(value.map((v) => int(v, { field, min: 1, nullable: false })))];
}

export function bool(value) {
  if (value === undefined) return undefined;
  return value === true || value === 1 || value === 'true' || value === '1';
}

export function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}
