import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Button, Field, FormError, Loading } from '../../components/ui.jsx';

function Shell({ children, workspace }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="ws-logo"><Sprout size={20} /></span>
          {workspace || 'Planta-Emporio'}
        </div>
        <div className="auth-box fade-in">{children}</div>
      </div>
    </div>
  );
}

function useSubmit(fn) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };
  return { submit, error, loading };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = qc.getQueryData(['auth'])?.workspace?.name;
  const { submit, error, loading } = useSubmit(async () => {
    await api.post('/auth/login', { email, password, remember });
    navigate(params.get('next') || '/', { replace: true });
  });
  return (
    <Shell workspace={ws}>
      <h1>Iniciar sesión</h1>
      <p className="sub">Entra al espacio de trabajo de tu empresa.</p>
      <form onSubmit={submit}>
        <FormError error={error} />
        <Field label="Correo" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="check small mb-3" style={{ display: 'flex' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Mantener la sesión iniciada en este equipo
        </label>
        <p className="faint tiny mb-3" style={{ marginTop: -6 }}>Déjalo sin marcar en computadoras prestadas o compartidas: la sesión se cierra al cerrar el navegador.</p>
        <Button type="submit" variant="primary" size="lg" block loading={loading}>Entrar</Button>
      </form>
      <div className="auth-foot">
        <Link className="link" to="/forgot">¿Olvidaste tu contraseña?</Link>
      </div>
    </Shell>
  );
}

export function Setup() {
  const [form, setForm] = useState({ workspaceName: 'Planta-Emporio', name: '', email: '', password: '', currency: 'MXN' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const { submit, error, loading } = useSubmit(() => api.post('/auth/setup', form));
  return (
    <Shell workspace={form.workspaceName || 'Planta-Emporio'}>
      <h1>Bienvenido 👋</h1>
      <p className="sub">Configura el espacio de trabajo. Serás quien lo administre y después podrás invitar a tus socios.</p>
      <form onSubmit={submit}>
        <FormError error={error} />
        <Field label="Nombre de la empresa">
          <input className="input" required value={form.workspaceName} onChange={set('workspaceName')} />
        </Field>
        <div className="grid-2">
          <Field label="Tu nombre">
            <input className="input" required autoFocus autoComplete="name" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Moneda" hint="Código ISO, p. ej. MXN">
            <select className="select" value={form.currency} onChange={set('currency')}>
              {['MXN', 'USD', 'EUR', 'COP', 'ARS', 'CLP', 'PEN', 'GTQ'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Correo">
          <input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loading}>Crear espacio</Button>
      </form>
    </Shell>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ['invite', token], queryFn: () => api.get(`/auth/invite/${token}`), retry: false });
  const [name, setName] = useState(null);
  const [password, setPassword] = useState('');
  const { submit, error, loading } = useSubmit(async () => {
    await api.post(`/auth/invite/${token}`, { name: name ?? data.name ?? '', password });
    navigate('/', { replace: true });
  });
  if (isLoading) return <Shell><Loading /></Shell>;
  if (loadError) {
    return (
      <Shell>
        <h1>Invitación no disponible</h1>
        <p className="sub">{loadError.message}</p>
        <Link className="btn block" to="/login">Ir a iniciar sesión</Link>
      </Shell>
    );
  }
  return (
    <Shell workspace={data.workspace.name}>
      <h1>Únete a {data.workspace.name}</h1>
      <p className="sub">Te invitaron como <strong>{data.role}</strong>. Crea tu cuenta para entrar.</p>
      <form onSubmit={submit}>
        <FormError error={error} />
        <Field label="Correo">
          <input className="input" value={data.email} disabled />
        </Field>
        <Field label="Tu nombre">
          <input className="input" required autoFocus autoComplete="name" value={name ?? data.name ?? ''} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          Crear cuenta y entrar
        </Button>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ['reset', token], queryFn: () => api.get(`/auth/reset/${token}`), retry: false });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { submit, error, loading } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Las contraseñas no coinciden.');
    await api.post(`/auth/reset/${token}`, { password });
    navigate('/', { replace: true });
  });
  if (isLoading) return <Shell><Loading /></Shell>;
  if (loadError) {
    return (
      <Shell>
        <h1>Enlace no válido</h1>
        <p className="sub">{loadError.message}</p>
        <Link className="btn block" to="/login">Ir a iniciar sesión</Link>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1>Nueva contraseña</h1>
      <p className="sub">Hola {data.name}, elige una contraseña nueva para {data.email}.</p>
      <form onSubmit={submit}>
        <FormError error={error} />
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres.">
          <input className="input" type="password" required minLength={8} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirmar contraseña">
          <input className="input" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loading}>Guardar y entrar</Button>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(await api.post('/auth/forgot', { email }));
    } catch (err) {
      setError(err);
    }
    setLoading(false);
  };
  return (
    <Shell>
      <h1>Recuperar acceso</h1>
      {result ? (
        <div className="flex-col" style={{ gap: 14 }}>
          <div className={`callout ${result.mailConfigured ? 'success' : 'info'}`}>
            <CheckCircle2 size={17} />
            <div className="callout-body">{result.message}</div>
          </div>
          <Link className="btn block" to="/login">Volver a iniciar sesión</Link>
        </div>
      ) : (
        <>
          <p className="sub">Escribe tu correo. Si el envío de correos está configurado recibirás un enlace; si no, un administrador puede generarte uno.</p>
          <form onSubmit={submit}>
            <FormError error={error} />
            <Field label="Correo">
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" size="lg" block loading={loading}>Continuar</Button>
          </form>
          <div className="auth-foot"><Link className="link" to="/login">Volver</Link></div>
        </>
      )}
    </Shell>
  );
}
