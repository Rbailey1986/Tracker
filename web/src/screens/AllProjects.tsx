import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Overview, type Project, type SearchHit, type Task } from '../api';
import { IdeasBox } from '../components/Ideas';
import { CopyPromptButton, fmtDate, formatMinutes, go, ProgressBar, StatusPill, Swatch, useMutate } from '../ui';

const PALETTE = ['#3451D1', '#5B34A8', '#0B6B78', '#1E6B33', '#9A4508', '#A32117', '#5B616E'];

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const mutate = useMutate();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [description, setDescription] = useState('');
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          const p = await mutate(() => api.post<Project>('/api/projects', { name, area, color, description }));
          if (p) {
            onClose();
            go({ name: 'project', id: p.id });
          }
        }}
      >
        <div className="modal-head">
          <strong>New project</strong>
        </div>
        <div className="modal-body">
          <label>
            <span className="field-label">Name</span>
            <input className="input" style={{ width: '100%' }} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="field-label">Area</span>
            <input className="input" style={{ width: '100%' }} placeholder="Creative, Teaching, Business…" value={area} onChange={(e) => setArea(e.target.value)} />
          </label>
          <div>
            <span className="field-label">Colour</span>
            <div className="row">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  style={{ width: 24, height: 24, borderRadius: 5, background: c, border: color === c ? '3px solid #16181D' : '1px solid #fff', cursor: 'pointer' }}
                />
              ))}
            </div>
          </div>
          <label>
            <span className="field-label">One-line description</span>
            <input className="input" style={{ width: '100%' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}

const HIT_LABEL: Record<SearchHit['type'], string> = {
  project: 'Project',
  task: 'Task',
  subtask: 'Subtask',
  note: 'Note',
  idea: 'Idea',
  milestone: 'Milestone',
};

function openHit(h: SearchHit) {
  if (h.task_id) go({ name: 'project', id: h.project_id!, taskId: h.task_id });
  else if (h.project_id) go({ name: 'project', id: h.project_id });
  else go({ name: 'ideas' });
}

/** Wraps each case-insensitive match of `q` in <mark>. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

function SearchBox() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 150);
    return () => clearTimeout(id);
  }, [text]);
  const { data: hits } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  useEffect(() => setSel(0), [hits]);
  const list = q.length >= 2 ? hits : undefined;
  const pick = (h: SearchHit) => {
    setOpen(false);
    setText('');
    openHit(h);
  };
  return (
    <div className="search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <input
        className="input"
        type="search"
        placeholder="Search tasks, notes, ideas…"
        aria-label="Search"
        style={{ width: 240 }}
        value={text}
        onChange={(e) => (setText(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (setText(''), setOpen(false));
          if (!list?.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((sel + 1) % list.length));
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel((sel - 1 + list.length) % list.length));
          if (e.key === 'Enter') pick(list[sel]);
        }}
      />
      {open && list && (
        <div className="search-results" data-testid="search-results">
          {list.length === 0 ? (
            <div className="card-pad muted small">Nothing matches "{q}".</div>
          ) : (
            list.map((h, i) => (
              <div
                key={h.type + h.id}
                tabIndex={-1}
                className={`search-hit ${i === sel ? 'on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setSel(i)}
              >
                <div className="row" style={{ gap: 6 }}>
                  <span className="tag">{HIT_LABEL[h.type]}</span>
                  <strong className="ellipsis grow">
                    <Highlight text={h.title} q={q} />
                  </strong>
                </div>
                {h.snippet && (
                  <div className="small muted ellipsis">
                    <Highlight text={h.snippet} q={q} />
                  </div>
                )}
                {h.project_name && (
                  <div className="row small muted" style={{ gap: 6 }}>
                    <Swatch color={h.project_color ?? '#999'} size={8} />
                    {h.project_name}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const chips = [];
  if (p.quiet && p.status === 'active') chips.push(<span key="q" className="pill warn" data-testid="quiet-pill">Quiet</span>);
  if (p.blocked_count) chips.push(<span key="b" className="pill blocked">{p.blocked_count} blocked</span>);
  if (p.overdue_count) chips.push(<span key="o" className="pill overdue">{p.overdue_count} overdue</span>);
  if (p.pending_agent_files) chips.push(<span key="a" className="chip agent">{p.pending_agent_files} agent change{p.pending_agent_files === 1 ? '' : 's'}</span>);
  return (
    <div className="card project-card" onClick={() => go({ name: 'project', id: p.id })} data-testid="project-card">
      <div className="row">
        <Swatch color={p.color} size={14} />
        <strong className="ellipsis grow">{p.name}</strong>
        <span className="muted small">{p.area}</span>
      </div>
      <div>
        <div className="row small" style={{ marginBottom: 4 }}>
          <span className="grow muted">
            {p.progress.done} of {p.progress.total} done
          </span>
          <strong>{p.progress.percent}%</strong>
        </div>
        <ProgressBar percent={p.progress.percent} color={p.color} />
      </div>
      <div className="small ellipsis">
        <span className="muted">Next: </span>
        {p.next_task ? (
          <>
            {p.next_task.title} <span className="muted">· {fmtDate(p.next_task.due_date)}</span>
          </>
        ) : (
          <span className="muted">nothing due</span>
        )}
      </div>
      <div className="row small muted ellipsis" style={{ justifyContent: 'space-between' }}>
        <span data-testid="worked-on-date">{p.last_worked_on ? `Worked on ${fmtDate(p.last_worked_on)}` : 'No sessions recorded'}</span>
        {p.time_stats && p.time_stats.logged_minutes > 0 && <span>{formatMinutes(p.time_stats.logged_minutes)} logged</span>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {chips.length ? chips : <span className="pill ok">On track</span>}
        {p.status !== 'active' && <span className="tag">{p.status}</span>}
      </div>
    </div>
  );
}

export function AllProjects() {
  const [status, setStatus] = useState<'active' | 'paused' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview') });
  const { data: due } = useQuery({ queryKey: ['due', 7], queryFn: () => api.get<Task[]>('/api/tasks/due?days=7') });
  if (!o) return <div className="page muted">Loading…</div>;

  const empty = o.projects.length === 0;
  const projects = o.projects.filter((p) => p.status === status);
  const today = new Date(o.today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page">
      <div className="page-header">
        <div className="grow">
          <h1>All projects</h1>
          <div className="muted small">
            {o.counts.active_projects} active · {today}
          </div>
        </div>
        <SearchBox />
        <button className="btn primary" onClick={() => setCreating(true)}>
          New project
        </button>
      </div>

      {empty ? (
        <div className="card empty" data-testid="empty-state">
          <h2>Your tracker is empty</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '0 auto 16px' }}>
            The agent fills it. Copy the prompt, paste it into Claude, and it will write one bootstrap file to the agent folder with your
            projects, tasks and notes. It shows up here within a couple of seconds.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <CopyPromptButton primary />
            <button className="btn" onClick={() => setCreating(true)}>
              Or create a project yourself
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stat" onClick={() => go({ name: 'today' })}>
              <div className="label">Due today</div>
              <div className="value" data-testid="count-due-today">{o.counts.due_today}</div>
            </div>
            <div className={`card stat ${o.counts.overdue ? 'warn' : ''}`} onClick={() => go({ name: 'today' })}>
              <div className="label">Overdue</div>
              <div className="value" data-testid="count-overdue">{o.counts.overdue}</div>
            </div>
            <div className={`card stat ${o.counts.blocked ? 'bad' : ''}`}>
              <div className="label">Blocked</div>
              <div className="value" data-testid="count-blocked">{o.counts.blocked}</div>
            </div>
            <div className={`card stat ${o.counts.pending_agent_files ? 'agent' : ''}`} onClick={() => go({ name: 'inbox' })}>
              <div className="label">Agent changes to review</div>
              <div className="value" data-testid="count-agent">{o.counts.pending_agent_files}</div>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <IdeasBox />
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="section-title grow" style={{ margin: 0 }}>
              Projects
            </h2>
            <div className="seg">
              {(['active', 'paused', 'archived'] as const).map((s) => (
                <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                  {s[0].toUpperCase() + s.slice(1)} ({o.projects.filter((p) => p.status === s).length})
                </button>
              ))}
            </div>
          </div>
          {projects.length === 0 ? (
            <div className="muted card card-pad">No {status} projects.</div>
          ) : (
            <div className="project-grid">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          )}

          <h2 className="section-title" style={{ marginTop: 28 }}>
            Due in the next 7 days
          </h2>
          <div className="card">
            {(due ?? []).length === 0 ? (
              <div className="card-pad muted">Nothing due this week.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Project</th>
                    <th>Owner</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {due!.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => go({ name: 'project', id: t.project_id, taskId: t.id })}>
                      <td>{t.title}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <Swatch color={t.project_color ?? '#999'} size={10} />
                          {t.project_name}
                        </span>
                      </td>
                      <td>
                        <span className={`chip ${t.owner}`}>{t.owner === 'you' ? 'You' : 'Agent'}</span>
                      </td>
                      <td className={t.overdue ? '' : ''} style={t.overdue ? { color: '#9a4508', fontWeight: 500 } : undefined}>
                        {fmtDate(t.due_date)}
                      </td>
                      <td>
                        <StatusPill status={t.blocked && t.status !== 'done' ? 'blocked' : t.status} overdue={t.overdue} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
