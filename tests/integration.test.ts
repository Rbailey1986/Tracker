import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Snapshot } from '../shared/schemas/index.js';
import { createApp, type TrackerApp } from '../server/app.js';
import { openDb } from '../server/db/db.js';
import { seed, SEED_IDS } from '../server/seed.js';
import { readFixture, tempDir, updateFile, uuid, waitFor } from './helpers.js';

let t: TrackerApp;
let dir: string;
let agentDir: string;

async function start(withSeed: boolean) {
  dir = tempDir();
  agentDir = path.join(dir, 'agent');
  const dbPath = path.join(dir, 'tracker.db');
  const db = openDb(dbPath);
  if (withSeed) seed(db);
  t = await createApp({ db, dbPath, agentDir, serveWeb: false, folderOptions: { healthIntervalMs: 200, snapshotDelayMs: 50 } });
}

const api = async (method: string, url: string, body?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: body as any });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(agentDir, ...p), 'utf8'));
const drop = (name: string, content: string) => {
  const tmp = path.join(agentDir, 'inbox', `.${name}.tmp`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, path.join(agentDir, 'inbox', name));
};
const fileRow = (fileId: string) => t.db.prepare('SELECT * FROM agent_files WHERE file_id = ? ORDER BY received_at DESC').get(fileId) as any;

afterEach(async () => {
  await t.close();
  t.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('API', () => {
  beforeEach(() => start(true));

  it('overview counts match the tasks', async () => {
    const { body } = await api('GET', '/api/overview');
    expect(body.counts.active_projects).toBe(5);
    const bbfm = body.projects.find((p: any) => p.id === SEED_IDS.bbfm);
    const tasks = (await api('GET', `/api/projects/${SEED_IDS.bbfm}/tasks`)).body;
    expect(bbfm.progress.total).toBe(tasks.length);
    expect(bbfm.progress.done).toBe(tasks.filter((x: any) => x.status === 'done').length);
    expect(bbfm.blocked_count).toBe(tasks.filter((x: any) => x.blocked && x.status !== 'done').length);
    expect(bbfm.overdue_count).toBe(tasks.filter((x: any) => x.overdue).length);
  });

  it('a second save with an old version gets 409, not a silent overwrite', async () => {
    const task = (await api('GET', `/api/tasks/${SEED_IDS.ep4Narration}`)).body;
    const first = await api('PATCH', `/api/tasks/${task.id}`, { version: task.version, title: 'Tab one' });
    expect(first.status).toBe(200);
    const second = await api('PATCH', `/api/tasks/${task.id}`, { version: task.version, title: 'Tab two' });
    expect(second.status).toBe(409);
    expect(second.body.details.current.title).toBe('Tab one');
  });

  it('returns 400 with field messages', async () => {
    const r = await api('POST', '/api/tasks', { project_id: SEED_IDS.bbfm, title: '', due_date: 'tomorrow' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.details.fields)).toEqual(expect.arrayContaining(['title', 'due_date']));
  });

  it('every create, edit and delete shows in the feed and task history and can be undone', async () => {
    const created = (await api('POST', '/api/tasks', { project_id: SEED_IDS.bbfm, title: 'New thing' })).body;
    const edited = (await api('PATCH', `/api/tasks/${created.id}`, { version: created.version, priority: 'high' })).body;
    await api('DELETE', `/api/tasks/${created.id}?version=${edited.version}`);
    const history = (await api('GET', `/api/changes?task=${created.id}`)).body;
    expect(history.map((b: any) => b.changes[0].op)).toEqual(['delete', 'update', 'create']);
    const feed = (await api('GET', `/api/changes?project=${SEED_IDS.bbfm}&limit=3`)).body;
    expect(feed[0].batch_id).toBe(history[0].batch_id);
    for (const b of history) expect((await api('POST', `/api/changes/batches/${b.batch_id}/undo`)).status).toBe(200);
    expect((await api('GET', `/api/tasks/${created.id}`)).status).toBe(404);
  });

  it('completing a dependency clears blocked', async () => {
    const narr = (await api('GET', `/api/tasks/${SEED_IDS.ep4Narration}`)).body;
    expect(narr.blocked).toBe(true);
    const scripts = (await api('GET', `/api/tasks/${SEED_IDS.ep4Scripts}`)).body;
    await api('POST', `/api/tasks/${scripts.id}/complete`, { version: scripts.version });
    expect((await api('GET', `/api/tasks/${SEED_IDS.ep4Narration}`)).body.blocked).toBe(false);
  });

  it('PUT dependencies refuses a cycle', async () => {
    const r = await api('PUT', `/api/tasks/${SEED_IDS.ep4Scripts}/dependencies`, { depends_on: [SEED_IDS.ep4Narration] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cycle/);
  });

  it('notes save with versions', async () => {
    const { note } = (await api('GET', `/api/notes/project/${SEED_IDS.bbfm}`)).body;
    const saved = await api('PUT', `/api/notes/project/${SEED_IDS.bbfm}`, { body_md: 'new', version: note.version });
    expect(saved.body.note.body_md).toBe('new');
    expect((await api('PUT', `/api/notes/project/${SEED_IDS.bbfm}`, { body_md: 'stale', version: note.version })).status).toBe(409);
  });

  it('ideas can be edited and removed only while new', async () => {
    const idea = (await api('POST', '/api/ideas', { text: 'Try a live episode' })).body;
    const edited = await api('PATCH', `/api/ideas/${idea.id}`, { version: idea.version, text: 'Try a live show' });
    expect(edited.body.text).toBe('Try a live show');
    t.db.prepare(`UPDATE ideas SET status = 'picked_up' WHERE id = ?`).run(idea.id);
    expect((await api('DELETE', `/api/ideas/${idea.id}`)).status).toBe(400);
  });

  it('ideas can be listed for one project', async () => {
    await api('POST', '/api/ideas', { text: 'Bonus episode', project_id: SEED_IDS.bbfm });
    await api('POST', '/api/ideas', { text: 'Somewhere else' });
    const list = (await api('GET', `/api/ideas?project=${SEED_IDS.bbfm}`)).body as { text: string; project_id: string }[];
    expect(list.map((i) => i.text)).toContain('Bonus episode');
    expect(list.every((i) => i.project_id === SEED_IDS.bbfm)).toBe(true);
  });

  it('search finds projects, tasks, subtasks, notes and ideas, titles first', async () => {
    const note = (await api('GET', `/api/notes/project/${SEED_IDS.bbfm}`)).body.note;
    await api('PUT', `/api/notes/project/${SEED_IDS.bbfm}`, { body_md: 'Mix the zebra crossing intro', version: note.version });
    await api('POST', '/api/ideas', { text: 'A zebra-themed episode', project_id: SEED_IDS.bbfm });
    const hits = (await api('GET', '/api/search?q=ZEBRA')).body as { type: string; title: string; snippet: string; project_id: string }[];
    expect(hits.map((h) => h.type)).toEqual(['idea', 'note']);
    expect(hits[1]).toMatchObject({ title: 'Black Buddha FM', project_id: SEED_IDS.bbfm });
    expect(hits[1].snippet).toContain('zebra');

    const sub = (await api('GET', '/api/search?q=chapters 4')).body as { type: string; task_id: string }[];
    expect(sub.find((h) => h.type === 'subtask')?.task_id).toBe(SEED_IDS.ep4Narration);
    expect((await api('GET', '/api/search?q=Black Buddha')).body[0].type).toBe('project');
    expect((await api('GET', '/api/search?q=%25')).body).toEqual([]);
    expect((await api('GET', '/api/search?q=a')).body).toEqual([]);
  });

  it('today gathers due, next steps, blocked, agent hand-offs and done today', async () => {
    const scripts = (await api('GET', `/api/tasks/${SEED_IDS.ep4Scripts}`)).body;
    await api('POST', `/api/tasks/${scripts.id}/complete`, { version: scripts.version });
    await api('POST', '/api/messages', { parent_type: 'task', parent_id: SEED_IDS.ep4Narration, kind: 'do_next' });

    const d = (await api('GET', '/api/today')).body;
    expect(d.overdue.map((t: any) => t.title)).toContain('Edit and mix (Ep 3)');
    expect(d.due_today.map((t: any) => t.title)).toContain('Plan next week’s lessons');
    const bbfm = d.next_steps.find((n: any) => n.project.id === SEED_IDS.bbfm);
    expect(bbfm.task.title).toBe('Edit and mix (Ep 3)');
    expect(d.next_steps.every((n: any) => n.project.name !== 'Desktop pet game')).toBe(true); // paused
    expect(d.blocked.find((t: any) => t.blocked_reason === 'Waiting for a reply from the guest')).toBeTruthy();
    expect(d.blocked.some((t: any) => t.id === SEED_IDS.ep4Narration)).toBe(false); // its dependency is done now
    expect(d.with_agent).toEqual([expect.objectContaining({ task_id: SEED_IDS.ep4Narration, status: 'open', reply: null })]);
    expect(d.done_today.map((t: any) => t.id)).toContain(SEED_IDS.ep4Scripts);
    expect(d.done_today.every((t: any) => t.status === 'done')).toBe(true);
  });

  it('settings and agent prompt include the folder path', async () => {
    const s = (await api('GET', '/api/settings')).body;
    expect(s.agent_folder).toBe(agentDir);
    expect(s.auto_apply).toBe(true);
    const p = (await api('GET', '/api/agent/prompt')).body;
    expect(p.prompt).toContain(agentDir);
  });
});

describe('agent folder', () => {
  it('creates the layout, AGENT.md, schemas and a valid snapshot', async () => {
    await start(true);
    for (const d of ['inbox', 'applied', 'rejected', 'answers', 'schema']) expect(fs.existsSync(path.join(agentDir, d))).toBe(true);
    expect(fs.readFileSync(path.join(agentDir, 'AGENT.md'), 'utf8')).toMatch(/^# Working with this tracker/);
    expect(readJson('schema', 'update-file.schema.json').definitions.UpdateFile).toBeTruthy();
    expect(Snapshot.safeParse(readJson('snapshot.json')).success).toBe(true);
    // Archived projects are left out.
    expect(readJson('snapshot.json').projects.find((p: any) => p.name === 'CV update')).toBeUndefined();
  });

  it('a clean file applies by itself in one agent batch, and undo reverses all of it', async () => {
    await start(true);
    drop('2026-10-21-bbfm-ep04.json', readFixture('spec-example.json'));
    const row = await waitFor(() => fileRow('2026-10-21-bbfm-ep04')?.status === 'applied' && fileRow('2026-10-21-bbfm-ep04'), 2000);
    expect(fs.existsSync(path.join(agentDir, 'applied', '2026-10-21-bbfm-ep04.json'))).toBe(true);
    const rows = t.db.prepare('SELECT * FROM changes WHERE batch_id = ?').all(row.batch_id) as any[];
    // create task, create subtask, status -> done, and completed_at set alongside it
    expect(rows.map((r) => r.field ?? r.op).sort()).toEqual(['completed_at', 'create', 'create', 'status']);
    expect(rows.every((r) => r.actor === 'agent' && r.source_file === '2026-10-21-bbfm-ep04.json')).toBe(true);
    // The question is open and in the snapshot.
    await waitFor(() => readJson('snapshot.json').open_questions.length === 1);

    expect((await api('POST', `/api/changes/batches/${row.batch_id}/undo`)).status).toBe(200);
    expect((await api('GET', `/api/tasks/${SEED_IDS.ep4Scripts}`)).body.status).toBe('in_progress');
    expect(t.db.prepare(`SELECT * FROM tasks WHERE title = 'Research track list (Ep 5)' AND deleted_at IS NULL`).get()).toBeUndefined();
  });

  it('the same file again is a duplicate and changes nothing', async () => {
    await start(true);
    drop('a.json', readFixture('spec-example.json'));
    await waitFor(() => fileRow('2026-10-21-bbfm-ep04')?.status === 'applied');
    const before = (t.db.prepare('SELECT COUNT(*) AS n FROM changes').get() as any).n;
    drop('b.json', readFixture('spec-example.json'));
    await waitFor(() => fs.existsSync(path.join(agentDir, 'applied', 'b.json')));
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM changes').get() as any).n).toBe(before);
    expect(fileRow('2026-10-21-bbfm-ep04').status).toBe('duplicate');
  });

  it('an invalid file goes to rejected/ with a readable error, and nothing changes', async () => {
    await start(true);
    const before = (t.db.prepare('SELECT COUNT(*) AS n FROM changes').get() as any).n;
    const bad = updateFile([{ change_id: uuid(), op: 'update', entity: 'task', id: 'missing', base_version: 1, fields: { title: 'x' } }], { file_id: 'bad-one' });
    drop('bad-one.json', JSON.stringify(bad));
    await waitFor(() => fs.existsSync(path.join(agentDir, 'rejected', 'bad-one.error.txt')));
    const text = fs.readFileSync(path.join(agentDir, 'rejected', 'bad-one.error.txt'), 'utf8');
    expect(text).toMatch(/Nothing in the tracker was changed/);
    expect(text).toMatch(/task missing does not exist/);
    expect(fs.existsSync(path.join(agentDir, 'rejected', 'bad-one.json'))).toBe(true);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM changes').get() as any).n).toBe(before);
    drop('garbage.json', '{not json');
    await waitFor(() => fs.existsSync(path.join(agentDir, 'rejected', 'garbage.error.txt')));
  });

  it('a file with conflicts waits; preview shows it; apply needs every conflict resolved', async () => {
    await start(true);
    const task = (await api('GET', `/api/tasks/${SEED_IDS.ep4Scripts}`)).body;
    await api('PATCH', `/api/tasks/${task.id}`, { version: task.version, title: 'My title' });
    const f = updateFile(
      [{ change_id: 'k1', op: 'update', entity: 'task', id: task.id, base_version: task.version, fields: { title: 'Agent title', priority: 'low' } }],
      { file_id: 'conflicted' },
    );
    const t0 = Date.now();
    drop('conflicted.json', JSON.stringify(f));
    const row = await waitFor(() => fileRow('conflicted'), 2000);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(row.status).toBe('pending');
    const preview = (await api('GET', `/api/inbox/${row.id}/preview`)).body;
    expect(preview.conflicts.map((c: any) => c.field)).toEqual(['title']);
    expect((await api('POST', `/api/inbox/${row.id}/apply`, { resolutions: {} })).status).toBe(409);
    expect((await api('POST', `/api/inbox/${row.id}/apply`, { resolutions: { 'k1:title': 'agent' } })).status).toBe(200);
    const after = (await api('GET', `/api/tasks/${task.id}`)).body;
    expect(after.title).toBe('Agent title');
    expect(after.priority).toBe('low');
  });

  it('deletes wait for review, and reject moves the file', async () => {
    await start(true);
    const sub = t.db.prepare('SELECT * FROM subtasks WHERE id = ?').get(SEED_IDS.ep4NarrationSub2) as any;
    const f = updateFile([{ change_id: uuid(), op: 'delete', entity: 'subtask', id: sub.id, base_version: sub.version }], { file_id: 'del' });
    drop('del.json', JSON.stringify(f));
    const row = await waitFor(() => fileRow('del'));
    expect(row.status).toBe('pending');
    await api('POST', `/api/inbox/${row.id}/reject`);
    await waitFor(() => fs.existsSync(path.join(agentDir, 'rejected', 'del.json')));
    expect(t.db.prepare('SELECT deleted_at FROM subtasks WHERE id = ?').get(sub.id)).toEqual({ deleted_at: null });
  });

  it('snapshot updates within 1 second of a change, ideas included', async () => {
    await start(true);
    const t0 = Date.now();
    await api('POST', '/api/ideas', { text: 'Rival label boss fight' });
    await waitFor(() => readJson('snapshot.json').ideas.some((i: any) => i.text === 'Rival label boss fight'), 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(Snapshot.safeParse(readJson('snapshot.json')).success).toBe(true);
  });

  it('answering a question writes answers/<question_id>.json', async () => {
    await start(true);
    drop('q.json', readFixture('spec-example.json'));
    await waitFor(() => fileRow('2026-10-21-bbfm-ep04')?.status === 'applied');
    const [q] = (await api('GET', '/api/questions?status=open')).body;
    await api('POST', `/api/questions/${q.id}/answer`, { answer: 'Yes, push it a week.' });
    const a = readJson('answers', `${q.id}.json`);
    expect(a).toMatchObject({ question_id: q.id, file_id: '2026-10-21-bbfm-ep04', key: 'guest-ep4', answer: 'Yes, push it a week.' });
  });

  it('recreates the folder when it goes missing, and says so', async () => {
    await start(false);
    fs.rmSync(agentDir, { recursive: true, force: true });
    await waitFor(() => fs.existsSync(path.join(agentDir, 'AGENT.md')) && fs.existsSync(path.join(agentDir, 'snapshot.json')), 3000);
    expect(t.folder().status.message).toMatch(/recreated/);
    // And it still watches the new inbox.
    const f = updateFile([{ change_id: uuid(), op: 'create', entity: 'project', fields: { name: 'After recreate' } }], { file_id: 'after' });
    await new Promise((r) => setTimeout(r, 300));
    drop('after.json', JSON.stringify(f));
    await waitFor(() => fileRow('after')?.status === 'applied', 3000);
  });

  it('an empty tracker is filled by one bootstrap file', async () => {
    await start(false);
    expect((await api('GET', '/api/agent/prompt')).body.empty).toBe(true);
    const f = updateFile(
      [
        { change_id: uuid(), op: 'upsert', entity: 'project', temp_id: 'bbfm', fields: { key: 'bbfm', name: 'Black Buddha FM', area: 'Creative' } },
        { change_id: uuid(), op: 'upsert', entity: 'task', temp_id: 'e1', fields: { key: 'ep01', project_id: '$bbfm', title: 'Episode 1' } },
        { change_id: uuid(), op: 'create', entity: 'subtask', fields: { task_id: '$e1', text: 'Script' } },
        { change_id: uuid(), op: 'upsert', entity: 'note', fields: { parent_type: 'project', parent_id: '$bbfm', body_md: '21 episodes' } },
      ],
      { file_id: 'bootstrap' },
    );
    drop('bootstrap.json', JSON.stringify(f));
    await waitFor(() => fileRow('bootstrap')?.status === 'applied');
    const o = (await api('GET', '/api/overview')).body;
    expect(o.projects.map((p: any) => p.name)).toEqual(['Black Buddha FM']);
    await waitFor(() => readJson('snapshot.json').tasks.length === 1);
  });
});

describe('Claude Code link (MCP server and hooks)', () => {
  beforeEach(() => start(true));

  it('finds a project by its folder, including subfolders, and returns its whole context', async () => {
    const folder = path.join(dir, 'projects', 'BBFM');
    const { note } = (await api('GET', `/api/notes/project/${SEED_IDS.bbfm}`)).body;
    await api('PUT', `/api/notes/project/${SEED_IDS.bbfm}`, {
      body_md: `## Where it lives\n\n- Folder: \`${folder}\`\n\n## Log\n\n- 2026-10-23 · ~30m · Mixed episode 3\n`,
      version: note?.version ?? null,
    });

    const hit = await api('GET', `/api/agent/project-for-folder?path=${encodeURIComponent(path.join(folder, 'episodes', 'ep4'))}`);
    expect(hit.body.project_id).toBe(SEED_IDS.bbfm);
    expect((await api('GET', `/api/agent/project-for-folder?path=${encodeURIComponent(path.join(dir, 'elsewhere'))}`)).status).toBe(404);
    expect((await api('GET', '/api/agent/project-for-folder?path=relative')).status).toBe(400);

    await api('POST', '/api/messages', { parent_type: 'task', parent_id: SEED_IDS.ep4Narration, kind: 'do_next', text: 'Start here' });
    const ctx = (await api('GET', `/api/agent/projects/${SEED_IDS.bbfm}`)).body;
    expect(ctx.folder).toBe(folder);
    expect(ctx.tasks.length).toBeGreaterThan(0);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]).toMatchObject({ kind: 'do_next', text: 'Start here' });
    expect(ctx.resume_prompt).toContain('Let\'s carry on with "Black Buddha FM"');
    expect(ctx.resume_prompt).toContain(`Folder: ${folder}`);
    expect(ctx.resume_prompt).toContain('Next step: Edit and mix (Ep 3) (in_progress)');
    expect(ctx.resume_prompt).toContain('Do next: "Record narration (Ep 4)" — Start here');
    expect(ctx.resume_prompt).toContain('Open tasks (6):');
    expect(ctx.resume_prompt).toContain('2026-10-23 · ~30m · Mixed episode 3');
    expect((await api('GET', '/api/agent/projects')).body.find((p: any) => p.id === SEED_IDS.bbfm).folder).toBe(folder);
  });

  it('an update sent straight in goes through the inbox and reports the outcome', async () => {
    const ok = await api('POST', '/api/agent/files', {
      file: updateFile([{ change_id: uuid(), op: 'create', entity: 'task', fields: { project_id: SEED_IDS.bbfm, title: 'From MCP' } }], {
        file_id: 'mcp-ok',
      }),
    });
    expect(ok.body.status).toBe('applied');
    expect(fs.existsSync(path.join(agentDir, 'applied', 'mcp-ok.json'))).toBe(true);

    const bad = await api('POST', '/api/agent/files', {
      file: updateFile([{ change_id: uuid(), op: 'create', entity: 'task', fields: { title: 'No project' } }], { file_id: 'mcp-bad' }),
    });
    expect(bad.body.status).toBe('rejected');
    expect(bad.body.error).toMatch(/project_id/);
    expect((await api('POST', '/api/agent/files', { file: { file_id: '../escape' } })).status).toBe(400);
  });
});

describe('Ask', () => {
  beforeEach(() => {
    process.env.TRACKER_ASK_COMMAND = JSON.stringify(['node', path.resolve('tests/fixtures/fake-claude.mjs')]);
    return start(true);
  });
  afterEach(() => {
    delete process.env.TRACKER_ASK_COMMAND;
  });

  it('answers a question about a task in its project folder, as a reply', async () => {
    const folder = path.join(dir, 'bbfm');
    fs.mkdirSync(folder);
    const { note } = (await api('GET', `/api/notes/project/${SEED_IDS.bbfm}`)).body;
    await api('PUT', `/api/notes/project/${SEED_IDS.bbfm}`, { body_md: `- Folder: \`${folder}\``, version: note?.version ?? null });
    const q = await api('POST', '/api/messages/ask', { parent_type: 'task', parent_id: SEED_IDS.ep4Narration, text: 'How long will this take?' });
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ kind: 'ask', status: 'open' });

    const thread = async () => (await api('GET', `/api/messages?parent_type=task&parent_id=${SEED_IDS.ep4Narration}`)).body as any[];
    await waitFor(async () => (await thread()).some((m) => m.author === 'agent'), 10000);
    const [question, answer] = await thread();
    expect(question.status).toBe('handled');
    expect(answer).toMatchObject({ author: 'agent', reply_to: question.id });
    expect(answer.text).toContain('Answer to "How long will this take?"');
    expect(answer.text.toLowerCase()).toContain(folder.toLowerCase());
    // Questions aren't notes for the agent: they never show in the snapshot's messages.
    expect((await api('GET', `/api/agent/projects/${SEED_IDS.bbfm}`)).body.messages).toHaveLength(0);
  });

  it('says so when it could not answer', async () => {
    await api('POST', '/api/messages/ask', { parent_type: 'task', parent_id: SEED_IDS.ep4Scripts, text: 'please fail' });
    const thread = async () => (await api('GET', `/api/messages?parent_type=task&parent_id=${SEED_IDS.ep4Scripts}`)).body as any[];
    await waitFor(async () => (await thread()).some((m) => m.author === 'agent'), 10000);
    expect((await thread()).find((m) => m.author === 'agent').text).toMatch(/Couldn't answer \(exit code 3\)/);
  });
});

describe('Milestones tab API', () => {
  beforeEach(() => start(true));

  it('creates, lists (planned first), edits and deletes milestones, all in the feed', async () => {
    const a = await api('POST', '/api/milestones', { project_id: SEED_IDS.bbfm, title: 'Season 1 done', kind: 'feature', status: 'achieved', achieved_on: '2026-09-01' });
    expect(a.status).toBe(201);
    const p = await api('POST', '/api/milestones', { project_id: SEED_IDS.bbfm, title: 'Website v2', kind: 'release', version_label: '2.0', target_date: '2026-12-01' });
    const list = (await api('GET', `/api/projects/${SEED_IDS.bbfm}/milestones`)).body;
    expect(list.map((m: any) => m.title)).toEqual(['Website v2', 'Season 1 done']);

    const done = await api('PATCH', `/api/milestones/${p.body.id}`, { version: p.body.version, status: 'achieved', achieved: '- New design\n- Episode pages' });
    expect(done.body.status).toBe('achieved');
    expect(done.body.achieved_on).toBeTruthy();
    expect((await api('PATCH', `/api/milestones/${p.body.id}`, { version: p.body.version, title: 'stale' })).status).toBe(409);
    expect((await api('DELETE', `/api/milestones/${a.body.id}?version=${a.body.version}`)).status).toBe(200);

    const feed = (await api('GET', `/api/changes?project=${SEED_IDS.bbfm}`)).body;
    expect(feed.some((b: any) => b.changes.some((c: any) => c.entity === 'milestone' && c.entity_label === 'Milestone: Website v2'))).toBe(true);
  });
});
