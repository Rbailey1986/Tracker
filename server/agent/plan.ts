import type { ZodError } from 'zod';
import {
  AgentChangeEnvelope,
  ChangeVariants,
  MAX_FILE_BYTES,
  UpdateFileEnvelope,
  type AgentChange,
  type ChangeVariantKey,
  type EntityName,
  type UpdateFile,
} from '../../shared/schemas/index.js';
import type { DB } from '../db/db.js';
import { replyProblems } from '../domain/messages.js';
import { getRow, sameValue, type Row } from '../domain/store.js';
import type { ChangeRow } from '../domain/undo.js';

/** Thrown when a file fails validation. The whole file is rejected; nothing touches the database. */
export class FileRejection extends Error {
  constructor(
    readonly step: number,
    readonly title: string,
    readonly problems: string[],
  ) {
    super(`${title}: ${problems.join('; ')}`);
  }
  readable(fileName: string): string {
    return [
      'This update file was rejected. Nothing in the tracker was changed.',
      '',
      `File:   ${fileName}`,
      `Check:  ${this.step}. ${this.title}`,
      '',
      'Problems:',
      ...this.problems.slice(0, 50).map((p) => `  - ${p}`),
      ...(this.problems.length > 50 ? [`  ... and ${this.problems.length - 50} more`] : []),
      '',
      'Fix the file and write it to inbox/ again (the same file_id is fine, since this one was not applied).',
      'See AGENT.md and schema/update-file.schema.json.',
    ].join('\n');
  }
}

export interface Conflict {
  key: string;
  change_id: string;
  field: string;
  mine: unknown;
  agent: unknown;
  changed_by: string;
  changed_at: string;
}

export interface PlanItem {
  index: number;
  change_id: string;
  requested_op: AgentChange['op'];
  op: 'create' | 'update' | 'delete' | 'noop';
  entity: EntityName;
  id: string | null;
  temp_id: string | null;
  fields: Record<string, unknown>;
  before: Record<string, unknown> | null;
  changed_fields: string[];
  base_version: number | null;
  current_version: number | null;
  conflicts: Conflict[];
  label: string;
  note?: string;
}

export interface Plan {
  file: UpdateFile;
  items: PlanItem[];
  conflicts: Conflict[];
  has_deletes: boolean;
  project_ids: string[];
}

// ---------- Step 1: JSON and schema ----------

export function parseUpdateFile(text: string): UpdateFile {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new FileRejection(1, 'File is too large', [`The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`]);
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new FileRejection(1, 'Not valid JSON', [(e as Error).message]);
  }
  const env = UpdateFileEnvelope.safeParse(json);
  if (!env.success) throw new FileRejection(1, 'Does not match the update file schema', zodProblems(env.error));
  const problems: string[] = [];
  (json as { changes: unknown[] }).changes.forEach((c, i) => {
    const e = AgentChangeEnvelope.parse(c);
    const key = `${e.op}:${e.entity}` as ChangeVariantKey;
    const variant = ChangeVariants[key];
    if (!variant) {
      problems.push(`changes[${i}]: "${e.op}" is not allowed for entity "${e.entity}"`);
      return;
    }
    const r = variant.safeParse(c);
    if (!r.success) problems.push(...zodProblems(r.error, `changes[${i}]`));
  });
  if (problems.length) throw new FileRejection(1, 'Does not match the update file schema', problems);
  return json as UpdateFile;
}

export function zodProblems(err: ZodError, prefix = ''): string[] {
  return err.issues.map((i) => {
    const p = [prefix, ...i.path.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`))].join('').replace(/^\./, '');
    return `${p || '(file)'}: ${i.message}`;
  });
}

// ---------- Steps 3 to 5, plus conflicts ----------

type Ref = { kind: 'real'; id: string } | { kind: 'temp'; name: string };
interface TempInfo {
  entity: EntityName;
  project: Ref | null;
  /** Set when an upsert matched an existing item: the temp id then means that item. */
  realId?: string;
}

export function buildPlan(db: DB, file: UpdateFile): Plan {
  const p = (index: number, c: AgentChange, msg: string) => `changes[${index}] (change_id ${c.change_id}): ${msg}`;

  // Step 3: every change_id new and unique within the file.
  {
    const problems: string[] = [];
    const seen = new Set<string>();
    const known = db.prepare('SELECT file_id FROM agent_change_ids WHERE change_id = ?');
    file.changes.forEach((c, i) => {
      if (seen.has(c.change_id)) problems.push(p(i, c, 'this change_id appears more than once in the file'));
      seen.add(c.change_id);
      const prev = known.get(c.change_id) as { file_id: string } | undefined;
      if (prev) problems.push(p(i, c, `this change_id was already used in file "${prev.file_id}"`));
    });
    if (problems.length) throw new FileRejection(3, 'Every change_id must be new', problems);
  }

  // Step 4: references.
  const problems: string[] = [];
  const temps = new Map<string, TempInfo>();
  const items: PlanItem[] = [];
  const newProjectKeys = new Set<string>();
  const newTaskKeys = new Set<string>();
  const newMilestoneKeys = new Set<string>();
  const notesCreated = new Set<string>();

  const ref = (value: unknown, entity: EntityName, i: number, c: AgentChange, what: string): Ref | null => {
    if (typeof value !== 'string') return null;
    if (value.startsWith('$')) {
      const name = value.slice(1);
      const t = temps.get(name);
      if (!t) {
        problems.push(p(i, c, `${what} "${value}" is not a temp_id defined earlier in this file`));
        return null;
      }
      if (t.entity !== entity) {
        problems.push(p(i, c, `${what} "${value}" is a ${t.entity}, expected a ${entity}`));
        return null;
      }
      return t.realId ? { kind: 'real', id: t.realId } : { kind: 'temp', name };
    }
    if (!getRow(db, entity, value)) {
      problems.push(p(i, c, `${what}: ${entity} ${value} does not exist or is deleted`));
      return null;
    }
    return { kind: 'real', id: value };
  };
  const projectOfTask = (r: Ref | null): Ref | null => {
    if (!r) return null;
    if (r.kind === 'temp') return temps.get(r.name)?.project ?? null;
    const t = getRow(db, 'task', r.id);
    return t ? { kind: 'real', id: t.project_id } : null;
  };
  const defineTemp = (c: AgentChange, i: number, info: TempInfo) => {
    if (!c.temp_id) return;
    if (temps.has(c.temp_id)) problems.push(p(i, c, `temp_id "${c.temp_id}" is defined twice`));
    temps.set(c.temp_id, info);
  };

  const projectRefs: (Ref | null)[] = [];
  const addedEdges: [string, string][] = [];
  const removedEdges: [string, string][] = [];
  const nodeOf = (r: Ref | null) => (r ? (r.kind === 'real' ? r.id : `$${r.name}`) : null);

  file.changes.forEach((c, i) => {
    const f = { ...(c.fields ?? {}) };
    const item: PlanItem = {
      index: i,
      change_id: c.change_id,
      requested_op: c.op,
      op: c.op === 'upsert' ? 'create' : c.op,
      entity: c.entity,
      id: c.id ?? null,
      temp_id: c.temp_id ?? null,
      fields: f,
      before: null,
      changed_fields: [],
      base_version: c.base_version ?? null,
      current_version: null,
      conflicts: [],
      label: String(f.title ?? f.name ?? f.text ?? f.body_md?.toString().slice(0, 60) ?? ''),
    };
    let existing: Row | undefined;
    let project: Ref | null = null;

    // Resolve upserts to an existing item, if there is one.
    if (c.op === 'upsert') {
      if (c.entity === 'project') {
        existing = db.prepare('SELECT * FROM projects WHERE key = ? AND deleted_at IS NULL').get(f.key) as Row | undefined;
      } else if (c.entity === 'task') {
        const pr = ref(f.project_id, 'project', i, c, 'project_id');
        if (pr?.kind === 'real') {
          existing = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND key = ? AND deleted_at IS NULL').get(pr.id, f.key) as Row | undefined;
        }
      } else if (c.entity === 'note') {
        const pr = ref(f.parent_id, f.parent_type as EntityName, i, c, 'parent_id');
        if (pr?.kind === 'real') {
          existing = db
            .prepare('SELECT * FROM notes WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL')
            .get(f.parent_type, pr.id) as Row | undefined;
        }
      } else if (c.entity === 'subtask') {
        const tr = ref(f.task_id, 'task', i, c, 'task_id');
        if (tr?.kind === 'real') {
          existing = db
            .prepare('SELECT * FROM subtasks WHERE task_id = ? AND text = ? AND deleted_at IS NULL')
            .get(tr.id, f.text) as Row | undefined;
        }
      } else if (c.entity === 'milestone') {
        const pr = ref(f.project_id, 'project', i, c, 'project_id');
        if (pr?.kind === 'real') {
          existing = db.prepare('SELECT * FROM milestones WHERE project_id = ? AND key = ? AND deleted_at IS NULL').get(pr.id, f.key) as Row | undefined;
        }
      } else if (c.entity === 'idea') {
        // Same text = same idea, whatever happened to it since, so a resend doesn't bring back a handled idea.
        existing = db.prepare('SELECT * FROM ideas WHERE text = ? AND deleted_at IS NULL').get(f.text) as Row | undefined;
      }
      if (existing) {
        item.op = 'update';
        item.id = existing.id;
        item.note = 'Matched an existing item';
        // Upserts carry the full record; the matching keys are not changes.
        if (c.entity === 'note') (delete f.parent_type, delete f.parent_id);
        if (c.entity === 'subtask') delete f.task_id;
        if (c.entity === 'idea') (delete f.text, delete f.project_id);
        defineTemp(c, i, { entity: c.entity, project: projectRefFor(db, c.entity, existing), realId: existing.id });
      }
    }

    if (item.op === 'create') {
      switch (c.entity) {
        case 'project':
          if (f.key) {
            const live = db.prepare('SELECT id FROM projects WHERE key = ? AND deleted_at IS NULL').get(f.key);
            if (live || newProjectKeys.has(String(f.key))) problems.push(p(i, c, `a project with key "${f.key}" already exists; use upsert or update`));
            newProjectKeys.add(String(f.key));
          }
          defineTemp(c, i, { entity: 'project', project: c.temp_id ? { kind: 'temp', name: c.temp_id } : null });
          break;
        case 'task': {
          project = ref(f.project_id, 'project', i, c, 'project_id');
          if (f.key && project) {
            const k = `${nodeOf(project)}::${f.key}`;
            const live =
              project.kind === 'real' &&
              db.prepare('SELECT id FROM tasks WHERE project_id = ? AND key = ? AND deleted_at IS NULL').get(project.id, f.key);
            if (live || newTaskKeys.has(k)) problems.push(p(i, c, `a task with key "${f.key}" already exists in that project; use upsert or update`));
            newTaskKeys.add(k);
          }
          defineTemp(c, i, { entity: 'task', project });
          break;
        }
        case 'subtask':
          project = projectOfTask(ref(f.task_id, 'task', i, c, 'task_id'));
          defineTemp(c, i, { entity: 'subtask', project });
          break;
        case 'note': {
          const parent = ref(f.parent_id, f.parent_type as EntityName, i, c, 'parent_id');
          project = f.parent_type === 'project' ? parent : projectOfTask(parent);
          const k = `${f.parent_type}:${nodeOf(parent)}`;
          const live =
            parent?.kind === 'real' &&
            db.prepare('SELECT id FROM notes WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL').get(f.parent_type, parent.id);
          if (live || notesCreated.has(k)) problems.push(p(i, c, 'that item already has a note; use upsert or update'));
          notesCreated.add(k);
          defineTemp(c, i, { entity: 'note', project });
          break;
        }
        case 'dependency': {
          const a = ref(f.task_id, 'task', i, c, 'task_id');
          const b = ref(f.depends_on_task_id, 'task', i, c, 'depends_on_task_id');
          project = projectOfTask(a);
          if (a && b) {
            if (nodeOf(a) === nodeOf(b)) problems.push(p(i, c, 'a task cannot depend on itself'));
            const live =
              a.kind === 'real' &&
              b.kind === 'real' &&
              db.prepare('SELECT id FROM dependencies WHERE task_id = ? AND depends_on_task_id = ? AND deleted_at IS NULL').get(a.id, b.id);
            if (live) {
              item.op = 'noop';
              item.note = 'This dependency already exists';
            } else addedEdges.push([nodeOf(a)!, nodeOf(b)!]);
          }
          break;
        }
        case 'milestone': {
          project = ref(f.project_id, 'project', i, c, 'project_id');
          if (f.key && project) {
            const k = `${nodeOf(project)}::${f.key}`;
            const live =
              project.kind === 'real' &&
              db.prepare('SELECT id FROM milestones WHERE project_id = ? AND key = ? AND deleted_at IS NULL').get(project.id, f.key);
            if (live || newMilestoneKeys.has(k)) problems.push(p(i, c, `a milestone with key "${f.key}" already exists in that project; use upsert or update`));
            newMilestoneKeys.add(k);
          }
          defineTemp(c, i, { entity: 'milestone', project });
          break;
        }
        case 'idea':
          project = f.project_id ? ref(f.project_id, 'project', i, c, 'project_id') : null;
          defineTemp(c, i, { entity: 'idea', project });
          break;
        default:
          problems.push(p(i, c, `cannot create a ${c.entity}`));
      }
      item.changed_fields = Object.keys(f);
    } else if (item.op === 'delete' && c.entity === 'dependency') {
      const a = ref(f.task_id, 'task', i, c, 'task_id');
      const b = ref(f.depends_on_task_id, 'task', i, c, 'depends_on_task_id');
      project = projectOfTask(a);
      if (a?.kind === 'real' && b?.kind === 'real') {
        existing = db
          .prepare('SELECT * FROM dependencies WHERE task_id = ? AND depends_on_task_id = ? AND deleted_at IS NULL')
          .get(a.id, b.id) as Row | undefined;
        if (existing) {
          item.id = existing.id;
          item.before = { task_id: a.id, depends_on_task_id: b.id };
          item.current_version = existing.version;
          removedEdges.push([a.id, b.id]);
        } else {
          item.op = 'noop';
          item.note = 'This dependency does not exist';
        }
      }
    } else {
      // update or delete of an existing item (or an upsert that matched one)
      existing ??= item.id ? getRow(db, c.entity, item.id) : undefined;
      if (!existing) {
        problems.push(p(i, c, `${c.entity} ${item.id} does not exist or is deleted`));
      } else {
        item.current_version = existing.version;
        item.label = item.label || String(existing.title ?? existing.name ?? existing.text ?? '');
        project = projectRefFor(db, c.entity, existing);
        if (item.op === 'delete') {
          item.before = pick(existing, Object.keys(existing).filter((k) => !['version', 'created_at', 'updated_at', 'deleted_at'].includes(k)));
        } else {
          // Field-level refs in updates.
          if ((c.entity === 'task' || c.entity === 'milestone') && 'project_id' in f) ref(f.project_id, 'project', i, c, 'project_id');
          if (c.entity === 'subtask' && 'task_id' in f) ref(f.task_id, 'task', i, c, 'task_id');
          if (c.entity === 'idea') {
            if ('status' in f && existing.status !== 'new' && existing.status !== f.status) {
              problems.push(p(i, c, `idea ${existing.id} is already ${existing.status}`));
            }
            const rt = f.result_type as string | undefined;
            if (f.result_id && rt && ['task', 'project', 'note'].includes(rt)) ref(f.result_id, rt as EntityName, i, c, 'result_id');
          }
          item.before = pick(existing, Object.keys(f));
          item.changed_fields = Object.keys(f).filter((k) => !sameValue(existing![k], f[k]));
          if (item.changed_fields.length === 0) {
            item.op = 'noop';
            item.note = 'Already up to date';
          }
        }
      }
      if (c.op === 'upsert' && existing && item.base_version === null) item.note = 'Matched an existing item by key';
    }
    projectRefs.push(project);
    if (c.entity === 'project' && item.op === 'create' && c.temp_id) projectRefs[projectRefs.length - 1] = { kind: 'temp', name: c.temp_id };
    items.push(item);
  });
  problems.push(...replyProblems(db, file.message_replies ?? []));
  if (problems.length) throw new FileRejection(4, 'Every referenced item must exist', [...new Set(problems)]);

  // Step 5: no dependency cycles, and nothing in an archived project.
  {
    const p5: string[] = [];
    const cycle = findCycle(db, addedEdges, removedEdges);
    if (cycle) p5.push(`these dependencies would form a cycle: ${cycle.join(' → ')}`);
    items.forEach((it, i) => {
      const pr = projectRefs[i];
      if (pr?.kind !== 'real') return;
      const proj = getRow(db, 'project', pr.id);
      if (proj?.status === 'archived') p5.push(p(i, file.changes[i], `project "${proj.name}" is archived and can't be changed`));
    });
    if (p5.length) throw new FileRejection(5, 'No cycles and no changes to archived projects', p5);
  }

  // Conflicts, per field.
  const conflicts: Conflict[] = [];
  for (const it of items) {
    if (!it.id || it.op === 'noop' || it.op === 'create') continue;
    const base = it.base_version ?? lastAgentVersion(db, it.entity, it.id);
    if (it.current_version === base) continue;
    const since = db
      .prepare(
        `SELECT * FROM changes WHERE entity = ? AND entity_id = ? AND entity_version_after > ? AND actor <> 'agent' ORDER BY id`,
      )
      .all(it.entity, it.id, base) as ChangeRow[];
    if (it.op === 'delete') {
      const last = since[since.length - 1];
      if (last || it.current_version !== base) {
        conflicts.push({
          key: `${it.change_id}:(delete)`,
          change_id: it.change_id,
          field: '(delete)',
          mine: 'keep',
          agent: 'delete',
          changed_by: last?.actor ?? 'unknown',
          changed_at: last?.created_at ?? '',
        });
      }
      continue;
    }
    for (const field of it.changed_fields) {
      const touched = [...since].reverse().find((r) => r.field === field || r.op === 'create' || r.op === 'restore');
      if (!touched) continue;
      conflicts.push({
        key: `${it.change_id}:${field}`,
        change_id: it.change_id,
        field,
        mine: it.before?.[field] ?? null,
        agent: it.fields[field],
        changed_by: touched.actor,
        changed_at: touched.created_at,
      });
    }
  }
  for (const c of conflicts) items.find((i) => i.change_id === c.change_id)!.conflicts.push(c);

  return {
    file,
    items,
    conflicts,
    has_deletes: file.changes.some((c) => c.op === 'delete'),
    project_ids: [...new Set(projectRefs.filter((r): r is { kind: 'real'; id: string } => r?.kind === 'real').map((r) => r.id))],
  };
}

/** For an upsert without base_version: the version right after the agent's own last change to the item. */
function lastAgentVersion(db: DB, entity: EntityName, id: string): number {
  const r = db
    .prepare(`SELECT MAX(entity_version_after) AS v FROM changes WHERE entity = ? AND entity_id = ? AND actor = 'agent'`)
    .get(entity, id) as { v: number | null };
  return r.v ?? 0;
}

function projectRefFor(db: DB, entity: EntityName, row: Row): Ref | null {
  const taskProject = (taskId: string) => {
    const t = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as { project_id: string } | undefined;
    return t ? ({ kind: 'real', id: t.project_id } as Ref) : null;
  };
  switch (entity) {
    case 'project':
      return { kind: 'real', id: row.id };
    case 'task':
      return { kind: 'real', id: row.project_id };
    case 'subtask':
    case 'dependency':
      return taskProject(row.task_id);
    case 'note':
      return row.parent_type === 'project' ? { kind: 'real', id: row.parent_id } : taskProject(row.parent_id);
    case 'idea':
      return row.project_id ? { kind: 'real', id: row.project_id } : null;
    case 'milestone':
      return { kind: 'real', id: row.project_id };
  }
}

function findCycle(db: DB, added: [string, string][], removed: [string, string][]): string[] | null {
  const rows = db
    .prepare(
      `SELECT d.task_id, d.depends_on_task_id FROM dependencies d
       JOIN tasks a ON a.id = d.task_id AND a.deleted_at IS NULL
       JOIN tasks b ON b.id = d.depends_on_task_id AND b.deleted_at IS NULL
       WHERE d.deleted_at IS NULL`,
    )
    .all() as { task_id: string; depends_on_task_id: string }[];
  const gone = new Set(removed.map(([a, b]) => `${a}>${b}`));
  const edges = new Map<string, string[]>();
  for (const [a, b] of [...rows.map((r) => [r.task_id, r.depends_on_task_id] as [string, string]), ...added]) {
    if (gone.has(`${a}>${b}`)) continue;
    edges.set(a, [...(edges.get(a) ?? []), b]);
  }
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (n: string): string[] | null => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...path.slice(path.indexOf(n)), n];
    state.set(n, 1);
    path.push(n);
    for (const m of edges.get(n) ?? []) {
      const c = visit(m);
      if (c) return c;
    }
    path.pop();
    state.set(n, 2);
    return null;
  };
  // Only cycles that involve a new edge matter; existing data is already acyclic.
  for (const [a] of added) {
    const c = visit(a);
    if (c) return c;
  }
  return null;
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
}
