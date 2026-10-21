import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, SlidersHorizontal, Bell, Building2, Shield, Zap, LayoutTemplate, DatabaseBackup, Plus, Trash2, Download, Mail, Info, Camera } from 'lucide-react';
import { api, uploadFiles } from '../lib/api.js';
import { STATUSES, PRIORITIES } from '../lib/constants.js';
import { fileSize, fmtDateTime, timeAgo, centsToInput, parseMoney } from '../lib/format.js';
import { useAction, useCan, useMe, usePref, useActiveMembers, useProjects, useIsMobile } from '../lib/hooks.js';
import { Avatar, Button, Callout, ColorDots, Field, FormError, Loading, MoneyInput, Pill, Switch, Segmented, EmptyState } from '../components/ui.jsx';
import { Modal, useConfirm, useToast } from '../components/overlay.jsx';
import { NAV, Topbar } from '../components/Layout.jsx';

const SECTIONS = [
  { to: 'profile', label: 'Mi perfil', icon: User },
  { to: 'preferences', label: 'Preferencias', icon: SlidersHorizontal },
  { to: 'notifications', label: 'Notificaciones', icon: Bell },
  { to: 'workspace', label: 'Espacio de trabajo', icon: Building2, perm: 'settings.manage' },
  { to: 'roles', label: 'Roles y permisos', icon: Shield },
  { to: 'automations', label: 'Automatizaciones', icon: Zap },
  { to: 'templates', label: 'Plantillas', icon: LayoutTemplate },
  { to: 'backups', label: 'Respaldos', icon: DatabaseBackup, perm: 'settings.manage' },
];

export default function Settings() {
  const me = useMe();
  const isMobile = useIsMobile();
  const visible = SECTIONS.filter((s) => !s.perm || me.permissions.includes(s.perm));
  return (
    <>
      <Topbar crumbs={[{ label: 'Configuración' }]} />
      <div className="content">
        <div className="page" style={{ display: 'flex', gap: 32, flexDirection: isMobile ? 'column' : 'row' }}>
          <nav style={{ width: isMobile ? '100%' : 210, flexShrink: 0, display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 2, overflowX: 'auto' }}>
            {visible.map((s) => (
              <NavLink key={s.to} to={`/settings/${s.to}`} className="sb-item" style={isMobile ? { width: 'auto', flexShrink: 0 } : undefined}>
                <span className="icon"><s.icon size={16} /></span>
                <span className="label">{s.label}</span>
              </NavLink>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, maxWidth: 760 }}>
            <Routes>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="preferences" element={<Preferences />} />
              <Route path="notifications" element={<NotificationPrefs />} />
              <Route path="workspace" element={<Workspace />} />
              <Route path="roles" element={<Roles />} />
              <Route path="automations" element={<Automations />} />
              <Route path="templates" element={<Templates />} />
              <Route path="backups" element={<Backups />} />
            </Routes>
          </div>
        </div>
      </div>
    </>
  );
}

const H = ({ title, sub }) => (
  <div className="mb-4">
    <h2 style={{ fontSize: 20 }}>{title}</h2>
    {sub && <p className="muted mt-1">{sub}</p>}
  </div>
);

function Profile() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: catalog } = useQuery({ queryKey: ['members', 'catalog'], queryFn: () => api.get('/members/catalog') });
  const [form, setForm] = useState({ name: me.name, title: me.title || '', phone: me.phone || '', avatar_color: me.avatar_color });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState(null);
  const photo = useRef(null);
  const save = useAction((body) => api.patch('/members/me', body), { invalidate: ['auth', 'members'], success: 'Perfil actualizado' });
  const changePw = useAction(() => {
    if (pw.next !== pw.confirm) return Promise.reject(new Error('Las contraseñas nuevas no coinciden.'));
    return api.post('/auth/change-password', { current: pw.current, next: pw.next });
  }, { success: 'Contraseña actualizada. Se cerraron tus otras sesiones.', onSuccess: () => { setPw({ current: '', next: '', confirm: '' }); setPwError(null); }, onError: setPwError });
  const uploadPhoto = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Elige una imagen.');
    try {
      const [f] = await uploadFiles([file], { visibility: 'workspace' });
      await api.patch('/members/me', { avatar_file_id: f.id });
      qc.invalidateQueries({ predicate: (q) => ['auth', 'members'].includes(q.queryKey[0]) });
      toast.success('Foto actualizada');
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <H title="Mi perfil" sub="Cómo te ven los demás integrantes." />
      <div className="flex mb-4" style={{ gap: 16 }}>
        <Avatar user={{ ...me, avatar_color: form.avatar_color }} size="xl" />
        <div className="flex-col" style={{ gap: 8 }}>
          <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => uploadPhoto(e.target.files[0])} />
          <div className="btn-group">
            <Button size="sm" icon={Camera} onClick={() => photo.current.click()}>Subir foto</Button>
            {me.avatar_file_id && <Button size="sm" variant="ghost" onClick={() => save.mutate({ avatar_file_id: null })}>Quitar foto</Button>}
          </div>
          {catalog && <ColorDots colors={catalog.avatarColors} value={form.avatar_color} onChange={(c) => setForm({ ...form, avatar_color: c })} />}
        </div>
      </div>
      <div className="grid-2">
        <Field label="Nombre"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Correo" hint="Para cambiarlo, pide ayuda a un administrador."><input className="input" value={me.email} disabled /></Field>
        <Field label="Puesto o rol en la empresa"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Ventas y redes sociales" /></Field>
        <Field label="Teléfono"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <div className="flex"><Pill color="purple">{me.role_name}</Pill><span className="spacer" style={{ flex: 1 }} /><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>Guardar cambios</Button></div>

      <div className="section" style={{ marginTop: 40 }}>
        <h3 style={{ fontSize: 16 }} className="mb-3">Cambiar contraseña</h3>
        <FormError error={pwError} />
        <div className="grid-3">
          <Field label="Actual"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nueva"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirmar"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        </div>
        <Button disabled={!pw.current || pw.next.length < 8} loading={changePw.isPending} onClick={() => changePw.mutate()}>Actualizar contraseña</Button>
      </div>
    </>
  );
}

function Preferences() {
  const [theme, setTheme] = usePref('theme', 'system');
  const [sidebar, setSidebar] = usePref('sidebar', {});
  const hidden = sidebar?.hidden || [];
  return (
    <>
      <H title="Preferencias" sub="Solo afectan tu vista." />
      <Field label="Tema">
        <Segmented value={theme || 'system'} onChange={setTheme} options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }, { value: 'system', label: 'Automático' }]} />
      </Field>
      <div className="section">
        <h3 style={{ fontSize: 15 }} className="mb-2">Menú lateral</h3>
        <p className="muted small mb-3">Oculta los módulos que no usas para mantener el menú simple. Siempre podrás encontrarlos con la búsqueda (⌘K).</p>
        <div className="card" style={{ padding: 6 }}>
          {NAV.filter((n) => n.key !== 'home').map((n) => (
            <div key={n.key} className="list-row">
              <n.icon size={16} className="faint" />
              <span className="grow">{n.label}</span>
              <Switch checked={!hidden.includes(n.key)} onChange={(on) => setSidebar({ hidden: on ? hidden.filter((h) => h !== n.key) : [...hidden, n.key] })} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function NotificationPrefs() {
  const me = useMe();
  const { data: catalog } = useQuery({ queryKey: ['members', 'catalog'], queryFn: () => api.get('/members/catalog') });
  const [prefs, setPrefs] = usePref('notifications', {});
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  if (!catalog) return <Loading />;
  return (
    <>
      <H title="Notificaciones" sub="Elige qué avisos quieres recibir dentro de la plataforma." />
      {!settings?.mail_configured && (
        <div className="mb-4"><Callout tone="info" icon={Mail} title="Las notificaciones son dentro de la plataforma">El envío por correo no está configurado en este servidor, así que no se envían correos. Un administrador puede configurarlo más adelante (ver documentación).</Callout></div>
      )}
      <div className="card" style={{ padding: 6 }}>
        {catalog.notificationTypes.map((t) => (
          <div key={t.key} className="list-row">
            <span className="grow">{t.label}</span>
            <Switch checked={prefs?.[t.key] !== false} onChange={(on) => setPrefs({ ...(prefs || {}), [t.key]: on })} />
          </div>
        ))}
      </div>
      <p className="faint small mt-3">Nunca recibes avisos de tus propias acciones. {me.name.split(' ')[0]}, si algo te genera demasiado ruido, desactívalo aquí.</p>
    </>
  );
}

function Workspace() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (data && !form) setForm({ name: data.name, currency: data.currency, timezone: data.timezone, threshold: centsToInput(data.approval_threshold_cents), payment_methods: data.payment_methods.join(', '), contribution_types: data.contribution_types.join(', ') });
  }, [data, form]);
  const save = useAction(() => {
    const threshold = form.threshold ? parseMoney(form.threshold) : null;
    if (form.threshold && threshold === null) return Promise.reject(new Error('El umbral no es un monto válido.'));
    return api.patch('/settings', {
      name: form.name,
      currency: form.currency,
      timezone: form.timezone,
      approval_threshold_cents: threshold,
      payment_methods: form.payment_methods.split(',').map((s) => s.trim()).filter(Boolean),
      contribution_types: form.contribution_types.split(',').map((s) => s.trim()).filter(Boolean),
    });
  }, { onSuccess: () => qc.invalidateQueries(), success: 'Configuración guardada', onError: setError });
  if (isLoading || !form) return <Loading />;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/') || z.startsWith('Europe/')) : [form.timezone];
  return (
    <>
      <H title="Espacio de trabajo" sub="Datos generales de la empresa y reglas financieras." />
      <FormError error={error} />
      <div className="grid-2">
        <Field label="Nombre de la empresa"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Moneda" hint="Código ISO: MXN, USD, EUR…"><input className="input" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Zona horaria" hint="Se usa para recordatorios y vencimientos.">
          <select className="select" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Gastos que requieren aprobación" hint="Desde este monto, un gasto de alguien sin permiso de aprobar queda pendiente. Vacío = sin límite.">
          <MoneyInput value={form.threshold} onChange={(v) => setForm({ ...form, threshold: v })} placeholder="Sin límite" />
        </Field>
      </div>
      <Field label="Métodos de pago" hint="Separados por comas."><input className="input" value={form.payment_methods} onChange={(e) => setForm({ ...form, payment_methods: e.target.value })} /></Field>
      <Field label="Tipos de aportación de socios" hint="Separados por comas. Los préstamos se registran aparte porque generan una deuda de la empresa."><input className="input" value={form.contribution_types} onChange={(e) => setForm({ ...form, contribution_types: e.target.value })} /></Field>
      <div className="form-actions"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></div>

      <div className="section">
        <h3 style={{ fontSize: 15 }} className="mb-2">Servicios</h3>
        <div className="card" style={{ padding: 6 }}>
          <div className="list-row" style={{ alignItems: 'flex-start', padding: 10 }}>
            <Mail size={16} className="faint" style={{ marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 550 }}>Correo</div>
              <div className="faint small">
                {data.mail_configured
                  ? `Activo con ${data.mail_provider === 'brevo' ? 'Brevo' : 'SMTP'}${data.mail_from ? `, remitente ${data.mail_from}` : ''}. Se envían invitaciones y recuperación de contraseña.`
                  : 'No configurado. Las invitaciones y recuperaciones se comparten con un enlace.'}
              </div>
            </div>
            {data.mail_configured && <TestEmailButton />}
          </div>
          <div className="list-row" style={{ alignItems: 'flex-start', padding: 10 }}>
            <DatabaseBackup size={16} className="faint" style={{ marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 550 }}>Almacenamiento de datos</div>
              <div className="faint small"><StorageStatus storage={data.storage} /></div>
              <div className="faint tiny mt-1">Archivos: hasta {data.storage_quota_mb} MB en total, {data.max_file_mb} MB por archivo.</div>
            </div>
          </div>
        </div>
        <p className="faint small mt-2">No hay conexiones con bancos ni servicios de pago. Requieren tu autorización expresa y una evaluación de seguridad antes de activarse.</p>
      </div>
    </>
  );
}

function TestEmailButton() {
  const test = useAction(() => api.post('/settings/test-email'), { success: (r) => `Correo de prueba enviado a ${r.to}. Revisa también la carpeta de spam.` });
  return <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>Enviar correo de prueba</Button>;
}

export function StorageStatus({ storage }) {
  if (!storage) return null;
  if (storage.mode === 'turso') {
    return (
      <>
        Respaldo continuo en Turso activo.
        {storage.lastSyncAt && ` Último envío de cambios ${timeAgo(storage.lastSyncAt)}.`}
        {storage.lastSnapshotAt && ` Última copia completa ${timeAgo(storage.lastSnapshotAt)}.`}
        {storage.pending > 0 && ` ${storage.pending} cambio(s) por enviar.`}
        {storage.error && <span style={{ color: 'var(--danger)' }}> Error reciente: {storage.error}</span>}
      </>
    );
  }
  if (storage.mode === 'ephemeral') return <span style={{ color: 'var(--danger)' }}>El disco de este alojamiento se borra y Turso no está configurado: los datos NO son permanentes.</span>;
  return 'En el disco del servidor (carpeta data/), con copia diaria automática.';
}

function Roles() {
  const canManage = useCan('settings.manage');
  const confirm = useConfirm();
  const { data: roles, isLoading } = useQuery({ queryKey: ['members', 'roles'], queryFn: () => api.get('/members/roles') });
  const { data: catalog } = useQuery({ queryKey: ['members', 'catalog'], queryFn: () => api.get('/members/catalog') });
  const update = useAction(({ id, ...body }) => api.patch(`/members/roles/${id}`, body), { invalidate: ['members', 'auth'] });
  const create = useAction((body) => api.post('/members/roles', body), { invalidate: ['members'], success: 'Rol creado' });
  const remove = useAction((id) => api.del(`/members/roles/${id}`), { invalidate: ['members'], success: 'Rol eliminado' });
  if (isLoading || !catalog) return <Loading />;
  const toggle = (role, perm, on) => update.mutate({ id: role.id, permissions: on ? [...role.permissions, perm] : role.permissions.filter((p) => p !== perm) });
  const groups = [...new Set(catalog.permissions.map((p) => p.group))];
  return (
    <>
      <H title="Roles y permisos" sub="Controla quién puede administrar proyectos, ver finanzas o invitar personas. El servidor valida estos permisos en cada acción." />
      <div className="table-wrap">
        <table className="table perm-table">
          <thead>
            <tr>
              <th>Permiso</th>
              {roles.map((r) => (
                <th key={r.id} style={{ textAlign: 'center' }}>
                  {r.name}
                  <div className="faint tiny" style={{ fontWeight: 400 }}>{r.users} {r.users === 1 ? 'persona' : 'personas'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g}><td colSpan={roles.length + 1} className="faint small strong" style={{ background: 'var(--bg-subtle)' }}>{g}</td></tr>,
              ...catalog.permissions.filter((p) => p.group === g).map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  {roles.map((r) => (
                    <td key={r.id}>
                      <input
                        type="checkbox"
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                        checked={r.permissions.includes(p.key)}
                        disabled={!canManage || r.is_system}
                        onChange={(e) => toggle(r, p.key, e.target.checked)}
                        aria-label={`${p.label} para ${r.name}`}
                      />
                    </td>
                  ))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <p className="faint small mt-2">El rol Administrador siempre tiene todos los permisos. {canManage ? '' : 'Solo quien administra la configuración puede cambiar permisos.'}</p>
      {canManage && (
        <div className="btn-group mt-4">
          <Button icon={Plus} onClick={async () => { const name = await confirm({ title: 'Nuevo rol', input: { placeholder: 'Ej. Contabilidad, Invitado', required: true }, confirmLabel: 'Crear' }); if (name) create.mutate({ name, permissions: [] }); }}>Nuevo rol</Button>
          {roles.filter((r) => !r.is_system && r.users === 0).map((r) => (
            <Button key={r.id} variant="ghost" icon={Trash2} onClick={async () => (await confirm({ title: `¿Eliminar el rol «${r.name}»?`, confirmLabel: 'Eliminar', danger: true })) && remove.mutate(r.id)}>Eliminar «{r.name}»</Button>
          ))}
        </div>
      )}
    </>
  );
}

const TARGET_LABELS = { assignees: 'Responsables de la tarea', project_owner: 'Responsable del proyecto', creator: 'Quien la creó', watchers: 'Seguidores', member: 'Integrante involucrado', participants: 'Participantes' };

function Automations() {
  const { data, isLoading } = useQuery({ queryKey: ['automations'], queryFn: () => api.get('/automations') });
  const update = useAction(({ id, ...body }) => api.patch(`/automations/${id}`, body), { invalidate: ['automations'] });
  const remove = useAction((id) => api.del(`/automations/${id}`), { invalidate: ['automations'], success: 'Automatización eliminada' });
  const [creating, setCreating] = useState(false);
  if (isLoading) return <Loading />;
  const describe = (r) => {
    const t = data.triggers[r.trigger];
    const cond = r.conditions.to ? ` a «${STATUSES.find((s) => s.key === r.conditions.to)?.label}»` : '';
    const ahead = r.conditions.days_before != null ? ` (${r.conditions.days_before} día(s) antes)` : r.conditions.minutes_before != null ? ` (${r.conditions.minutes_before} min antes)` : '';
    const who = r.action === 'notify' ? `avisar a: ${(r.action_config.targets || []).map((x) => TARGET_LABELS[x] || 'integrante').join(', ')}` : data.actions[r.action];
    return `${t}${cond}${ahead} → ${who}`;
  };
  return (
    <>
      <H title="Automatizaciones" sub="Reglas sencillas y transparentes. Se pueden desactivar en cualquier momento y nunca disparan otras reglas en cadena." />
      <div className="card" style={{ padding: 6 }}>
        {data.rules.map((r) => (
          <div key={r.id} className="list-row" style={{ alignItems: 'flex-start', padding: 10 }}>
            <Zap size={16} className="faint" style={{ marginTop: 2 }} />
            <div className="grow">
              <div style={{ fontWeight: 550 }}>{r.name}</div>
              <div className="faint small mt-1">{describe(r)}</div>
              <div className="faint tiny mt-1">{r.run_count ? `Se ha ejecutado ${r.run_count} ${r.run_count === 1 ? 'vez' : 'veces'} · última ${timeAgo(r.last_run_at)}` : 'Aún no se ejecuta'}{r.is_builtin ? ' · incluida' : ''}</div>
              {r.is_builtin && data.can_manage && (r.conditions.days_before != null || r.conditions.minutes_before != null) && (
                <div className="flex mt-2" style={{ gap: 6 }}>
                  <span className="small muted">Anticipación:</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    style={{ width: 80, height: 28 }}
                    defaultValue={r.conditions.days_before ?? r.conditions.minutes_before}
                    onBlur={(e) => update.mutate({ id: r.id, conditions: r.conditions.days_before != null ? { days_before: Number(e.target.value) } : { minutes_before: Number(e.target.value) } })}
                  />
                  <span className="small muted">{r.conditions.days_before != null ? 'días' : 'minutos'}</span>
                </div>
              )}
            </div>
            {!r.is_builtin && data.can_manage && <button className="icon-btn sm" aria-label="Eliminar" onClick={() => remove.mutate(r.id)}><Trash2 size={14} /></button>}
            <Switch checked={Boolean(r.enabled)} disabled={!data.can_manage} onChange={(on) => update.mutate({ id: r.id, enabled: on })} />
          </div>
        ))}
      </div>
      {data.can_manage && <Button className="mt-3" icon={Plus} onClick={() => setCreating(true)}>Nueva regla</Button>}
      {creating && <RuleModal onClose={() => setCreating(false)} />}
    </>
  );
}

function RuleModal({ onClose }) {
  const members = useActiveMembers();
  const { data: projects = [] } = useProjects({ status: 'planning,active,paused' });
  const [form, setForm] = useState({ name: '', trigger: 'task.status_changed', to: 'review', project_id: '', action: 'notify', targets: ['project_owner'], user_id: '', priority: 'high' });
  const [error, setError] = useState(null);
  const create = useAction(() => {
    const conditions = { ...(form.trigger === 'task.status_changed' ? { to: form.to } : {}), ...(form.project_id ? { project_id: Number(form.project_id) } : {}) };
    const action_config = form.action === 'notify' ? { targets: [...form.targets, ...(form.user_id ? [`user:${form.user_id}`] : [])] } : form.action === 'assign' ? { user_id: Number(form.user_id) } : { priority: form.priority };
    return api.post('/automations', { name: form.name, trigger: form.trigger, conditions, action: form.action, action_config });
  }, { invalidate: ['automations'], success: 'Regla creada', onSuccess: onClose, onError: setError });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title="Nueva automatización" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!form.name.trim() || (form.action === 'assign' && !form.user_id)} loading={create.isPending} onClick={() => create.mutate()}>Crear regla</Button></>}>
      <FormError error={error} />
      <Field label="Nombre"><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Avisar a Sofía cuando algo pase a revisión" /></Field>
      <div className="grid-2">
        <Field label="Cuando">
          <select className="select" value={form.trigger} onChange={(e) => set('trigger', e.target.value)}>
            <option value="task.status_changed">Una tarea cambia de estado</option>
            <option value="task.created">Se crea una tarea</option>
          </select>
        </Field>
        {form.trigger === 'task.status_changed' && (
          <Field label="Pasa a">
            <select className="select" value={form.to} onChange={(e) => set('to', e.target.value)}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="En el proyecto">
          <select className="select" value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Cualquier proyecto</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Entonces">
          <select className="select" value={form.action} onChange={(e) => set('action', e.target.value)}>
            <option value="notify">Enviar notificación</option>
            <option value="assign">Asignar a un integrante</option>
            <option value="set_priority">Cambiar la prioridad</option>
          </select>
        </Field>
      </div>
      {form.action === 'notify' && (
        <Field label="Avisar a">
          <div className="flex-col" style={{ gap: 6 }}>
            {['assignees', 'project_owner', 'creator', 'watchers'].map((t) => (
              <label key={t} className="check small"><input type="checkbox" checked={form.targets.includes(t)} onChange={(e) => set('targets', e.target.checked ? [...form.targets, t] : form.targets.filter((x) => x !== t))} />{TARGET_LABELS[t]}</label>
            ))}
          </div>
        </Field>
      )}
      {(form.action === 'notify' || form.action === 'assign') && (
        <Field label={form.action === 'assign' ? 'Integrante' : 'Y además a (opcional)'}>
          <select className="select" value={form.user_id} onChange={(e) => set('user_id', e.target.value)}>
            <option value="">—</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      )}
      {form.action === 'set_priority' && (
        <Field label="Prioridad">
          <select className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

function Templates() {
  const { data: pageTemplates = [] } = useQuery({ queryKey: ['pages', 'templates'], queryFn: () => api.get('/pages?templates=1') });
  const { data: projectTemplates = [] } = useQuery({ queryKey: ['templates'], queryFn: () => api.get('/templates') });
  return (
    <>
      <H title="Plantillas" sub="Para no empezar desde cero: documentos y proyectos con su estructura lista." />
      <h3 style={{ fontSize: 15 }} className="mb-2">Documentos</h3>
      <p className="muted small mb-3">Puedes editar estas plantillas como cualquier documento o crear nuevas desde un documento («Guardar como plantilla»).</p>
      <div className="card mb-4" style={{ padding: 6 }}>
        {pageTemplates.map((t) => (
          <Link key={t.id} to={`/docs/${t.id}`} className="list-row"><span style={{ width: 22, textAlign: 'center' }}>{t.icon || '📄'}</span><span className="grow title">{t.title}</span><span className="meta">{t.template_category}</span></Link>
        ))}
      </div>
      <h3 style={{ fontSize: 15 }} className="mb-2">Proyectos</h3>
      <p className="muted small mb-3">Se eligen al crear un proyecto. Para crear una nueva, usa «Guardar como plantilla» en el menú de un proyecto.</p>
      <div className="card" style={{ padding: 6 }}>
        {projectTemplates.map((t) => (
          <div key={t.id} className="list-row"><span style={{ width: 22, textAlign: 'center' }}>{t.icon || '📁'}</span><span className="grow"><span className="title">{t.name}</span><div className="faint small">{t.description}</div></span><span className="meta">{t.task_count} tareas</span></div>
        ))}
      </div>
    </>
  );
}

function Backups() {
  const { data = [], isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => api.get('/backups') });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const create = useAction(() => api.post('/backups'), { invalidate: ['backups'], success: 'Respaldo creado' });
  return (
    <>
      <H title="Respaldos" sub="Copias completas de la base de datos. Se crea una automática cada día y se conservan las más recientes." />
      <Callout icon={Info} title="Guarda copias fuera del servidor">
        <span className="small">Descarga un respaldo de vez en cuando y guárdalo en un lugar seguro (contiene información privada de la empresa). Los archivos subidos se guardan en la carpeta <code>data/uploads</code> del servidor y también conviene respaldarla.</span>
      </Callout>
      {settings?.storage?.mode === 'turso' && (
        <div className="mt-3"><Callout tone="success" icon={DatabaseBackup} title="Copia permanente en Turso"><span className="small"><StorageStatus storage={settings.storage} /> Se conserva además una copia completa por día de la última semana en Turso. Las copias de esta lista se guardan en el disco del servidor, que en el plan gratuito se borra: descárgalas si las quieres conservar.</span></Callout></div>
      )}
      <div className="flex mt-4 mb-3"><span className="spacer" style={{ flex: 1 }} /><Button variant="primary" icon={DatabaseBackup} loading={create.isPending} onClick={() => create.mutate()}>Crear respaldo ahora</Button></div>
      {isLoading ? <Loading /> : !data.length ? <EmptyState compact title="Aún no hay respaldos" /> : (
        <div className="card" style={{ padding: 6 }}>
          {data.map((b) => (
            <div key={b.name} className="list-row">
              <DatabaseBackup size={16} className="faint" />
              <span className="grow"><span className="title">{b.name}</span><div className="faint small">{fmtDateTime(b.created_at)} · {fileSize(b.size)}</div></span>
              <a className="btn sm" href={`/api/backups/${encodeURIComponent(b.name)}`}><Download size={14} />Descargar</a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
