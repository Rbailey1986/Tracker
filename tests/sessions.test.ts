import { describe, expect, it } from 'vitest';
import {
  computeProjectSessionsAndStats,
  extractSessionsFromNote,
  formatDuration,
  parseDurationMinutes,
  parseLogLine,
} from '../server/domain/sessions.js';

describe('sessions domain logic', () => {
  it('parses duration strings into minutes', () => {
    expect(parseDurationMinutes('~30m')).toBe(30);
    expect(parseDurationMinutes('~45min')).toBe(45);
    expect(parseDurationMinutes('~1h')).toBe(60);
    expect(parseDurationMinutes('~1.5h')).toBe(90);
    expect(parseDurationMinutes('~2.25h')).toBe(135);
    expect(parseDurationMinutes('~1h30m')).toBe(90);
    expect(parseDurationMinutes('~1h 15m')).toBe(75);
    expect(parseDurationMinutes('2 hours')).toBe(120);
    expect(parseDurationMinutes('something else')).toBeNull();
  });

  it('formats minutes into readable durations', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('parses log lines with date, duration, and summary', () => {
    const s1 = parseLogLine('- 2026-10-24 · ~45m · Built work sessions parser');
    expect(s1).toEqual({
      date: '2026-10-24',
      duration_minutes: 45,
      summary: 'Built work sessions parser',
    });

    const s2 = parseLogLine('* 2026-10-20: Cleaned up tasks without duration');
    expect(s2).toEqual({
      date: '2026-10-20',
      duration_minutes: null,
      summary: 'Cleaned up tasks without duration',
    });

    const s3 = parseLogLine('- 2026-10-22 · ~1.5h · Weekly review screen');
    expect(s3).toEqual({
      date: '2026-10-22',
      duration_minutes: 90,
      summary: 'Weekly review screen',
    });

    expect(parseLogLine('Not a dated log entry')).toBeNull();
  });

  it('extracts sessions from markdown notes under ## Log', () => {
    const note = `# Project Notes

Some notes here.

## Next
- Next task

## Log
- 2026-10-24 · ~45m · Session one
- 2026-10-20 · ~1h · Session two
- Plain line without date

## Ideas
- Another section
- 2026-10-15 · ~30m · This should be ignored as it is in Ideas
`;

    const sessions = extractSessionsFromNote(note);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      date: '2026-10-24',
      duration_minutes: 45,
      summary: 'Session one',
    });
    expect(sessions[1]).toEqual({
      date: '2026-10-20',
      duration_minutes: 60,
      summary: 'Session two',
    });
  });

  it('computes project sessions and time comparison stats', () => {
    const note = `## Log
- 2026-10-24 · ~90m · Core features
- 2026-10-23 · ~30m · Bug fixes
`;
    const tasks = [
      { id: '1', title: 'Task 1', status: 'done', estimate_minutes: 60 } as any,
      { id: '2', title: 'Task 2', status: 'in_progress', estimate_minutes: 45 } as any,
      { id: '3', title: 'Task 3', status: 'not_started', estimate_minutes: null } as any,
    ];

    const { sessions, stats } = computeProjectSessionsAndStats(tasks, note, '2026-10-24');
    expect(sessions).toHaveLength(2);
    expect(stats.total_estimate_minutes).toBe(105);
    expect(stats.done_estimate_minutes).toBe(60);
    expect(stats.open_estimate_minutes).toBe(45);
    expect(stats.logged_minutes).toBe(120);
    expect(stats.diff_minutes).toBe(15); // 120 - 105
    expect(stats.session_count).toBe(2);
    expect(stats.last_worked_on).toBe('2026-10-24');
    expect(stats.quiet).toBe(false);
    expect(stats.days_ago).toBe(0);
  });

  it('flags quiet project when last session is >= 7 days ago', () => {
    const note = `## Log
- 2026-10-10 · ~30m · Old session
`;
    const { stats } = computeProjectSessionsAndStats([], note, '2026-10-24');
    expect(stats.last_worked_on).toBe('2026-10-10');
    expect(stats.days_ago).toBe(14);
    expect(stats.quiet).toBe(true);
  });

  it('flags quiet project when there are no sessions at all', () => {
    const { stats } = computeProjectSessionsAndStats([], '', '2026-10-24');
    expect(stats.last_worked_on).toBeNull();
    expect(stats.days_ago).toBeNull();
    expect(stats.quiet).toBe(true);
  });
});
