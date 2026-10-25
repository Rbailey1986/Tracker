import type { Actor, EntityName } from '../../shared/schemas/index.js';
import type { DB } from '../db/db.js';
import { DomainError, invalid, notFound, versionConflict } from './errors.js';
import { bus } from './events.js';
import { newId, nowIso, todayLocal } from './time.js';

/**
 * The one way editable tables are written. Every create, update, delete and restore goes through a Writer,
 * which records it in `changes` inside the same transaction and raises the item's version.
 */

export type Row = Record<string, any> & { id: string; version: number; deleted_at: string | null };

export const TABLE: Record<EntityName, string> = {
  project: 'projects',
  task: 'tasks',
  subtask: 'subtasks',
  dependency: 'dependencies',
  note: 'notes',
  idea: 'ideas',
  milestone: 'milestones',
};

/** Data columns per entity (everything except id, version and timestamps). */
export const COLUMNS: Record<EntityName, string[]> = {
  project: ['key', 'name', 'status', 'area', 'color', 'description', 'folder'],
  task: [
    'key', 'project_id', 'title', 'description', 'status', 'blocked_reason', 'owner', 'due_date', 'priority',
    'estimate_minutes', 'created_from', 'created_from_ref', 'sort_order', 'completed_at',
  ],
  subtask: ['task_id', 'text', 'done', 'sort_order'],
  dependency: ['task_id', 'depends_on_task_id'],
  note: ['parent_type', 'parent_id', 'body_md'],
  idea: ['text', 'project_id', 'status', 'result_type', 'result_id', 'agent_note', 'picked_up_at', 'added_by'],
  milestone: ['project_id', 'key', 'title', 'kind', 'version_label', 'status', 'target_date', 'achieved_on', 'description', 'achieved'],
};

const DEFAULTS: Record<EntityName, Record<string, unknown>> = {
  project: { key: null, status: 'active', area: '', color: '#3451D1', description: '', folder: null },
  task: {
    key: null, description: '', status: 'not_started', blocked_reason: null, owner: 'you', due_date: null, priority: null,
    estimate_minutes: null, created_from: 'manual', created_from_ref: null, sort_order: 0, completed_at: null,
  },
  subtask: { done: false, sort_order: 0 },
  dependency: {},
  note: { body_md: '' },
  idea: { project_id: null, status: 'new', result_type: null, result_id: null, agent_note: null, picked_up_at: null, added_by: 'you' },
  milestone: { key: null, kind: 'feature', version_label: null, status: 'planned', target_date: null, achieved_on: null, description: '', achieved: '' },
};

const BOOLEAN_COLUMNS: Partial<Record<EntityName, string[]>> = { subtask: ['done'] };

export function fromDb(entity: EntityName, raw: any): Row {
  if (!raw) return raw;
  const row = { ...raw };
  for (const c of BOOLEAN_COLUMNS[entity] ?? []) row[c] = !!row[c];
  return row as Row;
}

function toDb(entity: EntityName, col: string, value: unknown): unknown {
  if (BOOLEAN_COLUMNS[entity]?.includes(col)) return value ? 1 : 0;
  return value === undefined ? null : value;
}

export function getRow(db: DB, entity: EntityName, id: string, opts: { includeDeleted?: boolean } = {}): Row | undefined {
  const raw = db.prepare(`SELECT * FROM ${TABLE[entity]} WHERE id = ?`).get(id);
  if (!raw) return undefined;
  const row = fromDb(entity, raw);
  if (row.deleted_at && !opts.includeDeleted) return undefined;
  return row;
}

export function mustGet(db: DB, entity: EntityName, id: string): Row {
  const row = getRow(db, entity, id);
  if (!row) throw notFound(entity[0].toUpperCase() + entity.slice(1));
  return row;
}

/** True if task `from` can reach task `to` by following live depends-on links. */
export function reaches(db: DB, from: string, to: string, extraEdges: [string, string][] = []): boolean {
  const edges = new Map<string, string[]>();
  const rows = db
    .prepare(
      `SELECT d.task_id, d.depends_on_task_id FROM dependencies d
       JOIN tasks a ON a.id = d.task_id AND a.deleted_at IS NULL
       JOIN tasks b ON b.id = d.depends_on_task_id AND b.deleted_at IS NULL
       WHERE d.deleted_at IS NULL`,
    )
    .all() as { task_id: string; depends_on_task_id: string }[];
  for (const r of rows) edges.set(r.task_id, [...(edges.get(r.task_id) ?? []), r.depends_on_task_id]);
  for (const [a, b] of extraEdges) edges.set(a, [...(edges.get(a) ?? []), b]);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(edges.get(n) ?? []));
  }
  return false;
}

interface Context {
  project_id: string | null;
  task_id: string | null;
  label: string;
}

export interface WriteOptions {
  /** The version the caller last saw. A mismatch throws 409 with the current record. */
  expectedVersion?: number;
  /** Skip automatic side fields (completed_at, picked_up_at). Undo uses this to put back exactly what was there. */
  raw?: boolean;
}

export class Writer {
  readonly now = nowIso();
  readonly changeIds: string[] = [];
  /** Business-rule extras added by the caller, e.g. linking undone rows. */
  constructor(
    readonly db: DB,
    readonly actor: Actor,
    readonly batchId: string,
    readonly sourceFile: string | null = null,
    readonly revertsBatchId: string | null = null,
  ) {}

  get(entity: EntityName, id: string, includeDeleted = false) {
    return getRow(this.db, entity, id, { includeDeleted });
  }

  create(entity: EntityName, fields: Record<string, unknown>, opts: { id?: string } = {}): Row {
    const cols = COLUMNS[entity];
    for (const k of Object.keys(fields)) if (!cols.includes(k)) throw invalid(`Unknown field "${k}" for ${entity}`);
    const values: Record<string, unknown> = { ...DEFAULTS[entity], ...stripUndefined(fields) };
    for (const c of cols) if (!(c in values)) throw invalid(`Missing field "${c}" for ${entity}`);
    this.applyRules(entity, null, values);
    this.validate(entity, null, values);

    const id = opts.id ?? newId();
    const row = { id, ...values, version: 1, created_at: this.now, updated_at: this.now, deleted_at: null } as Row;
    const allCols = ['id', ...cols, 'version', 'created_at', 'updated_at', 'deleted_at'];
    this.db
      .prepare(`INSERT INTO ${TABLE[entity]} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`)
      .run(...allCols.map((c) => toDb(entity, c, row[c])));
    this.log(entity, row, 'create', null, null, publicRecord(entity, row));
    return row;
  }

  /** Writes only fields whose value actually changes. Returns the new row and the change id per field. */
  update(
    entity: EntityName,
    id: string,
    patch: Record<string, unknown>,
    opts: WriteOptions = {},
  ): { row: Row; fieldChangeIds: Record<string, string> } {
    const current = this.get(entity, id);
    if (!current) throw notFound(cap(entity));
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== current.version) {
      throw versionConflict(current);
    }
    const cols = COLUMNS[entity];
    for (const k of Object.keys(patch)) if (!cols.includes(k)) throw invalid(`Unknown field "${k}" for ${entity}`);
    const next: Record<string, unknown> = { ...current, ...stripUndefined(patch) };
    if (!opts.raw) this.applyRules(entity, current, next);
    const changed = cols.filter((c) => !sameValue(current[c], next[c]));
    if (changed.length === 0) return { row: current, fieldChangeIds: {} };
    this.validate(entity, current, next);

    const version = current.version + 1;
    this.db
      .prepare(`UPDATE ${TABLE[entity]} SET ${changed.map((c) => `${c} = ?`).join(', ')}, version = ?, updated_at = ? WHERE id = ?`)
      .run(...changed.map((c) => toDb(entity, c, next[c])), version, this.now, id);
    const row = { ...(next as Row), version, updated_at: this.now };
    const fieldChangeIds: Record<string, string> = {};
    for (const c of changed) {
      fieldChangeIds[c] = this.log(entity, row, 'update', c, current[c], next[c]);
    }
    return { row, fieldChangeIds };
  }

  delete(entity: EntityName, id: string, opts: WriteOptions = {}): string {
    const current = this.get(entity, id);
    if (!current) throw notFound(cap(entity));
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== current.version) throw versionConflict(current);
    const version = current.version + 1;
    this.db.prepare(`UPDATE ${TABLE[entity]} SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`).run(this.now, version, this.now, id);
    return this.log(entity, { ...current, version }, 'delete', null, publicRecord(entity, current), null);
  }

  restore(entity: EntityName, id: string): string {
    const current = this.get(entity, id, true);
    if (!current) throw notFound(cap(entity));
    if (!current.deleted_at) throw invalid(`This ${entity} is not deleted`);
    this.validate(entity, null, current, true);
    const version = current.version + 1;
    this.db.prepare(`UPDATE ${TABLE[entity]} SET deleted_at = NULL, version = ?, updated_at = ? WHERE id = ?`).run(version, this.now, id);
    const row = { ...current, deleted_at: null, version };
    return this.log(entity, row, 'restore', null, null, publicRecord(entity, row));
  }

  // ---------- rules ----------

  /** Automatic side fields. */
  private applyRules(entity: EntityName, current: Row | null, next: Record<string, unknown>) {
    if (entity === 'task') {
      const wasDone = current?.status === 'done';
      if (next.status === 'done' && !wasDone && !next.completed_at) next.completed_at = this.now;
      if (next.status !== 'done' && (wasDone || next.completed_at)) next.completed_at = null;
    }
    if (entity === 'milestone') {
      if (next.status === 'achieved' && current?.status !== 'achieved' && !next.achieved_on) next.achieved_on = todayLocal();
      if (next.status === 'planned' && current?.status === 'achieved') next.achieved_on = null;
    }
    if (entity === 'idea') {
      if (next.status === 'picked_up' && current?.status !== 'picked_up') next.picked_up_at = this.now;
      if (next.status === 'new') next.picked_up_at = null;
    }
  }

  /** Reference and uniqueness checks. `current` is null for creates and restores. */
  private validate(entity: EntityName, current: Row | null, next: Record<string, any>, restoring = false) {
    const db = this.db;
    const changed = (c: string) => !current || !sameValue(current[c], next[c]);
    const live = (e: EntityName, id: unknown) => typeof id === 'string' && !!getRow(db, e, id);
    const excludeSelf = restoring || current ? (next.id as string) : '';

    switch (entity) {
      case 'project':
        if (next.key && changed('key')) {
          const dup = db.prepare('SELECT id FROM projects WHERE key = ? AND deleted_at IS NULL AND id <> ?').get(next.key, excludeSelf);
          if (dup) throw invalid(`Another project already uses the key "${next.key}"`);
        }
        break;
      case 'task':
        if (changed('project_id') && !live('project', next.project_id)) throw invalid('That project does not exist');
        if (next.key && (changed('key') || changed('project_id'))) {
          const dup = db
            .prepare('SELECT id FROM tasks WHERE project_id = ? AND key = ? AND deleted_at IS NULL AND id <> ?')
            .get(next.project_id, next.key, excludeSelf);
          if (dup) throw invalid(`Another task in this project already uses the key "${next.key}"`);
        }
        break;
      case 'subtask':
        if (changed('task_id') && !live('task', next.task_id)) throw invalid('That task does not exist');
        break;
      case 'dependency': {
        if (!live('task', next.task_id) || !live('task', next.depends_on_task_id)) throw invalid('Both tasks of a dependency must exist');
        if (next.task_id === next.depends_on_task_id) throw invalid('A task cannot depend on itself');
        const dup = db
          .prepare('SELECT id FROM dependencies WHERE task_id = ? AND depends_on_task_id = ? AND deleted_at IS NULL AND id <> ?')
          .get(next.task_id, next.depends_on_task_id, excludeSelf);
        if (dup) throw invalid('That dependency already exists');
        if (reaches(db, next.depends_on_task_id, next.task_id)) throw invalid('That dependency would create a cycle');
        break;
      }
      case 'note':
        if (changed('parent_id') && !live(next.parent_type, next.parent_id)) throw invalid(`That ${next.parent_type} does not exist`);
        if (!current) {
          const dup = db
            .prepare('SELECT id FROM notes WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL AND id <> ?')
            .get(next.parent_type, next.parent_id, excludeSelf);
          if (dup) throw invalid('That item already has a note');
        }
        break;
      case 'idea':
        if (next.project_id && changed('project_id') && !live('project', next.project_id)) throw invalid('That project does not exist');
        break;
      case 'milestone':
        if (changed('project_id') && !live('project', next.project_id)) throw invalid('That project does not exist');
        if (next.key && (changed('key') || changed('project_id'))) {
          const dup = db
            .prepare('SELECT id FROM milestones WHERE project_id = ? AND key = ? AND deleted_at IS NULL AND id <> ?')
            .get(next.project_id, next.key, excludeSelf);
          if (dup) throw invalid(`Another milestone in this project already uses the key "${next.key}"`);
        }
        break;
    }
  }

  // ---------- change log ----------

  private context(entity: EntityName, row: Record<string, any>): Context {
    const db = this.db;
    const task = (id: string) => db.prepare('SELECT id, project_id, title FROM tasks WHERE id = ?').get(id) as any;
    switch (entity) {
      case 'project':
        return { project_id: row.id, task_id: null, label: row.name };
      case 'task':
        return { project_id: row.project_id, task_id: row.id, label: row.title };
      case 'subtask': {
        const t = task(row.task_id);
        return { project_id: t?.project_id ?? null, task_id: row.task_id, label: row.text };
      }
      case 'dependency': {
        const a = task(row.task_id);
        const b = task(row.depends_on_task_id);
        return { project_id: a?.project_id ?? null, task_id: row.task_id, label: `${a?.title ?? '?'} → ${b?.title ?? '?'}` };
      }
      case 'note': {
        if (row.parent_type === 'task') {
          const t = task(row.parent_id);
          return { project_id: t?.project_id ?? null, task_id: row.parent_id, label: `Note on ${t?.title ?? 'task'}` };
        }
        const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(row.parent_id) as any;
        return { project_id: row.parent_id, task_id: null, label: `Note on ${p?.name ?? 'project'}` };
      }
      case 'idea':
        return { project_id: row.project_id ?? null, task_id: null, label: row.text };
      case 'milestone':
        return { project_id: row.project_id, task_id: null, label: `Milestone: ${row.title}` };
    }
  }

  private log(entity: EntityName, row: Record<string, any>, op: string, field: string | null, before: unknown, after: unknown): string {
    const id = newId();
    const ctx = this.context(entity, row);
    this.db
      .prepare(
        `INSERT INTO changes (id, batch_id, actor, source_file, entity, entity_id, op, field, before_json, after_json,
          entity_version_after, created_at, project_id, task_id, entity_label, reverts_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, this.batchId, this.actor, this.sourceFile, entity, row.id, op, field,
        before === null && op !== 'update' ? null : JSON.stringify(before ?? null),
        after === null && op !== 'update' ? null : JSON.stringify(after ?? null),
        row.version, this.now, ctx.project_id, ctx.task_id, ctx.label, this.revertsBatchId,
      );
    this.changeIds.push(id);
    return id;
  }
}

/**
 * Runs `fn` in one transaction as one batch. Listeners hear about it only after it commits.
 */
export function inBatch<T>(
  db: DB,
  opts: { actor: Actor; sourceFile?: string | null; revertsBatchId?: string | null },
  fn: (w: Writer) => T,
): T {
  const batchId = newId();
  let wrote = false;
  const result = db.transaction(() => {
    const w = new Writer(db, opts.actor, batchId, opts.sourceFile ?? null, opts.revertsBatchId ?? null);
    const r = fn(w);
    wrote = w.changeIds.length > 0;
    return r;
  })();
  if (wrote) bus.publish({ type: 'changed', batchId });
  return result;
}

export function publicRecord(entity: EntityName, row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id };
  for (const c of COLUMNS[entity]) out[c] = row[c];
  return out;
}

function stripUndefined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b && (typeof a === 'boolean' || typeof a === 'number') && (typeof b === 'boolean' || typeof b === 'number');
  return false;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export { DomainError };
