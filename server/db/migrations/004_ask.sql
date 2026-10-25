-- Questions you ask about a task or idea (the Ask button). The tracker runs Claude Code in the project's folder
-- and stores the answer as a reply. SQLite can't change a CHECK, so the table is rebuilt with 'ask' allowed.
CREATE TABLE agent_messages_new (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('task', 'idea')),
  parent_id TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'do_next', 'ask')),
  author TEXT NOT NULL CHECK (author IN ('you', 'agent')),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handled')),
  reply_to TEXT,
  file_id TEXT,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
INSERT INTO agent_messages_new SELECT * FROM agent_messages;
DROP TABLE agent_messages;
ALTER TABLE agent_messages_new RENAME TO agent_messages;
CREATE INDEX agent_messages_parent ON agent_messages (parent_type, parent_id);
CREATE INDEX agent_messages_open ON agent_messages (status, kind);
