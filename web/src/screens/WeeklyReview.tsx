import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type WeeklyQuestion, type WeeklyReviewData } from '../api';
import { TaskPopup } from '../components/TaskPopup';
import { fmtDate, fmtRelative, formatMinutes, go, Swatch, useMutate, useToast } from '../ui';

function AnswerQuestionRow({ q, onAnswered }: { q: WeeklyQuestion; onAnswered: () => void }) {
  const mutate = useMutate();
  const toast = useToast();
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) return;
    const res = await mutate(() => api.post(`/api/questions/${q.id}/answer`, { answer: answer.trim() }));
    if (res) {
      toast({ text: 'Answer sent to the agent folder', kind: 'info' });
      setAnswering(false);
      onAnswered();
    }
  };

  return (
    <li className="weekly-question-item" data-testid="weekly-question">
      <div className="row wrap" style={{ marginBottom: 4, gap: 6 }}>
        {q.project_name && <span className="chip import">{q.project_name}</span>}
        {q.task_title && <span className="small muted">on {q.task_title}</span>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {fmtRelative(q.created_at)}
        </span>
      </div>
      <div className="weekly-q-text">{q.text}</div>
      {answering ? (
        <form onSubmit={submit} className="row wrap" style={{ marginTop: 8, gap: 8 }}>
          <input
            className="input grow"
            autoFocus
            placeholder="Type your answer…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button type="submit" className="btn primary small" disabled={!answer.trim()}>
            Send answer
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAnswering(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small" onClick={() => setAnswering(true)}>
            Answer here
          </button>
          <button className="btn small ghost" onClick={() => go({ name: 'inbox' })}>
            View in Agent inbox →
          </button>
        </div>
      )}
    </li>
  );
}

export function WeeklyReviewScreen() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ['weekly'],
    queryFn: () => api.get<WeeklyReviewData>('/api/weekly'),
  });

  if (!data) return <div className="page muted">Loading weekly review…</div>;

  const m = data.metrics;
  const weekLabel = `${fmtDate(data.week_start)} – ${fmtDate(data.week_end)}`;

  return (
    <div className="page weekly-page">
      <div className="page-header">
        <div className="grow">
          <h1>Weekly review</h1>
          <div className="muted small">
            {weekLabel} · Today is {fmtDate(data.today)}
          </div>
        </div>
      </div>

      <div className="stat-grid weekly-stat-grid">
        <div className={`card stat ${m.done_count ? 'good' : ''}`} data-testid="stat-done">
          <div className="label">Done this week</div>
          <div className="value">{m.done_count}</div>
          {m.total_done_estimates_this_week > 0 && (
            <div className="small muted">{formatMinutes(m.total_done_estimates_this_week)} est</div>
          )}
        </div>
        <div className={`card stat ${m.slipped_count ? 'bad' : ''}`} data-testid="stat-slipped">
          <div className="label">Slipped due dates</div>
          <div className="value">{m.slipped_count}</div>
          <div className="small muted">due on or before today</div>
        </div>
        <div className={`card stat ${m.quiet_count ? 'warn' : ''}`} data-testid="stat-quiet">
          <div className="label">Quiet projects</div>
          <div className="value">{m.quiet_count}</div>
          <div className="small muted">no session in 7+ days</div>
        </div>
        <div className={`card stat ${m.questions_count ? 'agent' : ''}`} data-testid="stat-questions">
          <div className="label">Open questions</div>
          <div className="value">{m.questions_count}</div>
          <div className="small muted">waiting for reply</div>
        </div>
      </div>

      {m.total_logged_minutes_this_week > 0 && (
        <div className="card card-pad weekly-banner" style={{ marginBottom: 20 }}>
          <div className="row">
            <span>⏱️</span>
            <span>
              <strong>{formatMinutes(m.total_logged_minutes_this_week)}</strong> logged across project notes this week
            </span>
          </div>
        </div>
      )}

      <div className="weekly-sections">
        {/* Slipped due dates */}
        <section className="card card-pad weekly-card" data-testid="section-slipped">
          <h2>
            Slipped due dates <span className="today-count">{data.slipped_tasks.length}</span>
          </h2>
          {data.slipped_tasks.length === 0 ? (
            <div className="muted small">No overdue or slipped tasks. Everything is on schedule!</div>
          ) : (
            <ul className="weekly-list">
              {data.slipped_tasks.map((t) => (
                <li
                  key={t.id}
                  className="weekly-list-item clickable"
                  onClick={() => setOpenTaskId(t.id)}
                  data-testid="slipped-item"
                >
                  <Swatch color={t.project_color} size={10} />
                  <div className="grow">
                    <div className="row">
                      <strong>{t.title}</strong>
                      <span className="muted small">{t.project_name}</span>
                    </div>
                    {t.blocked && (
                      <div className="small" style={{ color: 'var(--danger)' }}>
                        Blocked: {t.blocked_reason || 'Waiting on dependencies'}
                      </div>
                    )}
                  </div>
                  <span className="pill overdue">{fmtDate(t.due_date)}</span>
                  {t.priority && <span className={`prio ${t.priority}`}>{t.priority}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Quiet projects */}
        <section className="card card-pad weekly-card" data-testid="section-quiet">
          <h2>
            Quiet projects <span className="today-count">{data.quiet_projects.length}</span>
          </h2>
          {data.quiet_projects.length === 0 ? (
            <div className="muted small">All active projects have recent sessions.</div>
          ) : (
            <div className="quiet-projects-grid">
              {data.quiet_projects.map((p) => (
                <div key={p.id} className="card card-pad quiet-project-card" data-testid="quiet-project-card">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <Swatch color={p.color} size={12} />
                    <strong className="grow ellipsis">{p.name}</strong>
                    <span className="pill warn small">
                      {p.days_ago !== null ? `${p.days_ago}d quiet` : 'No sessions'}
                    </span>
                  </div>
                  <div className="small muted" style={{ marginBottom: 8 }}>
                    {p.last_worked_on ? `Last worked on: ${fmtDate(p.last_worked_on)}` : 'Never worked on in log'}
                    {' · '}
                    {p.open_tasks_count} open task{p.open_tasks_count === 1 ? '' : 's'}
                  </div>
                  {p.next_step && (
                    <div className="small ellipsis" style={{ marginBottom: 10 }}>
                      <span className="muted">Next: </span>
                      {p.next_step.title}
                    </div>
                  )}
                  <button className="btn small" onClick={() => go({ name: 'project', id: p.id })}>
                    Open project →
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Completed this week */}
        <section className="card card-pad weekly-card" data-testid="section-completed">
          <h2>
            Completed this week <span className="today-count">{data.completed_this_week.length}</span>
          </h2>
          {data.completed_this_week.length === 0 ? (
            <div className="muted small">No tasks completed yet this week.</div>
          ) : (
            <ul className="weekly-list">
              {data.completed_this_week.map((t) => (
                <li key={t.id} className="weekly-list-item clickable" onClick={() => setOpenTaskId(t.id)}>
                  <span className="pill dn">✓</span>
                  <Swatch color={t.project_color} size={10} />
                  <div className="grow">
                    <span style={{ textDecoration: 'line-through', color: 'var(--text-2)' }}>{t.title}</span>
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {t.project_name}
                    </span>
                  </div>
                  {t.estimate_minutes && <span className="chip">{formatMinutes(t.estimate_minutes)}</span>}
                  <span className="small muted">{fmtRelative(t.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Unanswered questions */}
        {data.unanswered_questions.length > 0 && (
          <section className="card card-pad weekly-card" data-testid="section-questions">
            <h2>
              Unanswered questions from the agent <span className="today-count">{data.unanswered_questions.length}</span>
            </h2>
            <ul className="weekly-questions-list">
              {data.unanswered_questions.map((q) => (
                <AnswerQuestionRow key={q.id} q={q} onAnswered={() => refetch()} />
              ))}
            </ul>
          </section>
        )}
      </div>

      {openTaskId && <TaskPopup taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}
