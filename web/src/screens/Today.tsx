import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Handoff, type Overview, type Question, type Task, type TodayData } from '../api';
import { QuestionCard } from '../components/Inbox';
import { TaskPopup } from '../components/TaskPopup';
import { fmtDate, fmtRelative, go, ProgressBar, StatusPill, Swatch, useMutate, useToast } from '../ui';

type Why = 'overdue' | 'today' | 'next';
type FocusItem = { task: Task; why: Why[] };
type Filter = 'all' | Why;

const WHY_LABEL: Record<Why, string> = { overdue: 'Overdue', today: 'Due today', next: 'Next step' };

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Overdue, due today and each project's next step, as one list with no task twice. */
function focusList(d: TodayData): FocusItem[] {
  const items = new Map<string, FocusItem>();
  const add = (t: Task, why: Why) => {
    const it = items.get(t.id);
    if (it) it.why.push(why);
    else items.set(t.id, { task: t, why: [why] });
  };
  d.overdue.forEach((t) => add(t, 'overdue'));
  d.due_today.forEach((t) => add(t, 'today'));
  d.next_steps.forEach((n) => n.task && n.task.status !== 'done' && add(n.task, 'next'));
  return [...items.values()];
}

function Card({ title, count, action, children, tone, id }: { title: string; count?: number; action?: ReactNode; children: ReactNode; tone?: string; id?: string }) {
  return (
    <section className={`card today-card ${tone ?? ''}`} id={id}>
      <header className="today-card-head">
        <h2>
          {title}
          {count !== undefined && <span className="today-count">{count}</span>}
        </h2>
        {action}
      </header>
      <div className="today-card-body">{children}</div>
    </section>
  );
}

function Check({ done, label, onToggle }: { done: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`today-check ${done ? 'on' : ''}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </button>
  );
}

function FocusRow({ item, onOpen, sentToAgent }: { item: FocusItem; onOpen: () => void; sentToAgent: boolean }) {
  const { task: t, why } = item;
  const mutate = useMutate();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const complete = async () => {
    setLeaving(true);
    const r = await mutate(() => api.post<Task>(`/api/tasks/${t.id}/complete`, { version: t.version }));
    if (!r) return setLeaving(false);
    toast({ text: `Done: ${t.title}`, kind: 'info', action: { label: 'Undo', run: () => mutate(() => api.post(`/api/tasks/${t.id}/reopen`, { version: r.version })) } });
  };
  return (
    <li className={`focus-row ${leaving ? 'leaving' : ''}`} onClick={onOpen} data-testid="focus-row">
      <Check done={leaving} label="Mark complete" onToggle={complete} />
      <div className="grow">
        <div className="focus-title ellipsis">{t.title}</div>
        <div className="focus-meta">
          <Swatch color={t.project_color ?? '#999'} size={8} />
          <span className="ellipsis">{t.project_name}</span>
          {why.map((w) => (
            <span key={w} className={`why why-${w}`}>
              {w === 'overdue' ? `Overdue · ${fmtDate(t.due_date)}` : WHY_LABEL[w]}
            </span>
          ))}
          {t.owner === 'agent' && <span className="chip agent">Agent</span>}
          {sentToAgent && <span className="chip agent">Sent to agent</span>}
        </div>
      </div>
      <div className="focus-actions" onClick={(e) => e.stopPropagation()}>
        {t.status === 'not_started' && !t.blocked && (
          <button className="btn small" onClick={() => mutate(() => api.patch(`/api/tasks/${t.id}`, { version: t.version, status: 'in_progress' }))}>
            Start
          </button>
        )}
        {t.owner === 'you' && !sentToAgent && (
          <button
            className="btn small ghost"
            title="Hand this task to the agent as the next thing to do"
            onClick={() =>
              mutate(() => api.post('/api/messages', { parent_type: 'task', parent_id: t.id, kind: 'do_next', text: '' }), {
                success: 'Sent to the agent. It picks it up on its next sync.',
              })
            }
          >
            → Agent
          </button>
        )}
      </div>
      <StatusPill status={t.blocked ? 'blocked' : t.status} />
    </li>
  );
}

function HandoffRow({ h, onOpen }: { h: Handoff; onOpen: () => void }) {
  const open = h.status === 'open';
  return (
    <li className="mini-row" onClick={onOpen}>
      <span className={`dot ${open ? 'pulse' : 'ok'}`} />
      <div className="grow">
        <div className="ellipsis">{h.task_title}</div>
        <div className="small muted ellipsis">{open ? `Waiting · sent ${fmtRelative(h.sent_at)}` : h.reply ?? `Done ${fmtRelative(h.handled_at)}`}</div>
      </div>
    </li>
  );
}

/** Shows the first `n` items with a "Show all" toggle, so each card stays short. */
function Clamp<T>({ items, n, render }: { items: T[]; n: number; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, n);
  return (
    <>
      <ul className="mini-list">{shown.map(render)}</ul>
      {items.length > n && (
        <button className="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

export function TodayPage() {
  const mutate = useMutate();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: d } = useQuery({ queryKey: ['today'], queryFn: () => api.get<TodayData>('/api/today') });
  const { data: questions } = useQuery({ queryKey: ['questions', 'open', ''], queryFn: () => api.get<Question[]>('/api/questions?status=open') });
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview') });
  const focus = useMemo(() => (d ? focusList(d) : []), [d]);
  // An empty tracker has nothing for today; All projects has the first-run setup (Copy agent prompt).
  const empty = o?.projects.length === 0;
  useEffect(() => {
    if (empty) go({ name: 'projects' });
  }, [empty]);
  if (!d) return <div className="page muted">Loading…</div>;

  const sent = new Set(d.with_agent.filter((h) => h.status === 'open').map((h) => h.task_id));
  const shown = filter === 'all' ? focus : focus.filter((f) => f.why.includes(filter));
  const qs = questions ?? [];
  const waiting = qs.length + d.pending_files;
  const doneCount = d.done_today.length;
  const planned = doneCount + focus.length;
  const dateLabel = new Date(d.today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const tiles: { key: string; label: string; value: number; tone: string; onClick: () => void; on?: boolean }[] = [
    { key: 'overdue', label: 'Overdue', value: d.overdue.length, tone: d.overdue.length ? 'warn' : '', onClick: () => setFilter(filter === 'overdue' ? 'all' : 'overdue'), on: filter === 'overdue' },
    { key: 'today', label: 'Due today', value: d.due_today.length, tone: '', onClick: () => setFilter(filter === 'today' ? 'all' : 'today'), on: filter === 'today' },
    { key: 'waiting', label: 'Waiting for you', value: waiting, tone: waiting ? 'agent' : '', onClick: () => scrollTo('today-waiting') },
    { key: 'blocked', label: 'Blocked', value: d.blocked.length, tone: d.blocked.length ? 'bad' : '', onClick: () => scrollTo('today-blocked') },
    { key: 'done', label: 'Done today', value: doneCount, tone: doneCount ? 'good' : '', onClick: () => scrollTo('today-done') },
  ];

  return (
    <div className="page today">
      <div className="today-hero">
        <div className="grow">
          <h1>{greeting()}</h1>
          <div className="muted">
            {dateLabel} ·{' '}
            {focus.length === 0 ? 'nothing pressing today' : `${focus.length} thing${focus.length === 1 ? '' : 's'} to focus on`}
          </div>
        </div>
        <div className="today-ring" title={`${doneCount} of ${planned} done today`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" className="track" />
            <circle cx="18" cy="18" r="15.5" className="fill" strokeDasharray={`${planned ? (doneCount / planned) * 97.4 : 0} 97.4`} />
          </svg>
          <div>
            <strong>{doneCount}</strong>
            <span>/{planned}</span>
          </div>
        </div>
      </div>

      <div className="today-tiles">
        {tiles.map((t) => (
          <button key={t.key} className={`card stat today-tile ${t.tone} ${t.on ? 'on' : ''}`} onClick={t.onClick} data-testid={`tile-${t.key}`}>
            <div className="label">{t.label}</div>
            <div className="value">{t.value}</div>
          </button>
        ))}
      </div>

      <div className="today-grid">
        <div className="today-main">
          <Card
            title="Focus"
            count={shown.length}
            action={
              <div className="seg small-seg">
                {(['all', 'overdue', 'today', 'next'] as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'All' : WHY_LABEL[f]}
                  </button>
                ))}
              </div>
            }
          >
            {shown.length === 0 ? (
              <div className="today-empty">
                <div className="today-empty-mark">✓</div>
                {filter === 'all' ? 'Nothing overdue, due or set as a next step. A good day to pick something new.' : `Nothing ${WHY_LABEL[filter as Why].toLowerCase()}.`}
              </div>
            ) : (
              <ul className="focus-list">
                {shown.map((item) => (
                  <FocusRow key={item.task.id} item={item} sentToAgent={sent.has(item.task.id)} onOpen={() => setOpenId(item.task.id)} />
                ))}
              </ul>
            )}
          </Card>

          <WeekStrip d={d} onOpen={setOpenId} />
          <h2 className="section-title today-sub">Projects</h2>
          <div className="today-projects">
            {d.next_steps.map(({ project: p, task }) => (
              <div key={p.id} className="card today-project" onClick={() => go({ name: 'project', id: p.id })}>
                <div className="row">
                  <Swatch color={p.color} size={10} />
                  <strong className="ellipsis grow">{p.name}</strong>
                  {p.quiet && <span className="pill warn small" data-testid="quiet-pill">Quiet</span>}
                  <span className="small muted">{p.progress.percent}%</span>
                </div>
                <ProgressBar percent={p.progress.percent} color={p.color} />
                <div className="small ellipsis">
                  {task ? (
                    <>
                      <span className="muted">Next: </span>
                      {task.title}
                    </>
                  ) : (
                    <span className="muted">No next step set</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="today-side">
          {waiting > 0 && (
            <Card title="Waiting for you" count={waiting} tone="agent" id="today-waiting">
              {d.pending_files > 0 && (
                <button className="today-review" onClick={() => go({ name: 'inbox' })}>
                  <span className="grow">
                    {d.pending_files} agent change{d.pending_files === 1 ? '' : 's'} to review
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              )}
              <div className="side-stack">
                {qs.slice(0, 3).map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
                {qs.length > 3 && (
                  <button className="link-btn" onClick={() => go({ name: 'inbox' })}>
                    {qs.length - 3} more question{qs.length - 3 === 1 ? '' : 's'} in the Agent inbox
                  </button>
                )}
              </div>
            </Card>
          )}

          <Card title="With the agent" count={d.with_agent.length} id="today-agent">
            {d.with_agent.length === 0 ? (
              <div className="small muted">Nothing handed over. Use → Agent on a focus task.</div>
            ) : (
              <Clamp items={d.with_agent} n={4} render={(h) => <HandoffRow key={h.message_id} h={h} onOpen={() => setOpenId(h.task_id)} />} />
            )}
          </Card>

          <Card title="Blocked" count={d.blocked.length} id="today-blocked">
            {d.blocked.length === 0 ? (
              <div className="small muted">Nothing blocked.</div>
            ) : (
              <Clamp
                items={d.blocked}
                n={4}
                render={(t) => (
                  <li key={t.id} className="mini-row" onClick={() => setOpenId(t.id)}>
                    <span className="dot bad" />
                    <div className="grow">
                      <div className="ellipsis">{t.title}</div>
                      <div className="small muted ellipsis">{blockedWhy(t)}</div>
                    </div>
                  </li>
                )}
              />
            )}
          </Card>

          <Card title="Done today" count={doneCount} id="today-done" tone={doneCount ? 'good' : ''}>
            {doneCount === 0 ? (
              <div className="small muted">Nothing finished yet. Tick a focus task when it's done.</div>
            ) : (
              <Clamp
                items={d.done_today}
                n={5}
                render={(t) => (
                  <li key={t.id} className="mini-row done" onClick={() => setOpenId(t.id)}>
                    <Check done label="Reopen" onToggle={() => mutate(() => api.post(`/api/tasks/${t.id}/reopen`, { version: t.version }))} />
                    <div className="grow ellipsis">{t.title}</div>
                    <Swatch color={t.project_color ?? '#999'} size={8} />
                  </li>
                )}
              />
            )}
          </Card>
        </aside>
      </div>

      {openId && <TaskPopup taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** The next seven days, today first, with the open tasks due each day, and how many tasks were done since Monday. */
function WeekStrip({ d, onOpen }: { d: TodayData; onOpen: (taskId: string) => void }) {
  const due = d.week.reduce((n, day) => n + day.tasks.length, 0);
  return (
    <Card
      title="This week"
      count={due}
      id="today-week"
      action={
        <span className="small muted" data-testid="done-this-week">
          {d.done_this_week} done since Monday
        </span>
      }
    >
      <div className="week-strip" data-testid="week-strip">
        {d.week.map((day, i) => {
          const date = new Date(day.date + 'T12:00:00');
          return (
            <div key={day.date} className={`week-day ${i === 0 ? 'today' : ''} ${day.tasks.length === 0 ? 'empty' : ''}`} data-testid="week-day">
              <div className="week-day-head">
                <span>{i === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="muted">{date.getDate()}</span>
              </div>
              {day.tasks.length === 0 ? (
                <div className="week-none">—</div>
              ) : (
                <ul className="week-tasks">
                  {day.tasks.slice(0, 3).map((t) => (
                    <li key={t.id} title={`${t.title} · ${t.project_name ?? ''}`} onClick={() => onOpen(t.id)}>
                      <Swatch color={t.project_color ?? '#999'} size={7} />
                      <span className="ellipsis">{t.title}</span>
                    </li>
                  ))}
                  {day.tasks.length > 3 && <li className="week-more muted">+{day.tasks.length - 3} more</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Why a task is blocked: its own reason, else the unfinished tasks it waits on. */
function blockedWhy(t: Task): string {
  if (t.blocked_reason) return t.blocked_reason;
  const waits = t.depends_on_tasks.filter((d) => d.status !== 'done').map((d) => `“${d.title}”`);
  return waits.length ? `Waits on ${waits.join(', ')}` : 'No reason given';
}
