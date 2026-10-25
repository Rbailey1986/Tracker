// Starts a seeded tracker on port 4319 with its own data and agent folder under .tmp/e2e.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.tmp/e2e');
fs.rmSync(root, { recursive: true, force: true });
process.env.TRACKER_DATA_DIR = path.join(root, 'data');
process.env.TRACKER_AGENT_DIR = path.join(root, 'agent');
process.env.TRACKER_PORT = '4319';
process.env.TRACKER_NO_OPEN = '1';

const { openDb } = await import('../../server/db/db.js');
const { seed } = await import('../../server/seed.js');
const db = openDb(path.join(process.env.TRACKER_DATA_DIR, 'tracker.db'));
seed(db);
db.close();
await import('../../server/main.js');
