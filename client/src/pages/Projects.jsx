import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, Lock, CalendarDays, AlertTriangle, LayoutTemplate, FilePlus2, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { PROJECT_STATUS, PROJECT_ICONS } from '../lib/constants.js';
import { fmtDate, plural } from '../lib/format.js';
import { useAction, useCan, useMe, useMemberMap, useProjects } from '../lib/hooks.js';
import { AvatarStack, Button, EmptyState, ErrorState, Field, FormError, Pill, Progress, Segmented, SkeletonList } from '../components/ui.jsx';
import { Modal, useConfirm } from '../components/overlay.jsx';
import { Topbar, useLayout } from '../components/Layout.jsx';
import { DateField, EmojiPicker, PriorityPicker, UserPicker } from '../components/pickers.jsx';

const FILTERS = [
  { value: 'open', label: 'Abiertos', status: 'planning,active,paused' },
  { value: 'completed', label: 'Completados', status: 'completed' },
  { value: 'archived', label: 'Archivados', status: 'archived' },
  { value: 'all', label: 'Todos', status: undefined },
];

export default function Projects() {
  const [filter, setFilter] = useState('open');
  const [params, setParams] = useSearchParams();
  const canCreate = useCan('projects.create');
  const { openCreate } = useLayout();
  const { data, isLoading, error, refetch } = useProjects({ status: FILTERS.find((f) => f.value === filter).status });
  const members = useMemberMap();

  useEffect(() => {
    if (params.get('new') && canCreate) {
      openCreate('project');
      setParams({}, { replace: true });
    }
  }, [params, canCreate, openCreate, setParams]);

  return (
    <>
      <Topbar crumbs={[{ label: 'Proyectos' }]} actions={canCreate && <Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate('project')}>Nuevo proyecto</Button>} />
      <div className="content">
        <div className="page">
          <div className="page-header">
            <div>
              <h1 className="page-title">Proyectos</h1>
              <p className="page-subtitle">Cada proyecto tiene su tablero, documentos, archivos y conversación.</p>
            </div>
            <Segmented value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.length ? (
            <EmptyState
              icon={FolderKanban}
              title={filter === 'open' ? 'Todavía no hay proyectos' : 'No hay proyectos aquí'}
              actions={canCreate && filter === 'open' && <Button variant="primary" icon={Plus} onClick={() => openCreate('project')}>Crear el primero</Button>}
            >
              {filter === 'open' && 'Organiza el trabajo en proyectos: un lanzamiento, una feria, la operación mensual… Puedes empezar con una plantilla.'}
            </EmptyState>
          ) : (
            <div className="grid-cards">
              {data.map((p) => <ProjectCard key={p.id} p={p} members={members} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ProjectCard({ p, members }) {
  const st = PROJECT_STATUS[p.status];
  const people = [p.owner_id, ...p.member_ids.filter((id) => id !== p.owner_id)].map((id) => members.get(id)).filter(Boolean);
  return (
    <Link to={`/projects/${p.id}`} className="card hoverable" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="flex" style={{ alignItems: 'flex-start' }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{p.icon || '📁'}</span>
        <span className="spacer" />
        {p.visibility === 'members' && <Lock size={13} className="faint" title="Privado para sus integrantes" />}
        <Pill color={st.color} size="sm">{st.label}</Pill>
      </div>
      <div>
        <div className="strong" style={{ fontSize: 15 }}>{p.name}</div>
        {(p.objective || p.description) && <p className="muted small mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.objective || p.description}</p>}
      </div>
      <div className="mt-1">
        <div className="flex between tiny faint mb-2"><span>{p.stats.done} de {plural(p.stats.total, 'tarea', 'tareas')}</span><span className="num">{p.progress}%</span></div>
        <Progress value={p.progress} thin />
      </div>
      <div className="flex small" style={{ marginTop: 'auto' }}>
        <AvatarStack users={people} max={4} size="sm" />
        <span className="spacer" />
        {p.stats.overdue > 0 && <span className="neg flex" style={{ gap: 3 }}><AlertTriangle size={12} />{p.stats.overdue}</span>}
        {p.due_date && <span className="faint flex" style={{ gap: 4 }}><CalendarDays size={12} />{fmtDate(p.due_date)}</span>}
      </div>
    </Link>
  );
}

export function NewProjectModal({ defaults = {}, onClose }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [step, setStep] = useState('template');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: () => api.get('/templates') });
  const [form, setForm] = useState({
    name: '', icon: '🌱', description: '', objective: '', expected_result: '', owner_id: me.id, member_ids: [], start_date: null, due_date: null,
    priority: 'medium', visibility: 'workspace', template_id: null, ...defaults,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const tpl = templates.find((t) => t.id === form.template_id);
  const removeTpl = useAction((id) => api.del(`/templates/${id}`), { invalidate: ['templates'], success: 'Plantilla eliminada' });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const { id } = await api.post('/projects', form);
      qc.invalidateQueries({ predicate: (q) => ['projects', 'tasks', 'chat', 'dashboard'].includes(q.queryKey[0]) });
      onClose();
      navigate(`/projects/${id}`);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  if (step === 'template') {
    return (
      <Modal size="lg" title="Nuevo proyecto" onClose={onClose}>
        <p className="muted mb-3">Empieza desde cero o usa una plantilla con columnas y tareas ya preparadas.</p>
        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          <button type="button" className="card hoverable template-card" onClick={() => { set('template_id', null); setStep('details'); }}>
            <span className="t-emoji"><FilePlus2 size={24} /></span>
            <strong>Proyecto en blanco</strong>
            <span className="muted small">Tablero con columnas Ideas, Por hacer, En progreso, En revisión, Bloqueado y Terminado.</span>
          </button>
          {templates.map((t) => (
            <div key={t.id} className="card hoverable template-card" role="button" tabIndex={0} onClick={() => { setForm((f) => ({ ...f, template_id: t.id, icon: t.icon || f.icon })); setStep('details'); }}>
              <div className="flex"><span className="t-emoji">{t.icon || <LayoutTemplate size={22} />}</span><span className="spacer" />
                {!t.is_builtin && (
                  <button type="button" className="icon-btn xs" aria-label="Eliminar plantilla" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: `¿Eliminar la plantilla «${t.name}»?`, confirmLabel: 'Eliminar', danger: true })) removeTpl.mutate(t.id); }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <strong>{t.name}</strong>
              <span className="muted small">{t.description || `${t.task_count} tareas`}</span>
              <span className="faint tiny">{plural(t.task_count, 'tarea', 'tareas')}{t.is_builtin ? '' : ` · creada por ${t.created_by_name || 'el equipo'}`}</span>
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      size="lg"
      title={tpl ? `Nuevo proyecto · ${tpl.name}` : 'Nuevo proyecto'}
      back={() => setStep('template')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!form.name.trim()} loading={saving} onClick={submit}>Crear proyecto</Button>
        </>
      }
    >
      <FormError error={error} />
      <div className="flex" style={{ alignItems: 'flex-end', gap: 10 }}>
        <EmojiPicker value={form.icon} onChange={(v) => set('icon', v)} icons={PROJECT_ICONS} allowRemove={false}>
          {({ onClick }) => <button type="button" className="doc-icon-btn" style={{ fontSize: 30, marginBottom: 12 }} onClick={onClick} aria-label="Ícono">{form.icon}</button>}
        </EmojiPicker>
        <Field label="Nombre del proyecto" className="grow" htmlFor="pname">
          <input id="pname" className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Lanzamiento de la línea de macetas" onKeyDown={(e) => e.key === 'Enter' && form.name.trim() && submit()} />
        </Field>
      </div>
      <Field label="Objetivo" hint="¿Qué queremos lograr con este proyecto?">
        <input className="input" value={form.objective} onChange={(e) => set('objective', e.target.value)} placeholder={tpl ? 'Se usará el de la plantilla si lo dejas vacío' : ''} />
      </Field>
      <Field label="Resultado esperado">
        <input className="input" value={form.expected_result} onChange={(e) => set('expected_result', e.target.value)} placeholder="Ej. 50 piezas vendidas en el primer mes" />
      </Field>
      <div className="grid-2">
        <Field label="Responsable principal">
          <UserPicker multi={false} value={form.owner_id} onChange={(v) => set('owner_id', v)} />
        </Field>
        <Field label="Integrantes">
          <UserPicker value={form.member_ids} onChange={(v) => set('member_ids', v)} placeholder="Agregar integrantes" />
        </Field>
        <Field label="Fecha de inicio"><DateField value={form.start_date} onChange={(v) => set('start_date', v)} /></Field>
        <Field label="Fecha objetivo"><DateField value={form.due_date} onChange={(v) => set('due_date', v)} min={form.start_date || undefined} /></Field>
        <Field label="Prioridad"><PriorityPicker value={form.priority} onChange={(v) => set('priority', v)} /></Field>
        <Field label="Visibilidad">
          <select className="select" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
            <option value="workspace">Todo el equipo</option>
            <option value="members">Solo sus integrantes (privado)</option>
          </select>
        </Field>
      </div>
      {tpl && (
        <div className="callout">
          <LayoutTemplate size={16} />
          <div className="callout-body small">
            Se crearán {plural(tpl.task_count, 'tarea', 'tareas')} sin responsables para que las asignes después: {tpl.tasks_preview.join(', ')}{tpl.task_count > tpl.tasks_preview.length ? '…' : ''}
          </div>
        </div>
      )}
    </Modal>
  );
}

