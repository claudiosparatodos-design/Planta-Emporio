import { db, getSetting, setSetting } from './index.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';

const now = () => new Date().toISOString();

export const DEFAULT_COLUMNS = [
  { name: 'Ideas', category: 'idea' },
  { name: 'Por hacer', category: 'todo' },
  { name: 'En progreso', category: 'in_progress' },
  { name: 'En revisión', category: 'review' },
  { name: 'Bloqueado', category: 'blocked' },
  { name: 'Terminado', category: 'done' },
];

/** Datos base idempotentes: roles, ajustes, automatizaciones y plantillas. No crea datos de negocio. */
export function seed() {
  for (const role of DEFAULT_ROLES) {
    if (!db.get('SELECT 1 FROM roles WHERE name = ?', role.name)) {
      db.insert('roles', { ...role, permissions: role.permissions, created_at: now() });
    }
  }

  const defaults = {
    workspace_name: 'Planta-Emporio',
    currency: 'MXN',
    locale: 'es-MX',
    timezone: 'America/Mexico_City',
    approval_threshold_cents: null,
    payment_methods: ['Efectivo', 'Transferencia', 'Tarjeta de débito', 'Tarjeta de crédito', 'Depósito'],
    contribution_types: ['Capital', 'Aportación en especie', 'Otro'],
    onboarding_dismissed: false,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (getSetting(key, undefined) === undefined) setSetting(key, value);
  }

  if (!getSetting('seeded_automations', false)) {
    const rules = [
      {
        name: 'Avisar cuando una tarea se bloquea',
        trigger: 'task.status_changed',
        conditions: { to: 'blocked' },
        action: 'notify',
        action_config: { targets: ['project_owner', 'assignees'] },
        enabled: 1,
      },
      {
        name: 'Avisar al responsable del proyecto cuando una tarea pasa a revisión',
        trigger: 'task.status_changed',
        conditions: { to: 'review' },
        action: 'notify',
        action_config: { targets: ['project_owner'] },
        enabled: 1,
      },
      {
        name: 'Recordar tareas que vencen mañana',
        trigger: 'task.due_soon',
        conditions: { days_before: 1 },
        action: 'notify',
        action_config: { targets: ['assignees'] },
        enabled: 1,
      },
      {
        name: 'Recordar pagos y cobros próximos a vencer',
        trigger: 'obligation.due_soon',
        conditions: { days_before: 3 },
        action: 'notify',
        action_config: { targets: ['creator', 'member'] },
        enabled: 1,
      },
      {
        name: 'Recordar reuniones una hora antes',
        trigger: 'meeting.upcoming',
        conditions: { minutes_before: 60 },
        action: 'notify',
        action_config: { targets: ['participants'] },
        enabled: 1,
      },
      {
        name: 'Avisar a quien creó una tarea cuando se termina',
        trigger: 'task.status_changed',
        conditions: { to: 'done' },
        action: 'notify',
        action_config: { targets: ['creator'] },
        enabled: 0,
      },
    ];
    for (const r of rules) db.insert('automations', { ...r, is_builtin: 1, created_at: now() });
    setSetting('seeded_automations', true);
  }

  if (!getSetting('seeded_categories', false)) {
    const cats = [
      ['Ventas', 'income', 'green'],
      ['Servicios', 'income', 'teal'],
      ['Otros ingresos', 'income', 'gray'],
      ['Materiales', 'expense', 'orange'],
      ['Herramientas', 'expense', 'brown'],
      ['Publicidad', 'expense', 'pink'],
      ['Transporte', 'expense', 'blue'],
      ['Proveedores', 'expense', 'purple'],
      ['Servicios y suscripciones', 'expense', 'yellow'],
      ['Otros gastos', 'expense', 'gray'],
    ];
    for (const [name, kind, color] of cats) db.insert('fin_categories', { name, kind, color, created_at: now() });
    setSetting('seeded_categories', true);
  }

  if (!getSetting('seeded_accounts', false)) {
    // Cuenta inicial con saldo 0: no se inventa dinero, solo se prepara el lugar para registrarlo.
    db.insert('fin_accounts', { name: 'Caja principal', type: 'cash', initial_balance_cents: 0, notes: '', created_at: now() });
    setSetting('seeded_accounts', true);
  }

  if (!getSetting('seeded_templates', false)) {
    for (const t of PROJECT_TEMPLATES) {
      db.insert('templates', { kind: 'project', ...t, structure: t.structure, is_builtin: 1, created_at: now() });
    }
    for (const t of PAGE_TEMPLATES) {
      db.insert('pages', {
        title: t.title,
        icon: t.icon,
        content: t.content,
        content_text: '',
        is_template: 1,
        template_category: t.category,
        created_at: now(),
        updated_at: now(),
      });
    }
    setSetting('seeded_templates', true);
  }
}

// ───────── Plantillas de proyecto ─────────
const task = (title, category = 'todo', extra = {}) => ({ title, category, ...extra });

const PROJECT_TEMPLATES = [
  {
    name: 'Lanzamiento de producto',
    icon: '🚀',
    description: 'Desde la definición del producto hasta las primeras ventas.',
    structure: {
      objective: 'Lanzar un nuevo producto al mercado.',
      tasks: [
        task('Definir el producto, público y precio', 'todo', { priority: 'high', checklist: ['Público objetivo', 'Costo unitario', 'Precio de venta', 'Margen esperado'] }),
        task('Solicitar cotizaciones a proveedores', 'todo', { checklist: ['Proveedor 1', 'Proveedor 2', 'Proveedor 3'] }),
        task('Diseño de marca y empaque', 'todo'),
        task('Fotografías y contenido para redes', 'todo'),
        task('Plan de lanzamiento y calendario', 'todo', { priority: 'high' }),
        task('Abrir canal de venta', 'todo'),
        task('Medir resultados del primer mes', 'todo'),
        task('Ideas de productos complementarios', 'idea'),
      ],
    },
  },
  {
    name: 'Evento o feria',
    icon: '🎪',
    description: 'Planeación, logística y evaluación de un evento.',
    structure: {
      objective: 'Organizar un evento exitoso y dentro del presupuesto.',
      tasks: [
        task('Elegir fecha y lugar', 'todo', { priority: 'high' }),
        task('Definir presupuesto del evento', 'todo', { priority: 'high' }),
        task('Permisos y requisitos', 'todo'),
        task('Logística, materiales y transporte', 'todo', { checklist: ['Mobiliario', 'Producto', 'Transporte', 'Decoración'] }),
        task('Promoción e invitaciones', 'todo'),
        task('Montaje y desmontaje', 'todo'),
        task('Evaluación y aprendizajes', 'todo'),
      ],
    },
  },
  {
    name: 'Campaña de marketing',
    icon: '📣',
    description: 'Una campaña con objetivo, contenido, publicación y medición.',
    structure: {
      objective: 'Aumentar el alcance y las ventas mediante una campaña.',
      tasks: [
        task('Objetivo y público de la campaña', 'todo', { priority: 'high' }),
        task('Mensaje y piezas creativas', 'todo'),
        task('Calendario de publicaciones', 'todo'),
        task('Presupuesto de anuncios', 'todo'),
        task('Publicar y responder a la comunidad', 'todo'),
        task('Medir resultados', 'todo'),
      ],
    },
  },
  {
    name: 'Operación mensual',
    icon: '🔁',
    description: 'Actividades administrativas que se repiten cada mes.',
    structure: {
      objective: 'Mantener la operación al día cada mes.',
      tasks: [
        task('Pagar servicios y suscripciones', 'todo', { recurrence: { freq: 'monthly', interval: 1 }, dueInDays: 5 }),
        task('Revisar ingresos y gastos del mes', 'todo', { recurrence: { freq: 'monthly', interval: 1 }, dueInDays: 28 }),
        task('Revisión de inventario', 'todo', { recurrence: { freq: 'monthly', interval: 1 }, dueInDays: 25 }),
        task('Reunión mensual de socios', 'todo', { recurrence: { freq: 'monthly', interval: 1 }, dueInDays: 30 }),
      ],
    },
  },
  {
    name: 'Formalización de la empresa',
    icon: '🏛️',
    description: 'Lista de pasos generales para formalizar el negocio (consulta a un profesional).',
    structure: {
      objective: 'Formalizar Planta-Emporio con asesoría profesional.',
      tasks: [
        task('Definir nombre y estructura legal con un asesor', 'todo', { priority: 'high' }),
        task('Redactar acuerdos entre socios', 'todo', { priority: 'high', checklist: ['Aportaciones', 'Reparto de utilidades', 'Roles', 'Salida de un socio'] }),
        task('Alta fiscal del negocio', 'todo'),
        task('Abrir cuenta bancaria del negocio', 'todo'),
        task('Registro de marca (si aplica)', 'idea'),
      ],
    },
  },
];

// ───────── Plantillas de documentos (formato de bloques BlockNote) ─────────
const h = (text, level = 2) => ({ type: 'heading', props: { level }, content: text });
const p = (text = '') => ({ type: 'paragraph', content: text });
const li = (text) => ({ type: 'bulletListItem', content: text });
const ck = (text) => ({ type: 'checkListItem', props: { checked: false }, content: text });
const num = (text) => ({ type: 'numberedListItem', content: text });

const PAGE_TEMPLATES = [
  {
    title: 'Notas de reunión',
    icon: '🗓️',
    category: 'Reuniones',
    content: [
      p('Fecha: · Participantes: '),
      h('Objetivo'), p(),
      h('Agenda'), num('Tema 1'), num('Tema 2'),
      h('Notas'), p(),
      h('Decisiones'), li(''),
      h('Acuerdos y responsables'), ck('Acción — responsable — fecha'),
    ],
  },
  {
    title: 'Propuesta',
    icon: '💡',
    category: 'Propuestas',
    content: [
      h('Resumen'), p('¿Qué proponemos en una o dos frases?'),
      h('Problema u oportunidad'), p(),
      h('Propuesta'), p(),
      h('Costo estimado y recursos'), p(),
      h('Riesgos'), li(''),
      h('Siguiente paso'), ck(''),
    ],
  },
  {
    title: 'Plan de trabajo',
    icon: '🧭',
    category: 'Planes',
    content: [
      h('Objetivo'), p(),
      h('Alcance'), li('Incluye: '), li('No incluye: '),
      h('Etapas'), num('Etapa 1 — fecha'), num('Etapa 2 — fecha'),
      h('Responsables'), p(),
      h('Indicadores de éxito'), li(''),
    ],
  },
  {
    title: 'Revisión semanal',
    icon: '📊',
    category: 'Revisiones',
    content: [
      h('Lo que logramos'), li(''),
      h('Lo que quedó pendiente'), li(''),
      h('Bloqueos'), li(''),
      h('Prioridades de la próxima semana'), ck(''),
      h('Números de la semana'), p('Ventas: · Gastos: '),
    ],
  },
  {
    title: 'Registro de ideas',
    icon: '✨',
    category: 'Ideas',
    content: [
      h('Idea'), p(),
      h('¿Por qué podría funcionar?'), p(),
      h('¿Qué necesitaríamos?'), li(''),
      h('Primer experimento'), ck(''),
    ],
  },
  {
    title: 'Proceso interno',
    icon: '⚙️',
    category: 'Procesos',
    content: [
      h('Para qué sirve este proceso'), p(),
      h('Responsable'), p(),
      h('Pasos'), num('Paso 1'), num('Paso 2'), num('Paso 3'),
      h('Herramientas y recursos'), li(''),
      h('Errores comunes'), li(''),
    ],
  },
];
