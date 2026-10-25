import { useQuery } from '@tanstack/react-query';
import { api, type Task } from '../api';
import { fmtDate, go, ProgressBar, StatusPill, Swatch } from '../ui';

interface AreaProject {
  id: string;
  name: string;
  color: string;
  status: 'active' | 'paused' | 'archived';
  progress: { done: number; total: number; percent: number };
  next_step: Task | null;
}

interface AreaView {
  area: string;
  progress: { done: number; total: number; percent: number };
  projects: AreaProject[];
  overdue: Task[];
  blocked: Task[];
  log: { project_id: string; project_name: string; color: string; line: string }[];
}

/** One area: combined progress, each project's next step, what's overdue or blocked, and the latest Log lines. */
export function AreaScreen({ area }: { area: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['area', area],
    queryFn: () => api.get<AreaView>(`/api/areas/${encodeURIComponent(area)}`),
  });

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error || !data) {
    return (
      <div className="page-header">
        <h1>{area}</h1>
        <span className="muted">No active projects in this area.</span>
      </div>
    );
  }

  const openTask = (t: Task) => go({ name: 'project', id: t.project_id, taskId: t.id });

  return (
    <div>
      <header className="page-header" style={{ alignItems: 'baseline' }}>
        <h1>{data.area}</h1>
        <span className="muted">
          {data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'} · {data.progress.done} of{' '}
          {data.progress.total} tasks done ({data.progress.percent}%)
        </span>
      </header>

      <ProgressBar percent={data.progress.percent} color="var(--accent, #3451D1)" />

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2>Projects</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.projects.map((p) => (
            <li key={p.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 8 }}>
                <Swatch color={p.color} size={10} />
                <button className="link" onClick={() => go({ name: 'project', id: p.id })}>
                  {p.name}
                </button>
                {p.status === 'paused' && <span className="count">paused</span>}
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  {p.progress.done}/{p.progress.total}
                </span>
              </div>
              <ProgressBar percent={p.progress.percent} color={p.color} />
              {p.next_step ? (
                <button className="link small" onClick={() => openTask(p.next_step!)}>
                  Next: {p.next_step.title}
                </button>
              ) : (
                p.status === 'active' && <span className="muted small">No next step</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 16 }}>
        <section className="card card-pad">
          <h2>Overdue</h2>
          {data.overdue.length === 0 ? (
            <p className="muted small">Nothing overdue.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.overdue.map((t) => (
                <li key={t.id} className="row" style={{ gap: 8, padding: '4px 0' }}>
                  <button className="link" onClick={() => openTask(t)}>
                    {t.title}
                  </button>
                  <span className="muted small">{t.project_name}</span>
                  <span className="muted small" style={{ marginLeft: 'auto' }}>
                    due {fmtDate(t.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <h2>Blocked</h2>
          {data.blocked.length === 0 ? (
            <p className="muted small">Nothing blocked.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.blocked.map((t) => (
                <li key={t.id} style={{ padding: '4px 0' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="link" onClick={() => openTask(t)}>
                      {t.title}
                    </button>
                    <StatusPill status={t.status} />
                  </div>
                  {t.blocked_reason && <div className="muted small">{t.blocked_reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2>Recent work</h2>
        {data.log.length === 0 ? (
          <p className="muted small">No Log lines yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.log.map((l, i) => (
              <li key={i} className="row" style={{ gap: 8, padding: '3px 0' }}>
                <Swatch color={l.color} size={8} />
                <span className="muted small" style={{ minWidth: 110 }}>
                  {l.project_name}
                </span>
                <span className="small">{l.line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
