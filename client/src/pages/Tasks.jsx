import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { List, KanbanSquare, Table2, CalendarDays, GanttChart, Plus, Search, Bookmark, Trash2, MoreHorizontal, Share2, CheckSquare } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { STATUSES } from '../lib/constants.js';
import { useAction, usePref, useMe } from '../lib/hooks.js';
import { Button, EmptyState, ErrorState, SkeletonList, Segmented, Switch } from '../components/ui.jsx';
import { Menu, useConfirm, Modal } from '../components/overlay.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { Board, MonthCalendar, TaskFilters, TaskListView, TaskTable, Timeline, applyLocalFilters, useTaskPatch } from '../components/tasks.jsx';

export const VIEW_OPTIONS = [
  { value: 'list', label: 'Lista', icon: List },
  { value: 'board', label: 'Tablero', icon: KanbanSquare },
  { value: 'table', label: 'Tabla', icon: Table2 },
  { value: 'calendar', label: 'Calendario', icon: CalendarDays },
  { value: 'timeline', label: 'Cronograma', icon: GanttChart },
];

const SCOPES = [
  { value: 'mine', label: 'Asignadas a mí' },
  { value: 'created', label: 'Creadas por mí' },
  { value: 'all', label: 'Todas' },
  { value: 'unassigned', label: 'Sin asignar' },
];

/** Vista de tareas con sus 5 formas de visualización (comparten datos y filtros). */
export function TaskViews({ tasks, view, filters, groupBy, quickAddDefaults, showProject, columns, projectId, editableColumns, onColumnsChange }) {
  const patch = useTaskPatch();
  const { openTask, openCreate } = useLayout();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const visible = useMemo(() => applyLocalFilters(tasks, filters), [tasks, filters]);
  const onToggle = (t, status) => patch(t.id, { status }, { status, completed_at: status === 'done' ? new Date().toISOString() : null });

  if (view === 'board') {
    const cols = columns?.length ? columns.map((c) => ({ ...c, real: true })) : STATUSES.map((s) => ({ id: s.key, name: s.label, category: s.key }));
    return (
      <Board
        columns={cols}
        tasks={visible}
        projectId={projectId}
        editable={editableColumns}
        onColumnsChange={onColumnsChange}
        showProject={showProject}
        onToggle={onToggle}
        onMoveTask={(task, column, position) => {
          if (column.real) patch(task.id, { column_id: column.id, position }, { column_id: column.id, status: column.category, position });
          else patch(task.id, { status: column.category, position }, { status: column.category, position });
        }}
      />
    );
  }
  const wrap = (child) => <div className="view-pad">{child}</div>;
  if (view === 'table') return wrap(<TaskTable tasks={visible} onPatch={(id, p) => patch(id, p)} showProject={showProject} />);
  if (view === 'calendar') {
    const events = visible
      .filter((t) => t.due_date)
      .map((t) => ({ key: `t${t.id}`, date: t.due_date, kind: 'task', title: t.title, done: t.status === 'done', draggable: true, onClick: () => openTask(t.id), task: t }));
    return wrap(
      <>
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          events={events}
          onDropEvent={(ev, date) => patch(ev.task.id, { due_date: date })}
          onDayClick={(date) => openCreate('task', { ...quickAddDefaults, due_date: date })}
        />
        <p className="faint small mt-2 hide-sm">Arrastra una tarea a otro día para cambiar su fecha límite. Doble clic en un día para crear una tarea.</p>
        {visible.some((t) => !t.due_date) && <p className="faint small mt-1">{visible.filter((t) => !t.due_date).length} tareas sin fecha no aparecen en el calendario.</p>}
      </>,
    );
  }
  if (view === 'timeline') return wrap(<Timeline tasks={visible} />);
  return wrap(
    visible.length || quickAddDefaults ? (
      <TaskListView tasks={visible} groupBy={groupBy} onToggle={onToggle} quickAddDefaults={quickAddDefaults} showProject={showProject} />
    ) : (
      <EmptyState icon={CheckSquare} title="No hay tareas con estos filtros" />
    ),
  );
}

export default function Tasks() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [view, setView] = usePref('taskView', 'list');
  const [scope, setScope] = useState('mine');
  const [groupBy, setGroupBy] = useState('due');
  const [filters, setFilters] = useState({ hideDone: false });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const { openCreate } = useLayout();
  const viewId = params.get('view');

  const { data: views = [] } = useQuery({ queryKey: ['views'], queryFn: () => api.get('/views') });
  const savedView = views.find((v) => String(v.id) === viewId);
  useEffect(() => {
    if (savedView) {
      const c = savedView.config || {};
      setScope(c.scope || 'all');
      setFilters(c.filters || {});
      if (c.view) setView(c.view);
      if (c.groupBy) setGroupBy(c.groupBy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedView?.id]);

  const query = {
    mine: { assignee: 'me', include_subtasks: 1 },
    created: { created_by: 'me', include_subtasks: 1 },
    all: {},
    unassigned: { assignee: 'none' },
  }[scope];
  const { data: tasks = [], isLoading, error, refetch } = useQuery({ queryKey: ['tasks', 'list', scope], queryFn: () => api.get(`/tasks${qs(query)}`) });

  const saveView = useAction((body) => api.post('/views', body), { invalidate: ['views'], success: 'Vista guardada', onSuccess: (r) => { setSaving(false); setParams({ view: r.id }); } });
  const deleteView = useAction((id) => api.del(`/views/${id}`), { invalidate: ['views', 'favorites'], onSuccess: () => setParams({}) });
  const updateView = useAction((body) => api.patch(`/views/${savedView.id}`, body), { invalidate: ['views'], success: 'Vista actualizada' });
  const toggleFavorite = useAction((id) => api.post('/favorites', { entity_type: 'view', entity_id: id }), { invalidate: ['favorites'], success: 'Favoritos actualizados' });

  return (
    <>
      <Topbar
        crumbs={[{ label: savedView ? savedView.name : 'Mis tareas' }]}
        actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate('task', scope === 'mine' ? { assignee_ids: [me.id] } : {})}>Nueva tarea</Button>}
      />
      <div className="content">
        <div className="page wide" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
          <div className="view-toolbar" style={{ paddingTop: 4 }}>
            <h1 className="page-title" style={{ marginRight: 'auto' }}>{savedView ? savedView.name : 'Tareas'}</h1>
          </div>
          <div className="view-toolbar">
            <div className="segmented" role="tablist">
              {SCOPES.map((s) => (
                <button key={s.value} className={!savedView && scope === s.value ? 'active' : ''} onClick={() => { setScope(s.value); setParams({}); }}>{s.label}</button>
              ))}
              {views.map((v) => (
                <button key={v.id} className={savedView?.id === v.id ? 'active' : ''} onClick={() => setParams({ view: v.id })}><Bookmark size={12} />{v.name}</button>
              ))}
            </div>
            <span className="spacer" style={{ flex: 1 }} />
            <Segmented value={view} onChange={setView} options={VIEW_OPTIONS} size="sm" />
          </div>
          <div className="view-toolbar">
            <div className="flex" style={{ flex: 1, minWidth: 220, maxWidth: 300 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={14} className="faint" style={{ position: 'absolute', left: 9, top: 9 }} />
                <input className="input" style={{ paddingLeft: 30, height: 30 }} placeholder="Filtrar por título…" value={filters.q || ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              </div>
            </div>
            <TaskFilters value={filters} onChange={setFilters} showProject />
            <span style={{ flex: 1 }} />
            {view === 'list' && (
              <select className="select" style={{ width: 'auto', height: 30 }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Agrupar por">
                <option value="due">Agrupar por fecha</option>
                <option value="status">Agrupar por estado</option>
                <option value="priority">Agrupar por prioridad</option>
                <option value="project">Agrupar por proyecto</option>
              </select>
            )}
            <Switch checked={filters.hideDone} onChange={(v) => setFilters({ ...filters, hideDone: v })} label="Ocultar terminadas" />
            {savedView ? (
              savedView.mine && (
                <Menu
                  trigger={(p) => <Button size="sm" variant="ghost" icon={MoreHorizontal} {...p}>Vista</Button>}
                  items={[
                    { label: 'Actualizar con los filtros actuales', icon: Bookmark, onClick: () => updateView.mutate({ config: { scope, filters, view, groupBy } }) },
                    { label: 'Agregar / quitar de favoritos', icon: Bookmark, onClick: () => toggleFavorite.mutate(savedView.id) },
                    { label: savedView.shared ? 'Dejar de compartir con el equipo' : 'Compartir con el equipo', icon: Share2, onClick: () => updateView.mutate({ shared: !savedView.shared }) },
                    'sep',
                    { label: 'Eliminar vista', icon: Trash2, danger: true, onClick: async () => (await confirm({ title: `¿Eliminar la vista «${savedView.name}»?`, confirmLabel: 'Eliminar', danger: true })) && deleteView.mutate(savedView.id) },
                  ]}
                />
              )
            ) : (
              <Button size="sm" variant="ghost" icon={Bookmark} onClick={() => setSaving(true)}>Guardar vista</Button>
            )}
          </div>
          {isLoading ? (
            <div className="view-pad"><SkeletonList rows={8} /></div>
          ) : error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : (
            <TaskViews
              tasks={tasks}
              view={view}
              filters={filters}
              groupBy={groupBy}
              showProject
              quickAddDefaults={view === 'list' ? (scope === 'mine' ? { assignee_ids: [me.id] } : {}) : undefined}
            />
          )}
        </div>
      </div>
      {saving && <SaveViewModal onClose={() => setSaving(false)} onSave={(name, shared) => saveView.mutate({ name, shared, config: { scope, filters, view, groupBy } })} loading={saveView.isPending} />}
    </>
  );
}

function SaveViewModal({ onClose, onSave, loading }) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  return (
    <Modal
      size="sm"
      title="Guardar vista"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!name.trim()} loading={loading} onClick={() => onSave(name.trim(), shared)}>Guardar</Button></>}
    >
      <p className="muted small mb-3">Guarda los filtros y la forma de ver actuales, por ejemplo «Pendientes urgentes» o «Tareas de esta semana».</p>
      <input className="input" autoFocus placeholder="Nombre de la vista" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim(), shared)} />
      <div className="mt-3"><Switch checked={shared} onChange={setShared} label="Compartir con todo el equipo" /></div>
    </Modal>
  );
}

