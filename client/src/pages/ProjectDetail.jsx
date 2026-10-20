import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MoreHorizontal, MessageSquare, Trash2, LayoutTemplate, Archive, Plus, FileText, Lock, Users, CalendarDays, Flag,
  Target, Tag, User, CheckCircle2, AlertTriangle, CalendarClock, Info, Activity as ActivityIcon, Paperclip, Globe,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { PROJECT_STATUS, PROJECT_STATUSES, PROJECT_ICONS } from '../lib/constants.js';
import { fmtDate, fmtDateTime, timeAgo } from '../lib/format.js';
import { useAction, useCan, usePref, useMemberMap } from '../lib/hooks.js';
import { AutoTextarea, Button, EmptyState, ErrorState, Loading, Pill, Progress, Switch, AvatarStack } from '../components/ui.jsx';
import { Menu, Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { DateField, EmojiPicker, PriorityPicker, TagPicker, UserPicker } from '../components/pickers.jsx';
import { ActivityList, Attachments, Comments, FavoriteButton, RelatedItems } from '../components/collab.jsx';
import { TaskFilters } from '../components/tasks.jsx';
import { TaskViews, VIEW_OPTIONS } from './Tasks.jsx';

const TABS = [
  ...VIEW_OPTIONS.map((v) => ({ ...v, kind: 'tasks' })),
  { value: 'overview', label: 'Resumen', icon: Info },
  { value: 'docs', label: 'Documentos', icon: FileText },
  { value: 'files', label: 'Archivos', icon: Paperclip },
  { value: 'activity', label: 'Actividad', icon: ActivityIcon },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const [params, setParams] = useSearchParams();
  const [lastView, setLastView] = usePref('projectView', 'board');
  const tab = params.get('view') || lastView || 'board';
  const setTab = (v) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
    if (VIEW_OPTIONS.some((o) => o.value === v)) setLastView(v);
  };
  const { data: project, isLoading, error, refetch } = useQuery({ queryKey: ['projects', 'detail', pid], queryFn: () => api.get(`/projects/${pid}`) });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks', 'project', pid], queryFn: () => api.get(`/tasks${qs({ project_id: pid })}`), enabled: Boolean(project) });
  const [filters, setFilters] = useState({});
  const { openCreate } = useLayout();
  const isTaskView = VIEW_OPTIONS.some((o) => o.value === tab);

  if (isLoading) return <><Topbar crumbs={[{ label: 'Proyectos', to: '/projects' }]} /><Loading /></>;
  if (error) return <><Topbar crumbs={[{ label: 'Proyectos', to: '/projects' }]} /><ErrorState error={error} onRetry={refetch} /></>;

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Proyectos', to: '/projects' }, { label: project.name, icon: project.icon || '📁' }]}
        actions={
          <>
            {project.channel_id && <Link className="btn ghost sm" to={`/chat/${project.channel_id}`}><MessageSquare size={15} /><span className="hide-sm">Chat</span></Link>}
            <FavoriteButton type="project" id={pid} />
            <ProjectMenu project={project} />
          </>
        }
      />
      <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        <ProjectHero project={project} />
        <div className="view-toolbar" style={{ paddingBottom: 0 }}>
          <div className="tabs" style={{ marginBottom: 0, flex: 1, borderBottom: 0 }}>
            {TABS.map((t) => (
              <button key={t.value} className={`tab ${tab === t.value ? 'active' : ''}`} onClick={() => setTab(t.value)}>
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 12 }} />
        {isTaskView && (
          <div className="view-toolbar">
            <TaskFilters value={filters} onChange={setFilters} showStatus={tab !== 'board'} />
            <span style={{ flex: 1 }} />
            <Switch checked={filters.hideDone} onChange={(v) => setFilters({ ...filters, hideDone: v })} label="Ocultar terminadas" />
            <Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate('task', { project_id: pid })}>Tarea</Button>
          </div>
        )}
        {isTaskView ? (
          <TaskViews
            tasks={tasks}
            view={tab}
            filters={filters}
            groupBy="status"
            columns={project.columns}
            projectId={pid}
            editableColumns={project.can_edit}
            showProject={false}
            quickAddDefaults={{ project_id: pid }}
          />
        ) : tab === 'overview' ? (
          <Overview project={project} />
        ) : tab === 'docs' ? (
          <ProjectDocs project={project} />
        ) : tab === 'files' ? (
          <div className="view-pad" style={{ maxWidth: 900 }}>
            <p className="muted small mb-3">Archivos vinculados al proyecto. También aparecen en la sección Archivos.</p>
            <ProjectFiles project={project} />
          </div>
        ) : (
          <div className="view-pad" style={{ maxWidth: 820 }}><ProjectActivity pid={pid} /></div>
        )}
      </div>
    </>
  );
}

function useProjectSave(project) {
  const qc = useQueryClient();
  const toast = useToast();
  return async (patch) => {
    qc.setQueryData(['projects', 'detail', project.id], (old) => ({ ...old, ...patch }));
    try {
      await api.patch(`/projects/${project.id}`, patch);
    } catch (e) {
      toast.error(e);
    }
    qc.invalidateQueries({ predicate: (q) => ['projects', 'dashboard', 'chat'].includes(q.queryKey[0]) });
  };
}

function ProjectHero({ project }) {
  const save = useProjectSave(project);
  const [name, setName] = useState(project.name);
  const members = useMemberMap();
  useEffect(() => setName(project.name), [project.name]);
  const st = PROJECT_STATUS[project.status];
  const people = [project.owner_id, ...project.member_ids.filter((m) => m !== project.owner_id)].map((m) => members.get(m)).filter(Boolean);
  return (
    <div className="project-hero">
      <div className="flex" style={{ alignItems: 'center', gap: 10 }}>
        <EmojiPicker value={project.icon} onChange={(v) => project.can_edit && save({ icon: v })} icons={PROJECT_ICONS}>
          {({ onClick }) => <button className="doc-icon-btn" style={{ fontSize: 30 }} onClick={project.can_edit ? onClick : undefined} aria-label="Cambiar ícono">{project.icon || '📁'}</button>}
        </EmojiPicker>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AutoTextarea
            className="tp-title"
            style={{ fontSize: 26 }}
            value={name}
            readOnly={!project.can_edit}
            onChange={(e) => setName(e.target.value.replace(/\n/g, ''))}
            onBlur={() => name.trim() && name !== project.name && save({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            aria-label="Nombre del proyecto"
          />
          <div className="flex wrap small" style={{ gap: 10, marginTop: 2 }}>
            <Menu
              placement="bottom-start"
              trigger={(p) => <button className="pill clickable c-gray" style={{ background: 'transparent', padding: 0 }} {...(project.can_edit ? p : {})}><Pill color={st.color} dot>{st.label}</Pill></button>}
              items={PROJECT_STATUSES.map((s) => ({ label: s.label, checked: s.key === project.status, onClick: () => save({ status: s.key }) }))}
            />
            {project.visibility === 'members' && <span className="faint flex" style={{ gap: 4 }}><Lock size={12} />Privado</span>}
            <AvatarStack users={people} max={5} size="xs" />
            {project.due_date && <span className="faint flex" style={{ gap: 4 }}><CalendarDays size={12} />Meta: {fmtDate(project.due_date)}</span>}
            <span className="flex" style={{ gap: 6, minWidth: 140 }}>
              <span style={{ width: 90 }}><Progress value={project.progress} thin /></span>
              <span className="faint num">{project.progress}%</span>
            </span>
            {project.stats.overdue > 0 && <span className="neg flex" style={{ gap: 4 }}><AlertTriangle size={12} />{project.stats.overdue} vencidas</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectMenu({ project }) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const save = useProjectSave(project);
  const canCreate = useCan('projects.create');
  const [templateOpen, setTemplateOpen] = useState(false);
  const remove = async () => {
    if (!(await confirm({ title: `¿Enviar «${project.name}» a la papelera?`, message: 'Sus tareas dejarán de mostrarse. Podrás restaurarlo desde la papelera.', confirmLabel: 'Enviar a la papelera', danger: true }))) return;
    try {
      await api.del(`/projects/${project.id}`);
      qc.invalidateQueries();
      navigate('/projects');
      toast.show('Proyecto enviado a la papelera', { action: { label: 'Deshacer', onClick: async () => { await api.post('/trash/restore', { type: 'project', id: project.id }); qc.invalidateQueries(); navigate(`/projects/${project.id}`); } } });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <Menu
        trigger={(p) => <button className="icon-btn" aria-label="Opciones del proyecto" {...p}><MoreHorizontal size={16} /></button>}
        items={[
          canCreate && { label: 'Guardar como plantilla', icon: LayoutTemplate, onClick: () => setTemplateOpen(true) },
          project.can_edit && project.status !== 'completed' && { label: 'Marcar como completado', icon: CheckCircle2, onClick: () => save({ status: 'completed' }) },
          project.can_edit && project.status !== 'archived' && { label: 'Archivar', icon: Archive, onClick: () => save({ status: 'archived' }) },
          project.can_edit && 'sep',
          project.can_edit && { label: 'Enviar a la papelera', icon: Trash2, danger: true, onClick: remove },
        ]}
      />
      {templateOpen && <SaveTemplateModal project={project} onClose={() => setTemplateOpen(false)} />}
    </>
  );
}

function SaveTemplateModal({ project, onClose }) {
  const [name, setName] = useState(`Plantilla: ${project.name}`);
  const [description, setDescription] = useState('');
  const save = useAction(() => api.post(`/projects/${project.id}/save-template`, { name, description }), { invalidate: ['templates'], success: 'Plantilla guardada. La verás al crear un proyecto.', onSuccess: onClose });
  return (
    <Modal size="sm" title="Guardar como plantilla" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <p className="muted small mb-3">Se guardan las columnas y las tareas (sin responsables, fechas ni comentarios).</p>
      <div className="field"><label>Nombre</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Descripción</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
    </Modal>
  );
}

function Overview({ project }) {
  const save = useProjectSave(project);
  const [description, setDescription] = useState(project.description);
  const [objective, setObjective] = useState(project.objective);
  const [expected, setExpected] = useState(project.expected_result);
  const { data: goals = [] } = useQuery({ queryKey: ['goals'], queryFn: () => api.get('/goals') });
  const ro = !project.can_edit;
  return (
    <div className="view-pad" style={{ maxWidth: 900 }}>
      <div className="stats mb-4">
        <div className="card stat"><div className="label">Avance</div><div className="value">{project.progress}%</div><div className="sub">{project.stats.done} de {project.stats.total} tareas</div></div>
        <div className="card stat"><div className="label">Vencidas</div><div className="value" style={project.stats.overdue ? { color: 'var(--danger)' } : undefined}>{project.stats.overdue}</div></div>
        <div className="card stat"><div className="label">Bloqueadas</div><div className="value">{project.stats.blocked}</div></div>
      </div>

      <div className="props">
        <span className="prop-label"><User size={15} />Responsable</span>
        <span className="prop-value"><UserPicker multi={false} value={project.owner_id} onChange={(v) => save({ owner_id: v })} disabled={ro} /></span>
        <span className="prop-label"><Users size={15} />Integrantes</span>
        <span className="prop-value"><UserPicker value={project.member_ids} onChange={(v) => save({ member_ids: v })} disabled={ro} placeholder="Agregar integrantes" /></span>
        <span className="prop-label"><CalendarDays size={15} />Inicio</span>
        <span className="prop-value">{ro ? <span className="small">{fmtDate(project.start_date) || '—'}</span> : <DateField value={project.start_date} onChange={(v) => save({ start_date: v })} />}</span>
        <span className="prop-label"><CalendarDays size={15} />Fecha objetivo</span>
        <span className="prop-value">{ro ? <span className="small">{fmtDate(project.due_date) || '—'}</span> : <DateField value={project.due_date} onChange={(v) => save({ due_date: v })} />}</span>
        <span className="prop-label"><Flag size={15} />Prioridad</span>
        <span className="prop-value"><PriorityPicker value={project.priority} onChange={(v) => !ro && save({ priority: v })} /></span>
        <span className="prop-label"><Tag size={15} />Etiquetas</span>
        <span className="prop-value"><TagPicker value={project.tags.map((t) => t.id)} onChange={(v) => !ro && save({ tag_ids: v })} /></span>
        <span className="prop-label"><Target size={15} />Objetivo de la empresa</span>
        <span className="prop-value">
          <select className="select" style={{ width: 'auto', height: 30 }} disabled={ro} value={project.goal_id || ''} onChange={(e) => save({ goal_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin vincular</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </span>
        <span className="prop-label">{project.visibility === 'members' ? <Lock size={15} /> : <Globe size={15} />}Visibilidad</span>
        <span className="prop-value">
          <select className="select" style={{ width: 'auto', height: 30 }} disabled={ro} value={project.visibility} onChange={(e) => save({ visibility: e.target.value })}>
            <option value="workspace">Todo el equipo</option>
            <option value="members">Solo sus integrantes</option>
          </select>
        </span>
      </div>

      <div className="section">
        <div className="section-title"><h3>Objetivo</h3></div>
        <AutoTextarea className="textarea ghost" readOnly={ro} placeholder="¿Qué queremos lograr?" value={objective} onChange={(e) => setObjective(e.target.value)} onBlur={() => objective !== project.objective && save({ objective })} />
      </div>
      <div className="section">
        <div className="section-title"><h3>Resultado esperado</h3></div>
        <AutoTextarea className="textarea ghost" readOnly={ro} placeholder="¿Cómo sabremos que terminó bien?" value={expected} onChange={(e) => setExpected(e.target.value)} onBlur={() => expected !== project.expected_result && save({ expected_result: expected })} />
      </div>
      <div className="section">
        <div className="section-title"><h3>Descripción</h3></div>
        <AutoTextarea className="textarea ghost" readOnly={ro} style={{ minHeight: 80 }} placeholder="Contexto, alcance, notas…" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== project.description && save({ description })} />
      </div>

      {project.meetings.length > 0 && (
        <div className="section">
          <div className="section-title"><h3>Reuniones</h3></div>
          {project.meetings.map((m) => (
            <Link key={m.id} to={`/meetings/${m.id}`} className="list-row"><CalendarClock size={15} className="faint" /><span className="grow title">{m.title}</span><span className="meta">{fmtDateTime(m.starts_at)}</span></Link>
          ))}
        </div>
      )}
      <div className="section">
        <div className="section-title"><h3>Recursos vinculados</h3></div>
        <RelatedItems entityType="project" entityId={project.id} items={project.related} />
      </div>
      <div className="section">
        <div className="section-title"><h3>Comentarios</h3></div>
        <Comments entityType="project" entityId={project.id} />
      </div>
      <p className="faint tiny mt-4">Creado {fmtDateTime(project.created_at)} · Actualizado {timeAgo(project.updated_at)}</p>
    </div>
  );
}

function ProjectDocs({ project }) {
  const { openCreate } = useLayout();
  const canEdit = useCan('docs.edit');
  return (
    <div className="view-pad" style={{ maxWidth: 820 }}>
      <div className="flex between mb-3">
        <p className="muted small">Instrucciones, planes, notas y acuerdos de este proyecto.</p>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => openCreate('page', { project_id: project.id, title: '' })}>Nuevo documento</Button>}
      </div>
      {project.pages.length ? project.pages.map((p) => (
        <Link key={p.id} to={`/docs/${p.id}`} className="list-row">
          <span style={{ width: 20, textAlign: 'center' }}>{p.icon || '📄'}</span>
          <span className="grow title">{p.title || 'Sin título'}</span>
          <span className="meta">{timeAgo(p.updated_at)}</span>
        </Link>
      )) : <EmptyState icon={FileText} title="Sin documentos todavía">Crea un documento con las instrucciones o el plan del proyecto.</EmptyState>}
    </div>
  );
}

function ProjectFiles({ project }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['files', 'project', project.id], queryFn: () => api.get(`/files?project_id=${project.id}`) });
  if (isLoading) return <Loading />;
  return <Attachments entityType="project" entityId={project.id} files={data} projectId={project.id} />;
}

function ProjectActivity({ pid }) {
  const { data, isLoading } = useQuery({ queryKey: ['activity', 'project', pid], queryFn: () => api.get(`/activity?project_id=${pid}&limit=100`) });
  if (isLoading) return <Loading />;
  return <ActivityList items={data} />;
}

