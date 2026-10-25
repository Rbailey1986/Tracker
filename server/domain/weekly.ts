import type { DB } from '../db/db.js';
import { listProjects, listTasks, pickNextStep, type TaskView } from './queries.js';
import { computeProjectSessionsAndStats } from './sessions.js';
import { addDays, todayLocal } from './time.js';

export interface WeeklyCompletedTask {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  project_color: string;
  completed_at: string;
  owner: string;
  estimate_minutes: number | null;
}

export interface WeeklySlippedTask {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  project_color: string;
  due_date: string;
  overdue: boolean;
  priority: string | null;
  owner: string;
  blocked: boolean;
  blocked_reason: string | null;
}

export interface WeeklyQuietProject {
  id: string;
  name: string;
  color: string;
  area: string;
  last_worked_on: string | null;
  days_ago: number | null;
  open_tasks_count: number;
  next_step: { id: string; title: string } | null;
}

export interface WeeklyQuestion {
  id: string;
  question_key: string;
  text: string;
  project_id: string | null;
  project_name: string | null;
  task_id: string | null;
  task_title: string | null;
  created_at: string;
}

export interface WeeklyReviewData {
  today: string;
  week_start: string;
  week_end: string;
  completed_this_week: WeeklyCompletedTask[];
  slipped_tasks: WeeklySlippedTask[];
  quiet_projects: WeeklyQuietProject[];
  unanswered_questions: WeeklyQuestion[];
  metrics: {
    done_count: number;
    slipped_count: number;
    quiet_count: number;
    questions_count: number;
    total_logged_minutes_this_week: number;
    total_done_estimates_this_week: number;
  };
}

export function weeklyReview(db: DB, now = new Date()): WeeklyReviewData {
  const date = todayLocal(now);
  const monday = addDays(date, -((new Date(date + 'T12:00:00').getDay() + 6) % 7));
  const sunday = addDays(monday, 6);

  const projects = listProjects(db, undefined, date).filter((p) => p.status !== 'archived');
  const live = new Set(projects.map((p) => p.id));
  const allTasks = listTasks(db, {}, date).filter((t) => live.has(t.project_id));

  // Completed this week (Monday to today)
  const completed = allTasks
    .filter((t) => t.status === 'done' && t.completed_at && todayLocal(new Date(t.completed_at)) >= monday)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : a.completed_at! > b.completed_at! ? -1 : 0))
    .map((t): WeeklyCompletedTask => ({
      id: t.id,
      title: t.title,
      project_id: t.project_id,
      project_name: t.project_name ?? '',
      project_color: t.project_color ?? '#999',
      completed_at: t.completed_at!,
      owner: t.owner,
      estimate_minutes: t.estimate_minutes,
    }));

  // Slipped tasks: open tasks due on or before today
  const byDue = (a: TaskView, b: TaskView) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0);
  const slipped = allTasks
    .filter((t) => t.status !== 'done' && t.due_date && t.due_date <= date)
    .sort(byDue)
    .map((t): WeeklySlippedTask => ({
      id: t.id,
      title: t.title,
      project_id: t.project_id,
      project_name: t.project_name ?? '',
      project_color: t.project_color ?? '#999',
      due_date: t.due_date,
      overdue: t.overdue,
      priority: t.priority,
      owner: t.owner,
      blocked: t.blocked,
      blocked_reason: t.blocked_reason,
    }));

  // Quiet projects: active projects with quiet === true (no work in >= 7 days)
  const activeProjects = projects.filter((p) => p.status === 'active');
  const quietProjects: WeeklyQuietProject[] = activeProjects
    .filter((p) => p.quiet)
    .map((p) => {
      const pTasks = allTasks.filter((t) => t.project_id === p.id);
      const next = pickNextStep(pTasks) ?? pTasks.find((t) => t.status !== 'done' && !t.blocked) ?? null;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        area: p.area,
        last_worked_on: p.last_worked_on ?? null,
        days_ago: p.days_ago ?? null,
        open_tasks_count: pTasks.filter((t) => t.status !== 'done').length,
        next_step: next ? { id: next.id, title: next.title } : null,
      };
    })
    .sort((a, b) => ((a.days_ago ?? 999) < (b.days_ago ?? 999) ? 1 : -1));

  // Unanswered questions
  const questions = db
    .prepare(
      `SELECT q.id, q.question_key, q.text, q.project_id, q.created_at,
              COALESCE(p.name, tp.name) AS project_name,
              q.task_id, t.title AS task_title
       FROM agent_questions q
       LEFT JOIN projects p ON p.id = q.project_id AND p.deleted_at IS NULL
       LEFT JOIN tasks t ON t.id = q.task_id AND t.deleted_at IS NULL
       LEFT JOIN projects tp ON tp.id = t.project_id AND tp.deleted_at IS NULL
       WHERE q.status = 'open'
       ORDER BY q.created_at DESC`,
    )
    .all() as WeeklyQuestion[];

  // Calculate logged minutes this week from all project notes
  let totalLoggedThisWeek = 0;
  for (const p of projects) {
    if (p.sessions) {
      for (const s of p.sessions) {
        if (s.date >= monday && s.date <= sunday && s.duration_minutes) {
          totalLoggedThisWeek += s.duration_minutes;
        }
      }
    }
  }

  const totalDoneEstimatesThisWeek = completed.reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0);

  return {
    today: date,
    week_start: monday,
    week_end: sunday,
    completed_this_week: completed,
    slipped_tasks: slipped,
    quiet_projects: quietProjects,
    unanswered_questions: questions,
    metrics: {
      done_count: completed.length,
      slipped_count: slipped.length,
      quiet_count: quietProjects.length,
      questions_count: questions.length,
      total_logged_minutes_this_week: totalLoggedThisWeek,
      total_done_estimates_this_week: totalDoneEstimatesThisWeek,
    },
  };
}
