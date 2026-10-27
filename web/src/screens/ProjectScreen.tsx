import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type AgentMessage, type Idea, type Note, type Overview, type Project, type Task, type TaskStatus } from '../api';
import { Board } from '../components/Board';
import { Feed } from '../components/Feed';
import { ProjectIdeas } from '../components/Ideas';
import { ProjectMilestones, useMilestones } from '../components/Milestones';
import { PendingInbox } from '../components/Inbox';
import { TaskPopup } from '../components/TaskPopup';
import { Timeline } from '../components/Timeline';
import { BlurInput, fmtDate, formatMinutes, go, Markdown, ProgressBar, Swatch, useMutate, useToast } from '../ui';

/** Copies a ready-made prompt for a new chat: the project folder, next step, open tasks, open questions and recent Log. */
function ResumeChatButton({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['agent-project', projectId],
    queryFn: () => api.get<{ resume_prompt: string }>(`/api/agent/projects/${projectId}`),
  });
  const copy = async () => {
    const prompt = data?.resume_prompt ?? (await api.get<{ resume_prompt: string }>(`/api/agent/projects/${projectId}`)).resume_prompt;
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ text: 'Resume prompt copied. Paste it into a new chat.', kind: 'info' });
    } catch {
      window.prompt('Copy this prompt:', prompt);
    }
  };
  return (
    <button className="btn" onClick={copy}>
      Resume in a new chat
    </button>
  );
}

/** The project's area (category). Type a new one or pick an existing one from the suggestions; saves on leaving the field. */
function AreaPicker({ area, onSave }: { area: string; onSave: (area: string) => unknown }) {
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview') });
  const areas = [...new Set((o?.projects ?? []).map((p) => p.area).filter(Boolean))].sort();
  const [v, setV] = useState(area);
  const cancel = useRef(false);
  useEffect(() => setV(area), [area]);
  const commit = () => {
    const next = v.trim();
    if (!cancel.current && next && next !== area) onSave(next);
    else setV(area);
    cancel.current = false;
  };
  return (
    <>
      <input
        className="inline-input muted"
        list="area-options"
        aria-label="Area"
        placeholder="Area"
        value={v}
        style={{ width: 130 }}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancel.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      <datalist id="area-options">
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </>
  );
}

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'not_started', label: 'Not started' },
  { status: 'done', label: 'Done' },
];

/** A task with an unfinished dependency is shown in the Blocked group. */
const groupOf = (t: Task): TaskStatus => (t.status === 'done' ? 'done' : t.blocked ? 'blocked' : t.status);

type SortKey = 'order' | 'priority' | 'due';
type Sort = { key: SortKey; dir: 1 | -1 };
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 } as const;
const SORT_STORE = 'tracker.taskSort';

/** Sorts within a status group. Tasks with no priority or due date always go last; ties keep the saved order. */
function sortTasks(rows: Task[], sort: Sort): Task[] {
  if (sort.key === 'order') return rows;
  const value = (t: Task) => (sort.key === 'priority' ? (t.priority ? PRIORITY_RANK[t.priority] : null) : t.due_date);
  return rows
    .map((t, i) => ({ t, i, v: value(t) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      return a.v === b.v ? a.i - b.i : (a.v < b.v ? -1 : 1) * sort.dir;
    })
    .map((x) => x.t);
}

function useTaskSort(): [Sort, (key: SortKey) => void] {
  const [sort, setSort] = useState<Sort>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORE) ?? 'null');
      if (saved && ['order', 'priority', 'due'].includes(saved.key) && (saved.dir === 1 || saved.dir === -1)) return saved;
    } catch {
      /* storage blocked or bad value: use the default */
    }
    return { key: 'order', dir: 1 };
  });
  // Clicking a header: first click sorts the useful way round (priority high first, due soonest first),
  // the second flips it, the third goes back to the saved order.
  const toggle = (key: SortKey) => {
    const first: Sort['dir'] = key === 'priority' ? -1 : 1;
    const next: Sort = sort.key !== key ? { key, dir: first } : sort.dir === first ? { key, dir: -first as Sort['dir'] } : { key: 'order', dir: 1 };
    setSort(next);
    try {
      localStorage.setItem(SORT_STORE, JSON.stringify(next));
    } catch {
      /* not remembered, still sorted */
    }
  };
  return [sort, toggle];
}

function SortHeader({ label, k, sort, onSort }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void }) {
  const on = sort.key === k;
  const arrow = !on ? '↕' : k === 'priority' ? (sort.dir === -1 ? '↓' : '↑') : sort.dir === 1 ? '↓' : '↑';
  const hint = k === 'priority' ? (on && sort.dir === -1 ? 'low first' : on ? 'saved order' : 'high first') : on && sort.dir === 1 ? 'latest first' : on ? 'saved order' : 'soonest first';
  return (
    <th aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={`th-sort ${on ? 'on' : ''}`} onClick={() => onSort(k)} title={`Sort by ${label.toLowerCase()}: ${hint}`}>
        {label} <span aria-hidden="true">{arrow}</span>
      </button>
    </th>
  );
}

function ProjectNotes({ projectId }: { projectId: string }) {
  const mutate = useMutate();
  const [editing, setEditing] = useState(false);
  const { data } = useQuery({ queryKey: ['note', 'project', projectId], queryFn: () => api.get<{ note: Note | null }>(`/api/notes/project/${projectId}`) });
  const note = data?.note;
  return (
    <div className="card card-pad">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 className="grow" style={{ margin: 0 }}>
          Notes
        </h2>
        <button className="btn small ghost" onClick={() => setEditing((x) => !x)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing ? (
        <BlurInput
          multiline
          rows={10}
          value={note?.body_md ?? ''}
          version={note?.version}
          aria-label="Project notes"
          onSave={(body_md, version) => mutate(() => api.put(`/api/notes/project/${projectId}`, { body_md, version: version ?? null }))}
        />
      ) : note?.body_md ? (
        <Markdown source={note.body_md} />
      ) : (
        <div className="muted small">No notes yet.</div>
      )}
    </div>
  );
}

function NewTaskRow({ projectId, onCreated }: { projectId: string; onCreated: (t: Task) => void }) {
  const mutate = useMutate();
  const [title, setTitle] = useState('');
  return (
    <form
      className="row"
      style={{ padding: 12, borderBottom: '1px solid var(--border)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const t = await mutate(() => api.post<Task>('/api/tasks', { project_id: projectId, title }));
        if (t) {
          setTitle('');
          onCreated(t);
        }
      }}
    >
      <input className="input grow" autoFocus placeholder="New task title, then Enter" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task title" />
      <button className="btn primary" type="submit" disabled={!title.trim()}>
        Add task
      </button>
    </form>
  );
}

export function ProjectScreen({ id, taskId }: { id: string; taskId?: string }) {
  const mutate = useMutate();
  const [owner, setOwner] = useState<'' | 'you' | 'agent'>('');
  const [sort, setSortKey] = useTaskSort();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'list' | 'on_hold' | 'board' | 'timeline' | 'ideas' | 'milestones' | 'activity'>('list');
  const { data: p, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Project>(`/api/projects/${id}`) });
  const { data: ideas } = useQuery({ queryKey: ['ideas', 'project', id], queryFn: () => api.get<Idea[]>(`/api/ideas?project=${id}`) });
  const openIdeas = (ideas ?? []).filter((i) => i.status === 'new').length;
  const { data: handoffs } = useQuery({
    queryKey: ['messages', 'do_next', id],
    queryFn: () => api.get<AgentMessage[]>(`/api/messages?project=${id}&kind=do_next&status=open`),
  });
  const { data: milestones } = useMilestones(id);
  const sent = new Set((handoffs ?? []).map((m) => m.parent_id));
  const { data: tasks } = useQuery({
    queryKey: ['tasks', id, owner],
    queryFn: () => api.get<Task[]>(`/api/projects/${id}/tasks${owner ? `?owner=${owner}` : ''}`),
  });
  const onHoldTasks = (tasks ?? []).filter((t) => t.status === 'on_hold');

  if (error) return <div className="page">This project doesn't exist any more. <a href="#/projects">Back to all projects</a></div>;
  if (!p) return <div className="page muted">Loading…</div>;
  const save = (fields: Partial<Project>, version = p.version) => mutate(() => api.patch(`/api/projects/${p.id}`, { version, ...fields }));
  const saveTask = (t: Task, fields: Partial<Task>) => mutate(() => api.patch(`/api/tasks/${t.id}`, { version: t.version, ...fields }));

  return (
    <div className="page">
      <a href="#/projects" className="small">
        ← All projects
      </a>
      <div className="page-header" style={{ marginTop: 8, alignItems: 'flex-start' }}>
        <Swatch color={p.color} size={22} />
        <div className="grow">
          <div className="row">
            <h1>{p.name}</h1>
            <AreaPicker area={p.area} onSave={(area) => save({ area })} />
            <select className="select small" value={p.status} aria-label="Project status" onChange={(e) => save({ status: e.target.value as Project['status'] })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <BlurInput
            className="inline-input muted"
            value={p.description}
            version={p.version}
            placeholder="One-line description"
            onSave={(description, v) => save({ description }, v)}
            aria-label="Project description"
          />
          <div className="row wrap" style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
            <span className="small muted">Folder:</span>
            <BlurInput
              className="inline-input mono small grow"
              value={p.folder ?? ''}
              version={p.version}
              placeholder="Full path, e.g. C:\Users\rober\Desktop\MyProject"
              onSave={(folder, v) => save({ folder: folder.trim() || null }, v)}
              aria-label="Project folder"
            />
            {p.folder && (
              <button
                className="btn ghost small"
                title={`Open ${p.folder} in File Explorer`}
                onClick={() => mutate(() => api.post(`/api/projects/${p.id}/open-folder`))}
              >
                Open folder
              </button>
            )}
          </div>
        </div>
        <ResumeChatButton projectId={p.id} />
        <button
          className="btn primary"
          onClick={() => {
            setView('list');
            setAdding(true);
          }}
        >
          New task
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row small" style={{ marginBottom: 6, gap: 16 }}>
          <strong data-testid="project-progress">{p.progress.percent}%</strong>
          <span className="muted">
            {p.progress.done} of {p.progress.total} tasks done
          </span>
          {p.last_worked_on && <span className="muted">· Worked on {fmtDate(p.last_worked_on)}</span>}
          <span className="grow" />
          {p.quiet && <span className="pill quiet">Quiet</span>}
          {p.blocked_count > 0 && <span className="pill blocked">{p.blocked_count} blocked</span>}
          {p.overdue_count > 0 && <span className="pill overdue">{p.overdue_count} overdue</span>}
        </div>
        <ProgressBar percent={p.progress.percent} color={p.color} />
        {p.time_stats && (p.time_stats.logged_minutes > 0 || p.time_stats.total_estimate_minutes > 0) && (
          <div className="row small wrap" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', gap: 12 }} data-testid="project-time-stats">
            <span>
              <strong>{formatMinutes(p.time_stats.logged_minutes)}</strong> logged
              {p.time_stats.session_count > 0 && <span className="muted"> ({p.time_stats.session_count} {p.time_stats.session_count === 1 ? 'session' : 'sessions'})</span>}
            </span>
            <span className="muted">·</span>
            <span>
              <strong>{formatMinutes(p.time_stats.total_estimate_minutes)}</strong> estimated
            </span>
            {p.time_stats.total_estimate_minutes > 0 && (
              <>
                <span className="muted">·</span>
                {p.time_stats.diff_minutes > 0 ? (
                  <span className="pill overdue">+{formatMinutes(p.time_stats.diff_minutes)} over</span>
                ) : p.time_stats.diff_minutes < 0 ? (
                  <span className="pill done">{formatMinutes(Math.abs(p.time_stats.diff_minutes))} under</span>
                ) : (
                  <span className="pill in_progress">On track</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="project-layout">
        <div className="card">
          <div className="tabs">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              List
            </button>
            <button className={view === 'on_hold' ? 'on' : ''} onClick={() => setView('on_hold')}>
              On hold{onHoldTasks.length > 0 && <span className="muted"> {onHoldTasks.length}</span>}
            </button>
            <button className={view === 'ideas' ? 'on' : ''} onClick={() => setView('ideas')}>
              Ideas{openIdeas > 0 && <span className="muted"> {openIdeas}</span>}
            </button>
            <button className={view === 'milestones' ? 'on' : ''} onClick={() => setView('milestones')}>
              Milestones{(milestones ?? []).length > 0 && <span className="muted"> {(milestones ?? []).length}</span>}
            </button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
              Board
            </button>
            <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>
              Timeline
            </button>
            <button className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>
              Activity
            </button>
            <span className="grow" />
            {(view === 'list' || view === 'on_hold' || view === 'board' || view === 'timeline') && (
              <div className="seg" style={{ margin: '5px 0' }}>
                {(['', 'you', 'agent'] as const).map((o) => (
                  <button key={o} className={owner === o ? 'on' : ''} onClick={() => setOwner(o)}>
                    {o === '' ? 'All' : o === 'you' ? 'You' : 'Agent'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {view === 'ideas' && <ProjectIdeas projectId={p.id} />}
          {view === 'milestones' && <ProjectMilestones projectId={p.id} />}
          {view === 'board' && <Board projectId={p.id} tasks={tasks ?? []} sent={sent} />}
          {view === 'timeline' && <Timeline projectId={p.id} tasks={tasks ?? []} milestones={milestones ?? []} onMilestones={() => setView('milestones')} />}
          {view === 'activity' && (
            <div className="card-pad">
              <Feed project={p.id} limit={50} />
            </div>
          )}
          {view === 'on_hold' && (
            <table className="table" data-testid="on-hold-table">
              <thead>
                <tr>
                  <th style={{ width: '52%' }}>Task</th>
                  <th>Owner</th>
                  <SortHeader label="Due" k="due" sort={sort} onSort={setSortKey} />
                  <SortHeader label="Priority" k="priority" sort={sort} onSort={setSortKey} />
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortTasks(onHoldTasks, sort).map((t) => (
                  <tr key={t.id} className="clickable" data-testid="on-hold-task-row" onClick={() => go({ name: 'project', id: p.id, taskId: t.id })}>
                    <td>
                      <div className="row">
                        <span>{t.title}</span>
                        {t.estimate_minutes ? (
                          <span className="muted small" title={`Estimate: ${formatMinutes(t.estimate_minutes)}`}>
                            ~{formatMinutes(t.estimate_minutes)}
                          </span>
                        ) : null}
                        {t.subtasks.length > 0 && (
                          <span className="muted small">
                            {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                          </span>
                        )}
                        <span className="pill on_hold">On hold</span>
                      </div>
                    </td>
                    <td>
                      <span className={`chip ${t.owner}`}>{t.owner === 'you' ? 'You' : 'Agent'}</span>
                    </td>
                    <td>{t.due_date ? fmtDate(t.due_date) : <span className="muted">—</span>}</td>
                    <td>{t.priority ? <span className={`prio ${t.priority}`}>{t.priority[0].toUpperCase() + t.priority.slice(1)}</span> : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn small"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveTask(t, { status: 'not_started' });
                        }}
                        title="Resume task to active list"
                      >
                        Resume
                      </button>
                    </td>
                  </tr>
                ))}
                {onHoldTasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ padding: '24px 12px' }}>
                      No tasks on hold. Open any task and click <strong>Put on hold</strong> to move it here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {view === 'list' && adding && <NewTaskRow projectId={p.id} onCreated={() => setAdding(false)} />}
          {view === 'list' && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '52%' }}>Task</th>
                  <th>Owner</th>
                  <SortHeader label="Due" k="due" sort={sort} onSort={setSortKey} />
                  <SortHeader label="Priority" k="priority" sort={sort} onSort={setSortKey} />
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => {
                  const rows = sortTasks((tasks ?? []).filter((t) => groupOf(t) === g.status), sort);
                  if (rows.length === 0) return null;
                  return [
                    <tr key={g.status} className="group-head">
                      <td colSpan={4}>
                        {g.label} <span className="muted">{rows.length}</span>
                      </td>
                    </tr>,
                    ...rows.map((t) => (
                      <tr key={t.id} className="clickable" data-testid="task-row" onClick={() => go({ name: 'project', id: p.id, taskId: t.id })}>
                        <td>
                          <div className="row">
                            <span style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--text-2)' } : undefined}>{t.title}</span>
                            {t.estimate_minutes ? (
                              <span className="muted small" title={`Estimate: ${formatMinutes(t.estimate_minutes)}`}>
                                ~{formatMinutes(t.estimate_minutes)}
                              </span>
                            ) : null}
                            {t.subtasks.length > 0 && (
                              <span className="muted small">
                                {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                              </span>
                            )}
                            {sent.has(t.id) && <span className="chip sent-chip">Sent to agent</span>}
                          </div>
                          {g.status === 'blocked' && (
                            <div className="small" style={{ color: '#a32117' }}>
                              {t.blocked_reason ||
                                (t.depends_on_tasks.filter((d) => d.status !== 'done').length
                                  ? `Waiting on ${t.depends_on_tasks
                                      .filter((d) => d.status !== 'done')
                                      .map((d) => d.title)
                                      .join(', ')}`
                                  : '')}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`chip ${t.owner}`}>{t.owner === 'you' ? 'You' : 'Agent'}</span>
                        </td>
                        <td>{t.due_date ? t.overdue ? <span className="pill overdue">{fmtDate(t.due_date)}</span> : fmtDate(t.due_date) : <span className="muted">—</span>}</td>
                        <td>{t.priority ? <span className={`prio ${t.priority}`}>{t.priority[0].toUpperCase() + t.priority.slice(1)}</span> : <span className="muted">—</span>}</td>
                      </tr>
                    )),
                  ];
                })}
                {tasks && tasks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No tasks{owner ? ' for this owner' : ''} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="side-stack">
          <div className="card card-pad">
            <h2>Agent inbox</h2>
            <PendingInbox project={p.id} />
          </div>
          <ProjectNotes projectId={p.id} />
        </div>
      </div>

      {taskId && <TaskPopup taskId={taskId} onClose={() => go({ name: 'project', id: p.id })} />}
    </div>
  );
}
