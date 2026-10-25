import type { Snapshot } from '../../shared/schemas/index.js';
import type { DB } from '../db/db.js';
import { listProjects, listTasks } from '../domain/queries.js';
import { openMessagesForAgent } from '../domain/messages.js';

/** The current state the agent works from. Soft-deleted and archived items are left out. */
export function buildSnapshot(db: DB): Snapshot {
  const projects = listProjects(db).filter((p) => p.status !== 'archived');
  const open = new Set(projects.map((p) => p.id));
  const tasks = listTasks(db).filter((t) => open.has(t.project_id));
  const taskIds = new Set(tasks.map((t) => t.id));
  const notes = (db.prepare('SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY created_at').all() as any[]).filter((n) =>
    n.parent_type === 'project' ? open.has(n.parent_id) : taskIds.has(n.parent_id),
  );
  const ideas = db.prepare(`SELECT * FROM ideas WHERE deleted_at IS NULL AND status = 'new' ORDER BY created_at`).all() as any[];
  const questions = db.prepare(`SELECT * FROM agent_questions WHERE status = 'open' ORDER BY created_at`).all() as any[];

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      status: p.status,
      area: p.area,
      color: p.color,
      description: p.description,
      progress: { done: p.progress.done, total: p.progress.total },
      version: p.version,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      key: t.key,
      project_id: t.project_id,
      title: t.title,
      description: t.description,
      status: t.status,
      blocked: t.blocked,
      blocked_reason: t.blocked_reason,
      overdue: t.overdue,
      owner: t.owner,
      due_date: t.due_date,
      priority: t.priority,
      estimate_minutes: t.estimate_minutes,
      sort_order: t.sort_order,
      completed_at: t.completed_at,
      depends_on: t.depends_on,
      version: t.version,
      subtasks: t.subtasks.map((s) => ({ id: s.id, text: s.text, done: s.done, sort_order: s.sort_order, version: s.version })),
    })),
    notes: notes.map((n) => ({ id: n.id, parent_type: n.parent_type, parent_id: n.parent_id, body_md: n.body_md, version: n.version })),
    milestones: (
      db
        .prepare('SELECT * FROM milestones WHERE deleted_at IS NULL ORDER BY COALESCE(achieved_on, target_date, created_at) DESC, id DESC')
        .all() as any[]
    )
      .filter((m) => open.has(m.project_id))
      .map((m) => ({
        id: m.id,
        project_id: m.project_id,
        key: m.key,
        title: m.title,
        kind: m.kind,
        version_label: m.version_label,
        status: m.status,
        target_date: m.target_date,
        achieved_on: m.achieved_on,
        description: m.description,
        achieved: m.achieved,
        version: m.version,
      })),
    ideas: ideas.map((i) => ({
      id: i.id,
      text: i.text,
      project_id: i.project_id,
      added_by: i.added_by,
      created_at: i.created_at,
      version: i.version,
    })),
    messages: openMessagesForAgent(db),
    open_questions: questions.map((q) => ({
      id: q.id,
      file_id: q.file_id,
      key: q.question_key,
      text: q.text,
      project_id: q.project_id,
      task_id: q.task_id,
      asked_at: q.created_at,
    })),
  };
}
