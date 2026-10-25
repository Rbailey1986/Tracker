import { type Milestone, type Task } from '../api';
import { go, todayStr } from '../ui';

/** A week with this many open items or more is marked busy. */
const BUSY = 5;
const MAX_WEEKS = 26;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const toDate = (d: string) => new Date(d + 'T12:00:00');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: string, n: number) => {
  const x = toDate(d);
  x.setDate(x.getDate() + n);
  return ymd(x);
};
const mondayOf = (d: string) => addDays(d, -((toDate(d).getDay() + 6) % 7));

type Item = { kind: 'task'; date: string; open: boolean; task: Task } | { kind: 'milestone'; date: string; open: boolean; m: Milestone };

/**
 * Timeline tab: tasks by due date and milestones by target (or achieved) date, one row per week, so crowded weeks
 * stand out. Runs from the week of the earliest open item (or this week) to the last dated item, at least four weeks.
 */
export function Timeline({ projectId, tasks, milestones, onMilestones }: { projectId: string; tasks: Task[]; milestones: Milestone[]; onMilestones: () => void }) {
  const today = todayStr();
  const items: Item[] = [
    ...tasks.filter((t) => t.due_date).map((t): Item => ({ kind: 'task', date: t.due_date!, open: t.status !== 'done', task: t })),
    ...milestones
      .map((m): Item | null => {
        const date = m.status === 'achieved' ? m.achieved_on : m.target_date;
        return date ? { kind: 'milestone', date, open: m.status === 'planned', m } : null;
      })
      .filter((x): x is Item => x !== null),
  ];
  const undated = tasks.filter((t) => !t.due_date && t.status !== 'done').length;

  if (items.length === 0) {
    return (
      <div className="card-pad muted small" data-testid="timeline">
        No due dates or milestone dates yet. Give tasks a due date to see them here.
      </div>
    );
  }

  const openDates = items.filter((i) => i.open).map((i) => i.date).sort();
  const allDates = items.map((i) => i.date).sort();
  const first = openDates[0] && openDates[0] < today ? openDates[0] : today;
  const start = mondayOf(first);
  const last = allDates[allDates.length - 1] > addDays(today, 27) ? allDates[allDates.length - 1] : addDays(today, 27);
  const weeks: string[] = [];
  for (let w = start; w <= last && weeks.length < MAX_WEEKS; w = addDays(w, 7)) weeks.push(w);
  const end = addDays(weeks[weeks.length - 1], 6);
  const hiddenBefore = items.filter((i) => i.date < start).length;
  const hiddenAfter = items.filter((i) => i.date > end).length;

  const byDate = new Map<string, Item[]>();
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);

  return (
    <div className="timeline-wrap" data-testid="timeline">
      <div className="timeline">
        <div className="tl-row tl-head">
          <div className="tl-label" />
          {WEEKDAYS.map((d) => (
            <div key={d} className="tl-dayname">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((w) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
          const inWeek = days.flatMap((d) => byDate.get(d) ?? []);
          const openCount = inWeek.filter((i) => i.open).length;
          const busy = openCount >= BUSY;
          return (
            <div key={w} className={`tl-row ${busy ? 'busy' : ''}`} data-testid="tl-week">
              <div className="tl-label">
                <div>{toDate(w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
                <div className={`small ${busy ? 'tl-busy' : 'muted'}`}>{inWeek.length === 0 ? '—' : busy ? `${openCount} open · busy` : `${openCount} open`}</div>
              </div>
              {days.map((d) => (
                <div key={d} className={`tl-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
                  <div className="tl-date">{toDate(d).getDate()}</div>
                  {(byDate.get(d) ?? []).map((i) =>
                    i.kind === 'task' ? (
                      <button
                        key={i.task.id}
                        className={`tl-item task ${i.open ? '' : 'done'} ${i.open && d < today ? 'overdue' : ''}`}
                        title={i.task.title}
                        data-testid="tl-task"
                        onClick={() => go({ name: 'project', id: projectId, taskId: i.task.id })}
                      >
                        {i.task.title}
                      </button>
                    ) : (
                      <button key={i.m.id} className={`tl-item milestone ${i.open ? '' : 'done'}`} title={`Milestone: ${i.m.title}`} onClick={onMilestones}>
                        ◆ {i.m.title}
                      </button>
                    ),
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {(undated > 0 || hiddenBefore > 0 || hiddenAfter > 0) && (
        <div className="small muted tl-foot">
          {[
            undated > 0 && `${undated} open task${undated === 1 ? '' : 's'} with no due date`,
            hiddenBefore > 0 && `${hiddenBefore} earlier finished item${hiddenBefore === 1 ? '' : 's'} not shown`,
            hiddenAfter > 0 && `${hiddenAfter} item${hiddenAfter === 1 ? '' : 's'} after ${toDate(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} not shown`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}
