import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { agentPrompt } from '../agent/agentmd.js';
import type { TrackerApp } from '../app.js';
import { backupDb, getSetting, setSetting } from '../db/db.js';
import { DomainError, invalid, notFound } from '../domain/errors.js';
import { areaView } from '../domain/areas.js';
import { ask } from '../domain/ask.js';
import * as context from '../domain/context.js';
import { bus } from '../domain/events.js';
import * as messages from '../domain/messages.js';
import * as ops from '../domain/ops.js';
import { dueTasks, getProjectCard, getTaskView, listBatches, listProjects, listTasks, overview, search } from '../domain/queries.js';
import { weeklyReview } from '../domain/weekly.js';
import { mustGet } from '../domain/store.js';
import { today } from '../domain/today.js';
import { nowIso } from '../domain/time.js';
import { undoBatch } from '../domain/undo.js';

type Q = Record<string, string | undefined>;
type P = Record<string, string>;
const versionOf = (q: Q) => (q.version !== undefined ? Number(q.version) : undefined);

export function registerRoutes(t: TrackerApp) {
  const { app, db, pipeline } = t;

  // ---------- overview and projects ----------

  app.get('/api/overview', async () => overview(db));
  app.get('/api/today', async () => today(db));
  app.get('/api/weekly', async () => weeklyReview(db));
  app.get('/api/areas/:area', async (req) => {
    const v = areaView(db, (req.params as P).area);
    if (!v) throw notFound('Area');
    return v;
  });
  app.get('/api/search', async (req) => {
    const q = req.query as Q;
    return search(db, q.q ?? '', Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200));
  });

  app.get('/api/projects', async (req) => listProjects(db, (req.query as Q).status || undefined));
  app.get('/api/projects/:id', async (req) => {
    const p = getProjectCard(db, (req.params as P).id);
    if (!p) throw notFound('Project');
    return p;
  });
  app.post('/api/projects', async (req, reply) => reply.status(201).send(ops.createProject(db, req.body)));
  app.patch('/api/projects/:id', async (req) => ops.patchEntity(db, 'project', (req.params as P).id, req.body));
  app.delete('/api/projects/:id', async (req) => {
    ops.deleteEntity(db, 'project', (req.params as P).id, versionOf(req.query as Q));
    return { ok: true };
  });
  app.post('/api/projects/:id/open-folder', async (req) => {
    const id = (req.params as P).id;
    const p = mustGet(db, 'project', id) as any;
    const folder = p.folder || context.projectFolders(db).find((f) => f.project_id === id)?.folder;
    if (!folder) throw invalid('No folder configured for this project');
    if (!fs.existsSync(folder)) throw invalid(`Folder "${folder}" does not exist`);
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [folder], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, folder };
  });

  // ---------- tasks ----------

  app.get('/api/projects/:id/tasks', async (req) => {
    const q = req.query as Q;
    mustGet(db, 'project', (req.params as P).id);
    return listTasks(db, { projectId: (req.params as P).id, owner: q.owner || undefined, status: q.status || undefined });
  });
  app.get('/api/tasks/due', async (req) => dueTasks(db, Number((req.query as Q).days ?? 7)));
  app.get('/api/tasks/:id', async (req) => {
    const task = getTaskView(db, (req.params as P).id);
    if (!task) throw notFound('Task');
    return task;
  });
  app.post('/api/tasks', async (req, reply) => reply.status(201).send(ops.createTask(db, req.body)));
  app.patch('/api/tasks/:id', async (req) => {
    ops.patchEntity(db, 'task', (req.params as P).id, req.body);
    return getTaskView(db, (req.params as P).id);
  });
  app.post('/api/tasks/:id/complete', async (req) => {
    ops.setTaskStatus(db, (req.params as P).id, req.body, true);
    return getTaskView(db, (req.params as P).id);
  });
  app.post('/api/tasks/:id/reopen', async (req) => {
    ops.setTaskStatus(db, (req.params as P).id, req.body, false);
    return getTaskView(db, (req.params as P).id);
  });
  app.delete('/api/tasks/:id', async (req) => {
    ops.deleteEntity(db, 'task', (req.params as P).id, versionOf(req.query as Q));
    return { ok: true };
  });
  app.put('/api/tasks/:id/dependencies', async (req) => {
    ops.setDependencies(db, (req.params as P).id, req.body);
    return getTaskView(db, (req.params as P).id);
  });

  // ---------- milestones ----------

  app.get('/api/projects/:id/milestones', async (req) => {
    mustGet(db, 'project', (req.params as P).id);
    return ops.listMilestones(db, (req.params as P).id);
  });
  app.post('/api/milestones', async (req, reply) => reply.status(201).send(ops.createMilestone(db, req.body)));
  app.patch('/api/milestones/:id', async (req) => ops.patchEntity(db, 'milestone', (req.params as P).id, req.body));
  app.delete('/api/milestones/:id', async (req) => {
    ops.deleteEntity(db, 'milestone', (req.params as P).id, versionOf(req.query as Q));
    return { ok: true };
  });

  // ---------- subtasks ----------

  app.post('/api/subtasks', async (req, reply) => reply.status(201).send(ops.createSubtask(db, req.body)));
  app.patch('/api/subtasks/:id', async (req) => ops.patchEntity(db, 'subtask', (req.params as P).id, req.body));
  app.delete('/api/subtasks/:id', async (req) => {
    ops.deleteEntity(db, 'subtask', (req.params as P).id, versionOf(req.query as Q));
    return { ok: true };
  });

  // ---------- notes ----------

  app.get('/api/notes/:parentType/:parentId', async (req) => {
    const { parentType, parentId } = req.params as P;
    return { note: ops.getNote(db, parentType, parentId) };
  });
  app.put('/api/notes/:parentType/:parentId', async (req) => {
    const { parentType, parentId } = req.params as P;
    return { note: ops.saveNote(db, parentType, parentId, req.body) };
  });

  // ---------- change log ----------

  app.get('/api/changes', async (req) => {
    const q = req.query as Q;
    return listBatches(db, {
      projectId: q.project || undefined,
      taskId: q.task || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      before: q.before || undefined,
    });
  });
  app.post('/api/changes/batches/:batchId/undo', async (req) => undoBatch(db, (req.params as P).batchId));

  // ---------- agent inbox ----------

  app.get('/api/inbox', async (req) => {
    const q = req.query as Q;
    const files = pipeline.list(q.status || undefined);
    return q.project ? files.filter((f) => f.project_ids.includes(q.project!)) : files;
  });
  app.get('/api/inbox/:fileId/preview', async (req) => pipeline.preview((req.params as P).fileId));
  app.post('/api/inbox/:fileId/apply', async (req) => {
    const body = z
      .object({ resolutions: z.record(z.enum(['mine', 'agent'])).default({}) })
      .safeParse(req.body ?? {});
    if (!body.success) throw invalid('resolutions must map each conflict to "mine" or "agent"');
    return pipeline.apply((req.params as P).fileId, body.data.resolutions);
  });
  app.post('/api/inbox/:fileId/reject', async (req) => pipeline.reject((req.params as P).fileId));

  // ---------- questions ----------

  app.get('/api/questions', async (req) => {
    const q = req.query as Q;
    const where: string[] = [];
    const args: string[] = [];
    if (q.status) (where.push('q.status = ?'), args.push(q.status));
    if (q.file) (where.push('q.agent_file_row_id = ?'), args.push(q.file));
    if (q.project) (where.push('(q.project_id = ? OR t.project_id = ?)'), args.push(q.project, q.project));
    return db
      .prepare(
        `SELECT q.*, t.title AS task_title, COALESCE(p.name, tp.name) AS project_name FROM agent_questions q
         LEFT JOIN tasks t ON t.id = q.task_id LEFT JOIN projects p ON p.id = q.project_id
         LEFT JOIN projects tp ON tp.id = t.project_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.created_at DESC LIMIT 200`,
      )
      .all(...args);
  });
  app.post('/api/questions/:id/answer', async (req) => {
    const { answer } = z.object({ answer: z.string().trim().min(1).max(20000) }).parse(req.body);
    const id = (req.params as P).id;
    const q = db.prepare('SELECT * FROM agent_questions WHERE id = ?').get(id) as any;
    if (!q) throw notFound('Question');
    const answeredAt = nowIso();
    db.prepare(`UPDATE agent_questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ?`).run(answer, answeredAt, id);
    t.folder().writeAnswer({ question_id: id, file_id: q.file_id, key: q.question_key, question: q.text, answer, answered_at: answeredAt });
    bus.publish({ type: 'questions' });
    return db.prepare('SELECT * FROM agent_questions WHERE id = ?').get(id);
  });

  // ---------- messages for the agent ----------

  app.get('/api/messages', async (req) => messages.listMessages(db, req.query as Q));
  app.post('/api/messages', async (req, reply) => reply.status(201).send(messages.postMessage(db, req.body)));
  app.post('/api/messages/ask', async (req, reply) => reply.status(202).send(ask(db, req.body)));
  app.delete('/api/messages/:id', async (req) => {
    messages.withdrawMessage(db, (req.params as P).id);
    return { ok: true };
  });

  // ---------- ideas ----------

  app.get('/api/ideas', async (req) => {
    const q = req.query as Q;
    return ops.listIdeas(db, q.status || undefined, q.project || undefined);
  });
  app.post('/api/ideas', async (req, reply) => reply.status(201).send(ops.createIdea(db, req.body)));
  app.patch('/api/ideas/:id', async (req) => ops.patchIdea(db, (req.params as P).id, req.body));
  app.delete('/api/ideas/:id', async (req) => {
    ops.deleteIdea(db, (req.params as P).id, versionOf(req.query as Q));
    return { ok: true };
  });

  // ---------- settings and agent ----------

  const folderStatus = () => {
    const last = db.prepare('SELECT MAX(received_at) AS t FROM agent_files').get() as { t: string | null };
    return { ...t.folder().status, last_import_at: last.t };
  };
  const settings = () => ({
    agent_folder: t.folder().dir,
    auto_apply: (getSetting(db, 'auto_apply') ?? 'true') === 'true',
    db_path: t.dbPath,
    backups_path: path.join(path.dirname(t.dbPath), 'backups'),
    folder_status: folderStatus(),
  });
  app.get('/api/settings', async () => settings());
  app.put('/api/settings', async (req) => {
    const body = z
      .object({ agent_folder: z.string().trim().min(1).optional(), auto_apply: z.boolean().optional() })
      .strict()
      .safeParse(req.body);
    if (!body.success) throw invalid('Settings are not valid');
    if (body.data.auto_apply !== undefined) setSetting(db, 'auto_apply', String(body.data.auto_apply));
    if (body.data.agent_folder && path.resolve(body.data.agent_folder) !== t.folder().dir) {
      if (!path.isAbsolute(body.data.agent_folder)) throw invalid('Use a full folder path, such as C:\\Users\\you\\Tracker\\agent');
      await t.setAgentDir(body.data.agent_folder);
    }
    bus.publish({ type: 'folder', message: 'settings' });
    return settings();
  });
  app.post('/api/settings/backup', async () => {
    const file = backupDb(t.dbPath);
    return { ok: true, backup: file ? path.basename(file) : null };
  });
  app.get('/api/agent/status', async () => folderStatus());

  // For the MCP server and Claude Code hooks: find a project by folder, read it whole, submit an update file.
  app.get('/api/agent/projects', async () => context.projectsOverview(db));
  app.get('/api/agent/project-for-folder', async (req) => {
    const dir = (req.query as Q).path;
    if (!dir || !path.isAbsolute(dir)) throw invalid('path must be a full folder path');
    const id = context.projectForFolder(db, dir);
    if (!id) throw notFound('Project for that folder');
    return { project_id: id };
  });
  app.get('/api/agent/projects/:id', async (req) => {
    const ctx = context.projectContext(db, (req.params as P).id);
    if (!ctx) throw notFound('Project');
    return ctx;
  });
  app.post('/api/agent/files', async (req) => {
    const file = (req.body as { file?: { file_id?: unknown } } | null)?.file;
    if (!file || typeof file !== 'object') throw invalid('Send { "file": <update file> }');
    if (typeof file.file_id !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(file.file_id)) {
      throw invalid('file_id is required and may use letters, digits, dot, dash and underscore');
    }
    // Same route as any agent: the file goes through the inbox, so it is checked, logged and kept in applied/.
    const name = `${file.file_id}.json`;
    const since = nowIso();
    const inbox = path.join(t.folder().dir, 'inbox');
    fs.writeFileSync(path.join(inbox, `.${name}.tmp`), JSON.stringify(file, null, 2));
    fs.renameSync(path.join(inbox, `.${name}.tmp`), path.join(inbox, name));
    const find = db.prepare('SELECT * FROM agent_files WHERE file_name = ? AND received_at >= ? ORDER BY received_at DESC LIMIT 1');
    for (let i = 0; i < 100; i++) {
      const row = find.get(name, since) as { id: string; status: string; error: string | null } | undefined;
      if (row) {
        const preview = row.status === 'pending' ? pipeline.preview(row.id) : null;
        return {
          status: row.status,
          error: row.error,
          conflicts: preview?.conflicts ?? [],
          note:
            row.status === 'pending'
              ? 'Waiting for the user in the Agent inbox (conflicts with their edits, deletes, or auto-apply is off).'
              : undefined,
        };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new DomainError(504, 'The tracker did not pick up the file within 10 seconds. Is the agent folder being watched?');
  });
  app.get('/api/agent/prompt', async () => {
    const empty = (db.prepare('SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL').get() as { n: number }).n === 0;
    return { prompt: agentPrompt(t.folder().dir, empty), empty, folder: t.folder().dir };
  });
  app.post('/api/agent/open-folder', async () => {
    const dir = t.folder().dir;
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      throw new DomainError(500, `Couldn't open the folder: ${(e as Error).message}`);
    }
    return { ok: true };
  });

  // ---------- server-sent events ----------

  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const off = bus.subscribe((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
    reply.hijack();
  });
}
