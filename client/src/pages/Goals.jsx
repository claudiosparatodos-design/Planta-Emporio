import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Target, Plus, Trash2, MoreHorizontal, Pencil, FolderKanban, CheckSquare, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { GOAL_STATUS, GOAL_STATUSES } from '../lib/constants.js';
import { fmtDate } from '../lib/format.js';
import { useAction, useMe, useMemberMap } from '../lib/hooks.js';
import { Avatar, Button, EmptyState, ErrorState, Field, FormError, Loading, Pill, Progress, SkeletonList, IconButton } from '../components/ui.jsx';
import { Menu, Modal, useConfirm } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { DateField, UserPicker } from '../components/pickers.jsx';
import { Comments } from '../components/collab.jsx';

function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-T${Math.floor(d.getMonth() / 3) + 1}`;
}

export default function Goals() {
  const { id } = useParams();
  const navigate = useNavigate();
  const members = useMemberMap();
  const [editing, setEditing] = useState(null);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['goals'], queryFn: () => api.get('/goals') });
  const active = data.filter((g) => !['achieved', 'dropped'].includes(g.status));
  const closed = data.filter((g) => ['achieved', 'dropped'].includes(g.status));
  return (
    <>
      <Topbar crumbs={[{ label: 'Objetivos' }]} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({})}>Nuevo objetivo</Button>} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Objetivos</h1>
              <p className="page-subtitle">Hacia dónde va la empresa. Vincula proyectos y tareas para ver qué contribuye a cada objetivo.</p>
            </div>
          </div>
          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.length ? (
            <EmptyState icon={Target} title="Define el primer objetivo" actions={<Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Nuevo objetivo</Button>}>
              Por ejemplo «Lograr 100 ventas este trimestre», con indicadores medibles. El avance se calcula con los indicadores o, si no tiene, con las tareas de los proyectos vinculados.
            </EmptyState>
          ) : (
            <>
              <div className="flex-col" style={{ gap: 10 }}>{active.map((g) => <GoalCard key={g.id} g={g} members={members} />)}</div>
              {closed.length > 0 && (
                <div className="section">
                  <div className="section-title"><h3>Logrados o descartados</h3></div>
                  <div className="flex-col" style={{ gap: 10 }}>{closed.map((g) => <GoalCard key={g.id} g={g} members={members} />)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {editing && <GoalModal goal={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      {id && <GoalDetail id={Number(id)} onClose={() => navigate('/goals')} onEdit={(g) => setEditing(g)} />}
    </>
  );
}

function GoalCard({ g, members }) {
  const st = GOAL_STATUS[g.status];
  return (
    <Link to={`/goals/${g.id}`} className="card hoverable" style={{ padding: 16, display: 'block' }}>
      <div className="flex">
        <Target size={16} className="faint" />
        <span className="strong" style={{ flex: 1, minWidth: 0 }}>{g.title}</span>
        {g.period && <Pill size="sm" color="gray">{g.period}</Pill>}
        <Pill size="sm" color={st.color}>{st.label}</Pill>
      </div>
      <div className="flex mt-3" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}><Progress value={g.progress} tone={g.status === 'off_track' ? 'danger' : g.status === 'at_risk' ? 'warning' : ''} /></div>
        <span className="strong num" style={{ width: 44, textAlign: 'right' }}>{g.progress}%</span>
      </div>
      <div className="small faint flex wrap mt-2" style={{ gap: 12 }}>
        {g.owner_id && <span className="flex" style={{ gap: 5 }}><Avatar user={members.get(g.owner_id)} size="xs" />{members.get(g.owner_id)?.name}</span>}
        {g.target_date && <span>Meta: {fmtDate(g.target_date)}</span>}
        <span>{g.key_results.length ? `${g.key_results.length} indicadores` : `${g.task_stats.done}/${g.task_stats.total} tareas`}</span>
        {g.projects.length > 0 && <span>{g.projects.length} proyectos</span>}
      </div>
    </Link>
  );
}

function GoalModal({ goal, onClose }) {
  const me = useMe();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: goal?.title || '', description: goal?.description || '', period: goal?.period || currentQuarter(), owner_id: goal?.owner_id || me.id,
    target_date: goal?.target_date || null, status: goal?.status || 'on_track',
    key_results: goal ? [] : [{ title: '', start_value: 0, target_value: 100, unit: '' }],
  });
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = useAction(
    () => {
      const body = { ...form, key_results: form.key_results.filter((k) => k.title.trim()) };
      return goal ? api.patch(`/goals/${goal.id}`, body) : api.post('/goals', body);
    },
    { invalidate: ['goals', 'dashboard'], onSuccess: (r) => { onClose(); if (!goal) navigate(`/goals/${r.id}`); }, onError: setError },
  );
  const setKr = (i, k, v) => set('key_results', form.key_results.map((kr, j) => (j === i ? { ...kr, [k]: v } : kr)));
  return (
    <Modal
      size="lg"
      title={goal ? 'Editar objetivo' : 'Nuevo objetivo'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}
    >
      <FormError error={error} />
      <Field label="Objetivo"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej. Consolidar las ventas en línea" /></Field>
      <Field label="Descripción"><textarea className="textarea" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="grid-3">
        <Field label="Periodo" hint="Ej. 2026-T4 o 2027"><input className="input" value={form.period} onChange={(e) => set('period', e.target.value)} /></Field>
        <Field label="Fecha objetivo"><DateField value={form.target_date} onChange={(v) => set('target_date', v)} /></Field>
        <Field label="Responsable"><UserPicker multi={false} value={form.owner_id} onChange={(v) => set('owner_id', v)} /></Field>
      </div>
      {goal && (
        <Field label="Estado">
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {GOAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
      )}
      {!goal && (
        <>
          <div className="label mb-2">Indicadores de seguimiento (opcional)</div>
          {form.key_results.map((kr, i) => (
            <div key={i} className="flex mb-2" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 3, minWidth: 180 }} placeholder="Ej. Ventas en línea" value={kr.title} onChange={(e) => setKr(i, 'title', e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 70 }} type="number" placeholder="Inicio" value={kr.start_value} onChange={(e) => setKr(i, 'start_value', e.target.value)} aria-label="Valor inicial" />
              <input className="input" style={{ flex: 1, minWidth: 70 }} type="number" placeholder="Meta" value={kr.target_value} onChange={(e) => setKr(i, 'target_value', e.target.value)} aria-label="Meta" />
              <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Unidad" value={kr.unit} onChange={(e) => setKr(i, 'unit', e.target.value)} aria-label="Unidad" />
              <IconButton icon={X} label="Quitar" onClick={() => set('key_results', form.key_results.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => set('key_results', [...form.key_results, { title: '', start_value: 0, target_value: 100, unit: '' }])}>Agregar indicador</Button>
        </>
      )}
    </Modal>
  );
}

function GoalDetail({ id, onClose, onEdit }) {
  const confirm = useConfirm();
  const members = useMemberMap();
  const { data: g, isLoading, error } = useQuery({ queryKey: ['goals', 'detail', id], queryFn: () => api.get(`/goals/${id}`) });
  const update = useAction((body) => api.patch(`/goals/${id}`, body), { invalidate: ['goals', 'dashboard'] });
  const remove = useAction(() => api.del(`/goals/${id}`), { invalidate: ['goals', 'dashboard', 'projects'], onSuccess: onClose, success: 'Objetivo eliminado' });
  const addKr = useAction((body) => api.post(`/goals/${id}/key-results`, body), { invalidate: ['goals'] });
  const updateKr = useAction(({ krId, ...body }) => api.patch(`/goals/key-results/${krId}`, body), { invalidate: ['goals', 'dashboard'] });
  const removeKr = useAction((krId) => api.del(`/goals/key-results/${krId}`), { invalidate: ['goals'] });
  const [newKr, setNewKr] = useState(null);
  return (
    <Modal size="lg" title="Objetivo" onClose={onClose}>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} /> : (
        <>
          <div className="flex" style={{ alignItems: 'flex-start' }}>
            <h2 style={{ fontSize: 20, flex: 1 }}>{g.title}</h2>
            <Menu
              trigger={(p) => <button className="icon-btn" aria-label="Opciones" {...p}><MoreHorizontal size={16} /></button>}
              items={[
                { label: 'Editar', icon: Pencil, onClick: () => { onClose(); onEdit(g); } },
                { section: 'Estado' },
                ...GOAL_STATUSES.map((s) => ({ label: s.label, checked: g.status === s.key, onClick: () => update.mutate({ status: s.key }) })),
                'sep',
                { label: 'Eliminar objetivo', icon: Trash2, danger: true, onClick: async () => (await confirm({ title: '¿Eliminar el objetivo?', message: 'Los proyectos y tareas vinculados se conservan.', confirmLabel: 'Eliminar', danger: true })) && remove.mutate() },
              ]}
            />
          </div>
          <div className="flex wrap small muted mt-1" style={{ gap: 12 }}>
            <Pill size="sm" color={GOAL_STATUS[g.status].color}>{GOAL_STATUS[g.status].label}</Pill>
            {g.period && <span>{g.period}</span>}
            {g.target_date && <span>Meta: {fmtDate(g.target_date)}</span>}
            {g.owner_id && <span className="flex" style={{ gap: 5 }}><Avatar user={members.get(g.owner_id)} size="xs" />{members.get(g.owner_id)?.name}</span>}
          </div>
          {g.description && <p className="mt-3" style={{ whiteSpace: 'pre-wrap' }}>{g.description}</p>}
          <div className="flex mt-4" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}><Progress value={g.progress} /></div>
            <span className="strong num">{g.progress}%</span>
          </div>
          <p className="faint tiny mt-1">{g.progress_source === 'key_results' ? 'Promedio del avance de los indicadores.' : 'Calculado con las tareas de los proyectos y tareas vinculados.'}</p>

          <div className="section">
            <div className="section-title"><h3>Indicadores</h3><Button size="xs" variant="ghost" icon={Plus} onClick={() => setNewKr({ title: '', start_value: 0, target_value: 100, unit: '' })}>Agregar</Button></div>
            {g.key_results.map((kr) => <KeyResult key={kr.id} kr={kr} onUpdate={(v) => updateKr.mutate({ krId: kr.id, current_value: v })} onRemove={() => removeKr.mutate(kr.id)} />)}
            {!g.key_results.length && !newKr && <p className="faint small">Sin indicadores. Agrega uno medible, por ejemplo «Ventas: de 0 a 100 piezas».</p>}
            {newKr && (
              <div className="flex mt-2" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: 3, minWidth: 160 }} autoFocus placeholder="Indicador" value={newKr.title} onChange={(e) => setNewKr({ ...newKr, title: e.target.value })} />
                <input className="input" style={{ flex: 1, minWidth: 64 }} type="number" placeholder="Inicio" value={newKr.start_value} onChange={(e) => setNewKr({ ...newKr, start_value: e.target.value })} />
                <input className="input" style={{ flex: 1, minWidth: 64 }} type="number" placeholder="Meta" value={newKr.target_value} onChange={(e) => setNewKr({ ...newKr, target_value: e.target.value })} />
                <input className="input" style={{ flex: 1, minWidth: 64 }} placeholder="Unidad" value={newKr.unit} onChange={(e) => setNewKr({ ...newKr, unit: e.target.value })} />
                <Button size="sm" variant="primary" disabled={!newKr.title.trim()} onClick={() => { addKr.mutate(newKr); setNewKr(null); }}>Agregar</Button>
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-title"><h3>Proyectos que contribuyen</h3></div>
            {g.projects.length ? g.projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="list-row"><span>{p.icon || '📁'}</span><span className="grow title">{p.name}</span><FolderKanban size={14} className="faint" /></Link>
            )) : <p className="faint small">Vincula un proyecto desde su pestaña Resumen → «Objetivo de la empresa».</p>}
            {g.tasks.length > 0 && (
              <>
                <div className="menu-label mt-2">Tareas vinculadas directamente</div>
                {g.tasks.map((t) => <Link key={t.id} to={`/tasks/${t.id}`} className="list-row"><CheckSquare size={14} className="faint" /><span className="grow title">{t.title}</span></Link>)}
              </>
            )}
          </div>
          <div className="section">
            <div className="section-title"><h3>Comentarios</h3></div>
            <Comments entityType="goal" entityId={id} />
          </div>
        </>
      )}
    </Modal>
  );
}

function KeyResult({ kr, onUpdate, onRemove }) {
  const [v, setV] = useState(String(kr.current_value));
  return (
    <div className="key-result">
      <div className="flex">
        <span style={{ flex: 1, fontWeight: 550 }}>{kr.title}</span>
        <input className="input num" style={{ width: 90, height: 28, textAlign: 'right' }} type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== kr.current_value && v !== '' && onUpdate(Number(v))} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Valor actual" />
        <span className="faint small" style={{ minWidth: 90 }}>de {kr.target_value} {kr.unit}</span>
        <IconButton icon={Trash2} size="xs" label="Eliminar indicador" onClick={onRemove} />
      </div>
      <div className="flex mt-2" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><Progress value={kr.progress} thin /></div>
        <span className="tiny faint num">{kr.progress}%</span>
      </div>
    </div>
  );
}
