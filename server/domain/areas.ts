import type { DB } from '../db/db.js';
import { getNote } from './ops.js';
import { listProjects, listTasks, pickNextStep, type TaskView } from './queries.js';

export interface AreaLogLine {
  project_id: string;
  project_name: string;
  color: string;
  line: string;
}

/** The "## Log" lines of a project note, newest first, without the bullet. */
export function logLines(body: string, keep = 5): string[] {
  const at = body.search(/^## Log\s*$/m);
  if (at === -1) return [];
  return body
    .slice(at)
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .slice(0, keep);
}

/**
 * One area (Code, Music, School...) in one read: its projects with progress and next step, overdue and blocked tasks
 * across them, and the latest Log lines. Null when no active project is in the area. Paused projects are shown, with
 * no next step; archived ones are left out.
 */
export function areaView(db: DB, area: string) {
  const projects = listProjects(db).filter((p) => p.status !== 'archived' && (p.area || 'Other') === area);
  if (projects.length === 0) return null;

  const ids = new Set(projects.map((p) => p.id));
  const tasks = listTasks(db).filter((t) => ids.has(t.project_id));
  const open = tasks.filter((t) => t.status !== 'done');
  const byDue = (a: TaskView, b: TaskView) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0);

  const done = projects.reduce((n, p) => n + p.progress.done, 0);
  const total = projects.reduce((n, p) => n + p.progress.total, 0);

  const log: AreaLogLine[] = projects
    .flatMap((p) => {
      const body = String(getNote(db, 'project', p.id)?.body_md ?? '');
      return logLines(body).map((line) => ({ project_id: p.id, project_name: p.name, color: p.color, line }));
    })
    .sort((a, b) => (a.line < b.line ? 1 : a.line > b.line ? -1 : 0))
    .slice(0, 12);

  return {
    area,
    progress: { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      progress: p.progress,
      next_step: p.status === 'active' ? pickNextStep(tasks.filter((t) => t.project_id === p.id)) : null,
    })),
    overdue: open.filter((t) => t.overdue).sort(byDue),
    blocked: open.filter((t) => t.blocked),
    log,
  };
}
