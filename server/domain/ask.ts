import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { z } from 'zod';
import type { DB } from '../db/db.js';
import { projectFolders } from './context.js';
import { invalid, notFound } from './errors.js';
import { bus } from './events.js';
import { getRow } from './store.js';
import { getTaskView } from './queries.js';
import { newId, nowIso } from './time.js';

const TIMEOUT_MS = 3 * 60 * 1000;

const AskBody = z
  .object({ parent_type: z.enum(['task', 'idea']), parent_id: z.string().min(1), text: z.string().trim().min(1).max(4000) })
  .strict();

/**
 * The command that answers. Claude Code in print mode, read-only (it may only Read, Grep and Glob), with no MCP
 * servers, so it can look at the project's files but change nothing. TRACKER_ASK_COMMAND overrides it (tests):
 * a JSON array such as ["node", "fake-claude.mjs"]. The prompt goes in on stdin.
 */
function askCommand(): [string, string[]] {
  const custom = process.env.TRACKER_ASK_COMMAND;
  if (custom) {
    const [cmd, ...args] = JSON.parse(custom) as string[];
    return [cmd, args];
  }
  return ['claude', ['-p', '--output-format', 'text', '--strict-mcp-config', '--allowedTools', 'Read', 'Grep', 'Glob']];
}

function describe(db: DB, parentType: 'task' | 'idea', parentId: string) {
  if (parentType === 'idea') {
    const idea = getRow(db, 'idea', parentId)!;
    const project = idea.project_id ? getRow(db, 'project', idea.project_id) : undefined;
    return {
      projectId: (idea.project_id as string | null) ?? null,
      text: [`An idea${project ? ` for the project "${project.name}"` : ''}: ${idea.text}`, `Status: ${idea.status}`].join('\n'),
    };
  }
  const t = getTaskView(db, parentId)!;
  const note = db.prepare(`SELECT body_md FROM notes WHERE parent_type = 'task' AND parent_id = ? AND deleted_at IS NULL`).get(parentId) as
    | { body_md: string }
    | undefined;
  return {
    projectId: t.project_id as string,
    text: [
      `A task in the project "${t.project_name}": ${t.title}`,
      `Status: ${t.status}${t.blocked ? ' (blocked)' : ''}, owner ${t.owner}, priority ${t.priority ?? 'none'}, due ${t.due_date ?? 'none'}`,
      t.description ? `Description:\n${t.description}` : '',
      t.subtasks.length ? `Subtasks:\n${t.subtasks.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n')}` : '',
      t.depends_on_tasks.length ? `Depends on: ${t.depends_on_tasks.map((d) => `${d.title} (${d.status})`).join(', ')}` : '',
      note?.body_md ? `Task note:\n${note.body_md}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/** Saves your question, then answers it in the background. The answer arrives as a reply (and a live update). */
export function ask(db: DB, body: unknown) {
  const r = AskBody.safeParse(body);
  if (!r.success) throw invalid('Write a question first');
  const { parent_type, parent_id, text } = r.data;
  if (!getRow(db, parent_type, parent_id)) throw notFound(parent_type === 'task' ? 'Task' : 'Idea');

  const about = describe(db, parent_type, parent_id);
  const id = newId();
  db.prepare(
    `INSERT INTO agent_messages (id, parent_type, parent_id, project_id, kind, author, text, status, created_at)
     VALUES (?, ?, ?, ?, 'ask', 'you', ?, 'open', ?)`,
  ).run(id, parent_type, parent_id, about.projectId, text, nowIso());
  bus.publish({ type: 'messages' });

  const folder = projectFolders(db).find((f) => f.project_id === about.projectId)?.folder;
  const cwd = folder && fs.existsSync(folder) ? folder : os.homedir();
  const prompt = [
    "You're answering a question from the user about an item in their project tracker. Answer in plain text, briefly",
    '(under 200 words), and concretely. You may read files in the current folder to answer. Do not change anything.',
    folder ? `The project's folder is the current folder: ${folder}` : 'This project has no linked folder; answer from what is below.',
    '',
    about.text,
    '',
    `Question: ${text}`,
  ].join('\n');

  const finish = (answer: string) => {
    const now = nowIso();
    db.prepare(
      `INSERT INTO agent_messages (id, parent_type, parent_id, project_id, kind, author, text, status, reply_to, created_at, handled_at)
       VALUES (?, ?, ?, ?, 'note', 'agent', ?, 'handled', ?, ?, ?)`,
    ).run(newId(), parent_type, parent_id, about.projectId, answer.trim().slice(0, 20000), id, now, now);
    db.prepare(`UPDATE agent_messages SET status = 'handled', handled_at = ? WHERE id = ?`).run(now, id);
    bus.publish({ type: 'messages' });
  };

  const [cmd, args] = askCommand();
  let out = '';
  let err = '';
  let done = false;
  const child = spawn(cmd, args, { cwd, windowsHide: true });
  const timer = setTimeout(() => {
    child.kill();
    if (!done) (done = true), finish("Couldn't answer: it took longer than 3 minutes.");
  }, TIMEOUT_MS);
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('error', (e) => {
    clearTimeout(timer);
    if (!done) (done = true), finish(`Couldn't run Claude Code (${(e as NodeJS.ErrnoException).code ?? e.message}). Is it installed and on PATH?`);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (done) return;
    done = true;
    finish(code === 0 && out.trim() ? out : `Couldn't answer (exit code ${code}). ${err.trim().slice(0, 500)}`);
  });
  child.stdin.end(prompt);

  return db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id);
}
