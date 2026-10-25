import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../server/agent/pipeline.js';
import { buildPlan, FileRejection, parseUpdateFile } from '../server/agent/plan.js';
import { buildSnapshot } from '../server/agent/snapshot.js';
import { getRow, inBatch } from '../server/domain/store.js';
import { undoBatch } from '../server/domain/undo.js';
import { setSetting } from '../server/db/db.js';
import { SEED_IDS } from '../server/seed.js';
import { memoryDb, readFixture, updateFile, uuid } from './helpers.js';

const rejectionStep = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FileRejection) return e.step;
    throw e;
  }
  return null;
};

describe('validation order', () => {
  it('1: rejects invalid JSON and schema errors with readable paths', () => {
    expect(rejectionStep(() => parseUpdateFile('{ nope'))).toBe(1);
    const bad = updateFile([{ change_id: uuid(), op: 'create', entity: 'task', fields: { title: 'x' } }]);
    try {
      parseUpdateFile(JSON.stringify(bad));
      expect.unreachable();
    } catch (e) {
      expect((e as FileRejection).problems.join('\n')).toMatch(/changes\[0\]\.fields\.project_id/);
    }
    const wrongOp = updateFile([{ change_id: uuid(), op: 'delete', entity: 'idea', id: 'x', base_version: 1 }]);
    expect(rejectionStep(() => parseUpdateFile(JSON.stringify(wrongOp)))).toBe(1);
  });

  it('1: refuses fields the agent may not set', () => {
    const f = updateFile([{ change_id: uuid(), op: 'create', entity: 'project', fields: { name: 'x', version: 3 } }]);
    expect(rejectionStep(() => parseUpdateFile(JSON.stringify(f)))).toBe(1);
  });

  it('3: change_ids must be unique in the file and never seen before', () => {
    const db = memoryDb(true);
    const id = uuid();
    const dup = updateFile([
      { change_id: id, op: 'create', entity: 'project', fields: { name: 'A' } },
      { change_id: id, op: 'create', entity: 'project', fields: { name: 'B' } },
    ]);
    expect(rejectionStep(() => buildPlan(db, dup))).toBe(3);
    db.prepare('INSERT INTO agent_change_ids (change_id, file_id) VALUES (?, ?)').run('used', 'old');
    expect(rejectionStep(() => buildPlan(db, updateFile([{ change_id: 'used', op: 'create', entity: 'project', fields: { name: 'A' } }])))).toBe(3);
  });

  it('4: referenced ids must exist and temp ids must be defined earlier', () => {
    const db = memoryDb(true);
    const missing = updateFile([{ change_id: uuid(), op: 'update', entity: 'task', id: 'nope', base_version: 1, fields: { title: 'x' } }]);
    expect(rejectionStep(() => buildPlan(db, missing))).toBe(4);
    const lateTemp = updateFile([
      { change_id: uuid(), op: 'create', entity: 'subtask', fields: { task_id: '$t', text: 's' } },
      { change_id: uuid(), op: 'create', entity: 'task', temp_id: 't', fields: { project_id: SEED_IDS.bbfm, title: 'T' } },
    ]);
    expect(rejectionStep(() => buildPlan(db, lateTemp))).toBe(4);
    const wrongType = updateFile([
      { change_id: uuid(), op: 'create', entity: 'project', temp_id: 'p', fields: { name: 'P' } },
      { change_id: uuid(), op: 'create', entity: 'subtask', fields: { task_id: '$p', text: 's' } },
    ]);
    expect(rejectionStep(() => buildPlan(db, wrongType))).toBe(4);
  });

  it('5: rejects dependency cycles and changes to archived projects', () => {
    const db = memoryDb(true);
    // seed: narration depends on scripts
    const cycle = updateFile([
      { change_id: uuid(), op: 'create', entity: 'dependency', fields: { task_id: SEED_IDS.ep4Scripts, depends_on_task_id: SEED_IDS.ep4Narration } },
    ]);
    expect(rejectionStep(() => buildPlan(db, cycle))).toBe(5);
    const cv = db.prepare(`SELECT * FROM projects WHERE key = 'cv-update'`).get() as any;
    const archived = updateFile([{ change_id: uuid(), op: 'update', entity: 'project', id: cv.id, base_version: cv.version, fields: { name: 'x' } }]);
    expect(rejectionStep(() => buildPlan(db, archived))).toBe(5);
    const intoArchived = updateFile([{ change_id: uuid(), op: 'create', entity: 'task', fields: { project_id: cv.id, title: 'x' } }]);
    expect(rejectionStep(() => buildPlan(db, intoArchived))).toBe(5);
  });

  it('accepts the spec example file', () => {
    const db = memoryDb(true);
    const plan = buildPlan(db, parseUpdateFile(readFixture('spec-example.json')));
    expect(plan.items.map((i) => i.op)).toEqual(['create', 'create', 'update']);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('temp ids and upserts', () => {
  it('resolves $temp_id across a whole bootstrap file', () => {
    const db = memoryDb();
    const pipeline = new AgentPipeline(db);
    const file = updateFile([
      { change_id: uuid(), op: 'upsert', entity: 'project', temp_id: 'p', fields: { key: 'proj', name: 'Proj' } },
      { change_id: uuid(), op: 'upsert', entity: 'task', temp_id: 'a', fields: { key: 'a', project_id: '$p', title: 'A' } },
      { change_id: uuid(), op: 'upsert', entity: 'task', temp_id: 'b', fields: { key: 'b', project_id: '$p', title: 'B' } },
      { change_id: uuid(), op: 'create', entity: 'subtask', fields: { task_id: '$a', text: 'sub' } },
      { change_id: uuid(), op: 'create', entity: 'dependency', fields: { task_id: '$b', depends_on_task_id: '$a' } },
      { change_id: uuid(), op: 'upsert', entity: 'note', fields: { parent_type: 'project', parent_id: '$p', body_md: 'hello' } },
    ]);
    const r = pipeline.ingest(`${file.file_id}.json`, JSON.stringify(file));
    expect(r.outcome).toBe('applied');
    const tasks = db.prepare('SELECT * FROM tasks').all() as any[];
    expect(tasks.length).toBe(2);
    expect(tasks.every((t) => t.created_from === 'agent_file' && t.created_from_ref === file.file_id)).toBe(true);
    const a = tasks.find((t) => t.key === 'a');
    expect((db.prepare('SELECT * FROM subtasks').get() as any).task_id).toBe(a.id);
    expect((db.prepare('SELECT * FROM dependencies').get() as any).depends_on_task_id).toBe(a.id);
  });

  it('a resent upsert with the same key updates instead of duplicating', () => {
    const db = memoryDb();
    const pipeline = new AgentPipeline(db);
    const mk = (title: string) =>
      updateFile([
        { change_id: uuid(), op: 'upsert', entity: 'project', temp_id: 'p', fields: { key: 'proj', name: 'Proj' } },
        { change_id: uuid(), op: 'upsert', entity: 'task', fields: { key: 'a', project_id: '$p', title } },
      ]);
    const f1 = mk('First');
    expect(pipeline.ingest('a.json', JSON.stringify(f1)).outcome).toBe('applied');
    // Second run: the project now exists, so $p resolves to it and the task matches by key.
    const f2 = mk('Second');
    expect(pipeline.ingest('b.json', JSON.stringify(f2)).outcome).toBe('applied');
    const tasks = db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL').all() as any[];
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('Second');
    expect((db.prepare('SELECT COUNT(*) AS n FROM projects').get() as any).n).toBe(1);
  });
});

describe('conflicts', () => {
  function setup() {
    const db = memoryDb(true);
    const t = getRow(db, 'task', SEED_IDS.ep4Scripts)!;
    return { db, t };
  }

  it('no conflict when base_version matches', () => {
    const { db, t } = setup();
    const plan = buildPlan(db, updateFile([{ change_id: uuid(), op: 'update', entity: 'task', id: t.id, base_version: t.version, fields: { title: 'x' } }]));
    expect(plan.conflicts).toEqual([]);
  });

  it('a user edit since base_version on the same field is a conflict; a different field merges', () => {
    const { db, t } = setup();
    inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { title: 'Mine' }));
    const plan = buildPlan(
      db,
      updateFile([{ change_id: 'c1', op: 'update', entity: 'task', id: t.id, base_version: t.version, fields: { title: 'Agent', priority: 'low' } }]),
    );
    expect(plan.conflicts.map((c) => c.field)).toEqual(['title']);
    expect(plan.conflicts[0]).toMatchObject({ mine: 'Mine', agent: 'Agent', changed_by: 'you' });
  });

  it('agent edits since base_version are not conflicts', () => {
    const { db, t } = setup();
    inBatch(db, { actor: 'agent' }, (w) => w.update('task', t.id, { title: 'Earlier agent' }));
    const plan = buildPlan(db, updateFile([{ change_id: uuid(), op: 'update', entity: 'task', id: t.id, base_version: t.version, fields: { title: 'Agent' } }]));
    expect(plan.conflicts).toEqual([]);
  });

  it('a delete of an item changed since base_version is always a conflict', () => {
    const { db, t } = setup();
    inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { priority: 'low' }));
    const plan = buildPlan(db, updateFile([{ change_id: uuid(), op: 'delete', entity: 'task', id: t.id, base_version: t.version }]));
    expect(plan.conflicts.map((c) => c.field)).toEqual(['(delete)']);
  });

  it('an upsert without base_version is checked against the agent’s last change', () => {
    const db = memoryDb();
    const pipeline = new AgentPipeline(db);
    const f1 = updateFile([
      { change_id: uuid(), op: 'upsert', entity: 'project', temp_id: 'p', fields: { key: 'proj', name: 'Proj' } },
      { change_id: uuid(), op: 'upsert', entity: 'task', fields: { key: 'a', project_id: '$p', title: 'A' } },
    ]);
    pipeline.ingest('1.json', JSON.stringify(f1));
    const task = db.prepare('SELECT * FROM tasks').get() as any;
    inBatch(db, { actor: 'you' }, (w) => w.update('task', task.id, { title: 'Mine', priority: 'high' }));
    const f2 = updateFile([
      { change_id: uuid(), op: 'upsert', entity: 'project', temp_id: 'p', fields: { key: 'proj', name: 'Proj' } },
      { change_id: uuid(), op: 'upsert', entity: 'task', fields: { key: 'a', project_id: '$p', title: 'Agent', due_date: '2030-01-01' } },
    ]);
    const plan = buildPlan(db, f2);
    expect(plan.conflicts.map((c) => c.field)).toEqual(['title']);
  });

  it('applying with "mine" keeps the user value and still merges the rest', () => {
    const { db, t } = setup();
    setSetting(db, 'auto_apply', 'true');
    inBatch(db, { actor: 'you' }, (w) => w.update('task', t.id, { title: 'Mine' }));
    const pipeline = new AgentPipeline(db);
    const f = updateFile([{ change_id: 'cx', op: 'update', entity: 'task', id: t.id, base_version: t.version, fields: { title: 'Agent', priority: 'low' } }]);
    const r = pipeline.ingest('c.json', JSON.stringify(f));
    expect(r.outcome).toBe('pending');
    expect(() => pipeline.apply(r.row.id, {})).toThrowError(/conflict/);
    pipeline.apply(r.row.id, { 'cx:title': 'mine' });
    const row = getRow(db, 'task', t.id)!;
    expect(row.title).toBe('Mine');
    expect(row.priority).toBe('low');
  });
});

describe('ideas', () => {
  it('the agent marks an idea picked up, pointing at a task it created', () => {
    const db = memoryDb(true);
    const idea = db.prepare(`SELECT * FROM ideas`).get() as any;
    const pipeline = new AgentPipeline(db);
    const f = updateFile([
      { change_id: uuid(), op: 'create', entity: 'task', temp_id: 'bonus', fields: { project_id: SEED_IDS.bbfm, title: 'Plan bonus episode' } },
      {
        change_id: uuid(), op: 'update', entity: 'idea', id: idea.id, base_version: idea.version,
        fields: { status: 'picked_up', result_type: 'task', result_id: '$bonus', agent_note: 'Became task “Plan bonus episode”' },
      },
    ]);
    expect(pipeline.ingest('i.json', JSON.stringify(f)).outcome).toBe('applied');
    const after = getRow(db, 'idea', idea.id)!;
    const task = db.prepare(`SELECT * FROM tasks WHERE title = 'Plan bonus episode'`).get() as any;
    expect(after).toMatchObject({ status: 'picked_up', result_type: 'task', result_id: task.id });
    expect(after.picked_up_at).toBeTruthy();
  });

  it('the agent cannot edit idea text', () => {
    const db = memoryDb(true);
    const idea = db.prepare(`SELECT * FROM ideas`).get() as any;
    const f = updateFile([{ change_id: uuid(), op: 'update', entity: 'idea', id: idea.id, base_version: 1, fields: { status: 'picked_up', text: 'x' } as any }]);
    expect(rejectionStep(() => parseUpdateFile(JSON.stringify(f)))).toBe(1);
  });

  it('the agent adds its own ideas; they wait for the user and a resend does not duplicate them', () => {
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    const file = () =>
      updateFile([
        { change_id: uuid(), op: 'upsert', entity: 'idea', fields: { text: 'Chapter markers in the player', project_id: SEED_IDS.bbfm } },
        { change_id: uuid(), op: 'create', entity: 'idea', fields: { text: 'A dark theme' } },
      ]);
    expect(pipeline.ingest('a.json', JSON.stringify(file())).outcome).toBe('applied');
    const ideas = () => db.prepare(`SELECT * FROM ideas WHERE added_by = 'agent' AND deleted_at IS NULL`).all() as any[];
    expect(ideas()).toHaveLength(2);
    expect(ideas()[0]).toMatchObject({ status: 'new', added_by: 'agent' });

    // Resend with the upsert only: matched by text, nothing new.
    const again = updateFile([
      { change_id: uuid(), op: 'upsert', entity: 'idea', fields: { text: 'Chapter markers in the player', project_id: SEED_IDS.bbfm } },
    ]);
    expect(pipeline.ingest('b.json', JSON.stringify(again)).outcome).toBe('applied');
    expect(ideas()).toHaveLength(2);
    const snap = buildSnapshot(db);
    expect(snap.ideas.filter((i: any) => i.added_by === 'agent')).toHaveLength(2);
  });

  it('a resent idea the user already handled stays handled', () => {
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    const f = updateFile([{ change_id: uuid(), op: 'upsert', entity: 'idea', fields: { text: 'Live chat' } }]);
    pipeline.ingest('a.json', JSON.stringify(f));
    const idea = db.prepare(`SELECT * FROM ideas WHERE text = 'Live chat'`).get() as any;
    inBatch(db, { actor: 'you' }, (w) => w.update('idea', idea.id, { status: 'dismissed' }));
    const again = updateFile([{ change_id: uuid(), op: 'upsert', entity: 'idea', fields: { text: 'Live chat' } }]);
    expect(pipeline.ingest('b.json', JSON.stringify(again)).outcome).toBe('applied');
    expect(getRow(db, 'idea', idea.id)!.status).toBe('dismissed');
  });
});

describe('messages for the agent', () => {
  it('your notes and hand-offs show in the snapshot, and the agent replies and marks them handled', async () => {
    const { postMessage } = await import('../server/domain/messages.js');
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    const note = postMessage(db, { parent_type: 'task', parent_id: SEED_IDS.ep4Scripts, text: 'Use the shorter intro' }) as any;
    const next = postMessage(db, { parent_type: 'task', parent_id: SEED_IDS.ep4Narration, kind: 'do_next' }) as any;
    expect(() => postMessage(db, { parent_type: 'task', parent_id: SEED_IDS.ep4Narration, kind: 'do_next' })).toThrow(/already waiting/);

    const snap = buildSnapshot(db);
    expect(snap.messages.map((m) => [m.kind, m.parent_id])).toEqual([
      ['note', SEED_IDS.ep4Scripts],
      ['do_next', SEED_IDS.ep4Narration],
    ]);
    expect(snap.messages[0].project_id).toBe(SEED_IDS.bbfm);

    const f = {
      ...updateFile([]),
      message_replies: [
        { message_id: note.id, reply: 'Done: intro cut to 20 s' },
        { message_id: next.id, reply: 'Started; script drafted', handled: false },
      ],
    };
    expect(pipeline.ingest('r.json', JSON.stringify(f)).outcome).toBe('applied');
    const rows = db.prepare('SELECT * FROM agent_messages ORDER BY created_at').all() as any[];
    expect(rows.find((r) => r.id === note.id).status).toBe('handled');
    expect(rows.find((r) => r.id === next.id).status).toBe('open');
    expect(rows.filter((r) => r.author === 'agent').map((r) => r.reply_to).sort()).toEqual([note.id, next.id].sort());
    expect(buildSnapshot(db).messages.map((m) => m.id)).toEqual([next.id]);
  });

  it('a reply to a message that does not exist rejects the file at step 4', () => {
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    const f = { ...updateFile([]), message_replies: [{ message_id: 'nope', reply: 'x' }] };
    const r = pipeline.ingest('bad.json', JSON.stringify(f));
    expect(r.outcome).toBe('rejected');
    expect((r as any).error).toMatch(/message nope does not exist/);
  });
});

describe('milestones', () => {
  const release = (extra: Record<string, unknown> = {}) => ({
    change_id: uuid(),
    op: 'upsert' as const,
    entity: 'milestone' as const,
    fields: {
      project_id: SEED_IDS.bbfm,
      key: 'ep4-release',
      title: 'Episode 4 released',
      kind: 'release',
      version_label: 'Ep 4',
      status: 'achieved',
      description: 'The fourth episode goes out on all platforms.',
      achieved: '- Scripts and narration recorded\n- Mixed and mastered',
      ...extra,
    },
  });

  it('the agent adds a milestone; achieved_on defaults to today; a resend updates instead of duplicating', async () => {
    const { todayLocal } = await import('../server/domain/time.js');
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    expect(pipeline.ingest('m1.json', JSON.stringify(updateFile([release() as any]))).outcome).toBe('applied');
    const rows = () => db.prepare('SELECT * FROM milestones WHERE deleted_at IS NULL').all() as any[];
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ title: 'Episode 4 released', kind: 'release', status: 'achieved', achieved_on: todayLocal() });

    expect(pipeline.ingest('m2.json', JSON.stringify(updateFile([release({ title: 'Episode 4 is out' }) as any]))).outcome).toBe('applied');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].title).toBe('Episode 4 is out');
    expect(buildSnapshot(db).milestones).toHaveLength(1);
  });

  it('undo removes an agent milestone, and a delete waits for review', () => {
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    const r = pipeline.ingest('m.json', JSON.stringify(updateFile([release() as any])));
    const m = db.prepare('SELECT * FROM milestones').get() as any;
    undoBatch(db, r.row.batch_id!);
    expect(getRow(db, 'milestone', m.id)).toBeUndefined();

    const r2 = pipeline.ingest('m2.json', JSON.stringify(updateFile([release() as any])));
    const m2 = db.prepare('SELECT * FROM milestones WHERE deleted_at IS NULL').get() as any;
    expect(r2.outcome).toBe('applied');
    const del = updateFile([{ change_id: uuid(), op: 'delete', entity: 'milestone', id: m2.id, base_version: m2.version }]);
    expect(pipeline.ingest('d.json', JSON.stringify(del)).outcome).toBe('pending');
  });

  it('rejects a milestone for a project that does not exist, or an unknown kind', () => {
    const db = memoryDb(true);
    const pipeline = new AgentPipeline(db);
    expect(pipeline.ingest('x.json', JSON.stringify(updateFile([release({ project_id: 'nope' }) as any]))).outcome).toBe('rejected');
    expect(pipeline.ingest('y.json', JSON.stringify(updateFile([release({ kind: 'party' }) as any]))).outcome).toBe('rejected');
  });
});
