import type { DB } from './db/db.js';
import { inBatch } from './domain/store.js';
import { addDays, todayLocal } from './domain/time.js';

/**
 * Development and test data from the mockup. A real install starts empty and the agent fills it.
 * A few ids are fixed so tests/fixtures/spec-example.json can refer to real items.
 */
export const SEED_IDS = {
  bbfm: '01JB7Q00000000000000000BBF',
  ep4Scripts: '01JB8B0000000000000000E4SC',
  ep4Narration: '01JB8C0000000000000000E4NR',
  ep4NarrationSub2: '01JB8D0000000000000000E4N2',
};

export function seed(db: DB): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
  if (count > 0) throw new Error('The database already has projects. Seed only runs on an empty database.');
  const d = (n: number) => addDays(todayLocal(), n);

  inBatch(db, { actor: 'import' }, (w) => {
    const project = (fields: Record<string, unknown>, id?: string) => w.create('project', fields, { id }).id;
    const task = (project_id: string, title: string, extra: Record<string, unknown> = {}, id?: string) =>
      w.create('task', { project_id, title, created_from: 'manual', ...extra }, { id }).id;
    const sub = (task_id: string, text: string, done = false, sort_order = 0, id?: string) =>
      w.create('subtask', { task_id, text, done, sort_order }, { id });
    const dep = (task_id: string, depends_on_task_id: string) => w.create('dependency', { task_id, depends_on_task_id });
    const note = (parent_type: string, parent_id: string, body_md: string) => w.create('note', { parent_type, parent_id, body_md });

    // ---- Black Buddha FM ----
    const bbfm = project(
      { key: 'bbfm', name: 'Black Buddha FM', area: 'Creative', color: '#5B34A8', description: 'A 21-episode UK urban underground music documentary podcast.' },
      SEED_IDS.bbfm,
    );
    let o = 0;
    task(bbfm, 'Final mix (Ep 2)', { key: 'ep02-final-mix', status: 'done', owner: 'you', sort_order: o++ });
    task(bbfm, 'Publish episode 2', { key: 'ep02-publish', status: 'done', owner: 'you', sort_order: o++ });
    const ep3Edit = task(bbfm, 'Edit and mix (Ep 3)', { key: 'ep03-edit-mix', status: 'in_progress', owner: 'you', due_date: d(-1), priority: 'high', sort_order: o++ });
    const ep3Pub = task(bbfm, 'Publish episode 3', { key: 'ep03-publish', owner: 'you', due_date: d(2), priority: 'medium', sort_order: o++ });
    dep(ep3Pub, ep3Edit);
    const ep4Research = task(bbfm, 'Research track list (Ep 4)', { key: 'ep04-research', status: 'done', owner: 'agent', sort_order: o++ });
    const ep4Scripts = task(
      bbfm,
      'Write chapter scripts (Ep 4)',
      { key: 'ep04-scripts', status: 'in_progress', owner: 'agent', due_date: d(1), priority: 'high', sort_order: o++, description: 'Six chapters of narration, about 90 seconds each.' },
      SEED_IDS.ep4Scripts,
    );
    dep(ep4Scripts, ep4Research);
    const ep4Narr = task(
      bbfm,
      'Record narration (Ep 4)',
      { key: 'ep04-record-narration', owner: 'you', due_date: d(2), priority: 'high', sort_order: o++, estimate_minutes: 180 },
      SEED_IDS.ep4Narration,
    );
    sub(ep4Narr, 'Record chapters 1–3', false, 0);
    sub(ep4Narr, 'Record chapters 4–6', false, 1, SEED_IDS.ep4NarrationSub2);
    sub(ep4Narr, 'Clean up and level', false, 2);
    dep(ep4Narr, ep4Scripts);
    task(bbfm, 'Confirm guest (Ep 4)', {
      key: 'ep04-guest', status: 'blocked', blocked_reason: 'Waiting for a reply from the guest', owner: 'you', due_date: d(3), sort_order: o++,
    });
    task(bbfm, 'Pick the theme (Ep 5)', { key: 'ep05-theme', owner: 'agent', due_date: d(6), priority: 'medium', sort_order: o++ });
    note(
      'project',
      bbfm,
      `## Format\n\n- 21 episodes, one era or scene each\n- Narration by DJ President Bailey between tracks\n- Publish every second Friday\n\n## Log\n- ${d(0)} · ~1h · Ep 3 edit and mix review\n- ${d(-2)} · ~45m · Ep 2 publish checks`,
    );

    // ---- BBFM website ----
    const web = project({ key: 'bbfm-website', name: 'BBFM website', area: 'Creative', color: '#0B6B78', description: 'Episode pages, show notes and the mailing list.' });
    task(web, 'Episode page template', { key: 'episode-template', status: 'done', sort_order: 0 });
    task(web, 'Show notes for episode 3', { key: 'ep03-show-notes', owner: 'agent', due_date: d(3), sort_order: 1 });
    task(web, 'Mailing list signup', { key: 'mailing-list', due_date: d(10), priority: 'low', sort_order: 2 });

    // ---- School teaching ----
    const school = project({ key: 'school-2026-27', name: 'School teaching 2026–27', area: 'Teaching', color: '#1E6B33', description: 'Lessons, marking and reports for this school year.' });
    task(school, 'Plan next week’s lessons', { key: 'plan-week', due_date: d(0), priority: 'high', status: 'in_progress', sort_order: 0 });
    task(school, 'Mark Year 9 essays', { key: 'mark-y9', due_date: d(-2), priority: 'medium', sort_order: 1 });
    task(school, 'Parents’ evening slots', { key: 'parents-evening', status: 'done', sort_order: 2 });

    // ---- English school plan ----
    const esp = project({ key: 'english-school', name: 'English school plan', area: 'Business', color: '#9A4508', description: 'Plan for opening a small English language school.' });
    const market = task(esp, 'Market research', { key: 'market-research', owner: 'agent', due_date: d(5), status: 'in_progress', sort_order: 0 });
    const costs = task(esp, 'Cost model', { key: 'cost-model', due_date: d(12), sort_order: 1 });
    dep(costs, market);

    // ---- Music Empire mod ----
    const mod = project({ key: 'music-empire', name: 'Music Empire mod', area: 'Games', color: '#A32117', description: 'A record label management mod.' });
    task(mod, 'Label roster screen', { key: 'roster-screen', status: 'done', sort_order: 0 });
    task(mod, 'Design rival label events', { key: 'rival-events', owner: 'agent', due_date: d(7), sort_order: 1 });
    task(mod, 'Balance chart payouts', { key: 'chart-payouts', due_date: d(14), priority: 'low', sort_order: 2 });

    // ---- Paused and archived ----
    const pet = project({ key: 'desktop-pet', name: 'Desktop pet game', area: 'Games', color: '#5B616E', status: 'paused', description: 'A small pet that lives on the desktop.' });
    task(pet, 'Idle animation', { key: 'idle-animation', sort_order: 0 });
    const cv = project({ key: 'cv-update', name: 'CV update', area: 'Personal', color: '#3D434F', status: 'archived', description: '' });
    task(cv, 'Update CV for 2026', { key: 'cv-2026', status: 'done', sort_order: 0 });

    w.create('idea', { text: 'A bonus episode built from listener track requests', project_id: bbfm });
  });
}
