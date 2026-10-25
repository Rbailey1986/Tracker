-- Notes and answers you leave on a task or idea for the agent, and "do this next" hand-offs. The agent sees open
-- ones in snapshot.json and answers through message_replies in its update file. Like questions, these sit
-- outside the change log.
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('task', 'idea')),
  parent_id TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'do_next')),
  author TEXT NOT NULL CHECK (author IN ('you', 'agent')),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handled')),
  reply_to TEXT,
  file_id TEXT,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE INDEX agent_messages_parent ON agent_messages (parent_type, parent_id);
CREATE INDEX agent_messages_open ON agent_messages (status, kind);
