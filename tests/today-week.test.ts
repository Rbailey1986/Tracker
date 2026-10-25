import { describe, expect, it } from 'vitest';
import { inBatch } from '../server/domain/store.js';
import { addDays, todayLocal } from '../server/domain/time.js';
import { today } from '../server/domain/today.js';
import { memoryDb } from './helpers.js';

describe('Today: this week', () => {
  it('lists the next seven days with the open tasks due each day, and counts tasks done since Monday', () => {
    const db = memoryDb();
    const w = <T,>(fn: (w: any) => T) => inBatch(db, { actor: 'you' }, fn);
    const p = w((b) => b.create('project', { name: 'Tracker', area: 'Code' }));
    const date = todayLocal();
    w((b) => b.create('task', { project_id: p.id, title: 'Due today', due_date: date }));
    w((b) => b.create('task', { project_id: p.id, title: 'In three days', due_date: addDays(date, 3) }));
    w((b) => b.create('task', { project_id: p.id, title: 'Next week', due_date: addDays(date, 7) }));
    w((b) => b.create('task', { project_id: p.id, title: 'Done and due', due_date: addDays(date, 1), status: 'done' }));
    w((b) => b.create('task', { project_id: p.id, title: 'Undated' }));

    const d = today(db);
    expect(d.week).toHaveLength(7);
    expect(d.week.map((x) => x.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(date, i)));
    expect(d.week[0].tasks.map((t) => t.title)).toEqual(['Due today']);
    expect(d.week[1].tasks).toHaveLength(0); // done tasks are left out
    expect(d.week[3].tasks.map((t) => t.title)).toEqual(['In three days']);
    expect(d.week.flatMap((x) => x.tasks).some((t) => t.title === 'Next week')).toBe(false);

    expect(new Date(d.week_start + 'T12:00:00').getDay()).toBe(1);
    expect(d.week_start <= date).toBe(true);
    expect(d.done_this_week).toBe(1);
  });
});
