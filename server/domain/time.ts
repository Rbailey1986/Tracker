import { monotonicFactory } from 'ulid';

/** Monotonic so ids made in the same millisecond still sort in creation order (the change log relies on this). */
export const newId = monotonicFactory();

export const nowIso = () => new Date().toISOString();

/** Today's date on this PC, as YYYY-MM-DD. Due dates are local calendar dates. */
export function todayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return todayLocal(d);
}
