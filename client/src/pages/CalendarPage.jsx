import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, CalendarClock, CheckSquare, Wallet, FolderKanban, Bell } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { isoDate, money, fmtTime } from '../lib/format.js';
import { useCan } from '../lib/hooks.js';
import { Button, ErrorState, Switch } from '../components/ui.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { MonthCalendar, monthGrid, useTaskPatch } from '../components/tasks.jsx';

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [mine, setMine] = useState(false);
  const [show, setShow] = useState({ tasks: true, meetings: true, money: true, projects: true, reminders: true });
  const { openTask, openCreate } = useLayout();
  const navigate = useNavigate();
  const patch = useTaskPatch();
  const canRecord = useCan('finance.record');
  const canView = useCan('finance.view');
  const canFinance = canRecord || canView;
  const grid = monthGrid(month);
  const from = isoDate(grid[0]);
  const to = isoDate(grid[41]);
  const { data, error, refetch } = useQuery({ queryKey: ['calendar', from, to, mine], queryFn: () => api.get(`/calendar${qs({ from, to, mine: mine ? 1 : undefined })}`) });

  const events = useMemo(() => {
    if (!data) return [];
    const out = [];
    if (show.tasks) {
      for (const t of data.tasks.filter((x) => x.due_date)) {
        out.push({ key: `t${t.id}`, date: t.due_date, kind: 'task', title: t.title, done: t.status === 'done', draggable: true, task: t, onClick: () => openTask(t.id), icon: <CheckSquare size={11} /> });
      }
    }
    if (show.meetings) {
      for (const m of data.meetings) {
        const d = isoDate(new Date(m.starts_at));
        out.push({ key: `m${m.id}`, date: d, kind: 'meeting', title: `${fmtTime(m.starts_at)} ${m.title}`, onClick: () => navigate(`/meetings/${m.id}`), icon: <CalendarClock size={11} /> });
      }
    }
    if (show.money) {
      for (const o of data.obligations) {
        out.push({ key: `o${o.id}`, date: o.due_date, kind: 'money', title: `${o.direction === 'payable' ? 'Pagar' : 'Cobrar'} ${money(o.remaining_cents)} · ${o.title}`, onClick: () => navigate('/finance/obligations'), icon: <Wallet size={11} /> });
      }
    }
    if (show.projects) {
      for (const p of data.projects) out.push({ key: `p${p.id}`, date: p.due_date, kind: 'project', title: `Meta: ${p.name}`, onClick: () => navigate(`/projects/${p.id}`), icon: <FolderKanban size={11} /> });
    }
    if (show.reminders) {
      for (const r of data.reminders) out.push({ key: `r${r.id}`, date: isoDate(new Date(r.remind_at)), kind: 'reminder', title: r.title, icon: <Bell size={11} /> });
    }
    const order = { meeting: 0, project: 1, money: 2, task: 3, reminder: 4 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }, [data, show, openTask, navigate]);

  const toggle = (k) => setShow({ ...show, [k]: !show[k] });
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Calendario' }]}
        actions={
          <>
            <Button size="sm" icon={CalendarClock} onClick={() => openCreate('meeting')}>Reunión</Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate('task')}>Tarea</Button>
          </>
        }
      />
      <div className="content">
        <div className="page wide" style={{ maxWidth: 1300 }}>
          <div className="filter-bar">
            {[
              ['tasks', 'Tareas', 'cal-ev task'],
              ['meetings', 'Reuniones', 'cal-ev meeting'],
              canFinance && ['money', 'Pagos y cobros', 'cal-ev money'],
              ['projects', 'Metas de proyecto', 'cal-ev project'],
              ['reminders', 'Mis recordatorios', 'cal-ev reminder'],
            ].filter(Boolean).map(([k, label, cls]) => (
              <button key={k} className={`filter-chip ${show[k] ? 'on' : ''}`} onClick={() => toggle(k)}>
                <span className={cls} style={{ width: 10, height: 10, padding: 0, borderRadius: 3 }} />
                {label}
              </button>
            ))}
            <span className="spacer" style={{ flex: 1 }} />
            <Switch checked={mine} onChange={setMine} label="Solo mis tareas" />
          </div>
          {error ? <ErrorState error={error} onRetry={refetch} /> : (
            <MonthCalendar
              month={month}
              onMonth={setMonth}
              events={events}
              onDropEvent={(ev, date) => ev.task && patch(ev.task.id, { due_date: date })}
              onDayClick={(date) => openCreate('task', { due_date: date })}
            />
          )}
          <p className="faint small mt-2 hide-sm">Arrastra una tarea a otro día para cambiar su fecha. Doble clic en un día para crear una tarea con esa fecha.</p>
        </div>
      </div>
    </>
  );
}
