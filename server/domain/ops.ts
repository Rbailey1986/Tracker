import { z } from 'zod';
import {
  IdeaCreate,
  IdeaFields,
  MilestoneCreate,
  MilestoneFields,
  NoteFields,
  ParentType,
  ProjectCreate,
  ProjectFields,
  SubtaskCreate,
  SubtaskFields,
  TaskCreate,
  TaskFields,
  type EntityName,
} from '../../shared/schemas/index.js';
import type { DB } from '../db/db.js';
import { DomainError, invalid, notFound, versionConflict } from './errors.js';
import { getRow, inBatch, mustGet, type Row } from './store.js';

/** User-side operations used by the API. All of them write through inBatch, so each is one undoable batch. */

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
    throw invalid('Some fields are not valid', { fields });
  }
  return r.data;
}

const Version = z.object({ version: z.number().int().min(1) });

const patchSchemas: Partial<Record<EntityName, z.ZodTypeAny>> = {
  project: ProjectFields.partial().strict(),
  task: TaskFields.partial().strict(),
  subtask: SubtaskFields.partial().strict(),
  milestone: MilestoneFields.partial().strict(),
};

export function createProject(db: DB, body: unknown): Row {
  const fields = parse(ProjectCreate, body);
  return inBatch(db, { actor: 'you' }, (w) => w.create('project', fields));
}

export function createTask(db: DB, body: unknown): Row {
  const fields = parse(TaskCreate, body);
  return inBatch(db, { actor: 'you' }, (w) => w.create('task', { ...fields, created_from: 'manual' }));
}

export function createSubtask(db: DB, body: unknown): Row {
  const fields = parse(SubtaskCreate, body);
  return inBatch(db, { actor: 'you' }, (w) => {
    if (fields.sort_order === undefined) {
      const max = db.prepare('SELECT MAX(sort_order) AS m FROM subtasks WHERE task_id = ? AND deleted_at IS NULL').get(fields.task_id) as {
        m: number | null;
      };
      fields.sort_order = (max.m ?? -1) + 1;
    }
    return w.create('subtask', fields);
  });
}

/** PATCH with { version, ...fields }. */
export function patchEntity(db: DB, entity: 'project' | 'task' | 'subtask' | 'milestone', id: string, body: unknown): Row {
  const { version } = parse(Version.passthrough(), body);
  const { version: _v, ...rest } = body as Record<string, unknown>;
  const patch = parse(patchSchemas[entity]!, rest) as Record<string, unknown>;
  return inBatch(db, { actor: 'you' }, (w) => w.update(entity, id, patch, { expectedVersion: version }).row);
}

export function deleteEntity(db: DB, entity: EntityName, id: string, version: number | undefined): void {
  inBatch(db, { actor: 'you' }, (w) => {
    w.delete(entity, id, { expectedVersion: version });
  });
}

export function setTaskStatus(db: DB, id: string, body: unknown, done: boolean): Row {
  const { version } = parse(Version, body);
  return inBatch(db, { actor: 'you' }, (w) => {
    const t = mustGet(db, 'task', id);
    const status = done ? 'done' : t.status === 'done' ? 'in_progress' : t.status;
    return w.update('task', id, { status }, { expectedVersion: version }).row;
  });
}

/** Replaces a task's dependency list in one batch, refusing cycles. */
export function setDependencies(db: DB, taskId: string, body: unknown): string[] {
  const { depends_on } = parse(z.object({ depends_on: z.array(z.string()).max(200) }), body);
  mustGet(db, 'task', taskId);
  const want = new Set(depends_on);
  inBatch(db, { actor: 'you' }, (w) => {
    const current = db.prepare('SELECT * FROM dependencies WHERE task_id = ? AND deleted_at IS NULL').all(taskId) as Row[];
    for (const d of current) if (!want.has(d.depends_on_task_id)) w.delete('dependency', d.id);
    const have = new Set(current.map((d) => d.depends_on_task_id));
    for (const dep of want) if (!have.has(dep)) w.create('dependency', { task_id: taskId, depends_on_task_id: dep });
  });
  return [...want];
}

export function getNote(db: DB, parentType: string, parentId: string): Row | null {
  parse(ParentType, parentType);
  return (db.prepare('SELECT * FROM notes WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL').get(parentType, parentId) as Row) ?? null;
}

/** PUT a note: { body_md, version } where version is null when no note exists yet. */
export function saveNote(db: DB, parentType: string, parentId: string, body: unknown): Row {
  const pt = parse(ParentType, parentType);
  const { body_md, version } = parse(
    z.object({ body_md: NoteFields.shape.body_md, version: z.number().int().nullable().optional() }),
    body,
  );
  return inBatch(db, { actor: 'you' }, (w) => {
    const existing = getNote(db, pt, parentId);
    if (!existing) {
      if (version) throw versionConflict(null);
      return w.create('note', { parent_type: pt, parent_id: parentId, body_md });
    }
    if (version === null || version === undefined) throw versionConflict(existing);
    return w.update('note', existing.id, { body_md }, { expectedVersion: version }).row;
  });
}

// ---------- milestones ----------

/** Planned first (soonest target first), then achieved (newest first). */
export function listMilestones(db: DB, projectId: string) {
  return db
    .prepare(
      `SELECT * FROM milestones WHERE project_id = ? AND deleted_at IS NULL
       ORDER BY status = 'achieved', CASE WHEN status = 'planned' THEN COALESCE(target_date, '9999') END,
                COALESCE(achieved_on, created_at) DESC, id DESC`,
    )
    .all(projectId) as Row[];
}

export function createMilestone(db: DB, body: unknown): Row {
  const fields = parse(MilestoneCreate, body);
  return inBatch(db, { actor: 'you' }, (w) => w.create('milestone', fields));
}

// ---------- ideas ----------

export function listIdeas(db: DB, status?: string, projectId?: string) {
  const where = ['i.deleted_at IS NULL'];
  const args: string[] = [];
  if (status) (where.push('i.status = ?'), args.push(status));
  if (projectId) (where.push('i.project_id = ?'), args.push(projectId));
  return db
    .prepare(
      `SELECT i.*, p.name AS project_name, p.color AS project_color,
         (SELECT COUNT(*) FROM agent_messages m WHERE m.parent_type = 'idea' AND m.parent_id = i.id) AS message_count
       FROM ideas i LEFT JOIN projects p ON p.id = i.project_id
       WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC LIMIT ${projectId ? 500 : 200}`,
    )
    .all(...args) as Row[];
}

export function createIdea(db: DB, body: unknown): Row {
  const fields = parse(IdeaCreate, body);
  return inBatch(db, { actor: 'you' }, (w) => w.create('idea', { ...fields, project_id: fields.project_id ?? null }));
}

export function patchIdea(db: DB, id: string, body: unknown): Row {
  const { version } = parse(Version.passthrough(), body);
  const { version: _v, ...rest } = body as Record<string, unknown>;
  const patch = parse(IdeaFields.pick({ text: true, project_id: true, added_by: true }).partial().strict(), rest);
  const idea = getRow(db, 'idea', id);
  if (!idea) throw notFound('Idea');
  if (idea.status !== 'new') throw new DomainError(400, 'Only new ideas can be edited.');
  return inBatch(db, { actor: 'you' }, (w) => w.update('idea', id, patch, { expectedVersion: version }).row);
}

export function deleteIdea(db: DB, id: string, version?: number) {
  const idea = getRow(db, 'idea', id);
  if (!idea) throw notFound('Idea');
  if (idea.status !== 'new') throw new DomainError(400, 'Only new ideas can be removed.');
  deleteEntity(db, 'idea', id, version);
}
