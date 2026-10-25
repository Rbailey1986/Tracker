import type { DB } from '../db/db.js';
import { listProjects, listTasks, pickNextStep, type TaskView } from './queries.js';
import { addDays, todayLocal } from './time.js';

export interface HandoffView {
  message_id: string;
  task_id: string;
  task_title: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  text: string;
  status: 'open' | 'handled';
  sent_at: string;
  handled_at: string | null;
  reply: string | null;
}

/**
 * Everything for the Today page in one read: what's overdue and due, each active project's next step, blocked
 * work, tasks with the agent, questions and files waiting for you, and what got done today.
 * Archived projects are left out; paused ones only count for dated and blocked tasks.
 */
export function today(db: DB, now = new Date()) {
  const date = todayLocal(now);
  const projects = listProjects(db).filter((p) => p.status !== 'archived');
  const live = new Set(projects.map((p) => p.id));
  const tasks = listTasks(db).filter((t) => live.has(t.project_id));
  const open = tasks.filter((t) => t.status !== 'done');
  const byDue = (a: TaskView, b: TaskView) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0);

  const nextSteps = projects
    .filter((p) => p.status === 'active')
    .map((p) => ({
      project: { id: p.id, name: p.name, color: p.color, area: p.area, progress: p.progress, quiet: p.quiet, last_worked_on: p.last_worked_on },
      task: pickNextStep(tasks.filter((t) => t.project_id === p.id)),
    }));

  // Do-next hand-offs still open, plus those the agent finished in the last day, with its latest reply.
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const handoffs = (
    db
      .prepare(
        `SELECT m.id AS message_id, m.parent_id AS task_id, t.title AS task_title, t.project_id, p.name AS project_name,
           p.color AS project_color, m.text, m.status, m.created_at AS sent_at, m.handled_at,
           (SELECT r.text FROM agent_messages r WHERE r.reply_to = m.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS reply
         FROM agent_messages m
         JOIN tasks t ON t.id = m.parent_id AND t.deleted_at IS NULL
         JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
         WHERE m.kind = 'do_next' AND m.author = 'you' AND (m.status = 'open' OR m.handled_at >= ?)
         ORDER BY m.status = 'open' DESC, m.created_at`,
      )
      .all(since) as HandoffView[]
  );

  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM agent_files WHERE status = 'pending') AS pending_files,
              (SELECT COUNT(*) FROM agent_questions WHERE status = 'open') AS open_questions`,
    )
    .get() as { pending_files: number; open_questions: number };
  // This week: the next seven days (today first) with the open tasks due each day, and how many tasks were
  // finished since Monday (local dates).
  const monday = addDays(date, -((new Date(date + 'T12:00:00').getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(date, i);
    return { date: day, tasks: open.filter((t) => t.due_date === day) };
  });
  const doneThisWeek = tasks.filter((t) => t.status === 'done' && t.completed_at && todayLocal(new Date(t.completed_at)) >= monday).length;

  return {
    today: date,
    overdue: open.filter((t) => t.overdue).sort(byDue),
    due_today: open.filter((t) => t.due_date === date),
    next_steps: nextSteps,
    blocked: open.filter((t) => t.blocked),
    with_agent: handoffs,
    done_today: tasks
      .filter((t) => t.status === 'done' && t.completed_at && todayLocal(new Date(t.completed_at)) === date)
      .sort((a, b) => (a.completed_at < b.completed_at ? 1 : a.completed_at > b.completed_at ? -1 : 0)),
    week,
    week_start: monday,
    done_this_week: doneThisWeek,
    ...counts,
  };
}
