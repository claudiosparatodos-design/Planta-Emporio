-- Planta-Emporio · esquema v1
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ───────────── Integrantes, roles y acceso ─────────────
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role_id        INTEGER NOT NULL REFERENCES roles(id),
  title          TEXT,
  phone          TEXT,
  avatar_color   TEXT,
  avatar_file_id INTEGER,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  prefs          TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,           -- sha256 del token
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invitations (
  id               INTEGER PRIMARY KEY,
  email            TEXT NOT NULL COLLATE NOCASE,
  name             TEXT,
  role_id          INTEGER NOT NULL REFERENCES roles(id),
  token_hash       TEXT NOT NULL UNIQUE,
  invited_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  accepted_at      TEXT,
  accepted_user_id INTEGER REFERENCES users(id),
  revoked_at       TEXT
);

CREATE TABLE password_resets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- ───────────── Objetivos ─────────────
CREATE TABLE goals (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  period      TEXT,
  owner_id    INTEGER REFERENCES users(id),
  start_date  TEXT,
  target_date TEXT,
  status      TEXT NOT NULL DEFAULT 'on_track'
              CHECK (status IN ('on_track','at_risk','off_track','achieved','dropped')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE key_results (
  id            INTEGER PRIMARY KEY,
  goal_id       INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  start_value   REAL NOT NULL DEFAULT 0,
  target_value  REAL NOT NULL DEFAULT 100,
  current_value REAL NOT NULL DEFAULT 0,
  position      REAL NOT NULL DEFAULT 0,
  updated_by    INTEGER REFERENCES users(id),
  updated_at    TEXT NOT NULL
);

-- ───────────── Proyectos y tareas ─────────────
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'gray'
);

CREATE TABLE projects (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  objective       TEXT NOT NULL DEFAULT '',
  expected_result TEXT NOT NULL DEFAULT '',
  owner_id        INTEGER REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('planning','active','paused','completed','archived')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('none','low','medium','high','urgent')),
  start_date      TEXT,
  due_date        TEXT,
  color           TEXT NOT NULL DEFAULT 'green',
  icon            TEXT,
  visibility      TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','members')),
  goal_id         INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT,
  deleted_at      TEXT
);

CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE project_columns (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('idea','todo','in_progress','review','blocked','done')),
  position   REAL NOT NULL DEFAULT 0,
  color      TEXT
);
CREATE INDEX idx_columns_project ON project_columns(project_id);

CREATE TABLE tasks (
  id                   INTEGER PRIMARY KEY,
  project_id           INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  column_id            INTEGER REFERENCES project_columns(id) ON DELETE SET NULL,
  parent_id            INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'todo'
                       CHECK (status IN ('idea','todo','in_progress','review','blocked','done')),
  priority             TEXT NOT NULL DEFAULT 'none'
                       CHECK (priority IN ('none','low','medium','high','urgent')),
  position             REAL NOT NULL DEFAULT 0,
  start_date           TEXT,
  due_date             TEXT,
  estimate_minutes     INTEGER,
  spent_minutes        INTEGER NOT NULL DEFAULT 0,
  recurrence           TEXT,
  recurrence_source_id INTEGER,
  goal_id              INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  meeting_id           INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  completed_at         TEXT,
  completed_by         INTEGER REFERENCES users(id),
  deleted_at           TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_due ON tasks(due_date);

CREATE TABLE task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX idx_assignees_user ON task_assignees(user_id);

CREATE TABLE task_watchers (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE checklist_items (
  id       INTEGER PRIMARY KEY,
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  done_by  INTEGER REFERENCES users(id),
  done_at  TEXT
);

CREATE TABLE task_dependencies (
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- esta tarea…
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- …depende de esta
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE task_links (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  title      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE templates (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'project',
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT,
  structure   TEXT NOT NULL,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- ───────────── Colaboración transversal ─────────────
CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  edited_at   TEXT,
  deleted_at  TEXT
);
CREATE INDEX idx_comments_entity ON comments(entity_type, entity_id);

CREATE TABLE activity (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  project_id  INTEGER,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  data        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX idx_activity_created ON activity(created_at);
CREATE INDEX idx_activity_project ON activity(project_id);

CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  actor_id    INTEGER REFERENCES users(id),
  entity_type TEXT,
  entity_id   INTEGER,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE links (
  id         INTEGER PRIMARY KEY,
  a_type     TEXT NOT NULL,
  a_id       INTEGER NOT NULL,
  b_type     TEXT NOT NULL,
  b_id       INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (a_type, a_id, b_type, b_id)
);
CREATE INDEX idx_links_b ON links(b_type, b_id);

CREATE TABLE favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  position    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE TABLE saved_views (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  shared     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE inbox_items (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  processed_at TEXT,
  result_type  TEXT,
  result_id    INTEGER
);

CREATE TABLE reminders (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  remind_at   TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  notified_at TEXT,
  done_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE automations (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  conditions    TEXT NOT NULL DEFAULT '{}',
  action        TEXT NOT NULL,
  action_config TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  run_count     INTEGER NOT NULL DEFAULT 0,
  last_run_at   TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);

CREATE TABLE sent_reminders (
  key        TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- ───────────── Documentos ─────────────
CREATE TABLE pages (
  id                INTEGER PRIMARY KEY,
  parent_id         INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  title             TEXT NOT NULL DEFAULT '',
  icon              TEXT,
  content           TEXT NOT NULL DEFAULT '[]',
  content_text      TEXT NOT NULL DEFAULT '',
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  visibility        TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','private')),
  is_template       INTEGER NOT NULL DEFAULT 0,
  template_category TEXT,
  position          REAL NOT NULL DEFAULT 0,
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        INTEGER REFERENCES users(id),
  updated_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_pages_parent ON pages(parent_id);
CREATE INDEX idx_pages_project ON pages(project_id);

CREATE TABLE page_versions (
  id         INTEGER PRIMARY KEY,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_page_versions_page ON page_versions(page_id);

-- ───────────── Archivos ─────────────
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE files (
  id          INTEGER PRIMARY KEY,
  folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','finance','private')),
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- ───────────── Chat ─────────────
CREATE TABLE channels (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('general','project','topic','dm')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_id  INTEGER UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  dm_key      TEXT UNIQUE,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE channel_members (
  channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  edited_at   TEXT,
  deleted_at  TEXT
);
CREATE INDEX idx_messages_channel ON messages(channel_id, id);

-- ───────────── Reuniones y decisiones ─────────────
CREATE TABLE meetings (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT,
  location   TEXT NOT NULL DEFAULT '',
  objective  TEXT NOT NULL DEFAULT '',
  agenda     TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled')),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE meeting_participants (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE decisions (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'proposed'
              CHECK (status IN ('proposed','approved','rejected','superseded')),
  meeting_id  INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  proposed_by INTEGER REFERENCES users(id),
  decided_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE decision_approvers (
  decision_id  INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response     TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','approved','rejected')),
  comment      TEXT,
  responded_at TEXT,
  PRIMARY KEY (decision_id, user_id)
);

-- ───────────── Finanzas ─────────────
CREATE TABLE fin_accounts (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL DEFAULT 'bank' CHECK (type IN ('bank','cash','card','digital','other')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT NOT NULL DEFAULT '',
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL,
  archived_at           TEXT
);

CREATE TABLE fin_categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  color       TEXT NOT NULL DEFAULT 'gray',
  created_at  TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (name, kind)
);

CREATE TABLE fin_obligations (
  id                    INTEGER PRIMARY KEY,
  direction             TEXT NOT NULL CHECK (direction IN ('payable','receivable')),
  source                TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','reimbursement','loan')),
  title                 TEXT NOT NULL,
  counterparty          TEXT NOT NULL DEFAULT '',
  member_id             INTEGER REFERENCES users(id),
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date              TEXT,
  category_id           INTEGER REFERENCES fin_categories(id),
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  source_transaction_id INTEGER,
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  cancelled_at          TEXT,
  cancelled_by          INTEGER REFERENCES users(id),
  cancel_reason         TEXT
);

CREATE TABLE fin_transactions (
  id                INTEGER PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN
                    ('income','expense','contribution','loan_in','reimbursement','repayment','transfer')),
  concept           TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  date              TEXT NOT NULL,
  category_id       INTEGER REFERENCES fin_categories(id),
  account_id        INTEGER REFERENCES fin_accounts(id),
  to_account_id     INTEGER REFERENCES fin_accounts(id),
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  member_id         INTEGER REFERENCES users(id),
  counterparty      TEXT NOT NULL DEFAULT '',
  payment_method    TEXT NOT NULL DEFAULT '',
  paid_personally   INTEGER NOT NULL DEFAULT 0,
  contribution_type TEXT,
  obligation_id     INTEGER REFERENCES fin_obligations(id),
  notes             TEXT NOT NULL DEFAULT '',
  approval_status   TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','rejected')),
  approval_reason   TEXT,
  approved_by       INTEGER REFERENCES users(id),
  approved_at       TEXT,
  created_by        INTEGER REFERENCES users(id),
  updated_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  voided_at         TEXT,
  voided_by         INTEGER REFERENCES users(id),
  void_reason       TEXT
);
CREATE INDEX idx_tx_date ON fin_transactions(date);
CREATE INDEX idx_tx_obligation ON fin_transactions(obligation_id);

CREATE TABLE fin_budgets (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  category_ids TEXT NOT NULL DEFAULT '[]',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  owner_id     INTEGER REFERENCES users(id),
  alert_pct    INTEGER NOT NULL DEFAULT 80,
  over_action  TEXT NOT NULL DEFAULT 'warn' CHECK (over_action IN ('warn','approval')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

-- ───────────── Búsqueda global ─────────────
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
