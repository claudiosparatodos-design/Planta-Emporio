import { Router } from 'express';
import { db, getSetting } from '../lib/dbx.js';
import { handler } from '../lib/http.js';
import { can, canViewPage, canViewProject, projectVisibilitySql, taskVisibilitySql } from '../lib/permissions.js';
import { decorateTasks, listTasks } from '../lib/tasks.js';
import { projectStats } from './projects.js';
import { accountBalances, obligationsWithStatus, totals } from '../lib/finance.js';
import { addDays, today } from '../lib/workspace.js';
import { usersById } from '../lib/users.js';

const router = Router();
const FINANCE_ENTITIES = new Set(['transaction', 'account', 'budget', 'obligation', 'finance']);

/** Filtra la bitácora según lo que cada persona puede ver. */
export function visibleActivity(user, rows) {
  const projectCache = new Map();
  const seeProject = (id) => {
    if (!projectCache.has(id)) projectCache.set(id, canViewProject(user, id));
    return projectCache.get(id);
  };
  const out = rows.filter((r) => {
    if (FINANCE_ENTITIES.has(r.entity_type)) return can(user, 'finance.view');
    if (r.entity_type === 'page') {
      const p = db.get('SELECT * FROM pages WHERE id = ?', r.entity_id);
      if (p && !p.deleted_at && !canViewPage(user, p)) return false;
    }
    if (r.project_id && !seeProject(r.project_id)) return false;
    return true;
  });
  const users = usersById(out.map((r) => r.actor_id));
  return out.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null, actor: users.get(r.actor_id) || null }));
}

export function recentActivity(user, limit = 20, where = '1=1', params = []) {
  const rows = db.all(`SELECT * FROM activity WHERE ${where} ORDER BY id DESC LIMIT ?`, ...params, limit * 3);
  return visibleActivity(user, rows).slice(0, limit);
}

function monthRange() {
  const t = today();
  return { from: `${t.slice(0, 7)}-01`, to: t };
}

function financeSnapshot(user) {
  if (!can(user, 'finance.view')) return null;
  const month = monthRange();
  const m = totals(month);
  const year = totals({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const accounts = accountBalances();
  const open = obligationsWithStatus('o.cancelled_at IS NULL').filter((o) => o.status === 'open' || o.status === 'partial');
  const soon = addDays(today(), 7);
  const pending = db.get("SELECT COUNT(*) AS n FROM fin_transactions WHERE approval_status = 'pending' AND voided_at IS NULL").n;
  return {
    month: { ...month, income_cents: m.income, expense_cents: m.expense, net_cents: m.net },
    year: { income_cents: year.income, expense_cents: year.expense, net_cents: year.net },
    balance_cents: accounts.reduce((s, a) => s + a.balance_cents, 0),
    payable_cents: open.filter((o) => o.direction === 'payable').reduce((s, o) => s + o.remaining_cents, 0),
    receivable_cents: open.filter((o) => o.direction === 'receivable').reduce((s, o) => s + o.remaining_cents, 0),
    due_soon: open.filter((o) => o.due_date && o.due_date <= soon).slice(0, 5),
    pending_approvals: can(user, 'finance.approve') ? pending : null,
  };
}

router.get(
  '/me',
  handler((req, res) => {
    const u = req.user;
    const t = today();
    const weekEnd = addDays(t, 7);
    const mine = listTasks(u, { assignee: 'me', include_subtasks: true, status: 'idea,todo,in_progress,review,blocked' });
    mine.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || priorityRank(b) - priorityRank(a));
    const overdue = mine.filter((x) => x.due_date && x.due_date < t);
    const dueSoon = mine.filter((x) => x.due_date && x.due_date >= t && x.due_date <= weekEnd);

    // Lo que necesita mi atención aunque no esté asignado a mí.
    const review = decorateTasks(
      db.all(
        `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND t.status = 'review' AND ${taskVisibilitySql(u, 't')}
         AND (p.owner_id = ? OR t.created_by = ?) AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ?)
         ORDER BY t.updated_at DESC LIMIT 20`,
        u.id, u.id, u.id,
      ),
    );
    const blocked = decorateTasks(
      db.all(
        `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND t.status = 'blocked' AND p.owner_id = ?
         AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ?) LIMIT 20`,
        u.id, u.id,
      ),
    );
    const waitingOnMe = decorateTasks(
      db.all(
        `SELECT DISTINCT t.*, p.name AS project_name FROM task_dependencies d
         JOIN tasks t ON t.id = d.task_id JOIN tasks mine ON mine.id = d.depends_on_id
         JOIN task_assignees ma ON ma.task_id = mine.id AND ma.user_id = ?
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE mine.status <> 'done' AND mine.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status <> 'done' AND ${taskVisibilitySql(u, 't')} LIMIT 20`,
        u.id,
      ),
    );

    const projectsRows = db.all(
      `SELECT p.* FROM projects p WHERE p.deleted_at IS NULL AND p.status IN ('active','planning') AND ${projectVisibilitySql(u, 'p')}
       AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))
       ORDER BY p.updated_at DESC LIMIT 8`,
      u.id, u.id,
    );
    const stats = projectStats(projectsRows.map((p) => p.id));
    const projects = projectsRows.map((p) => {
      const s = stats.get(p.id) || { total: 0, done: 0, overdue: 0, blocked: 0 };
      return { ...p, stats: s, progress: s.total ? Math.round((s.done / s.total) * 100) : 0 };
    });

    const meetings = db
      .all(
        `SELECT m.* FROM meetings m JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = ?
         WHERE m.deleted_at IS NULL AND m.status = 'scheduled' AND m.starts_at >= ? AND m.starts_at <= ? ORDER BY m.starts_at LIMIT 6`,
        u.id, new Date(Date.now() - 2 * 3600e3).toISOString(), new Date(Date.now() + 14 * 864e5).toISOString(),
      )
      .filter((m) => !m.project_id || canViewProject(u, m.project_id));

    const reminders = db.all(
      'SELECT * FROM reminders WHERE user_id = ? AND done_at IS NULL ORDER BY remind_at LIMIT 8',
      u.id,
    );
    const notifications = db.all(
      'SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 6',
      u.id,
    );
    const unreadCount = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id).n;
    const decisions = db.all(
      `SELECT d.id, d.title, d.created_at, us.name AS proposed_by_name FROM decisions d
       JOIN decision_approvers da ON da.decision_id = d.id AND da.user_id = ? AND da.response = 'pending'
       LEFT JOIN users us ON us.id = d.proposed_by
       WHERE d.status = 'proposed' AND d.deleted_at IS NULL ORDER BY d.created_at`,
      u.id,
    );
    const myReimbursements = obligationsWithStatus("o.member_id = ? AND o.direction = 'payable' AND o.source <> 'manual' AND o.cancelled_at IS NULL", [u.id])
      .filter((o) => o.remaining_cents > 0);
    const inboxCount = db.get('SELECT COUNT(*) AS n FROM inbox_items WHERE user_id = ? AND processed_at IS NULL', u.id).n;

    res.json({
      today: t,
      my_tasks: mine.slice(0, 40),
      counts: { open: mine.length, overdue: overdue.length, due_soon: dueSoon.length },
      overdue,
      due_soon: dueSoon,
      attention: { review, blocked, waiting_on_me: waitingOnMe },
      projects,
      meetings,
      reminders,
      notifications,
      unread_notifications: unreadCount,
      decisions,
      finance: financeSnapshot(u),
      my_reimbursements: myReimbursements,
      inbox_count: inboxCount,
      activity: recentActivity(u, 15),
      onboarding: onboarding(u),
    });
  }),
);

function priorityRank(t) {
  return { urgent: 4, high: 3, medium: 2, low: 1, none: 0 }[t.priority] || 0;
}

function onboarding(user) {
  if (getSetting('onboarding_dismissed', false)) return null;
  const steps = [
    { key: 'members', label: 'Invita a tus socios y al equipo', done: db.get('SELECT COUNT(*) AS n FROM users').n > 1 || Boolean(db.get('SELECT 1 FROM invitations WHERE revoked_at IS NULL')), href: '/members', show: can(user, 'members.manage') },
    { key: 'project', label: 'Crea tu primer proyecto', done: Boolean(db.get('SELECT 1 FROM projects WHERE deleted_at IS NULL')), href: '/projects?new=1', show: can(user, 'projects.create') },
    { key: 'task', label: 'Asigna una tarea', done: Boolean(db.get('SELECT 1 FROM task_assignees')), href: '/tasks', show: true },
    { key: 'doc', label: 'Escribe un documento (por ejemplo, los acuerdos entre socios)', done: Boolean(db.get('SELECT 1 FROM pages WHERE is_template = 0 AND deleted_at IS NULL')), href: '/docs', show: can(user, 'docs.edit') },
    { key: 'finance', label: 'Configura tus cuentas y registra el primer movimiento', done: Boolean(db.get('SELECT 1 FROM fin_transactions')), href: '/finance', show: can(user, 'finance.record') },
    { key: 'chat', label: 'Saluda al equipo en el chat', done: Boolean(db.get('SELECT 1 FROM messages')), href: '/chat', show: true },
  ].filter((s) => s.show);
  if (steps.every((s) => s.done)) return null;
  return { steps, can_dismiss: can(user, 'settings.manage') };
}

router.get(
  '/company',
  handler((req, res) => {
    const u = req.user;
    const t = today();
    const vis = taskVisibilitySql(u, 't');
    const projectsRows = db.all(
      `SELECT p.*, us.name AS owner_name FROM projects p LEFT JOIN users us ON us.id = p.owner_id
       WHERE p.deleted_at IS NULL AND p.status IN ('active','planning','paused') AND ${projectVisibilitySql(u, 'p')}
       ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END, p.due_date IS NULL, p.due_date`,
    );
    const stats = projectStats(projectsRows.map((p) => p.id));
    const projects = projectsRows.map((p) => {
      const s = stats.get(p.id) || { total: 0, done: 0, overdue: 0, blocked: 0 };
      return { ...p, stats: s, progress: s.total ? Math.round((s.done / s.total) * 100) : 0 };
    });
    const taskTotals = db.get(
      `SELECT COUNT(*) AS total,
        SUM(t.status = 'done') AS done,
        SUM(t.status <> 'done') AS open,
        SUM(t.status = 'blocked') AS blocked,
        SUM(t.status <> 'done' AND t.due_date < ?) AS overdue,
        SUM(t.status = 'done' AND t.completed_at >= ?) AS done_week
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NULL) AND ${vis}`,
      t,
      new Date(Date.now() - 7 * 864e5).toISOString(),
    );
    const workload = db.all(
      `SELECT u.id, u.name, u.avatar_color, u.avatar_file_id,
        COUNT(CASE WHEN t.status <> 'done' THEN 1 END) AS open,
        COUNT(CASE WHEN t.status <> 'done' AND t.due_date < ? THEN 1 END) AS overdue,
        COUNT(CASE WHEN t.status <> 'done' AND t.due_date BETWEEN ? AND ? THEN 1 END) AS this_week,
        COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN t.status = 'done' AND t.completed_at >= ? THEN 1 END) AS done_week
       FROM users u
       LEFT JOIN task_assignees ta ON ta.user_id = u.id
       LEFT JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL AND ${vis}
         AND (t.project_id IS NULL OR t.project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL))
       WHERE u.status = 'active' GROUP BY u.id ORDER BY open DESC, u.name`,
      t, t, addDays(t, 7), new Date(Date.now() - 7 * 864e5).toISOString(),
    );
    const upcoming = listTasks(u, { due_from: t, due_to: addDays(t, 14), status: 'idea,todo,in_progress,review,blocked', include_subtasks: true })
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 15);
    const overdueTasks = listTasks(u, { overdue: true, include_subtasks: true }).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 15);
    const goals = db
      .all("SELECT id, title, status, period, target_date, owner_id FROM goals WHERE deleted_at IS NULL AND status NOT IN ('dropped') ORDER BY target_date IS NULL, target_date LIMIT 8");
    const goalProgress = goals.map((g) => {
      const krs = db.all('SELECT start_value, target_value, current_value FROM key_results WHERE goal_id = ?', g.id);
      let progress;
      if (krs.length) {
        progress = Math.round(
          krs.reduce((s, k) => {
            const span = k.target_value - k.start_value;
            const p = span === 0 ? (k.current_value >= k.target_value ? 1 : 0) : (k.current_value - k.start_value) / span;
            return s + Math.max(0, Math.min(1, p));
          }, 0) / krs.length * 100,
        );
      } else {
        const st = db.get(
          `SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL
           AND (goal_id = ? OR project_id IN (SELECT id FROM projects WHERE goal_id = ? AND deleted_at IS NULL))`,
          g.id, g.id,
        );
        progress = st.total ? Math.round(((st.done || 0) / st.total) * 100) : 0;
      }
      return { ...g, progress };
    });
    res.json({
      today: t,
      projects,
      tasks: { total: taskTotals.total || 0, done: taskTotals.done || 0, open: taskTotals.open || 0, blocked: taskTotals.blocked || 0, overdue: taskTotals.overdue || 0, done_week: taskTotals.done_week || 0 },
      workload,
      upcoming,
      overdue: overdueTasks,
      goals: goalProgress,
      finance: financeSnapshot(u),
      activity: recentActivity(u, 25),
    });
  }),
);


export default router;
