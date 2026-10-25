import type { DB } from '../db/db.js';
import { logLines } from './areas.js';
import type { TaskView } from './queries.js';
import { todayLocal } from './time.js';

export interface ProjectSession {
  date: string; // YYYY-MM-DD
  duration_minutes: number | null;
  summary: string;
}

export interface ProjectTimeStats {
  total_estimate_minutes: number;
  done_estimate_minutes: number;
  open_estimate_minutes: number;
  logged_minutes: number;
  diff_minutes: number; // logged_minutes - done_estimate_minutes
  session_count: number;
  last_worked_on: string | null;
  quiet: boolean;
  days_ago: number | null;
}

/**
 * Parses durations written in note logs, such as `~45m`, `~1.5h`, `~1h30m`, `~2h`, `~10m`, `30m`.
 * Returns total minutes, or null if no duration pattern matches.
 */
export function parseDurationMinutes(str: string): number | null {
  if (!str) return null;
  // Match ~1.5h, ~1h30m, ~45m, ~2 hours, etc.
  const match = /~?\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:(\d+)\s*(?:minutes?|mins?|m))?/i.exec(str);
  if (match) {
    const hours = parseFloat(match[1]);
    const mins = match[2] ? parseInt(match[2], 10) : 0;
    return Math.round(hours * 60 + mins);
  }
  const minMatch = /~?\s*(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(str);
  if (minMatch) {
    return parseInt(minMatch[1], 10);
  }
  return null;
}

/** Formats minutes as e.g. "1h 30m", "45m", "2h", "0m". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0 && rem > 0) return `${h}h ${rem}m`;
  if (h > 0) return `${h}h`;
  return `${rem}m`;
}

/** Parses a single log line into a ProjectSession if it begins with a date. */
export function parseLogLine(rawLine: string): ProjectSession | null {
  const line = rawLine.replace(/^[-\s*·]+/, '').trim();
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(line);
  if (!dateMatch) return null;
  const date = dateMatch[1];
  const rest = line.slice(date.length).replace(/^[\s·\-:]+/, '').trim();
  const dur = parseDurationMinutes(rest);
  // Remove duration token from summary (e.g. "~45m · " or "? · ")
  const summary = rest.replace(/^(?:~?\d+(?:\.\d+)?[hm](?:\s*\d+m)?|\?)\s*[·\-:]\s*/i, '').trim();
  return {
    date,
    duration_minutes: dur,
    summary: summary || rest,
  };
}

/** Extracts all sessions from a project note's "## Log" section. */
export function extractSessionsFromNote(noteBody: string): ProjectSession[] {
  if (!noteBody) return [];
  const logMatch = /^## Log\s*$/m.exec(noteBody);
  if (!logMatch || logMatch.index === undefined) return [];
  const afterLog = noteBody.slice(logMatch.index + logMatch[0].length);
  // Find where the next markdown section begins (if any)
  const nextSectionMatch = /^#{1,3}\s+\S+/m.exec(afterLog);
  const logSection = nextSectionMatch ? afterLog.slice(0, nextSectionMatch.index) : afterLog;

  const lines = logSection.split('\n');
  const sessions: ProjectSession[] = [];
  for (const l of lines) {
    const s = parseLogLine(l);
    if (s) sessions.push(s);
  }
  return sessions;
}

/** Days between a YYYY-MM-DD date and today YYYY-MM-DD. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const from = new Date(fromYmd + 'T12:00:00').getTime();
  const to = new Date(toYmd + 'T12:00:00').getTime();
  return Math.max(0, Math.round((to - from) / (24 * 3600 * 1000)));
}

/**
 * Computes time statistics and "last worked on" for a project from its tasks and note body.
 */
export function computeProjectSessionsAndStats(
  tasks: TaskView[],
  noteBody = '',
  today = todayLocal(),
): {
  sessions: ProjectSession[];
  stats: ProjectTimeStats;
} {
  const sessions = extractSessionsFromNote(noteBody);

  // Find the latest activity date from sessions and completed tasks
  const candidateDates: string[] = sessions.map((s) => s.date);
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      candidateDates.push(t.completed_at.slice(0, 10));
    }
  }
  candidateDates.sort().reverse();
  const last_worked_on = candidateDates[0] ?? null;
  const days_ago = last_worked_on ? daysBetween(last_worked_on, today) : null;
  const quiet = days_ago === null || days_ago >= 7;

  let total_estimate_minutes = 0;
  let done_estimate_minutes = 0;
  let open_estimate_minutes = 0;
  for (const t of tasks) {
    const est = t.estimate_minutes ?? 0;
    total_estimate_minutes += est;
    if (t.status === 'done') {
      done_estimate_minutes += est;
    } else {
      open_estimate_minutes += est;
    }
  }

  let logged_minutes = 0;
  for (const s of sessions) {
    if (s.duration_minutes) {
      logged_minutes += s.duration_minutes;
    }
  }

  const diff_minutes = logged_minutes - total_estimate_minutes;

  return {
    sessions,
    stats: {
      total_estimate_minutes,
      done_estimate_minutes,
      open_estimate_minutes,
      logged_minutes,
      diff_minutes,
      session_count: sessions.length,
      last_worked_on,
      quiet,
      days_ago,
    },
  };
}
