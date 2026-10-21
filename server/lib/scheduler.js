import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, now, getSetting, setSetting, backupTo } from './dbx.js';
import { notify } from './notify.js';
import { enabledRules, markRun, resolveTargets, taskContext } from './automations.js';
import { obligationsWithStatus } from './finance.js';
import { addDays, today } from './workspace.js';
import { mirrorEnabled } from './mirror.js';

/** Marca un aviso como enviado. Devuelve false si ya se había enviado (evita duplicados). */
function once(key) {
  const exists = db.get('SELECT 1 FROM sent_reminders WHERE key = ?', key);
  if (exists) return false;
  db.run('INSERT INTO sent_reminders (key, created_at) VALUES (?, ?)', key, now());
  return true;
}

const money = (cents) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: getSetting('currency', 'MXN') }).format(cents / 100);

function taskDueReminders() {
  for (const rule of enabledRules('task.due_soon')) {
    const days = Number(rule.conditions.days_before ?? 1);
    const target = addDays(today(), days);
    const tasks = db.all(
      `SELECT t.id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND t.status <> 'done' AND t.due_date >= ? AND t.due_date <= ? AND (p.id IS NULL OR p.deleted_at IS NULL)`,
      today(),
      target,
    );
    let ran = false;
    for (const { id } of tasks) {
      const task = taskContext(id);
      if (!once(`due:${rule.id}:${id}:${task.due_date}`)) continue;
      const when = task.due_date === today() ? 'vence hoy' : task.due_date === addDays(today(), 1) ? 'vence mañana' : `vence el ${task.due_date}`;
      notify({
        userIds: resolveTargets(rule.action_config.targets, task),
        type: 'due_soon',
        title: `«${task.title}» ${when}`,
        body: task.project_name ? `Proyecto: ${task.project_name}` : null,
        link: `/tasks/${id}`,
        entityType: 'task',
        entityId: id,
      });
      ran = true;
    }
    if (ran) markRun(rule);
  }
}

function obligationReminders() {
  for (const rule of enabledRules('obligation.due_soon')) {
    const days = Number(rule.conditions.days_before ?? 3);
    const target = addDays(today(), days);
    const list = obligationsWithStatus('o.cancelled_at IS NULL AND o.due_date IS NOT NULL AND o.due_date <= ?', [target]).filter(
      (o) => o.status === 'open' || o.status === 'partial',
    );
    let ran = false;
    for (const o of list) {
      if (!once(`obl:${rule.id}:${o.id}:${o.due_date}`)) continue;
      const ids = [];
      if (rule.action_config.targets?.includes('creator')) ids.push(o.created_by);
      if (rule.action_config.targets?.includes('member') && o.member_id) ids.push(o.member_id);
      const verb = o.direction === 'payable' ? 'Pago' : 'Cobro';
      notify({
        userIds: ids,
        type: 'finance',
        title: `${verb} ${o.due_date < today() ? 'vencido' : 'próximo'}: ${o.title}`,
        body: `${money(o.remaining_cents)} · vence ${o.due_date}`,
        link: '/finance/obligations',
        entityType: 'obligation',
        entityId: o.id,
      });
      ran = true;
    }
    if (ran) markRun(rule);
  }
}

function meetingReminders() {
  for (const rule of enabledRules('meeting.upcoming')) {
    const minutes = Number(rule.conditions.minutes_before ?? 60);
    const limit = new Date(Date.now() + minutes * 60_000).toISOString();
    const meetings = db.all(
      "SELECT * FROM meetings WHERE deleted_at IS NULL AND status = 'scheduled' AND starts_at > ? AND starts_at <= ?",
      now(),
      limit,
    );
    for (const m of meetings) {
      if (!once(`meet:${rule.id}:${m.id}:${m.starts_at}`)) continue;
      const people = db.all('SELECT user_id FROM meeting_participants WHERE meeting_id = ?', m.id).map((r) => r.user_id);
      const time = new Date(m.starts_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: getSetting('timezone') });
      notify({ userIds: people, type: 'meeting', title: `«${m.title}» comienza a las ${time}`, body: m.location || null, link: `/meetings/${m.id}`, entityType: 'meeting', entityId: m.id });
      markRun(rule);
    }
  }
}

function personalReminders() {
  const due = db.all('SELECT * FROM reminders WHERE done_at IS NULL AND notified_at IS NULL AND remind_at <= ?', now());
  for (const r of due) {
    db.run('UPDATE reminders SET notified_at = ? WHERE id = ?', now(), r.id);
    const link = r.entity_type === 'task' ? `/tasks/${r.entity_id}` : r.entity_type === 'page' ? `/docs/${r.entity_id}` : '/';
    notify({ userIds: [r.user_id], type: 'reminder', title: `Recordatorio: ${r.title}`, link, entityType: 'reminder', entityId: r.id });
  }
}

function cleanup() {
  db.run('DELETE FROM sessions WHERE expires_at < ?', now());
  db.run('DELETE FROM sent_reminders WHERE created_at < ?', new Date(Date.now() - 120 * 864e5).toISOString());
  db.run('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?', new Date(Date.now() - 180 * 864e5).toISOString());
}

export function runBackup(label = 'auto') {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `planta-${label}-${stamp}.db`;
  backupTo(path.join(config.backupsDir, name));
  // Conserva solo los respaldos automáticos más recientes.
  const autos = fs
    .readdirSync(config.backupsDir)
    .filter((f) => f.startsWith('planta-auto-'))
    .sort()
    .reverse();
  for (const old of autos.slice(config.backupsToKeep)) fs.rmSync(path.join(config.backupsDir, old), { force: true });
  setSetting('last_backup_at', now());
  return name;
}

function dailyBackup() {
  // Con Turso las copias diarias ya se guardan fuera del servidor.
  if (config.dbFile === ':memory:' || mirrorEnabled()) return;
  const last = getSetting('last_backup_at', null);
  if (last && Date.now() - Date.parse(last) < 24 * 3600e3) return;
  if (!db.get('SELECT 1 FROM users')) return;
  try {
    runBackup('auto');
  } catch (err) {
    console.error('[respaldo] Falló el respaldo automático:', err.message);
  }
}

export function tick() {
  const jobs = [taskDueReminders, obligationReminders, meetingReminders, personalReminders, cleanup, dailyBackup];
  for (const job of jobs) {
    try {
      job();
    } catch (err) {
      console.error(`[programador] ${job.name}:`, err);
    }
  }
}

export function startScheduler() {
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 60_000).unref();
}
