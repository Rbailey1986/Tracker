import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const BACKUPS_KEPT = 14;

/** %APPDATA%/Tracker on Windows, ~/.tracker elsewhere. TRACKER_DATA_DIR overrides it (tests, portable installs). */
export function defaultDataDir(): string {
  if (process.env.TRACKER_DATA_DIR) return process.env.TRACKER_DATA_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'Tracker');
  return path.join(os.homedir(), '.tracker');
}

export function defaultAgentDir(): string {
  if (process.env.TRACKER_AGENT_DIR) return process.env.TRACKER_AGENT_DIR;
  return path.join(os.homedir(), 'Tracker', 'agent');
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  return db;
}

/** Runs numbered SQL files (001_name.sql, ...) that haven't run yet, each in its own transaction. */
export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: number }).id));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const id = Number.parseInt(f, 10);
    if (done.has(id)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(id, f, new Date().toISOString());
    })();
    db.pragma('foreign_keys = ON');
  }
}

/** Copies the database into backups/ beside it before it is opened, keeping the newest 14. */
export function backupDb(dbFile: string): string | null {
  if (!fs.existsSync(dbFile)) return null;
  const dir = path.join(path.dirname(dbFile), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `tracker-${stamp}.db`);
  fs.copyFileSync(dbFile, target);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^tracker-.*\.db$/.test(f))
    .sort()
    .reverse()
    .slice(BACKUPS_KEPT);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return target;
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
