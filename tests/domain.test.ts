import { describe, expect, it } from 'vitest';
import { setDependencies } from '../server/domain/ops.js';
import { decorateTasks, getTaskView, listBatches } from '../server/domain/queries.js';
import { getRow, inBatch } from '../server/domain/store.js';
import { addDays, todayLocal } from '../server/domain/time.js';
import { undoBatch } from '../server/domain/undo.js';
import { memoryDb } from './helpers.js';

function setup() {
  const db = memoryDb();
  const p = inBatch(db, { actor: 'you' }, (w) => w.create('project', { name: 'P' }));
  const mk = (title: string, extra: Record<string, unknown> = {}) =>
    inBatch(db, { actor: 'you' }, (w) => w.create('task', { project_id: p.id, title, ...extra }));
  return { db, p, mk };
}

describe('change log', () => {
  it('writes one row per changed field in one batch, and raises the version', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const { row } = inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { title: 'B', priority: 'high', owner: 'you' }));
    expect(row.version).toBe(2);
    const rows = db.prepare(`SELECT * FROM changes WHERE entity_id = ? AND op = 'update'`).all(t.id) as any[];
    expect(rows.map((r) => r.field).sort()).toEqual(['priority', 'title']); // owner didn't change
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1);
  });

  it('refuses a stale version with 409 and the current record', () => {
    const { db, mk } = setup();
    const t = mk('A');
    inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { title: 'B' }, { expectedVersion: 1 }));
    expect(() => inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { title: 'C' }, { expectedVersion: 1 }))).toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('sets completed_at when a task is done and clears it on reopen', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const done = inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { status: 'done' })).row;
    expect(done.completed_at).toBeTruthy();
    const reopened = inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { status: 'in_progress' })).row;
    expect(reopened.completed_at).toBeNull();
  });
});

describe('undo', () => {
  it('reverses an update batch as a new batch and keeps history', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const batch = inBatch(db, { actor: 'you' }, (w) => (w.update('task', t.id, { title: 'B', status: 'done' }), w.batchId));
    const undo = undoBatch(db, batch);
    const row = getRow(db, 'task', t.id)!;
    expect(row.title).toBe('A');
    expect(row.status).toBe('not_started');
    expect(row.completed_at).toBeNull();
    const original = db.prepare('SELECT * FROM changes WHERE batch_id = ?').all(batch) as any[];
    expect(original.every((r) => r.undone_by_change_id)).toBe(true);
    const reverse = db.prepare('SELECT * FROM changes WHERE batch_id = ?').all(undo.batchId) as any[];
    expect(reverse.every((r) => r.actor === 'you' && r.reverts_batch_id === batch)).toBe(true);
  });

  it('undoing a create soft-deletes; undoing a delete restores', () => {
    const { db, p } = setup();
    let createBatch = '';
    const t = inBatch(db, { actor: 'you' }, (w) => ((createBatch = w.batchId), w.create('task', { project_id: p.id, title: 'X' })));
    undoBatch(db, createBatch);
    expect(getRow(db, 'task', t.id)).toBeUndefined();
    expect(getRow(db, 'task', t.id, { includeDeleted: true })).toBeTruthy();

    const t2 = inBatch(db, { actor: 'you' }, (w) => w.create('task', { project_id: p.id, title: 'Y' }));
    const del = inBatch(db, { actor: 'you' }, (w) => (w.delete('task', t2.id), w.batchId));
    undoBatch(db, del);
    expect(getRow(db, 'task', t2.id)?.title).toBe('Y');
  });

  it('refuses when a later change touched the same field, until that one is undone', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const first = inBatch(db, { actor: 'agent' }, (w) => (w.update('task', t.id, { title: 'B' }), w.batchId));
    const second = inBatch(db, { actor: 'you' }, (w) => (w.update('task', t.id, { title: 'C' }), w.batchId));
    expect(() => undoBatch(db, first)).toThrowError(/changed again later/);
    undoBatch(db, second);
    expect(getRow(db, 'task', t.id)?.title).toBe('B');
    undoBatch(db, first);
    expect(getRow(db, 'task', t.id)?.title).toBe('A');
  });

  it('allows undo when a later change touched a different field', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const first = inBatch(db, { actor: 'you' }, (w) => (w.update('task', t.id, { title: 'B' }), w.batchId));
    inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { priority: 'high' }));
    undoBatch(db, first);
    const row = getRow(db, 'task', t.id)!;
    expect(row.title).toBe('A');
    expect(row.priority).toBe('high');
  });

  it('refuses a second undo of the same batch', () => {
    const { db, mk } = setup();
    const t = mk('A');
    const b = inBatch(db, { actor: 'you' }, (w) => (w.update('task', t.id, { title: 'B' }), w.batchId));
    undoBatch(db, b);
    expect(() => undoBatch(db, b)).toThrowError(/already been undone/);
  });

  it('shows batches newest first in the feed, and task history filters to the task', () => {
    const { db, mk } = setup();
    const a = mk('A');
    const b = mk('B');
    inBatch(db, { actor: 'you' }, (w) => w.create('subtask', { task_id: a.id, text: 's' }));
    const feed = listBatches(db, {});
    expect(feed[0].changes[0].entity).toBe('subtask');
    const hist = listBatches(db, { taskId: a.id });
    expect(hist.length).toBe(2);
    expect(hist.every((h) => h.changes.every((c) => c.task_id === a.id))).toBe(true);
    expect(listBatches(db, { taskId: b.id }).length).toBe(1);
  });
});

describe('dependencies', () => {
  it('refuses cycles, direct and indirect', () => {
    const { db, mk } = setup();
    const a = mk('A');
    const b = mk('B');
    const c = mk('C');
    setDependencies(db, a.id, { depends_on: [b.id] });
    setDependencies(db, b.id, { depends_on: [c.id] });
    expect(() => setDependencies(db, c.id, { depends_on: [a.id] })).toThrowError(/cycle/);
    expect(() => setDependencies(db, a.id, { depends_on: [a.id] })).toThrowError(/itself/);
  });

  it('replaces the list in one batch', () => {
    const { db, mk } = setup();
    const [a, b, c] = [mk('A'), mk('B'), mk('C')];
    setDependencies(db, a.id, { depends_on: [b.id] });
    setDependencies(db, a.id, { depends_on: [c.id] });
    expect(getTaskView(db, a.id)!.depends_on).toEqual([c.id]);
  });
});

describe('derived values', () => {
  it('blocked follows status and unfinished dependencies', () => {
    const { db, mk } = setup();
    const a = mk('A');
    const b = mk('B');
    const s = mk('S', { status: 'blocked' });
    expect(getTaskView(db, s.id)!.blocked).toBe(true);
    setDependencies(db, a.id, { depends_on: [b.id] });
    expect(getTaskView(db, a.id)!.blocked).toBe(true);
    inBatch(db, { actor: 'you' }, (w) => w.update('task', b.id, { status: 'done' }));
    expect(getTaskView(db, a.id)!.blocked).toBe(false);
  });

  it('a deleted dependency target no longer blocks', () => {
    const { db, mk } = setup();
    const a = mk('A');
    const b = mk('B');
    setDependencies(db, a.id, { depends_on: [b.id] });
    inBatch(db, { actor: 'you' }, (w) => w.delete('task', b.id));
    expect(getTaskView(db, a.id)!.blocked).toBe(false);
  });

  it('overdue means due before today and not done', () => {
    const today = todayLocal();
    const base = { id: 'x', status: 'in_progress', version: 1, deleted_at: null };
    const db = memoryDb();
    const [past, now, done] = decorateTasks(db, [
      { ...base, id: 'a', due_date: addDays(today, -1) },
      { ...base, id: 'b', due_date: today },
      { ...base, id: 'c', due_date: addDays(today, -3), status: 'done' },
    ]);
    expect(past.overdue).toBe(true);
    expect(now.overdue).toBe(false);
    expect(done.overdue).toBe(false);
  });

  it('stores and updates project folder directly', () => {
    const { db } = setup();
    const p = inBatch(db, { actor: 'you' }, (w) => w.create('project', { name: 'FolderProj', folder: 'C:\\Projects\\Test' }));
    expect(p.folder).toBe('C:\\Projects\\Test');
    const updated = inBatch(db, { actor: 'you' }, (w) => w.update('project', p.id, { folder: 'C:\\Projects\\Updated' })).row;
    expect(updated.folder).toBe('C:\\Projects\\Updated');
  });

  it('supports on_hold status and excludes from overdue/next-step', () => {
    const { db, mk } = setup();
    const today = todayLocal();
    const t = mk('Hold me', { due_date: addDays(today, -2), priority: 'high' });
    const held = inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { status: 'on_hold' })).row;
    expect(held.status).toBe('on_hold');
    const view = getTaskView(db, t.id)!;
    expect(view.status).toBe('on_hold');
    expect(view.overdue).toBe(false);
  });
});
