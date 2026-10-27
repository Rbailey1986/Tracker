-- Migration 007: Allow 'on_hold' as a valid task status.
-- Rebuilds the tasks table to update the status CHECK constraint.

CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  key TEXT,
  project_id TEXT NOT NULL REFERENCES projects (id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'blocked', 'done', 'on_hold')),
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

INSERT INTO tasks_new SELECT * FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX tasks_project ON tasks (project_id);
CREATE UNIQUE INDEX tasks_key ON tasks (project_id, key) WHERE key IS NOT NULL AND deleted_at IS NULL;
