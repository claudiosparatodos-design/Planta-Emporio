import { Router } from 'express';
import { db, now, transaction, getSetting } from '../lib/dbx.js';
import { handler, HttpError, date, int, notFound, oneOf, str, ids } from '../lib/http.js';
import { can, canViewProject, requirePermission } from '../lib/permissions.js';
import { logActivity, diff } from '../lib/activity.js';
import { emit } from '../lib/events.js';
import { notify } from '../lib/notify.js';
import { userIdsWithPermission } from '../lib/users.js';
import { attachmentsOf } from '../lib/entities.js';
import {
  KIND_LABELS,
  VALID_TX,
  accountBalances,
  applyEffects,
  approvalRequirement,
  budgetImpact,
  budgetsWithSpend,
  getObligation,
  obligationsWithStatus,
  settlementKind,
  toCents,
  totals,
} from '../lib/finance.js';
import { today } from '../lib/workspace.js';

const router = Router();
const KINDS = ['income', 'expense', 'contribution', 'loan_in', 'transfer'];
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'];
const ACCOUNT_TYPES = ['bank', 'cash', 'card', 'digital', 'other'];

const canSeeAll = (u) => can(u, 'finance.view');
const financeAudience = (u) => can(u, 'finance.view') || can(u, 'finance.record');
const changed = (extra = []) => emit(['finance', 'dashboard', ...extra], { filter: financeAudience });

/** Quien no puede ver todas las finanzas solo ve lo que registró o lo que le corresponde. */
function ownScope(user, alias = 't') {
  if (canSeeAll(user)) return { sql: '1=1', params: [] };
  return { sql: `(${alias}.created_by = ? OR ${alias}.member_id = ?)`, params: [user.id, user.id] };
}

function requireFinanceAccess(user) {
  if (!can(user, 'finance.view') && !can(user, 'finance.record')) throw new HttpError(403, 'No tienes acceso a finanzas.');
}

router.use((req, res, next) => {
  try {
    requireFinanceAccess(req.user);
    next();
  } catch (e) {
    next(e);
  }
});

function money(cents) {
  const currency = getSetting('currency', 'MXN');
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100);
}

// ───────── Catálogos ─────────
router.get(
  '/meta',
  handler((req, res) => {
    const all = canSeeAll(req.user);
    const accounts = accountBalances({ includeArchived: true }).map((a) => (all ? a : { id: a.id, name: a.name, type: a.type, archived_at: a.archived_at }));
    res.json({
      accounts,
      categories: db.all('SELECT * FROM fin_categories ORDER BY kind, archived_at IS NOT NULL, name COLLATE NOCASE'),
      payment_methods: getSetting('payment_methods', []),
      contribution_types: getSetting('contribution_types', []),
      currency: getSetting('currency', 'MXN'),
      approval_threshold_cents: getSetting('approval_threshold_cents', null),
      kinds: KIND_LABELS,
      can: {
        view: can(req.user, 'finance.view'),
        record: can(req.user, 'finance.record'),
        approve: can(req.user, 'finance.approve'),
      },
    });
  }),
);

router.post(
  '/accounts',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const initial = req.body.initial_balance_cents != null || req.body.initial_balance != null
      ? Number(req.body.initial_balance_cents ?? Math.round(Number(String(req.body.initial_balance).replace(/,/g, '')) * 100))
      : 0;
    if (!Number.isSafeInteger(initial)) throw new HttpError(400, 'El saldo inicial no es válido.');
    const id = db.insert('fin_accounts', {
      name: str(req.body.name, { field: 'El nombre', required: true, max: 80 }),
      type: oneOf(req.body.type, ACCOUNT_TYPES, 'Tipo') || 'bank',
      initial_balance_cents: initial,
      notes: str(req.body.notes, { field: 'Notas', max: 500 }) || '',
      created_by: req.user.id,
      created_at: now(),
    });
    logActivity({ actor: req.user, entityType: 'account', entityId: id, action: 'created', summary: `creó la cuenta «${req.body.name}» con saldo inicial ${money(initial)}` });
    changed();
    res.status(201).json({ id });
  }),
);

router.patch(
  '/accounts/:id',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const a = db.get('SELECT * FROM fin_accounts WHERE id = ?', req.params.id);
    if (!a) throw notFound('La cuenta');
    let initial;
    if (req.body.initial_balance_cents !== undefined) {
      initial = Number(req.body.initial_balance_cents);
      if (!Number.isSafeInteger(initial)) throw new HttpError(400, 'El saldo inicial no es válido.');
    }
    db.update('fin_accounts', a.id, {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 80 }) : undefined,
      type: oneOf(req.body.type, ACCOUNT_TYPES, 'Tipo'),
      notes: str(req.body.notes, { field: 'Notas', max: 500 }),
      initial_balance_cents: initial,
      archived_at: req.body.archived === undefined ? undefined : req.body.archived ? now() : null,
    });
    const changes = diff(a, { initial_balance_cents: initial, name: req.body.name }, ['initial_balance_cents', 'name']);
    if (Object.keys(changes).length || req.body.archived !== undefined) {
      logActivity({ actor: req.user, entityType: 'account', entityId: a.id, action: 'updated', summary: `modificó la cuenta «${a.name}»`, data: changes });
    }
    changed();
    res.json({ ok: true });
  }),
);

router.post(
  '/categories',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const id = db.insert('fin_categories', {
      name: str(req.body.name, { field: 'El nombre', required: true, max: 60 }),
      kind: oneOf(req.body.kind, ['income', 'expense'], 'Tipo') || 'expense',
      color: oneOf(req.body.color, COLORS, 'Color') || 'gray',
      created_at: now(),
    });
    changed();
    res.status(201).json({ id });
  }),
);

router.patch(
  '/categories/:id',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const c = db.get('SELECT * FROM fin_categories WHERE id = ?', req.params.id);
    if (!c) throw notFound('La categoría');
    db.update('fin_categories', c.id, {
      name: req.body.name !== undefined ? str(req.body.name, { field: 'El nombre', required: true, max: 60 }) : undefined,
      color: oneOf(req.body.color, COLORS, 'Color'),
      archived_at: req.body.archived === undefined ? undefined : req.body.archived ? now() : null,
    });
    changed();
    res.json({ ok: true });
  }),
);

router.delete(
  '/categories/:id',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const c = db.get('SELECT * FROM fin_categories WHERE id = ?', req.params.id);
    if (!c) throw notFound('La categoría');
    if (db.get('SELECT 1 FROM fin_transactions WHERE category_id = ?', c.id) || db.get('SELECT 1 FROM fin_obligations WHERE category_id = ?', c.id)) {
      throw new HttpError(400, 'La categoría tiene movimientos. Archívala en lugar de eliminarla.');
    }
    db.run('DELETE FROM fin_categories WHERE id = ?', c.id);
    changed();
    res.json({ ok: true });
  }),
);

// ───────── Movimientos ─────────
const TX_SELECT = `SELECT t.*, c.name AS category_name, c.color AS category_color, a.name AS account_name, ta.name AS to_account_name,
  p.name AS project_name, m.name AS member_name, cu.name AS created_by_name, au.name AS approved_by_name, vu.name AS voided_by_name
  FROM fin_transactions t LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN fin_accounts a ON a.id = t.account_id
  LEFT JOIN fin_accounts ta ON ta.id = t.to_account_id LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users m ON m.id = t.member_id LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users au ON au.id = t.approved_by
  LEFT JOIN users vu ON vu.id = t.voided_by`;

function txFilters(user, q) {
  const scope = ownScope(user);
  const where = [scope.sql];
  const params = [...scope.params];
  const add = (sql, ...p) => {
    where.push(sql);
    params.push(...p);
  };
  if (q.from) add('t.date >= ?', String(q.from));
  if (q.to) add('t.date <= ?', String(q.to));
  if (q.kind) {
    const list = String(q.kind).split(',').filter((k) => KIND_LABELS[k]);
    if (list.length) where.push(`t.kind IN (${list.map((k) => `'${k}'`).join(',')})`);
  }
  if (q.category_id) add('t.category_id = ?', Number(q.category_id));
  if (q.project_id) add('t.project_id = ?', Number(q.project_id));
  if (q.account_id) add('(t.account_id = ? OR t.to_account_id = ?)', Number(q.account_id), Number(q.account_id));
  if (q.member_id) add('t.member_id = ?', Number(q.member_id));
  if (q.created_by) add('t.created_by = ?', Number(q.created_by));
  if (q.q) add('(t.concept LIKE ? OR t.counterparty LIKE ? OR t.notes LIKE ?)', `%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  if (q.status === 'pending') where.push("t.approval_status = 'pending' AND t.voided_at IS NULL");
  else if (q.status === 'voided') where.push('t.voided_at IS NOT NULL');
  else if (q.status === 'rejected') where.push("t.approval_status = 'rejected'");
  else if (q.status !== 'all') where.push("t.voided_at IS NULL AND t.approval_status <> 'rejected'");
  return { where: where.join(' AND '), params };
}

router.get(
  '/transactions',
  handler((req, res) => {
    const f = txFilters(req.user, req.query);
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const rows = db.all(`${TX_SELECT} WHERE ${f.where} ORDER BY t.date DESC, t.id DESC LIMIT ${limit}`, ...f.params);
    res.json(rows);
  }),
);

function getTx(user, id) {
  const tx = db.get(`${TX_SELECT} WHERE t.id = ?`, id);
  if (!tx) throw notFound('El movimiento');
  if (!canSeeAll(user) && tx.created_by !== user.id && tx.member_id !== user.id) throw notFound('El movimiento');
  return tx;
}

router.get(
  '/transactions/:id',
  handler((req, res) => {
    const tx = getTx(req.user, Number(req.params.id));
    const history = db.all("SELECT a.*, u.name AS actor_name FROM activity a LEFT JOIN users u ON u.id = a.actor_id WHERE a.entity_type = 'transaction' AND a.entity_id = ? ORDER BY a.id DESC", tx.id);
    const derived = db.get('SELECT id FROM fin_obligations WHERE source_transaction_id = ?', tx.id);
    res.json({
      ...tx,
      attachments: attachmentsOf(req.user, 'transaction', tx.id),
      history: history.map((h) => ({ ...h, data: h.data ? JSON.parse(h.data) : null })),
      derived_obligation: derived ? getObligation(derived.id) : null,
      settles: tx.obligation_id ? getObligation(tx.obligation_id) : null,
      can_edit: !tx.voided_at && !tx.obligation_id && (can(req.user, 'finance.approve') || (tx.created_by === req.user.id && can(req.user, 'finance.record'))),
      can_void: !tx.voided_at && (can(req.user, 'finance.approve') || (tx.created_by === req.user.id && tx.approval_status === 'pending')),
    });
  }),
);

function readTx(user, b, existing = null) {
  const kind = existing ? existing.kind : oneOf(b.kind, KINDS, 'Tipo de movimiento');
  if (!kind) throw new HttpError(400, 'Indica el tipo de movimiento.');
  const amount = toCents(b);
  const data = {
    kind,
    concept: b.concept !== undefined || !existing ? str(b.concept, { field: 'El concepto', required: true, max: 200 }) : undefined,
    amount_cents: amount ?? (existing ? undefined : null),
    date: b.date !== undefined || !existing ? date(b.date, 'La fecha') || (existing ? undefined : today()) : undefined,
    category_id: int(b.category_id, { field: 'Categoría', min: 1 }),
    account_id: int(b.account_id, { field: 'Cuenta', min: 1 }),
    to_account_id: int(b.to_account_id, { field: 'Cuenta destino', min: 1 }),
    project_id: int(b.project_id, { field: 'Proyecto', min: 1 }),
    member_id: int(b.member_id, { field: 'Integrante', min: 1 }),
    counterparty: str(b.counterparty, { field: 'La contraparte', max: 200 }),
    payment_method: str(b.payment_method, { field: 'El método de pago', max: 60 }),
    notes: str(b.notes, { field: 'Las notas', max: 5000, trim: false }),
    contribution_type: str(b.contribution_type, { field: 'El tipo de aportación', max: 60 }),
    paid_personally: existing ? undefined : b.paid_personally ? 1 : 0,
  };
  if (!existing && data.amount_cents == null) throw new HttpError(400, 'El monto es obligatorio.');
  const merged = { ...(existing || {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };

  // Reglas por tipo
  const needAccount = !(kind === 'expense' && merged.paid_personally);
  if (needAccount && !merged.account_id) throw new HttpError(400, 'Elige la cuenta o fondo del movimiento.');
  if (kind === 'expense' && merged.paid_personally) {
    if (!merged.member_id) throw new HttpError(400, 'Indica qué integrante pagó con su dinero.');
    data.account_id = null;
    merged.account_id = null;
  }
  if (kind === 'contribution' && !merged.member_id) throw new HttpError(400, 'Indica qué integrante hizo la aportación.');
  if (kind === 'contribution' && !merged.contribution_type) data.contribution_type = 'Capital';
  if (kind === 'loan_in' && !merged.member_id && !merged.counterparty) throw new HttpError(400, 'Indica quién prestó el dinero.');
  if (kind === 'transfer') {
    if (!merged.to_account_id) throw new HttpError(400, 'Elige la cuenta destino.');
    if (merged.to_account_id === merged.account_id) throw new HttpError(400, 'Las cuentas de origen y destino deben ser distintas.');
  } else {
    data.to_account_id = existing ? undefined : null;
  }
  for (const accId of [merged.account_id, merged.to_account_id].filter(Boolean)) {
    const acc = db.get('SELECT * FROM fin_accounts WHERE id = ?', accId);
    if (!acc) throw new HttpError(400, 'La cuenta no existe.');
    if (acc.archived_at && (!existing || accId !== existing.account_id)) throw new HttpError(400, `La cuenta «${acc.name}» está archivada.`);
  }
  if (merged.category_id) {
    const cat = db.get('SELECT * FROM fin_categories WHERE id = ?', merged.category_id);
    if (!cat) throw new HttpError(400, 'La categoría no existe.');
    if (['income', 'expense'].includes(kind) && cat.kind !== kind) throw new HttpError(400, 'La categoría no corresponde al tipo de movimiento.');
  }
  if (merged.member_id && !db.get('SELECT 1 FROM users WHERE id = ?', merged.member_id)) throw new HttpError(400, 'El integrante no existe.');
  if (merged.project_id && !canViewProject(user, merged.project_id)) throw new HttpError(400, 'El proyecto no existe.');
  return { data, merged };
}

function describe(tx) {
  return `${KIND_LABELS[tx.kind].toLowerCase()} «${tx.concept}» por ${money(tx.amount_cents)}`;
}

router.post(
  '/transactions',
  handler((req, res) => {
    requirePermission(req.user, 'finance.record');
    const { data, merged } = readTx(req.user, req.body);
    const check = approvalRequirement(req.user, merged);
    const ts = now();
    const id = transaction(() => {
      const tid = db.insert('fin_transactions', {
        ...data,
        counterparty: data.counterparty || '',
        payment_method: data.payment_method || '',
        notes: data.notes || '',
        approval_status: check.pending ? 'pending' : 'approved',
        approval_reason: check.reason,
        approved_by: check.pending ? null : req.user.id,
        approved_at: check.pending ? null : ts,
        created_by: req.user.id,
        updated_by: req.user.id,
        created_at: ts,
        updated_at: ts,
      });
      applyEffects(tid, { reimburse_due_date: date(req.body.reimburse_due_date), repay_due_date: date(req.body.repay_due_date) });
      for (const fid of ids(req.body.file_ids, 'Comprobantes') || []) {
        const f = db.get('SELECT * FROM files WHERE id = ? AND uploaded_by = ?', fid, req.user.id);
        if (!f) throw new HttpError(400, 'Solo puedes adjuntar comprobantes que tú subiste.');
        db.run("UPDATE files SET visibility = 'finance' WHERE id = ? AND visibility = 'workspace'", fid);
        db.insert('links', { a_type: 'transaction', a_id: tid, b_type: 'file', b_id: fid, created_by: req.user.id, created_at: ts });
      }
      logActivity({
        actor: req.user,
        entityType: 'transaction',
        entityId: tid,
        projectId: merged.project_id ?? null,
        action: 'created',
        summary: `registró ${describe(merged)}${check.pending ? ' (pendiente de aprobación)' : ''}`,
        data: { snapshot: merged },
      });
      return tid;
    });
    if (check.pending) {
      notify({
        userIds: userIdsWithPermission('finance.approve'),
        type: 'finance',
        title: `${req.user.name} registró un gasto que requiere aprobación`,
        body: `${merged.concept} · ${money(merged.amount_cents)} · ${check.reason}`,
        link: `/finance/movements?tx=${id}`,
        actorId: req.user.id,
        entityType: 'transaction',
        entityId: id,
      });
    }
    changed();
    res.status(201).json({ id, approval_status: check.pending ? 'pending' : 'approved', approval_reason: check.reason, warnings: check.warnings });
  }),
);

/** Revisa el impacto en presupuestos antes de guardar (para advertir en el formulario). */
router.post(
  '/transactions/preview',
  handler((req, res) => {
    const amount = toCents(req.body);
    if (!amount || req.body.kind !== 'expense') return res.json({ warnings: [], pending: false });
    const tx = { kind: 'expense', amount_cents: amount, date: date(req.body.date) || today(), project_id: int(req.body.project_id) ?? null, category_id: int(req.body.category_id) ?? null };
    const check = approvalRequirement(req.user, tx);
    res.json({ warnings: canSeeAll(req.user) ? check.warnings : check.warnings.map((w) => ({ name: w.name, exceeds: w.exceeds })), pending: check.pending, reason: check.reason });
  }),
);

router.patch(
  '/transactions/:id',
  handler((req, res) => {
    const tx = getTx(req.user, Number(req.params.id));
    if (tx.voided_at) throw new HttpError(400, 'Un movimiento anulado no se puede editar.');
    if (tx.obligation_id) throw new HttpError(400, 'Este movimiento liquida una obligación. Anúlalo y regístralo de nuevo si es incorrecto.');
    const isApprover = can(req.user, 'finance.approve');
    if (!isApprover && !(tx.created_by === req.user.id && can(req.user, 'finance.record'))) {
      throw new HttpError(403, 'Solo quien registró el movimiento o alguien con permiso de aprobación puede editarlo.');
    }
    const raw = db.get('SELECT * FROM fin_transactions WHERE id = ?', tx.id);
    const { data, merged } = readTx(req.user, req.body, raw);
    delete data.kind;
    const derived = db.get('SELECT * FROM fin_obligations WHERE source_transaction_id = ? AND cancelled_at IS NULL', tx.id);
    let requeued = null;
    transaction(() => {
      if (derived && data.amount_cents !== undefined && data.amount_cents !== raw.amount_cents) {
        const ob = getObligation(derived.id);
        if (ob.paid_cents > 0 || ob.pending_cents > 0) throw new HttpError(400, 'Ya hay pagos registrados sobre la obligación que genera este movimiento. Anula esos pagos antes de cambiar el monto.');
        db.update('fin_obligations', derived.id, { amount_cents: data.amount_cents, updated_at: now() });
      }
      // Un aumento de monto hecho por alguien sin permiso de aprobación vuelve a revisarse.
      if (!isApprover && raw.kind === 'expense' && raw.approval_status === 'approved' && data.amount_cents > raw.amount_cents) {
        const threshold = getSetting('approval_threshold_cents', null);
        // El presupuesto ya incluye el monto anterior: solo se evalúa el incremento.
        const over = budgetImpact({ ...merged, amount_cents: data.amount_cents - raw.amount_cents }).find((w) => w.exceeds && w.over_action === 'approval');
        const reason = threshold && data.amount_cents >= threshold ? 'Supera el monto que requiere aprobación.' : over ? `Excede el presupuesto «${over.name}».` : null;
        if (reason) {
          requeued = reason;
          data.approval_status = 'pending';
          data.approval_reason = reason;
          data.approved_by = null;
          data.approved_at = null;
        }
      }
      db.update('fin_transactions', tx.id, { ...data, updated_by: req.user.id, updated_at: now() });
      const changes = diff(raw, data, ['concept', 'amount_cents', 'date', 'category_id', 'account_id', 'to_account_id', 'project_id', 'member_id', 'counterparty', 'payment_method', 'notes']);
      if (Object.keys(changes).length) {
        logActivity({ actor: req.user, entityType: 'transaction', entityId: tx.id, projectId: merged.project_id ?? null, action: 'updated', summary: `modificó ${describe(merged)}`, data: changes });
      }
    });
    if (requeued) {
      notify({ userIds: userIdsWithPermission('finance.approve'), type: 'finance', title: `Un gasto modificado por ${req.user.name} requiere aprobación`, body: `${merged.concept} · ${money(merged.amount_cents)}`, link: `/finance/movements?tx=${tx.id}`, actorId: req.user.id, entityType: 'transaction', entityId: tx.id });
    }
    changed();
    res.json({ ok: true, approval_status: requeued ? 'pending' : raw.approval_status });
  }),
);

/** Anulación controlada: el movimiento se conserva con su motivo y deja de contar en los totales. */
router.post(
  '/transactions/:id/void',
  handler((req, res) => {
    const tx = getTx(req.user, Number(req.params.id));
    if (tx.voided_at) throw new HttpError(400, 'El movimiento ya está anulado.');
    const allowed = can(req.user, 'finance.approve') || (tx.created_by === req.user.id && tx.approval_status === 'pending');
    if (!allowed) throw new HttpError(403, 'Solo alguien con permiso de aprobación puede anular movimientos.');
    const reason = str(req.body.reason, { field: 'El motivo de la anulación', required: true, max: 500 });
    transaction(() => {
      const derived = db.get('SELECT * FROM fin_obligations WHERE source_transaction_id = ? AND cancelled_at IS NULL', tx.id);
      if (derived) {
        const ob = getObligation(derived.id);
        if (ob.paid_cents > 0 || ob.pending_cents > 0) {
          throw new HttpError(400, `Primero anula los pagos registrados de «${ob.title}».`);
        }
        db.update('fin_obligations', derived.id, { cancelled_at: now(), cancelled_by: req.user.id, cancel_reason: `Movimiento de origen anulado: ${reason}`, updated_at: now() });
      }
      db.update('fin_transactions', tx.id, { voided_at: now(), voided_by: req.user.id, void_reason: reason });
      logActivity({ actor: req.user, entityType: 'transaction', entityId: tx.id, projectId: tx.project_id, action: 'voided', summary: `anuló ${describe(tx)}. Motivo: ${reason}` });
    });
    changed();
    res.json({ ok: true });
  }),
);

router.post(
  '/transactions/:id/approve',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const tx = getTx(req.user, Number(req.params.id));
    if (tx.voided_at || tx.approval_status !== 'pending') throw new HttpError(400, 'El movimiento no está pendiente de aprobación.');
    transaction(() => {
      db.update('fin_transactions', tx.id, { approval_status: 'approved', approved_by: req.user.id, approved_at: now() });
      applyEffects(tx.id);
      logActivity({ actor: req.user, entityType: 'transaction', entityId: tx.id, projectId: tx.project_id, action: 'approved', summary: `aprobó ${describe(tx)}` });
    });
    notify({ userIds: [tx.created_by], type: 'finance', title: `${req.user.name} aprobó «${tx.concept}»`, link: `/finance/movements?tx=${tx.id}`, actorId: req.user.id, entityType: 'transaction', entityId: tx.id });
    changed();
    res.json({ ok: true });
  }),
);

router.post(
  '/transactions/:id/reject',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const tx = getTx(req.user, Number(req.params.id));
    if (tx.voided_at || tx.approval_status !== 'pending') throw new HttpError(400, 'El movimiento no está pendiente de aprobación.');
    const reason = str(req.body.reason, { field: 'El motivo', required: true, max: 500 });
    db.update('fin_transactions', tx.id, { approval_status: 'rejected', approval_reason: reason, approved_by: req.user.id, approved_at: now() });
    logActivity({ actor: req.user, entityType: 'transaction', entityId: tx.id, projectId: tx.project_id, action: 'rejected', summary: `rechazó ${describe(tx)}. Motivo: ${reason}` });
    notify({ userIds: [tx.created_by], type: 'finance', title: `${req.user.name} rechazó «${tx.concept}»`, body: reason, link: `/finance/movements?tx=${tx.id}`, actorId: req.user.id, entityType: 'transaction', entityId: tx.id });
    changed();
    res.json({ ok: true });
  }),
);

// ───────── Cuentas por pagar y cobrar ─────────
router.get(
  '/obligations',
  handler((req, res) => {
    const where = ['1=1'];
    const params = [];
    if (!canSeeAll(req.user)) {
      where.push('(o.created_by = ? OR o.member_id = ?)');
      params.push(req.user.id, req.user.id);
    }
    if (req.query.direction) {
      where.push('o.direction = ?');
      params.push(String(req.query.direction));
    }
    if (req.query.source) {
      where.push('o.source = ?');
      params.push(String(req.query.source));
    }
    if (req.query.member_id) {
      where.push('o.member_id = ?');
      params.push(Number(req.query.member_id));
    }
    let rows = obligationsWithStatus(where.join(' AND '), params);
    const status = String(req.query.status || 'pending');
    if (status === 'pending') rows = rows.filter((o) => o.status === 'open' || o.status === 'partial');
    else if (status !== 'all') rows = rows.filter((o) => o.status === status);
    res.json(rows);
  }),
);

function getObligationFor(user, id) {
  const o = getObligation(id);
  if (!canSeeAll(user) && o.created_by !== user.id && o.member_id !== user.id) throw notFound('La obligación');
  return o;
}

router.get(
  '/obligations/:id',
  handler((req, res) => {
    const o = getObligationFor(req.user, Number(req.params.id));
    const payments = db.all(`${TX_SELECT} WHERE t.obligation_id = ? ORDER BY t.date, t.id`, o.id);
    res.json({ ...o, payments });
  }),
);

router.post(
  '/obligations',
  handler((req, res) => {
    requirePermission(req.user, 'finance.record');
    const direction = oneOf(req.body.direction, ['payable', 'receivable'], 'Tipo');
    if (!direction) throw new HttpError(400, 'Indica si es una cuenta por pagar o por cobrar.');
    const amount = toCents(req.body);
    if (!amount) throw new HttpError(400, 'El monto es obligatorio.');
    const categoryId = int(req.body.category_id, { field: 'Categoría', min: 1 }) ?? null;
    if (categoryId) {
      const cat = db.get('SELECT kind FROM fin_categories WHERE id = ?', categoryId);
      if (!cat || cat.kind !== (direction === 'payable' ? 'expense' : 'income')) throw new HttpError(400, 'La categoría no corresponde.');
    }
    const projectId = int(req.body.project_id, { field: 'Proyecto', min: 1 }) ?? null;
    if (projectId && !canViewProject(req.user, projectId)) throw new HttpError(400, 'El proyecto no existe.');
    const ts = now();
    const id = db.insert('fin_obligations', {
      direction,
      source: 'manual',
      title: str(req.body.title, { field: 'El concepto', required: true, max: 200 }),
      counterparty: str(req.body.counterparty, { field: 'La contraparte', max: 200 }) || '',
      member_id: int(req.body.member_id, { field: 'Integrante', min: 1 }) ?? null,
      amount_cents: amount,
      due_date: date(req.body.due_date, 'La fecha de vencimiento') ?? null,
      category_id: categoryId,
      project_id: projectId,
      notes: str(req.body.notes, { field: 'Notas', max: 2000 }) || '',
      created_by: req.user.id,
      created_at: ts,
      updated_at: ts,
    });
    logActivity({ actor: req.user, entityType: 'obligation', entityId: id, projectId, action: 'created', summary: `registró una cuenta por ${direction === 'payable' ? 'pagar' : 'cobrar'}: «${req.body.title}» por ${money(amount)}` });
    changed(['calendar']);
    res.status(201).json({ id });
  }),
);

router.patch(
  '/obligations/:id',
  handler((req, res) => {
    const o = getObligationFor(req.user, Number(req.params.id));
    if (!can(req.user, 'finance.approve') && o.created_by !== req.user.id) throw new HttpError(403, 'No puedes modificar esta obligación.');
    if (o.status === 'cancelled' || o.status === 'paid') throw new HttpError(400, 'La obligación ya está cerrada.');
    const amount = toCents(req.body);
    if (amount !== undefined) {
      if (o.source !== 'manual') throw new HttpError(400, 'El monto de esta obligación depende de su movimiento de origen.');
      if (amount < o.paid_cents) throw new HttpError(400, 'El monto no puede ser menor a lo ya pagado.');
    }
    db.update('fin_obligations', o.id, {
      title: req.body.title !== undefined ? str(req.body.title, { field: 'El concepto', required: true, max: 200 }) : undefined,
      counterparty: str(req.body.counterparty, { field: 'La contraparte', max: 200 }),
      amount_cents: amount,
      due_date: date(req.body.due_date, 'La fecha de vencimiento'),
      notes: str(req.body.notes, { field: 'Notas', max: 2000 }),
      updated_at: now(),
    });
    const changes = diff(o, { amount_cents: amount, due_date: req.body.due_date, title: req.body.title }, ['amount_cents', 'due_date', 'title']);
    if (Object.keys(changes).length) logActivity({ actor: req.user, entityType: 'obligation', entityId: o.id, action: 'updated', summary: `modificó «${o.title}»`, data: changes });
    changed(['calendar']);
    res.json({ ok: true });
  }),
);

/** Registra un pago/cobro (total o parcial). Crea el movimiento real que corresponde. */
router.post(
  '/obligations/:id/pay',
  handler((req, res) => {
    const o = getObligationFor(req.user, Number(req.params.id));
    if (o.status === 'cancelled' || o.status === 'paid') throw new HttpError(400, 'La obligación ya está cerrada.');
    const kind = settlementKind(o);
    requirePermission(req.user, kind === 'reimbursement' || kind === 'repayment' ? 'finance.approve' : 'finance.record');
    const amount = toCents(req.body) ?? o.remaining_cents;
    if (amount > o.remaining_cents - o.pending_cents) throw new HttpError(400, `El pago excede lo pendiente (${money(o.remaining_cents - o.pending_cents)}).`);
    const accountId = int(req.body.account_id, { field: 'Cuenta', min: 1, nullable: false });
    const acc = db.get('SELECT * FROM fin_accounts WHERE id = ? AND archived_at IS NULL', accountId);
    if (!acc) throw new HttpError(400, 'La cuenta no existe.');
    const tx = {
      kind,
      concept: str(req.body.concept, { field: 'El concepto', max: 200 }) || (o.direction === 'payable' ? `Pago: ${o.title}` : `Cobro: ${o.title}`),
      amount_cents: amount,
      date: date(req.body.date, 'La fecha') || today(),
      category_id: ['income', 'expense'].includes(kind) ? o.category_id : null,
      account_id: acc.id,
      project_id: o.project_id,
      member_id: o.member_id,
      counterparty: o.counterparty || '',
      payment_method: str(req.body.payment_method, { field: 'El método de pago', max: 60 }) || '',
      notes: str(req.body.notes, { field: 'Notas', max: 2000 }) || '',
      obligation_id: o.id,
    };
    const check = approvalRequirement(req.user, tx);
    const ts = now();
    const id = transaction(() => {
      const tid = db.insert('fin_transactions', {
        ...tx,
        approval_status: check.pending ? 'pending' : 'approved',
        approval_reason: check.reason,
        approved_by: check.pending ? null : req.user.id,
        approved_at: check.pending ? null : ts,
        created_by: req.user.id,
        updated_by: req.user.id,
        created_at: ts,
        updated_at: ts,
      });
      logActivity({ actor: req.user, entityType: 'transaction', entityId: tid, projectId: o.project_id, action: 'settlement', summary: `registró ${describe(tx)} (liquida «${o.title}»)` });
      return tid;
    });
    if (o.member_id && o.member_id !== req.user.id && !check.pending) {
      notify({ userIds: [o.member_id], type: 'finance', title: kind === 'reimbursement' ? `Se registró tu reembolso de ${money(amount)}` : `Se registró un pago de ${money(amount)}`, body: o.title, link: '/finance/partners', actorId: req.user.id, entityType: 'transaction', entityId: id });
    }
    if (check.pending) {
      notify({ userIds: userIdsWithPermission('finance.approve'), type: 'finance', title: `Pago pendiente de aprobación: ${o.title}`, body: money(amount), link: `/finance/movements?tx=${id}`, actorId: req.user.id, entityType: 'transaction', entityId: id });
    }
    changed(['calendar']);
    res.status(201).json({ id, approval_status: check.pending ? 'pending' : 'approved' });
  }),
);

router.post(
  '/obligations/:id/cancel',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const o = getObligationFor(req.user, Number(req.params.id));
    if (o.status === 'cancelled' || o.status === 'paid') throw new HttpError(400, 'La obligación ya está cerrada.');
    const reason = str(req.body.reason, { field: 'El motivo', required: true, max: 500 });
    db.update('fin_obligations', o.id, { cancelled_at: now(), cancelled_by: req.user.id, cancel_reason: reason, updated_at: now() });
    logActivity({ actor: req.user, entityType: 'obligation', entityId: o.id, action: 'cancelled', summary: `canceló «${o.title}»${o.paid_cents ? ` (se habían liquidado ${money(o.paid_cents)})` : ''}. Motivo: ${reason}` });
    changed(['calendar']);
    res.json({ ok: true });
  }),
);

// ───────── Presupuestos ─────────
router.get(
  '/budgets',
  handler((req, res) => {
    requirePermission(req.user, 'finance.view');
    res.json(budgetsWithSpend(req.query.archived ? '1=1' : 'b.archived_at IS NULL'));
  }),
);

function readBudget(b, creating) {
  const data = {
    name: creating || b.name !== undefined ? str(b.name, { field: 'El nombre', required: true, max: 120 }) : undefined,
    project_id: int(b.project_id, { field: 'Proyecto', min: 1 }),
    category_ids: b.category_ids !== undefined ? ids(b.category_ids, 'Categorías') : undefined,
    amount_cents: toCents(b),
    period_start: date(b.period_start, 'El inicio del periodo'),
    period_end: date(b.period_end, 'El fin del periodo'),
    owner_id: int(b.owner_id, { field: 'Responsable', min: 1 }),
    alert_pct: int(b.alert_pct, { field: 'Porcentaje de alerta', min: 1, max: 100 }),
    over_action: oneOf(b.over_action, ['warn', 'approval'], 'Acción al exceder'),
  };
  if (creating && (!data.amount_cents || !data.period_start || !data.period_end)) {
    throw new HttpError(400, 'El monto y el periodo son obligatorios.');
  }
  return data;
}

router.post(
  '/budgets',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const data = readBudget(req.body, true);
    if (data.period_end < data.period_start) throw new HttpError(400, 'El periodo no es válido.');
    const ts = now();
    const id = db.insert('fin_budgets', { ...data, category_ids: data.category_ids || [], created_by: req.user.id, created_at: ts, updated_at: ts });
    logActivity({ actor: req.user, entityType: 'budget', entityId: id, projectId: data.project_id ?? null, action: 'created', summary: `creó el presupuesto «${data.name}» por ${money(data.amount_cents)}` });
    changed();
    res.status(201).json({ id });
  }),
);

router.patch(
  '/budgets/:id',
  handler((req, res) => {
    requirePermission(req.user, 'finance.approve');
    const b = db.get('SELECT * FROM fin_budgets WHERE id = ?', req.params.id);
    if (!b) throw notFound('El presupuesto');
    const data = readBudget(req.body, false);
    db.update('fin_budgets', b.id, { ...data, archived_at: req.body.archived === undefined ? undefined : req.body.archived ? now() : null, updated_at: now() });
    const changes = diff(b, data, ['amount_cents', 'period_start', 'period_end', 'over_action']);
    logActivity({ actor: req.user, entityType: 'budget', entityId: b.id, projectId: b.project_id, action: 'updated', summary: `modificó el presupuesto «${b.name}»`, data: changes });
    changed();
    res.json({ ok: true });
  }),
);

// ───────── Socios: aportaciones, préstamos y reembolsos ─────────
router.get(
  '/partners',
  handler((req, res) => {
    const members = db.all('SELECT id, name, avatar_color, avatar_file_id, status FROM users ORDER BY name COLLATE NOCASE');
    const visible = canSeeAll(req.user) ? members : members.filter((m) => m.id === req.user.id);
    const rows = visible.map((m) => {
      const sum = (sql, ...p) => db.get(`SELECT COALESCE(SUM(t.amount_cents), 0) AS s FROM fin_transactions t WHERE ${VALID_TX} AND ${sql}`, ...p).s;
      const capital = sum("t.kind = 'contribution' AND t.member_id = ?", m.id);
      const loans = sum("t.kind = 'loan_in' AND t.member_id = ?", m.id);
      const paidPersonally = sum("t.kind = 'expense' AND t.paid_personally = 1 AND t.member_id = ?", m.id);
      const obligations = obligationsWithStatus("o.member_id = ? AND o.direction = 'payable' AND o.source IN ('reimbursement','loan')", [m.id]);
      const pendingReimb = obligations.filter((o) => o.source === 'reimbursement').reduce((s, o) => s + o.remaining_cents, 0);
      const pendingLoans = obligations.filter((o) => o.source === 'loan').reduce((s, o) => s + o.remaining_cents, 0);
      const reimbursed = sum("t.kind = 'reimbursement' AND t.member_id = ?", m.id);
      const repaid = sum("t.kind = 'repayment' AND t.member_id = ?", m.id);
      const byType = db.all(`SELECT t.contribution_type AS type, SUM(t.amount_cents) AS total FROM fin_transactions t WHERE ${VALID_TX} AND t.kind = 'contribution' AND t.member_id = ? GROUP BY t.contribution_type`, m.id);
      return {
        member: m,
        capital_cents: capital,
        contributions_by_type: byType,
        loans_cents: loans,
        loans_pending_cents: pendingLoans,
        repaid_cents: repaid,
        paid_personally_cents: paidPersonally,
        reimbursed_cents: reimbursed,
        reimbursements_pending_cents: pendingReimb,
        company_owes_cents: pendingReimb + pendingLoans,
      };
    });
    const contributions = db.all(
      `${TX_SELECT} WHERE ${VALID_TX} AND t.kind IN ('contribution','loan_in') ${canSeeAll(req.user) ? '' : 'AND t.member_id = ?'} ORDER BY t.date DESC LIMIT 200`,
      ...(canSeeAll(req.user) ? [] : [req.user.id]),
    );
    res.json({ partners: rows.filter((r) => canSeeAll(req.user) || r.member.id === req.user.id).filter((r) => r.member.status === 'active' || r.capital_cents || r.loans_cents || r.company_owes_cents), contributions });
  }),
);

// ───────── Resumen y reportes ─────────
router.get(
  '/summary',
  handler((req, res) => {
    requirePermission(req.user, 'finance.view');
    const from = date(req.query.from) || null;
    const to = date(req.query.to) || null;
    const projectId = int(req.query.project_id) ?? null;
    const categoryId = int(req.query.category_id) ?? null;
    const base = totals({ from, to, projectId, categoryId });
    const byCategory = db.all(
      `SELECT t.kind, t.category_id, COALESCE(c.name, 'Sin categoría') AS name, COALESCE(c.color, 'gray') AS color, SUM(t.amount_cents) AS total, COUNT(*) AS count
       FROM fin_transactions t LEFT JOIN fin_categories c ON c.id = t.category_id WHERE ${base.where}
       GROUP BY t.kind, t.category_id ORDER BY total DESC`,
      ...base.params,
    );
    const byProject = db.all(
      `SELECT t.project_id, COALESCE(p.name, 'Sin proyecto') AS name,
        SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income,
        SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END) AS expense
       FROM fin_transactions t LEFT JOIN projects p ON p.id = t.project_id WHERE ${base.where}
       GROUP BY t.project_id ORDER BY (income + expense) DESC`,
      ...base.params,
    );
    const monthly = db.all(
      `SELECT substr(t.date, 1, 7) AS month,
        SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income,
        SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END) AS expense
       FROM fin_transactions t WHERE ${base.where} GROUP BY month ORDER BY month`,
      ...base.params,
    );
    // Movimiento de caja (incluye aportaciones, préstamos, reembolsos y devoluciones).
    const cashWhere = [VALID_TX, "t.kind <> 'transfer'"];
    const cashParams = [];
    if (from) { cashWhere.push('t.date >= ?'); cashParams.push(from); }
    if (to) { cashWhere.push('t.date <= ?'); cashParams.push(to); }
    if (projectId) { cashWhere.push('t.project_id = ?'); cashParams.push(projectId); }
    const cash = db.get(
      `SELECT COALESCE(SUM(CASE WHEN t.kind IN ('income','contribution','loan_in') THEN t.amount_cents END), 0) AS inflow,
              COALESCE(SUM(CASE WHEN t.kind IN ('reimbursement','repayment') OR (t.kind = 'expense' AND t.account_id IS NOT NULL) THEN t.amount_cents END), 0) AS outflow,
              COALESCE(SUM(CASE WHEN t.kind = 'contribution' THEN t.amount_cents END), 0) AS contributions,
              COALESCE(SUM(CASE WHEN t.kind = 'loan_in' THEN t.amount_cents END), 0) AS loans
       FROM fin_transactions t WHERE ${cashWhere.join(' AND ')}`,
      ...cashParams,
    );
    const accounts = accountBalances();
    const open = obligationsWithStatus('o.cancelled_at IS NULL').filter((o) => o.status === 'open' || o.status === 'partial');
    const agg = (list) => ({ count: list.length, total_cents: list.reduce((s, o) => s + o.remaining_cents, 0), overdue: list.filter((o) => o.overdue).length });
    const pendingApprovals = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS s FROM fin_transactions WHERE approval_status = 'pending' AND voided_at IS NULL");
    const recent = db.all(`${TX_SELECT} WHERE t.voided_at IS NULL ORDER BY t.created_at DESC LIMIT 8`);
    res.json({
      period: { from, to },
      income_cents: base.income,
      expense_cents: base.expense,
      net_cents: base.net,
      count: base.count,
      by_category: byCategory,
      by_project: byProject,
      monthly,
      cash,
      accounts,
      total_balance_cents: accounts.reduce((s, a) => s + a.balance_cents, 0),
      payables: agg(open.filter((o) => o.direction === 'payable' && o.source === 'manual')),
      receivables: agg(open.filter((o) => o.direction === 'receivable')),
      owed_to_partners: agg(open.filter((o) => o.source !== 'manual')),
      upcoming_obligations: open.filter((o) => o.due_date).slice(0, 8),
      pending_approvals: { count: pendingApprovals.n, total_cents: pendingApprovals.s },
      budgets: budgetsWithSpend().filter((b) => b.period_end >= today()).slice(0, 6),
      recent,
    });
  }),
);

const GROUPS = {
  category: { key: 't.category_id', label: "COALESCE(c.name, 'Sin categoría')" },
  project: { key: 't.project_id', label: "COALESCE(p.name, 'Sin proyecto')" },
  member: { key: 't.created_by', label: "COALESCE(cu.name, '—')" },
  month: { key: 'substr(t.date, 1, 7)', label: 'substr(t.date, 1, 7)' },
  account: { key: 't.account_id', label: "COALESCE(a.name, 'Pagado por un integrante')" },
};

function reportRows(user, q) {
  requirePermission(user, 'finance.view');
  const group = GROUPS[q.group] ? q.group : 'category';
  const g = GROUPS[group];
  const f = txFilters(user, { ...q, status: undefined, kind: q.kind || 'income,expense' });
  return db.all(
    `SELECT ${g.key} AS group_key, ${g.label} AS label,
      SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income_cents,
      SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents ELSE 0 END) AS expense_cents,
      COUNT(*) AS count
     FROM fin_transactions t LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN fin_accounts a ON a.id = t.account_id
     WHERE ${f.where} AND t.approval_status = 'approved' GROUP BY group_key ORDER BY ${group === 'month' ? 'group_key' : 'expense_cents + income_cents DESC'}`,
    ...f.params,
  ).map((r) => ({ ...r, net_cents: r.income_cents - r.expense_cents }));
}

router.get(
  '/report',
  handler((req, res) => {
    const rows = reportRows(req.user, req.query);
    const total = rows.reduce((s, r) => ({ income_cents: s.income_cents + r.income_cents, expense_cents: s.expense_cents + r.expense_cents, count: s.count + r.count }), { income_cents: 0, expense_cents: 0, count: 0 });
    res.json({ rows, total: { ...total, net_cents: total.income_cents - total.expense_cents } });
  }),
);

function csv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\r\n');
}

const amount = (c) => (c / 100).toFixed(2);

router.get(
  '/export.csv',
  handler((req, res) => {
    const type = req.query.type === 'report' ? 'report' : req.query.type === 'obligations' ? 'obligations' : 'transactions';
    let body;
    if (type === 'report') {
      body = csv(reportRows(req.user, req.query), [
        { label: 'Grupo', value: (r) => r.label },
        { label: 'Ingresos', value: (r) => amount(r.income_cents) },
        { label: 'Gastos', value: (r) => amount(r.expense_cents) },
        { label: 'Balance', value: (r) => amount(r.net_cents) },
        { label: 'Movimientos', value: (r) => r.count },
      ]);
    } else if (type === 'obligations') {
      requirePermission(req.user, 'finance.view');
      body = csv(obligationsWithStatus(), [
        { label: 'Tipo', value: (o) => (o.direction === 'payable' ? 'Por pagar' : 'Por cobrar') },
        { label: 'Origen', value: (o) => ({ manual: 'Manual', reimbursement: 'Reembolso a socio', loan: 'Préstamo' })[o.source] },
        { label: 'Concepto', value: (o) => o.title },
        { label: 'Contraparte', value: (o) => o.member_name || o.counterparty },
        { label: 'Monto', value: (o) => amount(o.amount_cents) },
        { label: 'Pagado', value: (o) => amount(o.paid_cents) },
        { label: 'Pendiente', value: (o) => amount(o.remaining_cents) },
        { label: 'Vencimiento', value: (o) => o.due_date },
        { label: 'Estado', value: (o) => ({ open: 'Pendiente', partial: 'Parcial', paid: 'Liquidada', cancelled: 'Cancelada' })[o.status] },
      ]);
    } else {
      const f = txFilters(req.user, { ...req.query, status: req.query.status || 'all' });
      const rows = db.all(`${TX_SELECT} WHERE ${f.where} ORDER BY t.date, t.id`, ...f.params);
      body = csv(rows, [
        { label: 'ID', value: (r) => r.id },
        { label: 'Fecha', value: (r) => r.date },
        { label: 'Tipo', value: (r) => KIND_LABELS[r.kind] },
        { label: 'Concepto', value: (r) => r.concept },
        { label: 'Monto', value: (r) => amount(r.amount_cents) },
        { label: 'Categoría', value: (r) => r.category_name },
        { label: 'Cuenta', value: (r) => (r.paid_personally ? `Pagado por ${r.member_name}` : r.account_name) },
        { label: 'Cuenta destino', value: (r) => r.to_account_name },
        { label: 'Proyecto', value: (r) => r.project_name },
        { label: 'Integrante', value: (r) => r.member_name },
        { label: 'Contraparte', value: (r) => r.counterparty },
        { label: 'Método de pago', value: (r) => r.payment_method },
        { label: 'Registró', value: (r) => r.created_by_name },
        { label: 'Estado', value: (r) => (r.voided_at ? `Anulado: ${r.void_reason}` : { approved: 'Aprobado', pending: 'Pendiente de aprobación', rejected: 'Rechazado' }[r.approval_status]) },
        { label: 'Notas', value: (r) => r.notes },
      ]);
    }
    const stamp = today();
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="planta-emporio-${type}-${stamp}.csv"` });
    logActivity({ actor: req.user, entityType: 'finance', action: 'export', summary: `exportó ${type === 'report' ? 'un reporte' : type === 'obligations' ? 'las obligaciones' : 'los movimientos'} a CSV` });
    res.send(body);
  }),
);


export default router;
