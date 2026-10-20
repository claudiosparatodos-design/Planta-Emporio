export const STATUSES = [
  { key: 'idea', label: 'Idea', color: 'purple' },
  { key: 'todo', label: 'Por hacer', color: 'gray' },
  { key: 'in_progress', label: 'En progreso', color: 'blue' },
  { key: 'review', label: 'En revisión', color: 'yellow' },
  { key: 'blocked', label: 'Bloqueado', color: 'red' },
  { key: 'done', label: 'Terminado', color: 'green' },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

export const PRIORITIES = [
  { key: 'urgent', label: 'Urgente', color: 'red', rank: 4 },
  { key: 'high', label: 'Alta', color: 'orange', rank: 3 },
  { key: 'medium', label: 'Media', color: 'yellow', rank: 2 },
  { key: 'low', label: 'Baja', color: 'blue', rank: 1 },
  { key: 'none', label: 'Sin prioridad', color: 'gray', rank: 0 },
];
export const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.key, p]));

export const PROJECT_STATUSES = [
  { key: 'planning', label: 'Planeación', color: 'purple' },
  { key: 'active', label: 'Activo', color: 'green' },
  { key: 'paused', label: 'En pausa', color: 'yellow' },
  { key: 'completed', label: 'Completado', color: 'blue' },
  { key: 'archived', label: 'Archivado', color: 'gray' },
];
export const PROJECT_STATUS = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.key, s]));

export const GOAL_STATUSES = [
  { key: 'on_track', label: 'En buen camino', color: 'green' },
  { key: 'at_risk', label: 'En riesgo', color: 'yellow' },
  { key: 'off_track', label: 'Atrasado', color: 'red' },
  { key: 'achieved', label: 'Logrado', color: 'blue' },
  { key: 'dropped', label: 'Descartado', color: 'gray' },
];
export const GOAL_STATUS = Object.fromEntries(GOAL_STATUSES.map((s) => [s.key, s]));

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'];
export const COLOR_LABELS = {
  gray: 'Gris', brown: 'Café', orange: 'Naranja', yellow: 'Amarillo', green: 'Verde',
  teal: 'Turquesa', blue: 'Azul', purple: 'Morado', pink: 'Rosa', red: 'Rojo',
};

export const KIND_LABELS = {
  income: 'Ingreso',
  expense: 'Gasto',
  contribution: 'Aportación',
  loan_in: 'Préstamo recibido',
  reimbursement: 'Reembolso a socio',
  repayment: 'Devolución de préstamo',
  transfer: 'Transferencia',
};

export const ACCOUNT_TYPES = { bank: 'Banco', cash: 'Efectivo', card: 'Tarjeta', digital: 'Cartera digital', other: 'Otro' };

export const DECISION_STATUS = {
  proposed: { label: 'Pendiente', color: 'yellow' },
  approved: { label: 'Aprobada', color: 'green' },
  rejected: { label: 'Rechazada', color: 'red' },
  superseded: { label: 'Reemplazada', color: 'gray' },
};

export const PROJECT_ICONS = ['🌱', '🪴', '🌿', '🚀', '📦', '🛒', '🎪', '📣', '💡', '🧭', '🔁', '🏛️', '🎨', '📸', '🧾', '🤝', '🛠️', '📊'];
export const PAGE_ICONS = ['📄', '📝', '📌', '💡', '🧭', '📚', '🗓️', '🤝', '⚙️', '📊', '✨', '🌱', '🧾', '🔒', '📣', '🏷️'];

export const RECURRENCE = {
  daily: 'Cada día',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
  yearly: 'Cada año',
};
