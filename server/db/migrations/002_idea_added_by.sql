-- Ideas can come from the agent too (while planning features together). Its own ideas wait for the user.
ALTER TABLE ideas ADD COLUMN added_by TEXT NOT NULL DEFAULT 'you' CHECK (added_by IN ('you', 'agent'));
