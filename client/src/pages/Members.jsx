import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Copy, MoreHorizontal, KeyRound, UserX, UserCheck, Shield, MessageSquare, Mail, X, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDate, timeAgo } from '../lib/format.js';
import { useAction, useCan, useMe } from '../lib/hooks.js';
import { Avatar, Button, EmptyState, ErrorState, Field, FormError, Loading, Pill, SkeletonList, Callout } from '../components/ui.jsx';
import { Menu, Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { Topbar } from '../components/Layout.jsx';
import { TaskRow, useTaskPatch } from '../components/tasks.jsx';
import { useNavigate } from 'react-router-dom';

export default function Members() {
  const me = useMe();
  const canManage = useCan('members.manage');
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState(null);
  const { data: members = [], isLoading, error, refetch } = useQuery({ queryKey: ['members'], queryFn: () => api.get('/members') });
  const { data: roles = [] } = useQuery({ queryKey: ['members', 'roles'], queryFn: () => api.get('/members/roles') });
  const { data: invitations = [] } = useQuery({ queryKey: ['members', 'invitations'], queryFn: () => api.get('/members/invitations'), enabled: canManage });
  const revoke = useAction((id) => api.del(`/members/invitations/${id}`), { invalidate: ['members'], success: 'Invitación revocada' });
  const active = members.filter((m) => m.status === 'active');
  const disabled = members.filter((m) => m.status !== 'active');
  return (
    <>
      <Topbar crumbs={[{ label: 'Integrantes' }]} actions={canManage && <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>Invitar</Button>} />
      <div className="content">
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Integrantes</h1>
              <p className="page-subtitle">{active.length} personas en el espacio. Los permisos se configuran por rol en Configuración.</p>
            </div>
          </div>
          {isLoading ? <SkeletonList /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
            <div className="card" style={{ padding: 6 }}>
              {active.map((m) => <MemberRow key={m.id} m={m} roles={roles} canManage={canManage} isMe={m.id === me.id} onLink={setLink} />)}
            </div>
          )}
          {canManage && invitations.length > 0 && (
            <div className="section">
              <div className="section-title"><h3>Invitaciones pendientes</h3></div>
              <div className="card" style={{ padding: 6 }}>
                {invitations.map((i) => (
                  <div key={i.id} className="list-row">
                    <span className="avatar md c-gray"><Mail size={15} /></span>
                    <div className="grow">
                      <div className="title">{i.name || i.email}</div>
                      <div className="faint small">{i.email} · {i.role_name} · {i.expired ? 'expirada' : `expira ${fmtDate(i.expires_at)}`}</div>
                    </div>
                    {i.expired && <Pill size="sm" color="red">Expirada</Pill>}
                    <Button size="xs" variant="ghost" icon={X} onClick={() => revoke.mutate(i.id)}>Revocar</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {disabled.length > 0 && (
            <div className="section">
              <div className="section-title"><h3>Cuentas desactivadas</h3></div>
              <div className="card" style={{ padding: 6, opacity: 0.8 }}>
                {disabled.map((m) => <MemberRow key={m.id} m={m} roles={roles} canManage={canManage} onLink={setLink} />)}
              </div>
            </div>
          )}
        </div>
      </div>
      {inviting && <InviteModal roles={roles} onClose={() => setInviting(false)} onLink={setLink} />}
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
    </>
  );
}

function MemberRow({ m, roles, canManage, isMe, onLink }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const update = useAction((body) => api.patch(`/members/${m.id}`, body), { invalidate: ['members'], success: 'Integrante actualizado' });
  const reset = useAction(() => api.post(`/members/${m.id}/reset-link`), {
    onSuccess: (r) => onLink({ title: `Enlace de recuperación para ${m.name}`, link: r.link, note: `Válido por ${r.expiresInHours} horas y de un solo uso. Compártelo de forma privada (por ejemplo, por mensaje directo).` }),
  });
  const dm = async () => {
    const { id } = await api.post('/chat/dm', { user_id: m.id });
    navigate(`/chat/${id}`);
  };
  return (
    <div className="list-row" style={{ padding: 10 }}>
      <Avatar user={m} size="md" />
      <Link to={`/members/${m.id}`} className="grow">
        <div className="title" style={{ fontWeight: 550 }}>{m.name}{isMe && <span className="faint"> (tú)</span>}</div>
        <div className="faint small truncate">{m.title ? `${m.title} · ` : ''}{m.email}</div>
      </Link>
      <span className="meta hide-sm">{m.open_tasks} tareas abiertas</span>
      <Pill size="sm" color={m.role_name === 'Administrador' ? 'purple' : m.role_name === 'Socio' ? 'blue' : 'gray'}>{m.role_name}</Pill>
      {!isMe && m.status === 'active' && <button className="icon-btn sm" aria-label="Mensaje directo" title="Mensaje directo" onClick={dm}><MessageSquare size={15} /></button>}
      {canManage && !isMe && (
        <Menu
          trigger={(p) => <button className="icon-btn sm" aria-label="Opciones" {...p}><MoreHorizontal size={15} /></button>}
          items={[
            { section: 'Rol' },
            ...roles.map((r) => ({ label: r.name, icon: Shield, checked: r.id === m.role_id, onClick: () => update.mutate({ role_id: r.id }) })),
            'sep',
            { label: 'Generar enlace de recuperación', icon: KeyRound, onClick: () => reset.mutate() },
            m.status === 'active'
              ? { label: 'Desactivar cuenta', icon: UserX, danger: true, onClick: async () => (await confirm({ title: `¿Desactivar a ${m.name}?`, message: 'No podrá entrar y se cerrarán sus sesiones. Su historial y tareas se conservan. Puedes reactivarla cuando quieras.', confirmLabel: 'Desactivar', danger: true })) && update.mutate({ status: 'disabled' }) }
              : { label: 'Reactivar cuenta', icon: UserCheck, onClick: () => update.mutate({ status: 'active' }) },
          ]}
        />
      )}
    </div>
  );
}

function InviteModal({ roles, onClose, onLink }) {
  const [form, setForm] = useState({ email: '', name: '', role_id: roles.find((r) => r.name === 'Integrante')?.id || roles[0]?.id });
  const [error, setError] = useState(null);
  const invite = useAction(() => api.post('/members/invitations', form), {
    invalidate: ['members'],
    onError: setError,
    onSuccess: (r) => {
      onClose();
      onLink({
        title: `Invitación para ${form.name || form.email}`,
        link: r.link,
        note: r.emailSent
          ? 'También se envió por correo. El enlace vale 7 días y es de un solo uso.'
          : 'El envío de correos no está configurado, así que no se envió ningún correo. Comparte este enlace en privado (vale 7 días y es de un solo uso).',
      });
    },
  });
  const role = roles.find((r) => r.id === Number(form.role_id));
  return (
    <Modal title="Invitar integrante" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.email} loading={invite.isPending} onClick={() => invite.mutate()}>Crear invitación</Button></>}>
      <FormError error={error} />
      <Field label="Correo"><input className="input" type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Nombre (opcional)"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Rol" hint={role?.description}>
        <select className="select" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: Number(e.target.value) })}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function LinkModal({ title, link, note, onClose }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Enlace copiado');
    } catch {
      toast.error('Copia el enlace manualmente.');
    }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Listo</Button>}>
      <Callout tone="info" title="Comparte este enlace">{note}</Callout>
      <div className="flex mt-3">
        <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button icon={Copy} onClick={copy}>Copiar</Button>
      </div>
    </Modal>
  );
}

export function MemberProfile() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const patch = useTaskPatch();
  const { data: m, isLoading, error } = useQuery({ queryKey: ['members', 'profile', Number(id)], queryFn: () => api.get(`/members/${id}`) });
  if (isLoading) return <><Topbar crumbs={[{ label: 'Integrantes', to: '/members' }]} /><Loading /></>;
  if (error) return <><Topbar crumbs={[{ label: 'Integrantes', to: '/members' }]} /><ErrorState error={error} /></>;
  const dm = async () => {
    const { id: cid } = await api.post('/chat/dm', { user_id: m.id });
    navigate(`/chat/${cid}`);
  };
  return (
    <>
      <Topbar crumbs={[{ label: 'Integrantes', to: '/members' }, { label: m.name }]} actions={m.id !== me.id && m.status === 'active' && <Button size="sm" icon={MessageSquare} onClick={dm}>Mensaje</Button>} />
      <div className="content">
        <div className="page narrow">
          <div className="flex" style={{ gap: 16 }}>
            <Avatar user={m} size="xl" />
            <div>
              <h1 className="page-title">{m.name}</h1>
              <div className="muted">{m.title || m.role_name}</div>
              <div className="faint small mt-1">{m.email}{m.phone ? ` · ${m.phone}` : ''}{m.last_seen_at ? ` · activo ${timeAgo(m.last_seen_at)}` : ''}</div>
            </div>
          </div>
          <div className="section">
            <div className="section-title"><h3>Tareas abiertas ({m.tasks.length})</h3></div>
            {m.tasks.length ? m.tasks.map((t) => <TaskRow key={t.id} task={{ ...t, assignee_ids: [m.id], tags: [] }} onToggle={(x, s) => patch(x.id, { status: s })} />) : <EmptyState compact title="Sin tareas abiertas" />}
          </div>
          <div className="section">
            <div className="section-title"><h3>Proyectos</h3></div>
            {m.projects.length ? m.projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="list-row"><span>{p.icon || '📁'}</span><span className="grow title">{p.name}</span></Link>
            )) : <EmptyState compact icon={Users} title="No participa en proyectos todavía" />}
          </div>
        </div>
      </div>
    </>
  );
}
