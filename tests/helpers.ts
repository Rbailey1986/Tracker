import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateFile } from '../shared/schemas/index.js';
import { openDb, type DB } from '../server/db/db.js';
import { seed } from '../server/seed.js';

export function memoryDb(withSeed = false): DB {
  const db = openDb(':memory:');
  if (withSeed) seed(db);
  return db;
}

export function tempDir(prefix = 'tracker-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const uuid = () => crypto.randomUUID();

export function updateFile(changes: UpdateFile['changes'], extra: Partial<UpdateFile> = {}): UpdateFile {
  return {
    schema_version: 1,
    file_id: `test-${uuid()}`,
    created_at: new Date().toISOString(),
    agent: 'Test agent',
    summary: 'Test file',
    changes,
    ...extra,
  };
}

export function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

export async function waitFor<T>(fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 3000, stepMs = 25): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
