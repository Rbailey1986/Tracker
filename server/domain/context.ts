import path from 'node:path';
import type { DB } from '../db/db.js';
import { logLines } from './areas.js';
import { openMessagesForAgent } from './messages.js';
import { getProjectCard, listProjects, listTasks, pickNextStep, type ProjectCard, type TaskView } from './queries.js';

/** Normalised for comparing Windows paths: forward slashes, lower case, no trailing slash. */
const norm = (p: string) => path.resolve(p.trim()).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const oneLine = (s: string, max = 300) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** The folder path from projects.folder or the `Folder:` line from each project's note. */
export function projectFolders(db: DB): { project_id: string; folder: string }[] {
  const direct = db
    .prepare(`SELECT id AS project_id, folder FROM projects WHERE deleted_at IS NULL AND folder IS NOT NULL AND TRIM(folder) <> ''`)
    .all() as { project_id: string; folder: string }[];
  const directIds = new Set(direct.map((d) => d.project_id));

  const notes = db
    .prepare(
      `SELECT n.parent_id, n.body_md FROM notes n JOIN projects p ON p.id = n.parent_id
       WHERE n.parent_type = 'project' AND n.deleted_at IS NULL AND p.deleted_at IS NULL`,
    )
    .all() as { parent_id: string; body_md: string }[];
  const fromNotes = notes.flatMap((n) => {
    if (directIds.has(n.parent_id)) return [];
    const m = /Folder:\s*`([^`]+)`/.exec(n.body_md) ?? /Folder:\s*([A-Za-z]:\\[^\n(]+)/.exec(n.body_md);
    return m ? [{ project_id: n.parent_id, folder: m[1].trim() }] : [];
  });

  return [...direct, ...fromNotes];
}

/** The project whose folder is `dir` or contains it; the deepest folder wins. */
export function projectForFolder(db: DB, dir: string): string | null {
  const target = norm(dir);
  let best: { id: string; len: number } | null = null;
  for (const { project_id, folder } of projectFolders(db)) {
    const f = norm(folder);
    if ((target === f || target.startsWith(f + '/')) && (!best || f.length > best.len)) best = { id: project_id, len: f.length };
  }
  return best?.id ?? null;
}

/** Ready-made prompt to paste into a new chat to carry on with a project: folder, next step, open tasks, questions and recent Log. */
export function resumePrompt(input: {
  project: ProjectCard;
  folder: string | null;
  next: TaskView | null;
  tasks: TaskView[];
  messages: { id: string; kind: string; parent_type: string; about: string; text: string }[];
  openQuestions: { text: string }[];
  noteBody: string;
}): string {
  const { project, folder, next, tasks, messages, openQuestions, noteBody } = input;
  const lines: string[] = [`Let's carry on with "${String(project.name)}" (${project.progress.done}/${project.progress.total} tasks done).`];
  if (project.description) lines.push(String(project.description));
  lines.push(`Folder: ${folder ?? '(not set in project notes)'}`);
  lines.push(`Next step: ${next ? `${next.title} (${next.status})` : 'none set'}`);

  if (messages.length > 0) {
    lines.push('', 'Waiting from me in the tracker:');
    for (const m of messages) {
      lines.push(
        m.kind === 'do_next'
          ? `- Do next: "${m.about}"${m.text ? ` — ${oneLine(m.text)}` : ''} [message_id ${m.id}]`
          : `- Note on ${m.parent_type} "${oneLine(m.about, 80)}": ${oneLine(m.text)} [message_id ${m.id}]`,
      );
    }
  }

  const openTasks = tasks.filter((t) => t.status !== 'done');
  lines.push('');
  if (openTasks.length === 0) {
    lines.push('Open tasks: none (all done).');
  } else {
    lines.push(`Open tasks (${openTasks.length}):`);
    for (const t of openTasks) {
      const state = t.blocked ? 'blocked' : t.status;
      const meta = [
        state,
        t.priority ? `${t.priority} priority` : null,
        t.due_date ? `due ${t.due_date}${t.overdue ? ' (overdue)' : ''}` : null,
        `owner: ${t.owner}`,
        t.blocked && t.blocked_reason ? `blocked: ${oneLine(t.blocked_reason, 120)}` : null,
      ].filter(Boolean);
      lines.push(`- ${t.title} [${meta.join(', ')}]`);
    }
  }

  if (openQuestions.length > 0) {
    lines.push('', `Open questions (${openQuestions.length}):`);
    for (const q of openQuestions) lines.push(`- ${oneLine(q.text)}`);
  }

  const log = logLines(noteBody, 5);
  if (log.length > 0) {
    lines.push('', 'Recent log:');
    for (const l of log) lines.push(`- ${l}`);
  }

  lines.push(
    '',
    'Read the project folder and tracker context, then tell me what we should tackle first. When we finish a piece of work, update the tracker (/update-tracker or tracker_update).',
  );
  return lines.join('\n');
}

/** Everything an agent needs about one project, in one read. */
export function projectContext(db: DB, id: string) {
  const project = getProjectCard(db, id);
  if (!project) return null;
  const tasks = listTasks(db, { projectId: id });
  const note = db
    .prepare(`SELECT id, body_md, version FROM notes WHERE parent_type = 'project' AND parent_id = ? AND deleted_at IS NULL`)
    .get(id) as { id: string; body_md: string; version: number } | undefined;
  const ideas = db
    .prepare(`SELECT id, text, status, added_by, agent_note, created_at, version FROM ideas WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`)
    .all(id);
  const taskIds = new Set(tasks.map((t) => t.id));
  const milestones = db
    .prepare(`SELECT id, key, title, kind, version_label, status, target_date, achieved_on, description, achieved, version
              FROM milestones WHERE project_id = ? AND deleted_at IS NULL ORDER BY COALESCE(achieved_on, target_date, created_at) DESC, id DESC`)
    .all(id);
  const questions = db
    .prepare(`SELECT id, file_id, question_key AS key, text, status, answer, task_id, created_at, answered_at FROM agent_questions
              WHERE project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ?) ORDER BY created_at DESC LIMIT 50`)
    .all(id, id) as { status: string; text: string }[];
  const next = pickNextStep(tasks);
  const folder = projectFolders(db).find((f) => f.project_id === id)?.folder ?? null;
  const messages = openMessagesForAgent(db).filter((m) => m.project_id === id || (m.parent_type === 'task' && taskIds.has(m.parent_id)));
  const open_questions = questions.filter((q) => q.status === 'open');
  return {
    project,
    folder,
    next_step: next ? { id: next.id, title: next.title, status: next.status } : null,
    tasks: tasks.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      status: t.status,
      blocked: t.blocked,
      blocked_reason: t.blocked_reason,
      owner: t.owner,
      due_date: t.due_date,
      overdue: t.overdue,
      priority: t.priority,
      estimate_minutes: t.estimate_minutes,
      description: t.description,
      depends_on: t.depends_on,
      version: t.version,
      subtasks: t.subtasks.map((s) => ({ id: s.id, text: s.text, done: s.done, version: s.version })),
    })),
    note,
    milestones,
    ideas,
    messages,
    open_questions,
    recent_answers: questions.filter((q) => q.status === 'answered').slice(0, 10),
    resume_prompt: resumePrompt({
      project,
      folder,
      next,
      tasks,
      messages,
      openQuestions: open_questions,
      noteBody: note?.body_md ?? '',
    }),
  };
}

/** One line per active project, for an overview. */
export function projectsOverview(db: DB) {
  const folders = new Map(projectFolders(db).map((f) => [f.project_id, f.folder]));
  return listProjects(db, 'active').map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    area: p.area,
    progress: p.progress,
    blocked: p.blocked_count,
    overdue: p.overdue_count,
    folder: folders.get(p.id) ?? null,
  }));
}
