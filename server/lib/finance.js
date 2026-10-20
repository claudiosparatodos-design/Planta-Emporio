import { db, now, getSetting } from './dbx.js';
import { HttpError, parseJson } from './http.js';
import { can } from './permissions.js';
import { today } from './workspace.js';

/** Condición de movimiento válido: aprobado y no anulado. Solo estos cuentan en totales. */
export const VALID_TX = "t.voided_at IS NULL AND t.approval_status = 'approved'";

export const KIND_LABELS = {
  income: 'Ingreso',
  expense: 'Gasto',
  contribution: 'Aportación',
  loan_in: 'Préstamo recibido',
  reimbursement: 'Reembolso a socio',
  repayment: 'Devolución de préstamo',
  transfer: 'Transferencia entre cuentas',
};

/** Convierte un monto a centavos enteros. Acepta amount_cents (entero) o amount (texto/número con decimales). */
export function toCents(body, field = 'El monto') {
  let cents;
  if (body.amount_cents !== undefined && body.amount_cents !== null && body.amount_cents !== '') {
    cents = Number(body.amount_cents);
  } else if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    const text = String(body.amount).replace(/[\s$,]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new HttpError(400, `${field} no es válido (usa hasta 2 decimales).`);
    const [int, dec = ''] = text.split('.');
    cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  } else {
    return undefined;
  }
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(400, `${field} debe ser mayor que cero.`);
  if (cents > 1e13) throw new HttpError(400, `${field} es demasiado grande.`);
  return cents;
}

export function accountBalances({ includeArchived = false } = {}) {
  return db.all(
    `SELECT a.*,
      a.initial_balance_cents
      + COALESCE((SELECT SUM(CASE t.kind
            WHEN 'income' THEN t.amount_cents WHEN 'contribution' THEN t.amount_cents WHEN 'loan_in' THEN t.amount_cents
            WHEN 'expense' THEN -t.amount_cents WHEN 'reimbursement' THEN -t.amount_cents WHEN 'repayment' THEN -t.amount_cents
            WHEN 'transfer' THEN -t.amount_cents ELSE 0 END)
          FROM fin_transactions t WHERE t.account_id = a.id AND ${VALID_TX}), 0)
      + COALESCE((SELECT SUM(t.amount_cents) FROM fin_transactions t
          WHERE t.to_account_id = a.id AND t.kind = 'transfer' AND ${VALID_TX}), 0) AS balance_cents,
      (SELECT COUNT(*) FROM fin_transactions t WHERE t.account_id = a.id OR t.to_account_id = a.id) AS tx_count
     FROM fin_accounts a ${includeArchived ? '' : 'WHERE a.archived_at IS NULL'} ORDER BY a.archived_at IS NOT NULL, a.id`,
  );
}

/** Obligaciones con lo pagado/cobrado calculado a partir de los movimientos reales. */
export function obligationsWithStatus(where = '1=1', params = []) {
  const rows = db.all(
    `SELECT o.*, u.name AS member_name, c.name AS category_name, p.name AS project_name,
      COALESCE((SELECT SUM(t.amount_cents) FROM fin_transactions t WHERE t.obligation_id = o.id AND ${VALID_TX}), 0) AS paid_cents,
      COALESCE((SELECT SUM(t.amount_cents) FROM fin_transactions t WHERE t.obligation_id = o.id AND t.voided_at IS NULL AND t.approval_status = 'pending'), 0) AS pending_cents
     FROM fin_obligations o LEFT JOIN users u ON u.id = o.member_id LEFT JOIN fin_categories c ON c.id = o.category_id
     LEFT JOIN projects p ON p.id = o.project_id WHERE ${where} ORDER BY o.due_date IS NULL, o.due_date, o.id`,
    ...params,
  );
  const t = today();
  return rows.map((o) => {
    const remaining = Math.max(0, o.amount_cents - o.paid_cents);
    let status = 'open';
    if (o.cancelled_at) status = 'cancelled';
    else if (remaining === 0) status = 'paid';
    else if (o.paid_cents > 0) status = 'partial';
    return { ...o, remaining_cents: o.cancelled_at ? 0 : remaining, status, overdue: (status === 'open' || status === 'partial') && o.due_date && o.due_date < t };
  });
}

export function getObligation(id) {
  const [o] = obligationsWithStatus('o.id = ?', [id]);
  if (!o) throw new HttpError(404, 'La obligación no existe.');
  return o;
}

/** Presupuestos con gasto real (aprobado) y gasto pendiente de aprobación. */
export function budgetsWithSpend(where = 'b.archived_at IS NULL', params = []) {
  const rows = db.all(
    `SELECT b.*, p.name AS project_name, u.name AS owner_name FROM fin_budgets b
     LEFT JOIN projects p ON p.id = b.project_id LEFT JOIN users u ON u.id = b.owner_id WHERE ${where} ORDER BY b.period_start DESC, b.id`,
    ...params,
  );
  return rows.map((b) => {
    const cats = parseJson(b.category_ids, []);
    const spent = budgetSpend(b, cats, "t.voided_at IS NULL AND t.approval_status = 'approved'");
    const pending = budgetSpend(b, cats, "t.voided_at IS NULL AND t.approval_status = 'pending'");
    const pct = Math.round((spent / b.amount_cents) * 100);
    return {
      ...b,
      category_ids: cats,
      spent_cents: spent,
      pending_cents: pending,
      remaining_cents: b.amount_cents - spent,
      pct,
      state: spent > b.amount_cents ? 'over' : pct >= b.alert_pct ? 'warning' : 'ok',
    };
  });
}

function budgetSpend(b, cats, cond) {
  const where = [`t.kind = 'expense'`, cond, 't.date >= ?', 't.date <= ?'];
  const params = [b.period_start, b.period_end];
  if (b.project_id) {
    where.push('t.project_id = ?');
    params.push(b.project_id);
  }
  if (cats.length) where.push(`t.category_id IN (${cats.map(() => '?').join(',')})`);
  return db.get(`SELECT COALESCE(SUM(t.amount_cents), 0) AS s FROM fin_transactions t WHERE ${where.join(' AND ')}`, ...params, ...cats).s;
}

/** Presupuestos que un gasto afectaría y si los excede. */
export function budgetImpact(tx) {
  if (tx.kind !== 'expense') return [];
  const budgets = budgetsWithSpend('b.archived_at IS NULL AND b.period_start <= ? AND b.period_end >= ?', [tx.date, tx.date]);
  return budgets
    .filter((b) => (!b.project_id || b.project_id === tx.project_id) && (!b.category_ids.length || b.category_ids.includes(tx.category_id)))
    .map((b) => {
      const after = b.spent_cents + b.pending_cents + tx.amount_cents;
      return { id: b.id, name: b.name, amount_cents: b.amount_cents, spent_after_cents: after, exceeds: after > b.amount_cents, over_action: b.over_action, alert: after >= (b.amount_cents * b.alert_pct) / 100 };
    })
    .filter((b) => b.alert);
}

/**
 * Determina si un gasto requiere aprobación: supera el umbral global o un presupuesto
 * configurado con "solicitar aprobación". Quien tiene permiso de aprobar no queda bloqueado.
 */
export function approvalRequirement(user, tx) {
  const warnings = budgetImpact(tx);
  if (tx.kind !== 'expense' || can(user, 'finance.approve')) return { pending: false, warnings, reason: null };
  const threshold = getSetting('approval_threshold_cents', null);
  if (threshold && tx.amount_cents >= threshold) {
    return { pending: true, warnings, reason: 'Supera el monto que requiere aprobación.' };
  }
  const blocking = warnings.find((w) => w.exceeds && w.over_action === 'approval');
  if (blocking) return { pending: true, warnings, reason: `Excede el presupuesto «${blocking.name}».` };
  return { pending: false, warnings, reason: null };
}

/** Efectos de un movimiento aprobado: crea las obligaciones derivadas (reembolsos y préstamos). */
export function applyEffects(txId, input = {}) {
  const tx = db.get('SELECT * FROM fin_transactions WHERE id = ?', txId);
  if (!tx || tx.voided_at || tx.approval_status !== 'approved') return null;
  if (db.get('SELECT 1 FROM fin_obligations WHERE source_transaction_id = ?', tx.id)) return null;
  const member = tx.member_id ? db.get('SELECT name FROM users WHERE id = ?', tx.member_id) : null;
  if (tx.kind === 'expense' && tx.paid_personally) {
    return db.insert('fin_obligations', {
      direction: 'payable',
      source: 'reimbursement',
      title: `Reembolso: ${tx.concept}`,
      counterparty: member?.name || '',
      member_id: tx.member_id,
      amount_cents: tx.amount_cents,
      due_date: input.reimburse_due_date || null,
      category_id: tx.category_id,
      project_id: tx.project_id,
      source_transaction_id: tx.id,
      created_by: tx.created_by,
      created_at: now(),
      updated_at: now(),
    });
  }
  if (tx.kind === 'loan_in') {
    return db.insert('fin_obligations', {
      direction: 'payable',
      source: 'loan',
      title: `Devolución de préstamo: ${tx.concept}`,
      counterparty: member?.name || tx.counterparty || '',
      member_id: tx.member_id,
      amount_cents: tx.amount_cents,
      due_date: input.repay_due_date || null,
      project_id: tx.project_id,
      source_transaction_id: tx.id,
      created_by: tx.created_by,
      created_at: now(),
      updated_at: now(),
    });
  }
  return null;
}

/** Tipo de movimiento con el que se liquida cada obligación. */
export function settlementKind(o) {
  if (o.source === 'reimbursement') return 'reimbursement';
  if (o.source === 'loan') return 'repayment';
  return o.direction === 'payable' ? 'expense' : 'income';
}

export function totals({ from, to, projectId, categoryId }) {
  const where = [VALID_TX, "t.kind IN ('income','expense')"];
  const params = [];
  if (from) {
    where.push('t.date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('t.date <= ?');
    params.push(to);
  }
  if (projectId) {
    where.push('t.project_id = ?');
    params.push(projectId);
  }
  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  const w = where.join(' AND ');
  const sum = db.get(
    `SELECT COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount_cents END), 0) AS income,
            COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount_cents END), 0) AS expense,
            COUNT(*) AS count FROM fin_transactions t WHERE ${w}`,
    ...params,
  );
  return { where: w, params, income: sum.income, expense: sum.expense, net: sum.income - sum.expense, count: sum.count };
}
