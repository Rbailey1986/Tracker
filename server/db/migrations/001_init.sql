-- Phase 1 schema. Every editable table carries version, created_at, updated_at and deleted_at.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  key TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  area TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3451D1',
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX projects_key ON projects (key) WHERE key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  key TEXT,
  project_id TEXT NOT NULL REFERENCES projects (id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'blocked', 'done')),
  blocked_reason TEXT,
  owner TEXT NOT NULL DEFAULT 'you' CHECK (owner IN ('you', 'agent')),
  due_date TEXT,
  priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
  estimate_minutes INTEGER,
  created_from TEXT NOT NULL DEFAULT 'manual' CHECK (created_from IN ('manual', 'template', 'agent_file')),
  created_from_ref TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX tasks_project ON tasks (project_id);
CREATE UNIQUE INDEX tasks_key ON tasks (project_id, key) WHERE key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX subtasks_task ON subtasks (task_id);

-- The pair (task_id, depends_on_task_id) is the key among live rows; the id lets the change log treat it like any other entity.
CREATE TABLE dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks (id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (task_id <> depends_on_task_id)
);
CREATE UNIQUE INDEX dependencies_pair ON dependencies (task_id, depends_on_task_id) WHERE deleted_at IS NULL;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('project', 'task')),
  parent_id TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX notes_parent ON notes (parent_type, parent_id) WHERE deleted_at IS NULL;

CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'picked_up', 'dismissed')),
  result_type TEXT CHECK (result_type IS NULL OR result_type IN ('task', 'project', 'note', 'question', 'none')),
  result_id TEXT,
  agent_note TEXT,
  picked_up_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('you', 'agent', 'import', 'system')),
  source_file TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete', 'restore')),
  field TEXT,
  before_json TEXT,
  after_json TEXT,
  entity_version_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  undone_by_change_id TEXT,
  -- Context columns so the feed and task history can filter without rebuilding the tree.
  project_id TEXT,
  task_id TEXT,
  entity_label TEXT,
  reverts_batch_id TEXT
);
CREATE INDEX changes_batch ON changes (batch_id);
CREATE INDEX changes_entity ON changes (entity, entity_id);
CREATE INDEX changes_project ON changes (project_id, batch_id);
CREATE INDEX changes_task ON changes (task_id, batch_id);

-- One row per received file. file_id is not unique: duplicates and rejected attempts each get their own row.
CREATE TABLE agent_files (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'duplicate')),
  received_at TEXT NOT NULL,
  decided_at TEXT,
  error TEXT,
  summary TEXT,
  agent TEXT,
  change_count INTEGER NOT NULL DEFAULT 0,
  body_json TEXT,
  batch_id TEXT,
  project_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX agent_files_file_id ON agent_files (file_id);

CREATE TABLE agent_change_ids (
  change_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL
);

CREATE TABLE agent_questions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  agent_file_row_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  text TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
