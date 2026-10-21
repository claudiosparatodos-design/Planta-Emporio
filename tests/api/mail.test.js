// Correo por la API HTTPS de Brevo (plan gratuito). Se intercepta la llamada: no se envía nada real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.BREVO_API_KEY = 'clave-de-prueba';
process.env.MAIL_FROM = 'equipo@example.test';
const { startServer, setupWorkspace } = await import('./helpers.js');

const sent = [];
let brevoStatus = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.brevo.com/')) {
    sent.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(brevoStatus < 300 ? '{"messageId":"x"}' : '{"message":"Key not found"}', { status: brevoStatus });
  }
  return realFetch(url, opts);
};

let srv;
let admin;
before(async () => {
  srv = await startServer();
  admin = await setupWorkspace(srv);
});
after(async () => {
  globalThis.fetch = realFetch;
  await srv.stop();
});

test('la invitación se envía por correo con Brevo', async () => {
  const status = await srv.client().ok('GET', '/api/auth/status');
  assert.equal(status.mailConfigured, true);
  const roles = await admin.ok('GET', '/api/members/roles');
  const inv = await admin.ok('POST', '/api/members/invitations', { email: 'beto@example.test', role_id: roles[2].id });
  assert.equal(inv.emailSent, true);
  const mail = sent.at(-1);
  assert.equal(mail.headers['api-key'], 'clave-de-prueba');
  assert.deepEqual(mail.body.to, [{ email: 'beto@example.test' }]);
  assert.equal(mail.body.sender.email, 'equipo@example.test');
  assert.ok(mail.body.textContent.includes(inv.link), 'el correo incluye el enlace de invitación');
});

test('recuperar contraseña envía un enlace válido por correo', async () => {
  const r = await srv.client().ok('POST', '/api/auth/forgot', { email: 'ana@example.test' });
  assert.equal(r.mailConfigured, true);
  const link = sent.at(-1).body.textContent.match(/\/reset\/([\w-]+)/)[1];
  const info = await srv.client().ok('GET', `/api/auth/reset/${link}`);
  assert.equal(info.email, 'ana@example.test');
  // Un correo no registrado recibe la misma respuesta y no se envía nada.
  const before = sent.length;
  await srv.client().ok('POST', '/api/auth/forgot', { email: 'nadie@example.test' });
  assert.equal(sent.length, before);
});

test('correo de prueba y error del proveedor sin simular envíos', async () => {
  const ok = await admin.ok('POST', '/api/settings/test-email');
  assert.equal(ok.to, 'ana@example.test');
  brevoStatus = 401;
  const fail = await admin.post('/api/settings/test-email');
  assert.equal(fail.status, 502);
  const roles = await admin.ok('GET', '/api/members/roles');
  const inv = await admin.ok('POST', '/api/members/invitations', { email: 'carla@example.test', role_id: roles[2].id });
  assert.equal(inv.emailSent, false, 'si el proveedor falla, se informa y se comparte el enlace');
  assert.ok(inv.link);
});
