// Cliente HTTP de la API. Todas las peticiones llevan la cabecera de la aplicación (defensa CSRF).

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-PE-Client': '1',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, form) => request('POST', url, form),
};

/** Construye una query string ignorando valores vacíos. */
export function qs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`).join('&');
}

/** Sube archivos con progreso (XHR) — útil para archivos grandes. */
export function uploadFiles(files, extra = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) form.append(k, String(v));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('X-PE-Client', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* vacío */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || 'No se pudo subir el archivo.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Se perdió la conexión durante la subida.'));
    xhr.send(form);
  });
}

/** Borra las preferencias cosméticas guardadas en este navegador (tema, carpetas abiertas…). */
export function clearLocalData() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('pe:')).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
}

export const fileUrl = (id, download = false) => `/api/files/${id}/raw${download ? '?download=1' : ''}`;
