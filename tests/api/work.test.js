import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupWorkspace, addMember } from './helpers.js';

let srv, admin, member, socio;
let project;

before(async () => {
  srv = await startServer();
  admin = await setupWorkspace(srv);
  member = await addMember(srv, admin, { name: 'Iván Integrante', email: 'ivan@example.test' });
  socio = await addMember(srv, admin, { name: 'Sofía Socia', email: 'sofia@example.test', role: 'Socio' });
});
after(async () => srv.stop());

test('crear proyecto desde plantilla genera columnas, tareas y su canal', async () => {
  const templates = await admin.ok('GET', '/api/templates');
  const tpl = templates.find((t) => t.name === 'Lanzamiento de producto');
  const { id } = await admin.ok('POST', '/api/projects', { name: 'Línea de macetas', template_id: tpl.id, member_ids: [member.user.id], due_date: '2026-12-15' });
  project = await admin.ok('GET', `/api/projects/${id}`);
  assert.deepEqual(project.columns.map((c) => c.name), ['Ideas', 'Por hacer', 'En progreso', 'En revisión', 'Bloqueado', 'Terminado']);
  assert.equal(project.stats.total, tpl.task_count);
  assert.ok(project.channel_id);
  assert.ok(project.member_ids.includes(member.user.id));
  const notes = await member.ok('GET', '/api/notifications');
  assert.ok(notes.items.some((n) => n.type === 'project'), 'el integrante recibe aviso');
});

test('crear tarea solo con título y sincronizar estado ↔ columna', async () => {
  const t = await member.ok('POST', '/api/tasks', { title: 'Cotizar macetas de barro', project_id: project.id });
  assert.equal(t.status, 'todo');
  const todoCol = project.columns.find((c) => c.category === 'todo');
  assert.equal(t.column_id, todoCol.id);

  const inProgress = project.columns.find((c) => c.category === 'in_progress');
  const moved = await member.ok('PATCH', `/api/tasks/${t.id}`, { column_id: inProgress.id });
  assert.equal(moved.status, 'in_progress');

  const review = await member.ok('PATCH', `/api/tasks/${t.id}`, { status: 'review' });
  assert.equal(review.column_id, project.columns.find((c) => c.category === 'review').id);

  const done = await member.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done' });
  assert.ok(done.completed_at);
  const reopened = await member.ok('PATCH', `/api/tasks/${t.id}`, { status: 'todo' });
  assert.equal(reopened.completed_at, null);

  // La misma tarea aparece igual en lista, tablero (por proyecto) y calendario.
  await member.ok('PATCH', `/api/tasks/${t.id}`, { due_date: '2026-11-20' });
  const list = await admin.ok('GET', `/api/tasks?project_id=${project.id}`);
  assert.equal(list.find((x) => x.id === t.id).due_date, '2026-11-20');
  const cal = await admin.ok('GET', '/api/calendar?from=2026-11-01&to=2026-11-30');
  assert.ok(cal.tasks.some((x) => x.id === t.id));

  const history = await admin.ok('GET', `/api/tasks/${t.id}/history`);
  assert.ok(history.some((h) => h.action === 'completed'));
  assert.ok(history.some((h) => h.action === 'updated' && h.data.due_date));
});

test('asignar requiere permiso y notifica a la persona asignada', async () => {
  const roleless = await admin.ok('POST', '/api/members/roles', { name: 'Solo lectura', permissions: [] });
  assert.ok(roleless.id);
  const viewer = await addMember(srv, admin, { name: 'Vera Lectora', email: 'vera@example.test', role: 'Solo lectura' });
  const forbidden = await viewer.post('/api/tasks', { title: 'x', assignee_ids: [member.user.id] });
  assert.equal(forbidden.status, 403);
  const self = await viewer.post('/api/tasks', { title: 'Mi tarea', assignee_ids: [viewer.user.id] });
  assert.equal(self.status, 201, 'cualquiera puede asignarse a sí mismo');

  const t = await admin.ok('POST', '/api/tasks', { title: 'Diseñar etiqueta', project_id: project.id, assignee_ids: [member.user.id], priority: 'high' });
  const notes = await member.ok('GET', '/api/notifications?unread=1');
  assert.ok(notes.items.some((n) => n.type === 'assigned' && n.entity_id === t.id));
  const dash = await member.ok('GET', '/api/dashboard/me');
  assert.ok(dash.my_tasks.some((x) => x.id === t.id));
});

test('automatización: al bloquearse una tarea se avisa al responsable del proyecto', async () => {
  const t = await member.ok('POST', '/api/tasks', { title: 'Conseguir proveedor', project_id: project.id, assignee_ids: [member.user.id] });
  await member.ok('PATCH', `/api/tasks/${t.id}`, { status: 'blocked' });
  const notes = await admin.ok('GET', '/api/notifications');
  assert.ok(notes.items.some((n) => n.type === 'task_status' && n.entity_id === t.id && /Bloqueado/.test(n.title)));
  const dash = await admin.ok('GET', '/api/dashboard/me');
  assert.ok(dash.attention.blocked.some((x) => x.id === t.id));

  // Se puede desactivar.
  const rules = await admin.ok('GET', '/api/automations');
  const rule = rules.rules.find((r) => r.conditions.to === 'blocked');
  await admin.ok('PATCH', `/api/automations/${rule.id}`, { enabled: false });
  const before = (await admin.ok('GET', '/api/notifications')).items.length;
  const t2 = await member.ok('POST', '/api/tasks', { title: 'Otra', project_id: project.id });
  await member.ok('PATCH', `/api/tasks/${t2.id}`, { status: 'blocked' });
  assert.equal((await admin.ok('GET', '/api/notifications')).items.length, before);
  assert.equal((await member.patch(`/api/automations/${rule.id}`, { enabled: true })).status, 403);
});

test('tareas recurrentes generan la siguiente ocurrencia al completarse', async () => {
  const t = await admin.ok('POST', '/api/tasks', { title: 'Pagar internet', recurrence: { freq: 'monthly', interval: 1 }, due_date: '2099-01-31', assignee_ids: [member.user.id] });
  await admin.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done' });
  const all = await admin.ok('GET', '/api/tasks?q=Pagar%20internet&include_done=1');
  const next = all.find((x) => x.recurrence_source_id === t.id);
  assert.ok(next, 'existe la siguiente');
  assert.equal(next.due_date, '2099-02-28', 'respeta fin de mes');
  assert.deepEqual(next.assignee_ids, [member.user.id]);
  // Completar otra vez la original no duplica.
  await admin.ok('PATCH', `/api/tasks/${t.id}`, { status: 'todo' });
  await admin.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done' });
  const again = await admin.ok('GET', '/api/tasks?q=Pagar%20internet&include_done=1');
  assert.equal(again.filter((x) => x.recurrence_source_id === t.id).length, 1);
});

test('subtareas, checklist, dependencias sin ciclos y enlaces', async () => {
  const a = await admin.ok('POST', '/api/tasks', { title: 'A', project_id: project.id });
  const b = await admin.ok('POST', '/api/tasks', { title: 'B', project_id: project.id });
  const sub = await admin.ok('POST', '/api/tasks', { title: 'A.1', parent_id: a.id });
  assert.equal(sub.project_id, project.id);
  await admin.ok('POST', `/api/tasks/${a.id}/checklist`, { text: 'Paso 1' });
  await admin.ok('POST', `/api/tasks/${b.id}/dependencies`, { depends_on_id: a.id });
  const cycle = await admin.post(`/api/tasks/${a.id}/dependencies`, { depends_on_id: b.id });
  assert.equal(cycle.status, 400);
  const link = await admin.post(`/api/tasks/${a.id}/links`, { url: 'javascript:alert(1)' });
  assert.equal(link.status, 400, 'solo enlaces http(s)');
  await admin.ok('POST', `/api/tasks/${a.id}/links`, { url: 'https://example.com/cotizacion' });
  const detail = await admin.ok('GET', `/api/tasks/${a.id}`);
  assert.equal(detail.subtasks.length, 1);
  assert.equal(detail.checklist.length, 1);
  assert.equal(detail.blocking_tasks[0].id, b.id);
  assert.equal(detail.links.length, 1);
  const bDetail = await admin.ok('GET', `/api/tasks/${b.id}`);
  assert.equal(bDetail.open_dependencies, 1);
});

test('papelera: eliminar y restaurar una tarea', async () => {
  const t = await member.ok('POST', '/api/tasks', { title: 'Tarea temporal', project_id: project.id });
  const otro = await addMember(srv, admin, { name: 'Olga Otra', email: 'olga@example.test' });
  assert.equal((await otro.del(`/api/tasks/${t.id}`)).status, 403, 'otro integrante sin permisos no la elimina');
  await member.ok('DELETE', `/api/tasks/${t.id}`);
  assert.equal((await member.get(`/api/tasks/${t.id}`)).status, 404);
  const trash = await member.ok('GET', '/api/trash');
  assert.ok(trash.items.some((i) => i.type === 'task' && i.id === t.id));
  await member.ok('POST', '/api/trash/restore', { type: 'task', id: t.id });
  assert.equal((await member.get(`/api/tasks/${t.id}`)).status, 200);
});

test('proyectos privados: solo sus integrantes los ven (y su chat, tareas y búsqueda)', async () => {
  const { id } = await socio.ok('POST', '/api/projects', { name: 'Negociación confidencial', visibility: 'members' });
  const t = await socio.ok('POST', '/api/tasks', { title: 'Oferta secreta zafiro', project_id: id });
  assert.equal((await member.get(`/api/projects/${id}`)).status, 404);
  assert.equal((await member.get(`/api/tasks/${t.id}`)).status, 404);
  assert.ok(!(await member.ok('GET', '/api/projects')).some((p) => p.id === id));
  const search = await member.ok('GET', '/api/search?q=zafiro');
  assert.equal(search.groups.length, 0);
  const channels = await member.ok('GET', '/api/chat/channels');
  assert.ok(!channels.some((c) => c.project_id === id));
  // El administrador (gestiona proyectos) sí lo ve.
  assert.equal((await admin.get(`/api/projects/${id}`)).status, 200);
  // Al agregarlo como integrante, ya puede verlo.
  await socio.ok('PATCH', `/api/projects/${id}`, { member_ids: [socio.user.id, member.user.id] });
  assert.equal((await member.get(`/api/tasks/${t.id}`)).status, 200);
});

test('documentos: jerarquía, conflicto de edición, versiones y vínculo con proyecto', async () => {
  const parent = await admin.ok('POST', '/api/pages', { title: 'Manual de operación', project_id: project.id });
  const child = await admin.ok('POST', '/api/pages', { title: 'Empaque', parent_id: parent.id });
  assert.equal(child.project_id, project.id, 'hereda el proyecto');
  const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Usar caja reciclada esmeralda', styles: {} }] }];
  const saved = await admin.ok('PATCH', `/api/pages/${child.id}`, { content, base_version: child.version });
  assert.equal(saved.version, 2);
  // Otra persona guarda con una versión vieja → conflicto, no sobrescribe.
  const conflict = await member.patch(`/api/pages/${child.id}`, { content: [], base_version: 1 });
  assert.equal(conflict.status, 409);
  const page = await admin.ok('GET', `/api/pages/${child.id}`);
  assert.equal(page.content[0].content[0].text, 'Usar caja reciclada esmeralda');
  assert.equal(page.breadcrumbs[0].id, parent.id);
  // Ciclo en jerarquía
  assert.equal((await admin.patch(`/api/pages/${parent.id}`, { parent_id: child.id })).status, 400);
  // Búsqueda por contenido (sin acentos)
  const s = await member.ok('GET', '/api/search?q=esmeralda');
  assert.ok(s.groups.find((g) => g.type === 'page').items.some((i) => i.id === child.id));
  const s2 = await member.ok('GET', '/api/search?q=operacion');
  assert.ok(s2.groups.find((g) => g.type === 'page'), 'ignora acentos');
  // Aparece en el proyecto
  const p = await admin.ok('GET', `/api/projects/${project.id}`);
  assert.ok(p.pages.some((x) => x.id === child.id));
  // Versiones restaurables
  await admin.ok('PATCH', `/api/pages/${child.id}`, { content: [{ type: 'paragraph', content: 'Nueva versión' }], base_version: 2 });
  const versions = await admin.ok('GET', `/api/pages/${child.id}/versions`);
  assert.ok(versions.length >= 1);
  await admin.ok('POST', `/api/pages/${child.id}/versions/${versions[0].id}/restore`);
  const restored = await admin.ok('GET', `/api/pages/${child.id}`);
  assert.equal(restored.content[0].content[0].text, 'Usar caja reciclada esmeralda');
  // Vínculo con una tarea
  const task = await admin.ok('POST', '/api/tasks', { title: 'Revisar manual', project_id: project.id });
  await admin.ok('POST', '/api/links', { a_type: 'page', a_id: child.id, b_type: 'task', b_id: task.id });
  const td = await admin.ok('GET', `/api/tasks/${task.id}`);
  assert.ok(td.related.some((r) => r.type === 'page' && r.id === child.id));
  // Eliminar la página superior manda también las subpáginas a la papelera
  const del = await admin.ok('DELETE', `/api/pages/${parent.id}`);
  assert.equal(del.count, 2);
  await admin.ok('POST', '/api/trash/restore', { type: 'page', id: parent.id });
  assert.equal((await admin.get(`/api/pages/${child.id}`)).status, 200);
});

test('páginas privadas no son visibles para otros', async () => {
  const p = await member.ok('POST', '/api/pages', { title: 'Mis notas personales', visibility: 'private' });
  assert.equal((await admin.get(`/api/pages/${p.id}`)).status, 404);
  assert.ok(!(await admin.ok('GET', '/api/pages')).some((x) => x.id === p.id));
});

test('plantilla de documento crea una página con su estructura', async () => {
  const templates = await admin.ok('GET', '/api/pages?templates=1');
  const tpl = templates.find((t) => t.title === 'Notas de reunión');
  const page = await admin.ok('POST', '/api/pages', { template_id: tpl.id, title: 'Reunión de socios' });
  const full = await admin.ok('GET', `/api/pages/${page.id}`);
  assert.ok(full.content.length > 5);
  assert.equal(full.title, 'Reunión de socios');
});

test('chat: mensajes persistentes, respuestas, menciones, no leídos y mensajes directos privados', async () => {
  const channels = await admin.ok('GET', '/api/chat/channels');
  const general = channels.find((c) => c.kind === 'general');
  const m1 = await admin.ok('POST', `/api/chat/channels/${general.id}/messages`, { body: 'Hola equipo, @Iván revisa la cotización' });
  const reply = await member.ok('POST', `/api/chat/channels/${general.id}/messages`, { body: 'Claro, la reviso hoy', reply_to_id: m1.id });
  assert.equal(reply.reply_to.id, m1.id);
  const notes = await member.ok('GET', '/api/notifications');
  assert.ok(notes.items.some((n) => n.type === 'mention' && n.entity_id === m1.id));
  const socioChannels = await socio.ok('GET', '/api/chat/channels');
  assert.equal(socioChannels.find((c) => c.id === general.id).unread, 2);
  await socio.ok('POST', `/api/chat/channels/${general.id}/read`, {});
  assert.equal((await socio.ok('GET', '/api/chat/channels')).find((c) => c.id === general.id).unread, 0);
  const msgs = await socio.ok('GET', `/api/chat/channels/${general.id}/messages`);
  assert.equal(msgs.messages.length, 2);

  const dm = await admin.ok('POST', '/api/chat/dm', { user_id: member.user.id });
  await admin.ok('POST', `/api/chat/channels/${dm.id}/messages`, { body: 'Mensaje privado con turquesa' });
  assert.equal((await socio.get(`/api/chat/channels/${dm.id}/messages`)).status, 404);
  const found = await socio.ok('GET', '/api/chat/search?q=turquesa');
  assert.equal(found.length, 0, 'la búsqueda no expone mensajes privados');
  assert.equal((await member.ok('GET', '/api/chat/search?q=turquesa')).length, 1);
  const again = await member.ok('POST', '/api/chat/dm', { user_id: admin.user?.id || (await admin.ok('GET', '/api/auth/me')).user.id });
  assert.equal(again.id, dm.id, 'misma conversación directa');
  assert.equal((await socio.patch(`/api/chat/messages/${m1.id}`, { body: 'x' })).status, 403);
});

test('reuniones: acuerdos como tareas y decisiones con aprobación explícita', async () => {
  const { id } = await admin.ok('POST', '/api/meetings', {
    title: 'Reunión mensual', starts_at: '2026-11-03T18:00:00.000Z', participant_ids: [member.user.id, socio.user.id], agenda: '1. Ventas', project_id: project.id,
  });
  await admin.ok('POST', `/api/meetings/${id}/actions`, { title: 'Enviar propuesta a tienda', assignee_ids: [member.user.id], due_date: '2026-11-10' });
  const d = await admin.ok('POST', '/api/decisions', { title: 'Vender en mercado local', meeting_id: id, approver_ids: [socio.user.id, member.user.id] });
  const meeting = await admin.ok('GET', `/api/meetings/${id}`);
  assert.equal(meeting.actions.length, 1);
  assert.equal(meeting.actions[0].meeting_id, id);
  assert.equal(meeting.decisions[0].status, 'proposed');
  const pending = await socio.ok('GET', '/api/dashboard/me');
  assert.ok(pending.decisions.some((x) => x.id === d.id));
  assert.equal((await admin.post(`/api/decisions/${d.id}/respond`, { response: 'approved' })).status, 403, 'quien no es aprobador no decide');
  const r1 = await socio.ok('POST', `/api/decisions/${d.id}/respond`, { response: 'approved' });
  assert.equal(r1.status, 'proposed', 'falta otro aprobador');
  const r2 = await member.ok('POST', `/api/decisions/${d.id}/respond`, { response: 'approved' });
  assert.equal(r2.status, 'approved');
  assert.equal((await admin.patch(`/api/decisions/${d.id}`, { title: 'cambiar' })).status, 400, 'una decisión resuelta no se reescribe');
  const log = await member.ok('GET', '/api/decisions?status=approved');
  assert.ok(log.some((x) => x.id === d.id));
});

test('archivos: subida, descarga con permisos y privacidad de comprobantes', async () => {
  const form = new FormData();
  form.append('files', new Blob(['cotizacion de prueba'], { type: 'text/plain' }), 'cotización.txt');
  form.append('project_id', String(project.id));
  const [file] = await admin.ok('POST', '/api/files', form);
  assert.equal(file.name, 'cotización.txt');
  const raw = await member.request('GET', `/api/files/${file.id}/raw`, undefined, { raw: true });
  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), 'cotizacion de prueba');
  const anon = await srv.client().request('GET', `/api/files/${file.id}/raw`, undefined, { raw: true });
  assert.equal(anon.status, 401, 'conocer la URL no basta');

  // HTML se descarga, nunca se interpreta
  const html = new FormData();
  html.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
  const [hf] = await admin.ok('POST', '/api/files', html);
  const hr = await admin.request('GET', `/api/files/${hf.id}/raw`, undefined, { raw: true });
  assert.match(hr.headers.get('content-disposition'), /^attachment/);

  // Comprobante de un movimiento: solo finanzas
  const tx = await admin.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Compra con ticket', amount: '10', account_id: (await admin.ok('GET', '/api/finance/meta')).accounts[0].id });
  const receipt = new FormData();
  receipt.append('files', new Blob(['ticket'], { type: 'text/plain' }), 'ticket.txt');
  receipt.append('link_type', 'transaction');
  receipt.append('link_id', String(tx.id));
  const [rf] = await admin.ok('POST', '/api/files', receipt);
  assert.equal(rf.visibility, 'finance');
  assert.equal((await member.request('GET', `/api/files/${rf.id}/raw`, undefined, { raw: true })).status, 404);
  assert.equal((await socio.request('GET', `/api/files/${rf.id}/raw`, undefined, { raw: true })).status, 200);
});

test('bandeja de entrada: capturar y convertir en tarea', async () => {
  const { id } = await member.ok('POST', '/api/inbox', { title: 'Idea: vender kits de cultivo' });
  const conv = await member.ok('POST', `/api/inbox/${id}/convert`, { to: 'task', project_id: project.id });
  const t = await member.ok('GET', `/api/tasks/${conv.id}`);
  assert.equal(t.title, 'Idea: vender kits de cultivo');
  assert.equal((await member.ok('GET', '/api/inbox')).length, 0);
  assert.equal((await admin.ok('GET', '/api/inbox')).length, 0, 'la bandeja es personal');
});

test('objetivos con indicadores calculan su progreso', async () => {
  const { id } = await admin.ok('POST', '/api/goals', { title: 'Primeras 100 ventas', period: '2026-T4', key_results: [{ title: 'Ventas', start_value: 0, target_value: 100, current_value: 25 }] });
  await admin.ok('PATCH', `/api/projects/${project.id}`, { goal_id: id });
  const g = await member.ok('GET', `/api/goals/${id}`);
  assert.equal(g.progress, 25);
  assert.ok(g.projects.some((p) => p.id === project.id));
});

test('vistas guardadas y favoritos', async () => {
  const v = await member.ok('POST', '/api/views', { name: 'Urgentes', config: { priority: 'urgent,high' } });
  await member.ok('POST', '/api/favorites', { entity_type: 'view', entity_id: v.id });
  await member.ok('POST', '/api/favorites', { entity_type: 'project', entity_id: project.id });
  const favs = await member.ok('GET', '/api/favorites');
  assert.equal(favs.length, 2);
  await member.ok('POST', '/api/favorites', { entity_type: 'project', entity_id: project.id });
  assert.equal((await member.ok('GET', '/api/favorites')).length, 1, 'alternar quita el favorito');
});

test('panel de empresa: carga de trabajo y totales', async () => {
  const c = await admin.ok('GET', '/api/dashboard/company');
  assert.ok(c.projects.length >= 1);
  const ivan = c.workload.find((w) => w.id === member.user.id);
  assert.ok(ivan.open >= 1);
  assert.ok(c.tasks.total >= c.tasks.done);
});

test('los datos persisten al reiniciar el servidor', async () => {
  const { closeDatabase, openDatabase } = await import('../../server/db/index.js');
  closeDatabase();
  openDatabase();
  const p = await admin.ok('GET', `/api/projects/${project.id}`);
  assert.equal(p.name, 'Línea de macetas');
  const tasks = await admin.ok('GET', `/api/tasks?project_id=${project.id}`);
  assert.ok(tasks.length > 5);
});
