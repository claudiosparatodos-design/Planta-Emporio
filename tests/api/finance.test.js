import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupWorkspace, addMember } from './helpers.js';

// Datos de prueba: montos inventados únicamente para verificar cálculos en una base temporal.
let srv, admin, socio, member;
let caja, banco, catVentas, catMateriales, catPublicidad;

before(async () => {
  srv = await startServer();
  admin = await setupWorkspace(srv);
  socio = await addMember(srv, admin, { name: 'Sofía Socia', email: 'sofia@example.test', role: 'Socio' });
  member = await addMember(srv, admin, { name: 'Iván Integrante', email: 'ivan@example.test', role: 'Integrante' });
  const meta = await admin.ok('GET', '/api/finance/meta');
  caja = meta.accounts.find((a) => a.name === 'Caja principal');
  assert.equal(caja.balance_cents, 0, 'la cuenta inicial empieza en cero');
  const { id } = await admin.ok('POST', '/api/finance/accounts', { name: 'Banco', type: 'bank', initial_balance_cents: 100000 });
  banco = { id };
  catVentas = meta.categories.find((c) => c.name === 'Ventas');
  catMateriales = meta.categories.find((c) => c.name === 'Materiales');
  catPublicidad = meta.categories.find((c) => c.name === 'Publicidad');
});
after(async () => srv.stop());

const balance = async (id) => (await admin.ok('GET', '/api/finance/meta')).accounts.find((a) => a.id === id).balance_cents;

test('ingresos y gastos se calculan en centavos exactos', async () => {
  await admin.ok('POST', '/api/finance/transactions', { kind: 'income', concept: 'Venta de prueba', amount: '1000.10', date: '2026-10-01', account_id: caja.id, category_id: catVentas.id });
  await admin.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Material de prueba', amount: '250.20', date: '2026-10-02', account_id: caja.id, category_id: catMateriales.id });
  await admin.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Gasto 0.1', amount_cents: 10, date: '2026-10-02', account_id: caja.id });
  const s = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s.income_cents, 100010);
  assert.equal(s.expense_cents, 25030);
  assert.equal(s.net_cents, 74980);
  assert.equal(await balance(caja.id), 74980);
  const mat = s.by_category.find((c) => c.category_id === catMateriales.id);
  assert.equal(mat.total, 25020);
});

test('validaciones: monto, categoría del tipo correcto y cuenta obligatoria', async () => {
  const cases = [
    { kind: 'expense', concept: 'x', amount: '-5', account_id: caja.id },
    { kind: 'expense', concept: 'x', amount: '10.123', account_id: caja.id },
    { kind: 'expense', concept: 'x', amount: '0', account_id: caja.id },
    { kind: 'expense', concept: 'x', amount: '10' },
    { kind: 'expense', concept: 'x', amount: '10', account_id: caja.id, category_id: catVentas.id },
    { kind: 'transfer', concept: 'x', amount: '10', account_id: caja.id, to_account_id: caja.id },
  ];
  for (const body of cases) {
    const r = await admin.post('/api/finance/transactions', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('gasto pagado por un socio con su dinero: no sale de caja y genera un reembolso pendiente', async () => {
  const before = await balance(caja.id);
  const { id } = await member.ok('POST', '/api/finance/transactions', {
    kind: 'expense', concept: 'Gasolina (prueba)', amount: '100', date: '2026-10-05', paid_personally: true, member_id: member.user.id, category_id: catMateriales.id,
  });
  assert.equal(await balance(caja.id), before, 'no afecta la caja');
  const s = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s.expense_cents, 25030 + 10000, 'sí cuenta como gasto del negocio');
  const obligations = await admin.ok('GET', '/api/finance/obligations?source=reimbursement');
  const reimb = obligations.find((o) => o.source_transaction_id === id);
  assert.equal(reimb.amount_cents, 10000);
  assert.equal(reimb.member_id, member.user.id);
  assert.equal(reimb.status, 'open');

  // Reembolso parcial de 40: saldo de caja baja 40, quedan 60 pendientes, no es gasto adicional.
  await admin.ok('POST', `/api/finance/obligations/${reimb.id}/pay`, { amount: '40', account_id: caja.id, date: '2026-10-06' });
  const after1 = (await admin.ok('GET', `/api/finance/obligations/${reimb.id}`));
  assert.equal(after1.status, 'partial');
  assert.equal(after1.remaining_cents, 6000);
  assert.equal(await balance(caja.id), before - 4000);
  const s2 = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s2.expense_cents, 35030, 'el reembolso no duplica el gasto');

  const over = await admin.post(`/api/finance/obligations/${reimb.id}/pay`, { amount: '61', account_id: caja.id });
  assert.equal(over.status, 400, 'no se puede pagar más de lo pendiente');

  // No se puede anular el gasto de origen mientras haya pagos.
  const voidSrc = await admin.post(`/api/finance/transactions/${id}/void`, { reason: 'prueba' });
  assert.equal(voidSrc.status, 400);

  const partners = await member.ok('GET', '/api/finance/partners');
  assert.equal(partners.partners.length, 1, 'el integrante solo ve su propia información');
  assert.equal(partners.partners[0].reimbursements_pending_cents, 6000);
  assert.equal(partners.partners[0].reimbursed_cents, 4000);
});

test('aportaciones de capital y préstamos de socios no son ingresos', async () => {
  const caja0 = await balance(caja.id);
  await admin.ok('POST', '/api/finance/transactions', { kind: 'contribution', concept: 'Capital inicial (prueba)', amount: '5000', date: '2026-10-03', account_id: caja.id, member_id: socio.user.id });
  const loan = await admin.ok('POST', '/api/finance/transactions', { kind: 'loan_in', concept: 'Préstamo (prueba)', amount: '2000', date: '2026-10-03', account_id: caja.id, member_id: socio.user.id, repay_due_date: '2026-12-31' });
  assert.equal(await balance(caja.id), caja0 + 700000);
  const s = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s.income_cents, 100010, 'los ingresos no cambian');
  assert.equal(s.cash.contributions, 500000);
  assert.equal(s.cash.loans, 200000);
  const partners = await admin.ok('GET', '/api/finance/partners');
  const sofia = partners.partners.find((p) => p.member.id === socio.user.id);
  assert.equal(sofia.capital_cents, 500000);
  assert.equal(sofia.loans_pending_cents, 200000);
  const ob = (await admin.ok('GET', '/api/finance/obligations?source=loan')).find((o) => o.source_transaction_id === loan.id);
  assert.equal(ob.due_date, '2026-12-31');
  await admin.ok('POST', `/api/finance/obligations/${ob.id}/pay`, { account_id: caja.id });
  assert.equal((await admin.ok('GET', `/api/finance/obligations/${ob.id}`)).status, 'paid');
  assert.equal(await balance(caja.id), caja0 + 500000);
});

test('transferencias mueven saldo entre cuentas sin alterar el total', async () => {
  const t0 = (await admin.ok('GET', '/api/finance/summary')).total_balance_cents;
  const c0 = await balance(caja.id);
  const b0 = await balance(banco.id);
  await admin.ok('POST', '/api/finance/transactions', { kind: 'transfer', concept: 'Depósito al banco', amount: '300', account_id: caja.id, to_account_id: banco.id });
  assert.equal(await balance(caja.id), c0 - 30000);
  assert.equal(await balance(banco.id), b0 + 30000);
  assert.equal((await admin.ok('GET', '/api/finance/summary')).total_balance_cents, t0);
});

test('anular conserva el registro, exige motivo y lo excluye de los totales', async () => {
  const { id } = await admin.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Error de captura', amount: '999', date: '2026-10-10', account_id: caja.id });
  const s0 = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal((await admin.post(`/api/finance/transactions/${id}/void`, {})).status, 400, 'sin motivo no se anula');
  assert.equal((await member.post(`/api/finance/transactions/${id}/void`, { reason: 'x' })).status, 404, 'el integrante no ve movimientos ajenos');
  await admin.ok('POST', `/api/finance/transactions/${id}/void`, { reason: 'Capturado dos veces' });
  const s1 = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s1.expense_cents, s0.expense_cents - 99900);
  const detail = await admin.ok('GET', `/api/finance/transactions/${id}`);
  assert.equal(detail.void_reason, 'Capturado dos veces');
  assert.ok(detail.history.some((h) => h.action === 'voided'));
  assert.equal((await admin.patch(`/api/finance/transactions/${id}`, { concept: 'x' })).status, 400, 'no se edita un anulado');
  const voided = await admin.ok('GET', '/api/finance/transactions?status=voided');
  assert.ok(voided.some((t) => t.id === id));
});

test('las ediciones quedan en el historial con valores anteriores', async () => {
  const { id } = await admin.ok('POST', '/api/finance/transactions', { kind: 'income', concept: 'Venta feria', amount: '50', date: '2026-10-11', account_id: caja.id });
  await admin.ok('PATCH', `/api/finance/transactions/${id}`, { amount: '55.50' });
  const d = await admin.ok('GET', `/api/finance/transactions/${id}`);
  assert.equal(d.amount_cents, 5550);
  const edit = d.history.find((h) => h.action === 'updated');
  assert.deepEqual(edit.data.amount_cents, { from: 5000, to: 5550 });
});

test('presupuesto con aprobación: el gasto que lo excede queda pendiente y no cuenta hasta aprobarse', async () => {
  await admin.ok('POST', '/api/finance/budgets', {
    name: 'Publicidad octubre', amount: '500', period_start: '2026-10-01', period_end: '2026-10-31', category_ids: [catPublicidad.id], over_action: 'approval',
  });
  assert.equal((await member.post('/api/finance/budgets', { name: 'x', amount: '1', period_start: '2026-10-01', period_end: '2026-10-02' })).status, 403);

  const ok = await member.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Anuncio 1', amount: '300', date: '2026-10-12', account_id: caja.id, category_id: catPublicidad.id });
  assert.equal(ok.approval_status, 'approved');
  const over = await member.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Anuncio 2', amount: '300', date: '2026-10-13', account_id: caja.id, category_id: catPublicidad.id });
  assert.equal(over.approval_status, 'pending');
  assert.match(over.approval_reason, /Publicidad octubre/);

  let budgets = await admin.ok('GET', '/api/finance/budgets');
  let b = budgets.find((x) => x.name === 'Publicidad octubre');
  assert.equal(b.spent_cents, 30000);
  assert.equal(b.pending_cents, 30000);
  const s = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s.pending_approvals.count, 1);

  // Las notificaciones llegan a quien aprueba.
  const notes = await socio.ok('GET', '/api/notifications');
  assert.ok(notes.items.some((n) => n.type === 'finance' && n.entity_id === over.id));

  assert.equal((await member.post(`/api/finance/transactions/${over.id}/approve`)).status, 403);
  await socio.ok('POST', `/api/finance/transactions/${over.id}/approve`);
  budgets = await admin.ok('GET', '/api/finance/budgets');
  b = budgets.find((x) => x.name === 'Publicidad octubre');
  assert.equal(b.spent_cents, 60000);
  assert.equal(b.state, 'over');
  assert.equal(b.remaining_cents, -10000);
});

test('umbral global de aprobación para gastos grandes', async () => {
  await admin.ok('PATCH', '/api/settings', { approval_threshold_cents: 200000 });
  const big = await member.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Compra grande', amount: '2500', date: '2026-10-14', account_id: caja.id });
  assert.equal(big.approval_status, 'pending');
  await admin.ok('POST', `/api/finance/transactions/${big.id}/reject`, { reason: 'No está presupuestado' });
  const d = await member.ok('GET', `/api/finance/transactions/${big.id}`);
  assert.equal(d.approval_status, 'rejected');
  const byAdmin = await admin.ok('POST', '/api/finance/transactions', { kind: 'expense', concept: 'Compra grande aprobada', amount: '2500', date: '2026-10-14', account_id: banco.id });
  assert.equal(byAdmin.approval_status, 'approved', 'quien puede aprobar no queda bloqueado');
  await admin.ok('PATCH', '/api/settings', { approval_threshold_cents: null });
});

test('cuentas por cobrar: al cobrar se registra el ingreso real', async () => {
  const { id } = await admin.ok('POST', '/api/finance/obligations', { direction: 'receivable', title: 'Pedido cliente (prueba)', counterparty: 'Cliente X', amount: '800', due_date: '2026-10-30', category_id: catVentas.id });
  const s0 = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s0.receivables.total_cents, 80000);
  await admin.ok('POST', `/api/finance/obligations/${id}/pay`, { amount: '800', account_id: banco.id, date: '2026-10-20' });
  const s1 = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(s1.income_cents, s0.income_cents + 80000);
  assert.equal(s1.receivables.total_cents, 0);
  const ob = await admin.ok('GET', `/api/finance/obligations/${id}`);
  assert.equal(ob.status, 'paid');
  assert.equal(ob.payments[0].kind, 'income');
});

test('permisos financieros por rol', async () => {
  assert.equal((await member.get('/api/finance/summary')).status, 403);
  assert.equal((await member.get('/api/finance/budgets')).status, 403);
  const mine = await member.ok('GET', '/api/finance/transactions?status=all');
  assert.ok(mine.length > 0);
  assert.ok(mine.every((t) => t.created_by === member.user.id || t.member_id === member.user.id), 'solo ve lo suyo');
  const meta = await member.ok('GET', '/api/finance/meta');
  assert.equal(meta.accounts[0].balance_cents, undefined, 'no ve saldos');
  const dash = await member.ok('GET', '/api/dashboard/me');
  assert.equal(dash.finance, null);
  assert.equal((await member.post('/api/finance/accounts', { name: 'X' })).status, 403);

  // Socio: consulta y aprueba, pero no configura el espacio.
  assert.equal((await socio.get('/api/finance/summary')).status, 200);
  assert.equal((await socio.patch('/api/settings', { currency: 'USD' })).status, 403);

  // Un rol sin permisos financieros no entra al módulo.
  const role = await admin.ok('POST', '/api/members/roles', { name: 'Invitado', permissions: ['docs.edit'] });
  const guest = await addMember(srv, admin, { name: 'Gael Invitado', email: 'gael@example.test', role: 'Invitado' });
  assert.ok(role.id);
  assert.equal((await guest.get('/api/finance/transactions')).status, 403);
  assert.equal((await guest.post('/api/finance/transactions', { kind: 'income', concept: 'x', amount: '1', account_id: caja.id })).status, 403);
});

test('reportes por categoría y exportación CSV basada en movimientos reales', async () => {
  const report = await admin.ok('GET', '/api/finance/report?group=category&from=2026-10-01&to=2026-10-31');
  const summary = await admin.ok('GET', '/api/finance/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(report.total.income_cents, summary.income_cents);
  assert.equal(report.total.expense_cents, summary.expense_cents);
  const monthly = await admin.ok('GET', '/api/finance/report?group=month&from=2026-10-01&to=2026-10-31');
  assert.equal(monthly.rows.length, 1);
  assert.equal(monthly.rows[0].net_cents, summary.net_cents);

  const res = await admin.request('GET', '/api/finance/export.csv?from=2026-10-01&to=2026-10-31', undefined, { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para que Excel muestre acentos');
  const text = bytes.toString('utf8');
  assert.ok(text.startsWith('﻿ID,Fecha,Tipo'));
  assert.ok(text.includes('Venta de prueba'));
  assert.ok(text.includes('Anulado: Capturado dos veces'));
  const forbidden = await member.request('GET', '/api/finance/export.csv?type=report', undefined, { raw: true });
  assert.equal(forbidden.status, 403);
});
