// Utilidades de prueba: levanta la API real con una base de datos temporal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planta-test-'));
  process.env.DATA_DIR = dir;
  process.env.DISABLE_SCHEDULER = 'true';
  process.env.RATE_LIMIT_AUTH = '10000';
  const { openDatabase, closeDatabase } = await import('../../server/db/index.js');
  const { createApp } = await import('../../server/app.js');
  openDatabase();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dir,
    client: () => new Client(base),
    async stop() {
      const { closeAll } = await import('../../server/lib/events.js');
      closeAll();
      await new Promise((r) => server.close(r));
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async request(method, url, body, { raw = false, headers = {} } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(this.base + url, {
      method,
      headers: {
        ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-PE-Client': '1',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    if (raw) return res;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  get(url) {
    return this.request('GET', url);
  }
  post(url, body = {}) {
    return this.request('POST', url, body);
  }
  patch(url, body = {}) {
    return this.request('PATCH', url, body);
  }
  del(url) {
    return this.request('DELETE', url);
  }

  /** Igual que request pero falla la prueba si el estado no es el esperado. */
  async ok(method, url, body, expected = [200, 201]) {
    const r = await this.request(method, url, body);
    if (!expected.includes(r.status)) {
      throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.data)}`);
    }
    return r.data;
  }
}

/** Crea el espacio con un administrador y devuelve su cliente. */
export async function setupWorkspace(srv) {
  const admin = srv.client();
  await admin.ok('POST', '/api/auth/setup', {
    workspaceName: 'Planta-Emporio (prueba)',
    name: 'Ana Admin',
    email: 'ana@example.test',
    password: 'contrasena-segura-1',
  });
  return admin;
}

/** Invita y registra a un integrante con el rol indicado. */
export async function addMember(srv, admin, { name, email, role = 'Integrante' }) {
  const roles = await admin.ok('GET', '/api/members/roles');
  const roleId = roles.find((r) => r.name === role).id;
  const inv = await admin.ok('POST', '/api/members/invitations', { email, name, role_id: roleId });
  const token = inv.link.split('/invite/')[1];
  const c = srv.client();
  const res = await c.ok('POST', `/api/auth/invite/${token}`, { name, password: 'contrasena-segura-2' });
  c.user = res.user;
  return c;
}
