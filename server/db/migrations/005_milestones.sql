-- Milestones: releases, new features and major changes per project, planned or achieved, with what was achieved.
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'feature' CHECK (kind IN ('release', 'feature', 'change')),
  version_label TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'achieved')),
  target_date TEXT,
  achieved_on TEXT,
  description TEXT NOT NULL DEFAULT '',
  achieved TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX milestones_project ON milestones (project_id);
CREATE UNIQUE INDEX milestones_key ON milestones (project_id, key) WHERE key IS NOT NULL AND deleted_at IS NULL;
