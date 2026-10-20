import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './lib/hooks.js';
import { setUnauthorizedHandler } from './lib/api.js';
import { setCurrency } from './lib/format.js';
import { Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, Setup, AcceptInvite, ResetPassword, Forgot } from './pages/auth/Auth.jsx';
import Home from './pages/Home.jsx';
import Tasks from './pages/Tasks.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import Meetings, { MeetingDetail } from './pages/Meetings.jsx';
import Decisions from './pages/Decisions.jsx';
import Goals from './pages/Goals.jsx';
import Chat from './pages/Chat.jsx';
import Files from './pages/Files.jsx';
import Inbox from './pages/Inbox.jsx';
import Notifications from './pages/Notifications.jsx';
import Members, { MemberProfile } from './pages/Members.jsx';
import Settings from './pages/Settings.jsx';
import Trash from './pages/Trash.jsx';
import Activity from './pages/Activity.jsx';
import NotFound from './pages/NotFound.jsx';

// El editor de documentos y finanzas se cargan bajo demanda (son los módulos más pesados).
const Docs = lazy(() => import('./pages/Docs.jsx'));
const Finance = lazy(() => import('./pages/finance/Finance.jsx'));

const FullLoad = () => (
  <div className="full-load">
    <Spinner size={22} />
  </div>
);

function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else delete root.dataset.theme;
  try {
    localStorage.setItem('pe:theme', pref || 'system');
  } catch {
    /* sin almacenamiento */
  }
}

export default function App() {
  const { data, isLoading, error, refetch } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => qc.invalidateQueries({ queryKey: ['auth'] }));
  }, [qc]);

  useEffect(() => {
    if (data?.workspace) {
      setCurrency(data.workspace.currency);
      document.title = data.workspace.name;
    }
    applyTheme(data?.user?.prefs?.theme);
  }, [data]);

  // Navegación desde contenido (menciones dentro del editor).
  useEffect(() => {
    const fn = (e) => navigate(e.detail);
    window.addEventListener('pe:navigate', fn);
    return () => window.removeEventListener('pe:navigate', fn);
  }, [navigate]);

  if (isLoading) return <FullLoad />;
  if (error) {
    return (
      <div className="auth">
        <div className="auth-box" style={{ maxWidth: 400, textAlign: 'center' }}>
          <h1>No se pudo conectar</h1>
          <p className="sub">{error.message}</p>
          <button className="btn primary" onClick={() => refetch()}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (data.setupRequired) {
    return (
      <Routes>
        <Route path="*" element={<Setup />} />
      </Routes>
    );
  }

  if (!data.user) {
    const next = location.pathname !== '/' && !location.pathname.startsWith('/login') ? location.pathname + location.search : '';
    return (
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/reset/:token" element={<ResetPassword />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:taskId" element={<Tasks />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="docs" element={<Suspense fallback={<FullLoad />}><Docs /></Suspense>} />
        <Route path="docs/:id" element={<Suspense fallback={<FullLoad />}><Docs /></Suspense>} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingDetail />} />
        <Route path="decisions" element={<Decisions />} />
        <Route path="decisions/:id" element={<Decisions />} />
        <Route path="goals" element={<Goals />} />
        <Route path="goals/:id" element={<Goals />} />
        <Route path="finance/*" element={<Suspense fallback={<FullLoad />}><Finance /></Suspense>} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:id" element={<Chat />} />
        <Route path="files" element={<Files />} />
        <Route path="members" element={<Members />} />
        <Route path="members/:id" element={<MemberProfile />} />
        <Route path="settings/*" element={<Settings />} />
        <Route path="trash" element={<Trash />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
