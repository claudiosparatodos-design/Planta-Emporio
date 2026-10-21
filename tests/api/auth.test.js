import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupWorkspace, addMember } from './helpers.js';

let srv;
let admin;
before(async () => {
  srv = await startServer();
});
after(async () => srv.stop());

test('el primer arranque pide configuración y crea la cuenta de administración', async () => {
  const anon = srv.client();
  const status = await anon.ok('GET', '/api/auth/status');
  assert.equal(status.setupRequired, true);
  assert.equal(status.user, null);

  admin = await setupWorkspace(srv);
  const me = await admin.ok('GET', '/api/auth/me');
  assert.equal(me.user.email, 'ana@example.test');
  assert.equal(me.user.is_admin, true);
  assert.ok(me.user.permissions.includes('settings.manage'));

  // No se puede volver a configurar.
  const again = await srv.client().post('/api/auth/setup', { name: 'X', email: 'x@example.test', password: '12345678' });
  assert.equal(again.status, 409);
});

test('sin sesión no se accede a la información', async () => {
  const anon = srv.client();
  for (const url of ['/api/projects', '/api/tasks', '/api/finance/summary', '/api/pages', '/api/files/1/raw', '/api/chat/channels']) {
    const r = await anon.get(url);
    assert.equal(r.status, 401, url);
  }
});

test('las mutaciones sin la cabecera de la aplicación se rechazan (CSRF)', async () => {
  const r = await admin.request('POST', '/api/tasks', { title: 'x' }, { headers: { 'X-PE-Client': '0' } });
  assert.equal(r.status, 403);
});

test('inicio de sesión: credenciales incorrectas, correctas y cierre', async () => {
  const c = srv.client();
  const bad = await c.post('/api/auth/login', { email: 'ana@example.test', password: 'incorrecta' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/api/auth/login', { email: 'ANA@example.test', password: 'contrasena-segura-1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('invitación: enlace de un solo uso que crea la cuenta con el rol elegido', async () => {
  const roles = await admin.ok('GET', '/api/members/roles');
  const memberRole = roles.find((r) => r.name === 'Integrante');
  const inv = await admin.ok('POST', '/api/members/invitations', { email: 'beto@example.test', name: 'Beto', role_id: memberRole.id });
  assert.equal(inv.emailSent, false, 'sin SMTP no se simula el envío');
  const token = inv.link.split('/invite/')[1];

  const anon = srv.client();
  const info = await anon.ok('GET', `/api/auth/invite/${token}`);
  assert.equal(info.email, 'beto@example.test');
  assert.equal(info.role, 'Integrante');

  const weak = await anon.post(`/api/auth/invite/${token}`, { name: 'Beto', password: '123' });
  assert.equal(weak.status, 400);

  const created = await anon.ok('POST', `/api/auth/invite/${token}`, { name: 'Beto Integrante', password: 'otra-contrasena-1' });
  assert.equal(created.user.role_name, 'Integrante');
  assert.equal(created.user.permissions.includes('finance.view'), false);

  const reuse = await srv.client().post(`/api/auth/invite/${token}`, { name: 'Otro', password: 'otra-contrasena-1' });
  assert.equal(reuse.status, 410);
  const bogus = await srv.client().get('/api/auth/invite/token-inventado');
  assert.equal(bogus.status, 410);
});

test('un integrante no puede invitar ni cambiar roles', async () => {
  const beto = srv.client();
  await beto.ok('POST', '/api/auth/login', { email: 'beto@example.test', password: 'otra-contrasena-1' });
  const roles = await beto.ok('GET', '/api/members/roles');
  const r = await beto.post('/api/members/invitations', { email: 'z@example.test', role_id: roles[0].id });
  assert.equal(r.status, 403);
  const me = await beto.ok('GET', '/api/auth/me');
  const r2 = await beto.patch(`/api/members/${me.user.id}`, { role_id: roles[0].id });
  assert.equal(r2.status, 403);
});

test('recuperación de acceso con enlace generado por administración', async () => {
  const members = await admin.ok('GET', '/api/members');
  const beto = members.find((m) => m.email === 'beto@example.test');
  const forgot = await srv.client().ok('POST', '/api/auth/forgot', { email: 'beto@example.test' });
  assert.equal(forgot.mailConfigured, false);

  const { link } = await admin.ok('POST', `/api/members/${beto.id}/reset-link`);
  const token = link.split('/reset/')[1];
  const c = srv.client();
  assert.equal((await c.ok('GET', `/api/auth/reset/${token}`)).email, 'beto@example.test');
  await c.ok('POST', `/api/auth/reset/${token}`, { password: 'nueva-contrasena-9' });
  assert.equal((await c.post(`/api/auth/reset/${token}`, { password: 'nueva-contrasena-9' })).status, 410);
  const login = await srv.client().post('/api/auth/login', { email: 'beto@example.test', password: 'nueva-contrasena-9' });
  assert.equal(login.status, 200);
});

test('desactivar a un integrante cierra su acceso; no se puede quedar sin administradores', async () => {
  const carla = await addMember(srv, admin, { name: 'Carla', email: 'carla@example.test' });
  assert.equal((await carla.get('/api/auth/me')).status, 200);
  await admin.ok('PATCH', `/api/members/${carla.user.id}`, { status: 'disabled' });
  assert.equal((await carla.get('/api/auth/me')).status, 401);
  const login = await srv.client().post('/api/auth/login', { email: 'carla@example.test', password: 'contrasena-segura-2' });
  assert.equal(login.status, 403);

  const me = await admin.ok('GET', '/api/auth/me');
  const self = await admin.patch(`/api/members/${me.user.id}`, { status: 'disabled' });
  assert.equal(self.status, 400);
  const roles = await admin.ok('GET', '/api/members/roles');
  const demote = await admin.patch(`/api/members/${me.user.id}`, { role_id: roles.find((r) => r.name === 'Socio').id });
  assert.equal(demote.status, 400, 'debe quedar al menos un administrador');
});

test('cambio de contraseña requiere la actual', async () => {
  const bad = await admin.post('/api/auth/change-password', { current: 'mala', next: 'otra-buena-123' });
  assert.equal(bad.status, 400);
  await admin.ok('POST', '/api/auth/change-password', { current: 'contrasena-segura-1', next: 'otra-buena-123' });
  const login = await srv.client().post('/api/auth/login', { email: 'ana@example.test', password: 'otra-buena-123' });
  assert.equal(login.status, 200);
});

test('sesión sin "recordar": cookie de navegador y caducidad corta; cerrar todas las sesiones', async () => {
  const c = srv.client();
  const res = await c.request('POST', '/api/auth/login', { email: 'ana@example.test', password: 'otra-buena-123' }, { raw: true });
  const cookieHeader = res.headers.get('set-cookie');
  assert.ok(!/expires=/i.test(cookieHeader), 'sin recordar: la cookie se borra al cerrar el navegador');
  c.cookie = cookieHeader.split(';')[0];
  const r2 = await srv.client().request('POST', '/api/auth/login', { email: 'ana@example.test', password: 'otra-buena-123', remember: true }, { raw: true });
  assert.match(r2.headers.get('set-cookie'), /expires=/i, 'con recordar: cookie persistente');
  const other = srv.client();
  await other.ok('POST', '/api/auth/login', { email: 'ana@example.test', password: 'otra-buena-123' });
  const out = await c.ok('POST', '/api/auth/logout-all');
  assert.ok(out.closed >= 2);
  assert.equal((await other.get('/api/auth/me')).status, 401, 'las demás sesiones también se cerraron');
});
