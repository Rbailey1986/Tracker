// npm run seed: fills an empty database with the mockup's projects. For development and tests only.
import path from 'node:path';
import { defaultDataDir, openDb } from '../server/db/db.js';
import { seed } from '../server/seed.js';

const dbPath = path.join(defaultDataDir(), 'tracker.db');
const db = openDb(dbPath);
try {
  seed(db);
  console.log(`Seeded ${dbPath}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
