import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { requireAuth, requireClientHeader } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import membersRoutes from './routes/members.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import pagesRoutes from './routes/pages.js';
import filesRoutes from './routes/files.js';
import chatRoutes from './routes/chat.js';
import meetingsRoutes from './routes/meetings.js';
import decisionsRoutes from './routes/decisions.js';
import goalsRoutes from './routes/goals.js';
import financeRoutes from './routes/finance.js';
import dashboardRoutes from './routes/dashboard.js';
import workspaceRoutes from './routes/workspace.js';
import eventsRoutes from './routes/events.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-src': ["'self'"],
          'frame-ancestors': ["'self'"],
          'upgrade-insecure-requests': config.production && !process.env.INSECURE_COOKIES ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.production && !process.env.INSECURE_COOKIES,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  api.use(requireClientHeader);
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/events', eventsRoutes);
  api.use('/members', membersRoutes);
  api.use('/projects', projectsRoutes);
  api.use('/tasks', tasksRoutes);
  api.use('/pages', pagesRoutes);
  api.use('/files', filesRoutes);
  api.use('/chat', chatRoutes);
  api.use('/meetings', meetingsRoutes);
  api.use('/decisions', decisionsRoutes);
  api.use('/goals', goalsRoutes);
  api.use('/finance', financeRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/', workspaceRoutes);
  api.use((req, res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  app.use('/api', api);

  // Aplicación web compilada (producción).
  const dist = path.join(config.root, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos con formato inválido.' });
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `El archivo supera el máximo de ${config.maxFileMb} MB.` });
    }
    if (String(err?.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Ya existe un elemento con esos datos.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

  return app;
}
