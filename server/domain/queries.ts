import type { DB } from '../db/db.js';
import { fromDb, type Row } from './store.js';
import { addDays, todayLocal } from './time.js';
import { computeProjectSessionsAndStats, type ProjectSession, type ProjectTimeStats } from './sessions.js';
import type { ChangeRow } from './undo.js';

export interface TaskView extends Row {
  blocked: boolean;
  overdue: boolean;
  depends_on: string[];
  depends_on_tasks: { id: string; title: string; status: string; project_id: string }[];
  subtasks: Row[];
  project_name?: string;
  project_color?: string;
}

/** Adds derived values (never stored): blocked, overdue, dependency details and subtasks. */
export function decorateTasks(db: DB, rawTasks: any[], today = todayLocal()): TaskView[] {
  if (rawTasks.length === 0) return [];
  const ids = rawTasks.map((t) => t.id);
  const ph = ids.map(() => '?').join(',');
  const deps = db
    .prepare(
      `SELECT d.task_id, t.id, t.title, t.status, t.project_id FROM dependencies d
       JOIN tasks t ON t.id = d.depends_on_task_id AND t.deleted_at IS NULL
       WHERE d.deleted_at IS NULL AND d.task_id IN (${ph}) ORDER BY t.title`,
    )
    .all(...ids) as any[];
  const subs = db
    .prepare(`SELECT * FROM subtasks WHERE deleted_at IS NULL AND task_id IN (${ph}) ORDER BY sort_order, created_at`)
    .all(...ids)
    .map((s) => fromDb('subtask', s));
  return rawTasks.map((raw) => {
    const t = fromDb('task', raw);
    const myDeps = deps.filter((d) => d.task_id === t.id).map(({ task_id, ...d }) => d);
    return {
      ...t,
      depends_on: myDeps.map((d) => d.id),
      depends_on_tasks: myDeps,
      blocked: t.status === 'blocked' || myDeps.some((d) => d.status !== 'done'),
      overdue: !!t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'on_hold',
      subtasks: subs.filter((s) => s.task_id === t.id),
    } as TaskView;
  });
}

export function listTasks(db: DB, filter: { projectId?: string; owner?: string; status?: string } = {}, today = todayLocal()): TaskView[] {
  const where = ['t.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const args: unknown[] = [];
  if (filter.projectId) (where.push('t.project_id = ?'), args.push(filter.projectId));
  if (filter.owner) (where.push('t.owner = ?'), args.push(filter.owner));
  if (filter.status) (where.push('t.status = ?'), args.push(filter.status));
  const rows = db
    .prepare(
      `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE ${where.join(' AND ')} ORDER BY t.sort_order, t.due_date IS NULL, t.due_date, t.created_at`,
    )
    .all(...args);
  return decorateTasks(db, rows, today);
}

/** A project's one next step: the task in progress, else the open high-priority task that isn't blocked or on hold. */
export function pickNextStep(tasks: TaskView[]): TaskView | null {
  return (
    tasks.find((t) => t.status === 'in_progress') ??
    tasks.find((t) => t.status !== 'done' && t.status !== 'on_hold' && t.priority === 'high' && !t.blocked) ??
    null
  );
}

export function getTaskView(db: DB, id: string): TaskView | undefined {
  const raw = db
    .prepare(
      `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
    )
    .get(id);
  return raw ? decorateTasks(db, [raw])[0] : undefined;
}

/** Open tasks due within `days` (and anything overdue) across projects that aren't archived. */
export function dueTasks(db: DB, days: number): TaskView[] {
  const until = addDays(todayLocal(), days);
  const rows = db
    .prepare(
      `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status <> 'archived'
         AND t.status <> 'done' AND t.status <> 'on_hold' AND t.due_date IS NOT NULL AND t.due_date <= ?
       ORDER BY t.due_date, t.title`,
    )
    .all(until);
  return decorateTasks(db, rows);
}

export interface ProjectCard extends Row {
  progress: { done: number; total: number; percent: number };
  blocked_count: number;
  overdue_count: number;
  pending_agent_files: number;
  next_task: { id: string; title: string; due_date: string } | null;
  last_worked_on: string | null;
  quiet: boolean;
  days_ago: number | null;
  sessions: ProjectSession[];
  time_stats: ProjectTimeStats;
}

export function listProjects(db: DB, status?: string, today = todayLocal()): ProjectCard[] {
  const rows = db
    .prepare(`SELECT * FROM projects WHERE deleted_at IS NULL ${status ? 'AND status = ?' : ''} ORDER BY area, name`)
    .all(...(status ? [status] : [])) as Row[];
  const tasks = listTasks(db, {}, today);
  const pending = pendingFilesByProject(db);
  const notes = new Map<string, string>();
  const noteRows = db
    .prepare(`SELECT parent_id, body_md FROM notes WHERE parent_type = 'project' AND deleted_at IS NULL`)
    .all() as { parent_id: string; body_md: string }[];
  for (const n of noteRows) notes.set(n.parent_id, n.body_md);

  return rows.map((p) =>
    projectCard(p, tasks.filter((t) => t.project_id === p.id), pending.get(p.id) ?? 0, notes.get(p.id) ?? '', today)
  );
}

export function getProjectCard(db: DB, id: string, today = todayLocal()): ProjectCard | undefined {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
  if (!p) return undefined;
  const note = db
    .prepare(`SELECT body_md FROM notes WHERE parent_type = 'project' AND parent_id = ? AND deleted_at IS NULL`)
    .get(id) as { body_md: string } | undefined;
  return projectCard(p, listTasks(db, { projectId: id }, today), pendingFilesByProject(db).get(id) ?? 0, note?.body_md ?? '', today);
}

function projectCard(p: Row, tasks: TaskView[], pendingFiles: number, noteBody = '', today = todayLocal()): ProjectCard {
  const done = tasks.filter((t) => t.status === 'done').length;
  const next = tasks
    .filter((t) => t.status !== 'done' && t.due_date)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))[0];
  const { sessions, stats } = computeProjectSessionsAndStats(tasks, noteBody, today);
  return {
    ...p,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    blocked_count: tasks.filter((t) => t.blocked && t.status !== 'done').length,
    overdue_count: tasks.filter((t) => t.overdue).length,
    pending_agent_files: pendingFiles,
    next_task: next ? { id: next.id, title: next.title, due_date: next.due_date } : null,
    last_worked_on: stats.last_worked_on,
    quiet: p.status === 'active' && stats.quiet,
    days_ago: stats.days_ago,
    sessions,
    time_stats: stats,
  };
}

function pendingFilesByProject(db: DB): Map<string, number> {
  const m = new Map<string, number>();
  const rows = db.prepare(`SELECT project_ids FROM agent_files WHERE status = 'pending'`).all() as { project_ids: string }[];
  for (const r of rows) for (const id of JSON.parse(r.project_ids) as string[]) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function overview(db: DB) {
  const today = todayLocal();
  const projects = listProjects(db);
  const open = new Set(projects.filter((p) => p.status !== 'archived').map((p) => p.id));
  const tasks = listTasks(db).filter((t) => open.has(t.project_id) && t.status !== 'done');
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM agent_files WHERE status = 'pending'`).get() as { n: number };
  const newIdeas = db.prepare(`SELECT COUNT(*) AS n FROM ideas WHERE status = 'new' AND deleted_at IS NULL`).get() as { n: number };
  const openQuestions = db.prepare(`SELECT COUNT(*) AS n FROM agent_questions WHERE status = 'open'`).get() as { n: number };
  return {
    today,
    counts: {
      due_today: tasks.filter((t) => t.due_date === today).length,
      overdue: tasks.filter((t) => t.overdue).length,
      blocked: tasks.filter((t) => t.blocked).length,
      pending_agent_files: pending.n,
      new_ideas: newIdeas.n,
      open_questions: openQuestions.n,
      active_projects: projects.filter((p) => p.status === 'active').length,
    },
    projects,
  };
}

// ---------- change feed ----------

export interface Batch {
  batch_id: string;
  actor: string;
  source_file: string | null;
  created_at: string;
  reverts_batch_id: string | null;
  undone: boolean;
  changes: (Omit<ChangeRow, 'before_json' | 'after_json'> & { before: unknown; after: unknown })[];
}

export function listBatches(db: DB, opts: { projectId?: string; taskId?: string; limit?: number; before?: string }): Batch[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.projectId) (where.push('project_id = ?'), args.push(opts.projectId));
  if (opts.taskId) (where.push('task_id = ?'), args.push(opts.taskId));
  if (opts.before) (where.push('batch_id < ?'), args.push(opts.before));
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const batchIds = (
    db
      .prepare(
        `SELECT DISTINCT batch_id FROM changes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY batch_id DESC LIMIT ?`,
      )
      .all(...args, limit) as { batch_id: string }[]
  ).map((r) => r.batch_id);
  if (batchIds.length === 0) return [];
  const rows = db
    .prepare(`SELECT * FROM changes WHERE batch_id IN (${batchIds.map(() => '?').join(',')}) ORDER BY id`)
    .all(...batchIds) as ChangeRow[];
  return batchIds.map((bid) => {
    // Task history shows only that task's rows; the project feed keeps the whole batch for context.
    const all = rows.filter((r) => r.batch_id === bid);
    const mine = opts.taskId ? all.filter((r) => r.task_id === opts.taskId) : all;
    const first = all[0];
    return {
      batch_id: bid,
      actor: first.actor,
      source_file: first.source_file,
      created_at: first.created_at,
      reverts_batch_id: first.reverts_batch_id,
      undone: all.every((r) => !!r.undone_by_change_id),
      changes: mine.map(({ before_json, after_json, ...r }) => ({
        ...r,
        before: before_json === null ? null : JSON.parse(before_json),
        after: after_json === null ? null : JSON.parse(after_json),
      })),
    };
  });
}

// ---------- search ----------

export interface SearchHit {
  type: 'project' | 'task' | 'subtask' | 'note' | 'idea' | 'milestone';
  id: string;
  title: string;
  snippet: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  task_id: string | null;
  status: string | null;
}

/** A short piece of `text` around the first match, so results show why they matched. */
function snippetOf(text: string, q: string, width = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.length > width ? flat.slice(0, width) + '…' : flat;
  const start = Math.max(0, i - Math.floor((width - q.length) / 2));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

/**
 * Case-insensitive substring search over projects, tasks, subtasks, notes, ideas and milestones (not deleted).
 * Plain LIKE is enough at this size; titles that match rank above body-only matches.
 */
export function search(db: DB, query: string, limit = 50): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = '%' + q.replace(/[!%_]/g, (c) => '!' + c) + '%';
  const m = (col: string) => `${col} LIKE @like ESCAPE '!'`;
  const P = `p.name AS project_name, p.color AS project_color`;
  const rows = [
    ...db
      .prepare(
        `SELECT 'project' AS type, p.id, p.name AS title, p.description || ' ' || p.area || ' ' || COALESCE(p.key, '') AS body,
           p.id AS project_id, ${P}, NULL AS task_id, p.status, ${m('p.name')} AS in_title
         FROM projects p WHERE p.deleted_at IS NULL AND (${m('p.name')} OR ${m('p.description')} OR ${m('p.area')} OR ${m("COALESCE(p.key, '')")})`,
      )
      .all({ like }),
    ...db
      .prepare(
        `SELECT 'task' AS type, t.id, t.title, t.description || ' ' || COALESCE(t.blocked_reason, '') AS body,
           t.project_id, ${P}, t.id AS task_id, t.status, ${m('t.title')} AS in_title
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL
           AND (${m('t.title')} OR ${m('t.description')} OR ${m("COALESCE(t.blocked_reason, '')")} OR ${m("COALESCE(t.key, '')")})`,
      )
      .all({ like }),
    ...db
      .prepare(
        `SELECT 'subtask' AS type, s.id, t.title, s.text AS body, t.project_id, ${P}, t.id AS task_id,
           CASE s.done WHEN 1 THEN 'done' ELSE 'not_started' END AS status, 0 AS in_title
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
         WHERE s.deleted_at IS NULL AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND ${m('s.text')}`,
      )
      .all({ like }),
    ...db
      .prepare(
        `SELECT 'note' AS type, n.id, COALESCE(t.title, p.name) AS title, n.body_md AS body,
           p.id AS project_id, ${P}, t.id AS task_id, NULL AS status, 0 AS in_title
         FROM notes n
         LEFT JOIN tasks t ON n.parent_type = 'task' AND t.id = n.parent_id AND t.deleted_at IS NULL
         JOIN projects p ON p.id = CASE n.parent_type WHEN 'task' THEN t.project_id ELSE n.parent_id END AND p.deleted_at IS NULL
         WHERE n.deleted_at IS NULL AND ${m('n.body_md')}`,
      )
      .all({ like }),
    ...db
      .prepare(
        `SELECT 'idea' AS type, i.id, i.text AS title, COALESCE(i.agent_note, '') AS body,
           i.project_id, ${P}, NULL AS task_id, i.status, ${m('i.text')} AS in_title
         FROM ideas i LEFT JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
         WHERE i.deleted_at IS NULL AND (${m('i.text')} OR ${m("COALESCE(i.agent_note, '')")})`,
      )
      .all({ like }),
    ...db
      .prepare(
        `SELECT 'milestone' AS type, ms.id, ms.title, ms.description || ' ' || ms.achieved AS body,
           ms.project_id, ${P}, NULL AS task_id, ms.status, ${m('ms.title')} AS in_title
         FROM milestones ms JOIN projects p ON p.id = ms.project_id AND p.deleted_at IS NULL
         WHERE ms.deleted_at IS NULL
           AND (${m('ms.title')} OR ${m('ms.description')} OR ${m('ms.achieved')} OR ${m("COALESCE(ms.version_label, '')")})`,
      )
      .all({ like }),
  ] as any[];
  return rows
    .sort((a, b) => b.in_title - a.in_title)
    .slice(0, limit)
    .map(({ body, in_title, ...r }) => ({ ...r, snippet: snippetOf(in_title ? body || r.title : body, q) }));
}
