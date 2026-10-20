import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCorners, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check, MessageSquare, Paperclip, ListChecks, GitBranch, Plus, MoreHorizontal, Pencil, Trash2, ArrowLeft, ArrowRight, ChevronLeft,
  ChevronRight, Lock, ArrowUpDown, X, Filter, Users, Flag, CalendarDays, Tag, CircleDot, FolderKanban,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { STATUS, STATUSES, PRIORITY, PRIORITIES } from '../lib/constants.js';
import { addDaysIso, cap, dueState, fmtDate, isoDate, relativeDay, todayIso } from '../lib/format.js';
import { useAction, useMemberMap, useTags, useActiveMembers, useProjects, useIsMobile } from '../lib/hooks.js';
import { Avatar, AvatarStack, Button, DueDate, IconButton, Pill, PriorityFlag, StatusPill, EmptyState } from './ui.jsx';
import { Menu, Popover, useConfirm, useToast } from './overlay.jsx';
import { DateField, OptionList, PriorityPicker, StatusPicker, UserPicker } from './pickers.jsx';
import { useLayout } from './Layout.jsx';

// ───────── Actualización optimista compartida por todas las vistas ─────────
export function useUpdateTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useAction((vars) => api.patch(`/tasks/${vars.id}`, vars.patch), {
    onError: (err) => {
      toast.error(err);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    invalidate: ['tasks', 'dashboard', 'projects', 'calendar'],
  });
}

export function patchTaskCaches(qc, id, patch) {
  qc.setQueriesData({ queryKey: ['tasks'] }, (old) => {
    if (!Array.isArray(old)) return old;
    return old.map((t) => (t.id === id ? { ...t, ...patch } : t));
  });
}

/** Mutación con actualización inmediata en pantalla. */
export function useTaskPatch() {
  const qc = useQueryClient();
  const update = useUpdateTask();
  return (id, patch, optimistic = patch) => {
    patchTaskCaches(qc, id, optimistic);
    update.mutate({ id, patch });
  };
}

export function TaskCheck({ task, onToggle }) {
  const done = task.status === 'done';
  return (
    <button
      type="button"
      className={`task-check ${done ? 'done' : ''} ${task.status === 'blocked' ? 'blocked' : ''}`}
      aria-label={done ? 'Marcar como pendiente' : 'Marcar como terminada'}
      title={done ? 'Marcar como pendiente' : 'Marcar como terminada'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(task, done ? 'todo' : 'done');
      }}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

function CardMeta({ task, members, showProject }) {
  const assignees = task.assignee_ids.map((id) => members.get(id)).filter(Boolean);
  return (
    <>
      {showProject && task.project_name && <span className="meta-ico truncate" style={{ maxWidth: 140 }}>{task.project_icon || '📁'} {task.project_name}</span>}
      {task.due_date && <DueDate task={task} />}
      <PriorityFlag priority={task.priority} />
      {task.checklist_count > 0 && <span className="meta-ico"><ListChecks size={12.5} />{task.checklist_done}/{task.checklist_count}</span>}
      {task.subtask_count > 0 && <span className="meta-ico"><GitBranch size={12.5} />{task.subtask_done}/{task.subtask_count}</span>}
      {task.comment_count > 0 && <span className="meta-ico"><MessageSquare size={12.5} />{task.comment_count}</span>}
      {task.attachment_count > 0 && <span className="meta-ico"><Paperclip size={12.5} />{task.attachment_count}</span>}
      {task.open_dependencies > 0 && <span className="meta-ico" title="Depende de tareas pendientes" style={{ color: 'var(--warning)' }}><Lock size={12} /></span>}
      <span className="spacer" />
      <AvatarStack users={assignees} size="xs" />
    </>
  );
}

export function TaskRow({ task, onToggle, showProject = true }) {
  const members = useMemberMap();
  const { openTask } = useLayout();
  const assignees = task.assignee_ids.map((id) => members.get(id)).filter(Boolean);
  return (
    <div className={`task-row ${task.status === 'done' ? 'is-done' : ''}`} onClick={() => openTask(task.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTask(task.id)}>
      <TaskCheck task={task} onToggle={onToggle} />
      <span className="task-title">{task.title}</span>
      <span className="task-meta">
        {task.tags?.slice(0, 2).map((t) => <Pill key={t.id} color={t.color} size="sm" className="hide-sm">{t.name}</Pill>)}
        {task.status !== 'todo' && task.status !== 'done' && <span className="hide-sm"><StatusPill status={task.status} size="sm" /></span>}
        {showProject && task.project_name && <span className="hide-sm truncate" style={{ maxWidth: 160 }}>{task.project_icon || '📁'} {task.project_name}</span>}
        {task.open_dependencies > 0 && <Lock size={12} style={{ color: 'var(--warning)' }} />}
        <PriorityFlag priority={task.priority} />
        <DueDate task={task} />
        <AvatarStack users={assignees} size="xs" />
      </span>
    </div>
  );
}

/** Captura rápida: Enter crea la tarea solo con título. */
export function QuickAdd({ defaults = {}, placeholder = 'Agregar tarea…', autoFocus }) {
  const [title, setTitle] = useState('');
  const create = useAction((body) => api.post('/tasks', body), { invalidate: ['tasks', 'projects', 'dashboard'] });
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ ...defaults, title: title.trim() });
    setTitle('');
  };
  return (
    <form className="quick-add" onSubmit={submit}>
      <Plus size={16} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder} />
      {title && <Button type="submit" size="xs" variant="primary" loading={create.isPending}>Agregar</Button>}
    </form>
  );
}

// ───────── Lista agrupada ─────────
const GROUPERS = {
  status: { label: 'Estado', key: (t) => t.status, order: STATUSES.map((s) => s.key), title: (k) => STATUS[k]?.label },
  priority: { label: 'Prioridad', key: (t) => t.priority, order: PRIORITIES.map((p) => p.key), title: (k) => PRIORITY[k]?.label },
  project: { label: 'Proyecto', key: (t) => t.project_name || 'Sin proyecto' },
  due: {
    label: 'Fecha límite',
    key: (t) => {
      if (!t.due_date) return '5';
      const s = dueState(t);
      if (s === 'overdue') return '0';
      if (t.due_date === todayIso()) return '1';
      if (t.due_date <= addDaysIso(todayIso(), 7)) return '2';
      return '3';
    },
    order: ['0', '1', '2', '3', '5'],
    title: (k) => ({ 0: 'Vencidas', 1: 'Hoy', 2: 'Próximos 7 días', 3: 'Más adelante', 5: 'Sin fecha' })[k],
  },
};

export function TaskListView({ tasks, groupBy = 'status', onToggle, quickAddDefaults, showProject = true }) {
  const g = GROUPERS[groupBy] || GROUPERS.status;
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      const k = g.key(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    const keys = g.order ? g.order.filter((k) => m.has(k)) : [...m.keys()].sort();
    return keys.map((k) => ({ key: k, title: g.title ? g.title(k) : k, items: m.get(k).sort(sortTasks) }));
  }, [tasks, g]);
  return (
    <div>
      {quickAddDefaults && <QuickAdd defaults={quickAddDefaults} />}
      {groups.map((grp) => (
        <div key={grp.key}>
          <div className="group-head">
            {groupBy === 'status' && <span className={`swatch m-${STATUS[grp.key]?.color}`} style={{ borderRadius: '50%' }} />}
            {grp.title}
            <span className="count">{grp.items.length}</span>
          </div>
          {grp.items.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} showProject={showProject} />)}
        </div>
      ))}
    </div>
  );
}

export function sortTasks(a, b) {
  const ad = a.due_date || '9999';
  const bd = b.due_date || '9999';
  if (ad !== bd) return ad.localeCompare(bd);
  return (PRIORITY[b.priority]?.rank || 0) - (PRIORITY[a.priority]?.rank || 0) || a.position - b.position;
}

// ───────── Tabla ─────────
export function TaskTable({ tasks, columns, onPatch, showProject = true }) {
  const members = useMemberMap();
  const { openTask } = useLayout();
  const [sort, setSort] = useState({ key: 'due_date', dir: 1 });
  const sorted = useMemo(() => {
    const val = (t) => {
      if (sort.key === 'priority') return PRIORITY[t.priority]?.rank ?? 0;
      if (sort.key === 'status') return STATUSES.findIndex((s) => s.key === t.status);
      if (sort.key === 'assignee') return members.get(t.assignee_ids[0])?.name || '~';
      return t[sort.key] ?? '~';
    };
    return [...tasks].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [tasks, sort, members]);
  const th = (key, label) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))} style={{ cursor: 'pointer' }}>
      {label} {sort.key === key && <ArrowUpDown size={11} style={{ verticalAlign: -1 }} />}
    </th>
  );
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {th('title', 'Tarea')}
            {th('status', 'Estado')}
            {th('assignee', 'Responsables')}
            {th('priority', 'Prioridad')}
            {th('due_date', 'Fecha límite')}
            {showProject && th('project_name', 'Proyecto')}
            <th>Etiquetas</th>
            {th('estimate_minutes', 'Estimado')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => openTask(t.id)}>
              <td style={{ minWidth: 220 }}>
                <span className="flex">
                  <TaskCheck task={t} onToggle={(task, status) => onPatch(task.id, { status })} />
                  <span className={t.status === 'done' ? 'faint' : ''}>{t.title}</span>
                </span>
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <StatusPicker value={t.status} onChange={(s) => onPatch(t.id, { status: s })} />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <UserPicker value={t.assignee_ids} onChange={(ids) => onPatch(t.id, { assignee_ids: ids })}>
                  {({ onClick }) => (
                    <button className="prop-btn" onClick={onClick}>
                      {t.assignee_ids.length ? <AvatarStack users={t.assignee_ids.map((id) => members.get(id))} size="xs" /> : <span className="faint">—</span>}
                    </button>
                  )}
                </UserPicker>
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <PriorityPicker value={t.priority} onChange={(p) => onPatch(t.id, { priority: p })} />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <DateField value={t.due_date} onChange={(d) => onPatch(t.id, { due_date: d })} />
              </td>
              {showProject && <td className="muted truncate" style={{ maxWidth: 180 }}>{t.project_name ? `${t.project_icon || '📁'} ${t.project_name}` : '—'}</td>}
              <td>
                <span className="flex wrap" style={{ gap: 4 }}>{t.tags.map((g) => <Pill key={g.id} color={g.color} size="sm">{g.name}</Pill>)}</span>
              </td>
              <td className="muted num">{t.estimate_minutes ? `${Math.round((t.estimate_minutes / 60) * 10) / 10} h` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && <EmptyState compact title="No hay tareas con estos filtros" />}
    </div>
  );
}

// ───────── Tablero Kanban ─────────
function SortableCard({ task, onToggle, showProject }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `t-${task.id}`, data: { task } });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BoardCard task={task} dragging={isDragging} onToggle={onToggle} showProject={showProject} />
    </div>
  );
}

export function BoardCard({ task, dragging, overlay, showProject }) {
  const members = useMemberMap();
  const { openTask } = useLayout();
  return (
    <div
      className={`board-card ${dragging ? 'dragging' : ''} ${overlay ? 'overlay-card' : ''} ${task.status === 'done' ? 'is-done' : ''}`}
      onClick={() => !overlay && openTask(task.id)}
    >
      {task.tags?.length > 0 && (
        <div className="bc-tags">{task.tags.map((t) => <Pill key={t.id} color={t.color} size="sm">{t.name}</Pill>)}</div>
      )}
      <div className="bc-title">{task.title}</div>
      <div className="bc-meta">
        <CardMeta task={task} members={members} showProject={showProject} />
      </div>
    </div>
  );
}

function BoardColumn({ column, tasks, onToggle, onRename, onDelete, onMove, onCategory, editable, quickAddDefaults, isFirst, isLast, showProject }) {
  const { setNodeRef, isOver } = useDroppable({ id: `c-${column.id}`, data: { column } });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const color = STATUS[column.category]?.color;
  return (
    <div className={`board-col ${isOver ? 'drop-target' : ''}`}>
      <div className="col-head">
        <span className={`swatch m-${column.color || color}`} style={{ borderRadius: '50%' }} />
        {editing ? (
          <input
            className="input"
            style={{ height: 26 }}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name !== column.name) onRename(column, name.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(column.name); setEditing(false); } }}
          />
        ) : (
          <span className="col-name" onDoubleClick={() => editable && setEditing(true)}>{column.name}</span>
        )}
        <span className="count">{tasks.length}</span>
        <IconButton icon={Plus} size="xs" label="Agregar tarea" onClick={() => setAdding(true)} />
        {editable && (
          <Menu
            trigger={(p) => <IconButton icon={MoreHorizontal} size="xs" label="Opciones de columna" {...p} />}
            items={[
              { label: 'Renombrar', icon: Pencil, onClick: () => setEditing(true) },
              { section: 'Tipo de estado' },
              ...STATUSES.map((s) => ({ label: s.label, checked: column.category === s.key, onClick: () => onCategory(column, s.key) })),
              'sep',
              !isFirst && { label: 'Mover a la izquierda', icon: ArrowLeft, onClick: () => onMove(column, -1) },
              !isLast && { label: 'Mover a la derecha', icon: ArrowRight, onClick: () => onMove(column, 1) },
              { label: 'Eliminar columna', icon: Trash2, danger: true, onClick: () => onDelete(column) },
            ]}
          />
        )}
      </div>
      <div className="col-body" ref={setNodeRef}>
        {adding && <InlineCardCreator defaults={{ ...quickAddDefaults, ...(column.real ? { column_id: column.id } : { status: column.category }) }} onDone={() => setAdding(false)} />}
        <SortableContext items={tasks.map((t) => `t-${t.id}`)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <SortableCard key={t.id} task={t} onToggle={onToggle} showProject={showProject} />)}
        </SortableContext>
        {!tasks.length && !adding && <div className="faint small" style={{ padding: '10px 4px', textAlign: 'center' }}>Arrastra tarjetas aquí</div>}
      </div>
      {!adding && (
        <div className="col-add">
          <Button size="xs" variant="ghost" icon={Plus} block style={{ justifyContent: 'flex-start' }} onClick={() => setAdding(true)}>Agregar tarea</Button>
        </div>
      )}
    </div>
  );
}

function InlineCardCreator({ defaults, onDone }) {
  const [title, setTitle] = useState('');
  const create = useAction((body) => api.post('/tasks', body), { invalidate: ['tasks', 'projects', 'dashboard'] });
  const submit = () => {
    if (title.trim()) create.mutate({ ...defaults, title: title.trim() });
    setTitle('');
  };
  return (
    <div className="board-card" style={{ cursor: 'text' }}>
      <textarea
        className="textarea ghost"
        autoFocus
        rows={2}
        style={{ minHeight: 0, padding: 0, border: 0, boxShadow: 'none', background: 'transparent' }}
        placeholder="Título de la tarea… (Enter para crear)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onDone();
        }}
        onBlur={() => { if (title.trim()) submit(); onDone(); }}
      />
    </div>
  );
}

/**
 * Tablero genérico. columns: [{id, name, category, real}] — real = columna de proyecto.
 * onMoveTask(task, column, position) aplica el cambio.
 */
export function Board({ columns, tasks, onMoveTask, onToggle, editable, onColumnsChange, projectId, showProject }) {
  const isMobile = useIsMobile();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const columnOf = (t) => {
    if (columns[0]?.real) {
      const c = columns.find((col) => col.id === t.column_id);
      return c ? c.id : columns.find((col) => col.category === t.status)?.id ?? columns[0].id;
    }
    return t.status;
  };
  const build = () => {
    const m = Object.fromEntries(columns.map((c) => [c.id, []]));
    for (const t of tasks) {
      const cid = columnOf(t);
      if (m[cid]) m[cid].push(t);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.position - b.position || a.id - b.id);
    return m;
  };
  const [items, setItems] = useState(build);
  const [active, setActive] = useState(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setItems(build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, columns]);

  const findCol = (id) => {
    if (String(id).startsWith('c-')) return String(id).slice(2);
    const tid = Number(String(id).slice(2));
    return Object.keys(items).find((k) => items[k].some((t) => t.id === tid));
  };
  const key = (k) => (columns[0]?.real ? Number(k) : k);

  const onDragStart = ({ active: a }) => {
    dragging.current = true;
    setActive(a.data.current.task);
  };
  const onDragOver = ({ active: a, over }) => {
    if (!over) return;
    const from = findCol(a.id);
    const to = findCol(over.id);
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const task = prev[from].find((t) => `t-${t.id}` === a.id);
      if (!task) return prev;
      const target = [...prev[to]];
      const overIndex = target.findIndex((t) => `t-${t.id}` === over.id);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, task);
      return { ...prev, [from]: prev[from].filter((t) => t.id !== task.id), [to]: target };
    });
  };
  const onDragEnd = ({ active: a, over }) => {
    dragging.current = false;
    setActive(null);
    if (!over) return setItems(build());
    const col = findCol(a.id);
    const overCol = findCol(over.id);
    if (!col) return setItems(build());
    let list = [...items[col]];
    const oldIndex = list.findIndex((t) => `t-${t.id}` === a.id);
    let newIndex = String(over.id).startsWith('c-') ? list.length - 1 : list.findIndex((t) => `t-${t.id}` === over.id);
    if (col === overCol && newIndex >= 0 && oldIndex !== newIndex) {
      const [moved] = list.splice(oldIndex, 1);
      list.splice(newIndex, 0, moved);
    } else newIndex = oldIndex;
    const idx = list.findIndex((t) => `t-${t.id}` === a.id);
    const prev = list[idx - 1];
    const next = list[idx + 1];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1024 : next ? next.position - 1024 : 1024;
    const task = list[idx];
    list[idx] = { ...task, position };
    setItems({ ...items, [col]: list });
    const column = columns.find((c) => String(c.id) === String(col));
    if (task.position !== position || columnOf(task) !== key(col)) onMoveTask(task, column, position);
  };

  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ['projects', 'tasks'].includes(q.queryKey[0]) });
  const colAction = async (fn) => {
    try {
      await fn();
      refresh();
      onColumnsChange?.();
    } catch (e) {
      toast.error(e);
    }
  };
  const rename = (c, name) => colAction(() => api.patch(`/projects/${projectId}/columns/${c.id}`, { name }));
  const category = async (c, cat) => {
    const n = items[c.id]?.length || 0;
    if (n && !(await confirm({ title: 'Cambiar el tipo de columna', message: `Las ${n} tareas de «${c.name}» pasarán al estado «${STATUS[cat].label}».`, confirmLabel: 'Cambiar' }))) return;
    colAction(() => api.patch(`/projects/${projectId}/columns/${c.id}`, { category: cat }));
  };
  const move = (c, dir) => {
    const order = columns.map((x) => x.id);
    const i = order.indexOf(c.id);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    colAction(() => api.post(`/projects/${projectId}/columns-order`, { ids: order }));
  };
  const remove = async (c) => {
    const others = columns.filter((x) => x.id !== c.id);
    if (!others.length) return toast.error('El tablero necesita al menos una columna.');
    const n = items[c.id]?.length || 0;
    const target = others.find((x) => x.category === c.category) || others[0];
    const ok = await confirm({
      title: `¿Eliminar la columna «${c.name}»?`,
      message: n ? `Sus ${n} tareas se moverán a «${target.name}». No se elimina ninguna tarea.` : 'La columna está vacía.',
      confirmLabel: 'Eliminar columna',
      danger: true,
    });
    if (ok) colAction(() => api.del(`/projects/${projectId}/columns/${c.id}?move_to=${target.id}`));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { dragging.current = false; setActive(null); setItems(build()); }}>
      <div className="board">
        {columns.map((c, i) => (
          <BoardColumn
            key={c.id}
            column={c}
            tasks={items[c.id] || []}
            onToggle={onToggle}
            editable={editable}
            onRename={rename}
            onCategory={category}
            onMove={move}
            onDelete={remove}
            isFirst={i === 0}
            isLast={i === columns.length - 1}
            quickAddDefaults={projectId ? { project_id: projectId } : {}}
            showProject={showProject}
          />
        ))}
        {editable && <AddColumn projectId={projectId} onAdded={refresh} />}
      </div>
      <DragOverlay dropAnimation={isMobile ? null : undefined}>{active ? <BoardCard task={active} overlay showProject={showProject} /> : null}</DragOverlay>
    </DndContext>
  );
}

function AddColumn({ projectId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('todo');
  const add = useAction(() => api.post(`/projects/${projectId}/columns`, { name, category }), { onSuccess: () => { setName(''); setOpen(false); onAdded(); } });
  if (!open) {
    return (
      <div className="board-add-col">
        <Button variant="ghost" icon={Plus} onClick={() => setOpen(true)}>Agregar columna</Button>
      </div>
    );
  }
  return (
    <div className="board-col" style={{ padding: 10, width: 260 }}>
      <input className="input" autoFocus placeholder="Nombre de la columna" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add.mutate()} />
      <label className="label mt-2" style={{ display: 'block' }}>Equivale al estado</label>
      <select className="select mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
        {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <div className="flex mt-3">
        <Button size="sm" variant="primary" disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>Agregar</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </div>
  );
}

// ───────── Calendario mensual ─────────
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** events: [{key, date, kind, title, draggable, onClick, done, icon}] */
export function MonthCalendar({ month, onMonth, events, onDropEvent, onDayClick }) {
  const days = useMemo(() => monthGrid(month), [month]);
  const [overDay, setOverDay] = useState(null);
  const [more, setMore] = useState(null);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date).push(e);
    }
    return m;
  }, [events]);
  const today = todayIso();
  const label = cap(month.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
  // Hay 6 semanas; si la última es del mes siguiente completa, se oculta.
  const visible = days[35].getMonth() !== month.getMonth() ? days.slice(0, 35) : days;
  return (
    <div>
      <div className="flex mb-3">
        <h3 style={{ fontSize: 16, minWidth: 150 }}>{label}</h3>
        <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
        <Button size="sm" variant="ghost" onClick={() => onMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoy</Button>
      </div>
      <div className="cal">
        <div className="cal-head">{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
        <div className="cal-grid">
          {visible.map((d) => {
            const iso = isoDate(d);
            const list = byDay.get(iso) || [];
            const max = 3;
            return (
              <div
                key={iso}
                className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''} ${overDay === iso ? 'drop-target' : ''}`}
                onDragOver={(e) => { if (onDropEvent) { e.preventDefault(); setOverDay(iso); } }}
                onDragLeave={() => setOverDay(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverDay(null);
                  const key = e.dataTransfer.getData('text/plain');
                  const ev = events.find((x) => x.key === key);
                  if (ev && ev.date !== iso) onDropEvent(ev, iso);
                }}
                onDoubleClick={() => onDayClick?.(iso)}
              >
                <span className="cal-num">{d.getDate()}</span>
                {list.slice(0, max).map((ev) => <CalEvent key={ev.key} ev={ev} />)}
                {list.length > max && (
                  <button className="cal-more" onClick={(e) => setMore({ anchor: e.currentTarget, list, iso })}>+{list.length - max} más</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Popover anchor={more?.anchor} open={Boolean(more)} onClose={() => setMore(null)} width={260}>
        <div className="menu-label">{more && cap(fmtDate(more.iso, "EEEE d 'de' MMMM"))}</div>
        <div className="flex-col" style={{ gap: 2, padding: 4 }}>{more?.list.map((ev) => <CalEvent key={ev.key} ev={ev} />)}</div>
      </Popover>
    </div>
  );
}

function CalEvent({ ev }) {
  return (
    <button
      type="button"
      className={`cal-ev ${ev.kind} ${ev.done ? 'done' : ''}`}
      draggable={Boolean(ev.draggable)}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', ev.key)}
      onClick={ev.onClick}
      title={ev.title}
    >
      {ev.icon && <span className="cal-ev-ico">{ev.icon}</span>}
      <span className="truncate">{ev.title}</span>
    </button>
  );
}

// ───────── Cronograma ─────────
export function Timeline({ tasks }) {
  const { openTask } = useLayout();
  const isMobile = useIsMobile();
  const dayW = isMobile ? 22 : 30;
  const dated = tasks.filter((t) => t.due_date || t.start_date).sort((a, b) => (a.start_date || a.due_date).localeCompare(b.start_date || b.due_date));
  const undated = tasks.length - dated.length;
  if (!dated.length) {
    return <EmptyState icon={CalendarDays} title="Sin fechas para mostrar">Agrega fecha de inicio y fecha límite a las tareas para verlas en el cronograma.</EmptyState>;
  }
  const starts = dated.map((t) => t.start_date || t.due_date);
  const ends = dated.map((t) => t.due_date || t.start_date);
  const min = addDaysIso([...starts, todayIso()].sort()[0], -3);
  const max = addDaysIso([...ends, todayIso()].sort().slice(-1)[0], 7);
  const toX = (iso) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${min}T12:00:00`)) / 864e5) * dayW;
  const totalDays = Math.round((Date.parse(`${max}T12:00:00`) - Date.parse(`${min}T12:00:00`)) / 864e5) + 1;
  const days = Array.from({ length: totalDays }, (_, i) => addDaysIso(min, i));
  const rowIndex = new Map(dated.map((t, i) => [t.id, i]));
  const ROW = 37;
  return (
    <div>
      <div className="timeline">
        <div className="tl-head">
          <div className="tl-label">Tarea</div>
          <div className="tl-days" style={{ width: totalDays * dayW }}>
            {days.map((d) => {
              const date = new Date(`${d}T12:00:00`);
              const first = date.getDate() === 1 || d === min;
              return (
                <div key={d} className={`tl-day ${first ? 'month-start' : ''}`} style={{ width: dayW }} title={fmtDate(d, "EEEE d 'de' MMMM")}>
                  {first ? date.toLocaleDateString('es-MX', { month: 'short' }) : date.getDate()}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <div className="tl-today" style={{ left: (isMobile ? 150 : 260) + toX(todayIso()) + dayW / 2 }} />
          {dated.map((t) => {
            const s = t.start_date || t.due_date;
            const e = t.due_date || t.start_date;
            const left = toX(s);
            const width = Math.max(dayW, toX(e) - left + dayW);
            const color = t.status === 'done' ? 'green' : t.status === 'blocked' ? 'red' : dueState(t) === 'overdue' ? 'orange' : 'blue';
            return (
              <div key={t.id} className="tl-row">
                <div className="tl-label" onClick={() => openTask(t.id)}>
                  <span className={`swatch m-${STATUS[t.status].color}`} style={{ borderRadius: '50%' }} />
                  <span className="truncate">{t.title}</span>
                </div>
                <div className="tl-track" style={{ width: totalDays * dayW }}>
                  <div
                    className={`tl-bar m-${color} ${!t.start_date || t.start_date === t.due_date ? (width <= dayW ? 'milestone' : '') : ''}`}
                    style={{ left: left + (width <= dayW && (!t.start_date || t.start_date === t.due_date) ? dayW / 2 - 7 : 0), width }}
                    onClick={() => openTask(t.id)}
                    title={`${t.title}: ${s === e ? relativeDay(e) : `${fmtDate(s)} → ${fmtDate(e)}`}`}
                  >
                    {width > 80 && t.title}
                  </div>
                </div>
              </div>
            );
          })}
          <svg className="tl-dep" style={{ left: isMobile ? 150 : 260, top: 0, width: totalDays * dayW, height: dated.length * ROW }}>
            {dated.flatMap((t) =>
              t.depends_on
                .filter((d) => rowIndex.has(d))
                .map((d) => {
                  const dep = dated[rowIndex.get(d)];
                  const x1 = toX(dep.due_date || dep.start_date) + dayW;
                  const y1 = rowIndex.get(d) * ROW + 18;
                  const x2 = toX(t.start_date || t.due_date);
                  const y2 = rowIndex.get(t.id) * ROW + 18;
                  return <path key={`${d}-${t.id}`} d={`M${x1},${y1} C${x1 + 16},${y1} ${x2 - 16},${y2} ${x2},${y2}`} fill="none" stroke="var(--text-3)" strokeWidth="1.3" markerEnd="url(#arrow)" />;
                }),
            )}
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-3)" />
              </marker>
            </defs>
          </svg>
        </div>
      </div>
      {undated > 0 && <p className="faint small mt-2">{undated} {undated === 1 ? 'tarea no aparece' : 'tareas no aparecen'} porque no tienen fechas.</p>}
    </div>
  );
}

// ───────── Filtros ─────────
const DUE_FILTERS = { overdue: 'Vencidas', week: 'Esta semana', none: 'Sin fecha' };

export function applyLocalFilters(tasks, f) {
  return tasks.filter((t) => {
    if (f.assignee?.length && !f.assignee.some((a) => (a === 0 ? t.assignee_ids.length === 0 : t.assignee_ids.includes(a)))) return false;
    if (f.priority?.length && !f.priority.includes(t.priority)) return false;
    if (f.status?.length && !f.status.includes(t.status)) return false;
    if (f.tag?.length && !t.tags.some((g) => f.tag.includes(g.id))) return false;
    if (f.project?.length && !f.project.includes(t.project_id ?? 0)) return false;
    if (f.due === 'overdue' && dueState(t) !== 'overdue') return false;
    if (f.due === 'week' && (!t.due_date || t.due_date > addDaysIso(todayIso(), 7))) return false;
    if (f.due === 'none' && t.due_date) return false;
    if (f.q && !t.title.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.hideDone && t.status === 'done') return false;
    return true;
  });
}

export function TaskFilters({ value, onChange, showProject, showStatus = true }) {
  const members = useActiveMembers();
  const { data: tags = [] } = useTags();
  const { data: projects = [] } = useProjects({ status: 'planning,active,paused' });
  const [pop, setPop] = useState(null);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const toggle = (k, v) => {
    const cur = value[k] || [];
    set(k, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };
  const chip = (k, label, icon, count) => (
    <button type="button" className={`filter-chip ${count ? 'on' : ''}`} onClick={(e) => setPop({ k, anchor: e.currentTarget })}>
      {icon}
      {label}
      {count ? <span>· {count}</span> : null}
    </button>
  );
  const active = ['assignee', 'priority', 'status', 'tag', 'project'].some((k) => value[k]?.length) || value.due;
  const options = {
    assignee: [{ value: 0, label: 'Sin asignar' }, ...members.map((m) => ({ value: m.id, label: m.name, render: () => (<><Avatar user={m} size="sm" /><span>{m.name}</span></>) }))],
    priority: PRIORITIES.map((p) => ({ value: p.key, label: p.label, render: () => (<><PriorityFlag priority={p.key} /><span>{p.label}</span></>) })),
    status: STATUSES.map((s) => ({ value: s.key, label: s.label, render: () => <StatusPill status={s.key} size="sm" /> })),
    tag: tags.map((t) => ({ value: t.id, label: t.name, render: () => <Pill color={t.color} size="sm">{t.name}</Pill> })),
    project: [{ value: 0, label: 'Sin proyecto' }, ...projects.map((p) => ({ value: p.id, label: `${p.icon || '📁'} ${p.name}` }))],
  };
  return (
    <div className="filter-bar">
      <Filter size={14} className="faint" />
      {chip('assignee', 'Responsable', <Users size={13} />, value.assignee?.length)}
      {showStatus && chip('status', 'Estado', <CircleDot size={13} />, value.status?.length)}
      {chip('priority', 'Prioridad', <Flag size={13} />, value.priority?.length)}
      {showProject && chip('project', 'Proyecto', <FolderKanban size={13} />, value.project?.length)}
      {tags.length > 0 && chip('tag', 'Etiqueta', <Tag size={13} />, value.tag?.length)}
      <Menu
        placement="bottom-start"
        trigger={(p) => (
          <button type="button" className={`filter-chip ${value.due ? 'on' : ''}`} {...p}>
            <CalendarDays size={13} />
            {value.due ? DUE_FILTERS[value.due] : 'Fecha'}
          </button>
        )}
        items={[
          ...Object.entries(DUE_FILTERS).map(([k, l]) => ({ label: l, checked: value.due === k, onClick: () => set('due', value.due === k ? null : k) })),
        ]}
      />
      {active && <Button size="xs" variant="ghost" icon={X} onClick={() => onChange({ q: value.q, hideDone: value.hideDone })}>Limpiar</Button>}
      <Popover anchor={pop?.anchor} open={Boolean(pop)} onClose={() => setPop(null)} width={250}>
        {pop && <OptionList options={options[pop.k]} selected={value[pop.k] || []} multi onSelect={(v) => toggle(pop.k, v)} search={options[pop.k].length > 6} />}
      </Popover>
    </div>
  );
}
