import { describe, expect, it } from 'vitest';
import { inBatch } from '../server/domain/store.js';
import { addDays, todayLocal } from '../server/domain/time.js';
import { weeklyReview } from '../server/domain/weekly.js';
import { memoryDb } from './helpers.js';

describe('weekly review domain', () => {
  it('summarizes completed tasks, slipped tasks, quiet projects, and questions', () => {
    const db = memoryDb();
    const w = <T,>(fn: (w: any) => T) => inBatch(db, { actor: 'you' }, fn);

    const now = new Date('2026-10-24T12:00:00'); // Saturday
    const today = todayLocal(now);

    // Project 1: Active and recently worked on
    const p1 = w((b) => b.create('project', { name: 'Active Project', area: 'Code', status: 'active' }));
    w((b) =>
      b.create('note', {
        parent_type: 'project',
        parent_id: p1.id,
        body_md: `## Log\n- 2026-10-24 · ~60m · Session today\n`,
      }),
    );

    // Project 2: Active but quiet (last worked on 10 days ago)
    const p2 = w((b) => b.create('project', { name: 'Quiet Project', area: 'Design', status: 'active' }));
    w((b) =>
      b.create('note', {
        parent_type: 'project',
        parent_id: p2.id,
        body_md: `## Log\n- 2026-10-14 · ~30m · Old session\n`,
      }),
    );
    w((b) => b.create('task', { project_id: p2.id, title: 'Quiet project next task', status: 'not_started' }));

    // Tasks for Project 1:
    // Task done this week
    w((b) =>
      b.create('task', {
        project_id: p1.id,
        title: 'Done task this week',
        status: 'done',
        completed_at: '2026-10-23T10:00:00.000Z',
        estimate_minutes: 45,
      }),
    );

    // Task done last month (should NOT appear in completed_this_week)
    w((b) =>
      b.create('task', {
        project_id: p1.id,
        title: 'Done task last month',
        status: 'done',
        completed_at: '2026-09-01T10:00:00.000Z',
        estimate_minutes: 120,
      }),
    );

    // Slipped task: due yesterday, not done
    w((b) =>
      b.create('task', {
        project_id: p1.id,
        title: 'Overdue task',
        status: 'in_progress',
        due_date: addDays(today, -1),
      }),
    );

    // Upcoming task: due tomorrow
    w((b) =>
      b.create('task', {
        project_id: p1.id,
        title: 'Future task',
        status: 'not_started',
        due_date: addDays(today, 1),
      }),
    );

    // Agent question
    db.prepare(
      `INSERT INTO agent_questions (id, file_id, agent_file_row_id, question_key, text, project_id, status, created_at)
       VALUES (?, 'f-1', 'row-1', ?, ?, ?, 'open', ?)`,
    ).run('q-1', 'clarify-api', 'Which auth provider should we use?', p1.id, now.toISOString());

    const review = weeklyReview(db, now);

    expect(review.today).toBe(today);
    expect(review.completed_this_week).toHaveLength(1);
    expect(review.completed_this_week[0].title).toBe('Done task this week');
    expect(review.completed_this_week[0].estimate_minutes).toBe(45);

    expect(review.slipped_tasks).toHaveLength(1);
    expect(review.slipped_tasks[0].title).toBe('Overdue task');

    expect(review.quiet_projects).toHaveLength(1);
    expect(review.quiet_projects[0].name).toBe('Quiet Project');
    expect(review.quiet_projects[0].days_ago).toBe(10);
    expect(review.quiet_projects[0].next_step?.title).toBe('Quiet project next task');

    expect(review.unanswered_questions).toHaveLength(1);
    expect(review.unanswered_questions[0].text).toBe('Which auth provider should we use?');

    expect(review.metrics.done_count).toBe(1);
    expect(review.metrics.slipped_count).toBe(1);
    expect(review.metrics.quiet_count).toBe(1);
    expect(review.metrics.questions_count).toBe(1);
    expect(review.metrics.total_logged_minutes_this_week).toBe(60);
    expect(review.metrics.total_done_estimates_this_week).toBe(45);
  });
});
