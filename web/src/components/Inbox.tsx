import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AgentFile, type PlanItem, type Preview, type Question } from '../api';
import { fmtDateTime, fmtRelative, fmtValue, useMutate } from '../ui';

const HIDDEN_FIELDS = new Set(['sort_order']);

function ChangeRow({ item, choice, onChoose }: { item: PlanItem; choice: Record<string, 'mine' | 'agent'>; onChoose: (key: string, v: 'mine' | 'agent') => void }) {
  const conflictFields = new Set(item.conflicts.map((c) => c.field));
  const op = item.op;
  const opLabel = op === 'noop' ? 'No change' : op;
  const fields =
    op === 'create'
      ? Object.keys(item.fields)
      : op === 'update'
        ? item.changed_fields
        : op === 'delete'
          ? Object.keys(item.before ?? {}).filter((k) => !['id'].includes(k))
          : [];
  return (
    <div className={`change ${item.conflicts.length ? 'conflict' : ''}`} data-testid="inbox-change">
      <div className="row">
        <span className={`op ${op}`}>{opLabel}</span>
        <span className="muted small">{item.entity}</span>
        <strong className="ellipsis">{item.label || item.id}</strong>
        {item.note && <span className="muted small">· {item.note}</span>}
      </div>
      {fields.length > 0 && (
        <div className="diff">
          {fields
            .filter((f) => !HIDDEN_FIELDS.has(f) && !conflictFields.has(f))
            .map((f) => (
              <DiffRow key={f} k={f}>
                {op === 'update' && <span className="before">{fmtValue(item.before?.[f])}</span>}{' '}
                {op === 'delete' ? <span className="before">{fmtValue(item.before?.[f])}</span> : <span>{fmtValue(item.fields[f])}</span>}
              </DiffRow>
            ))}
        </div>
      )}
      {item.conflicts.map((c) => (
        <div key={c.key} style={{ marginTop: 8 }} data-testid="conflict">
          <div className="small">
            <strong>Conflict on {c.field === '(delete)' ? 'deleting this item' : c.field}</strong>
            <span className="muted"> · you changed it {fmtRelative(c.changed_at)}</span>
          </div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <button className={`btn small ${choice[c.key] === 'mine' ? 'selected' : ''}`} onClick={() => onChoose(c.key, 'mine')}>
              Keep mine: {c.field === '(delete)' ? 'keep it' : fmtValue(c.mine)}
            </button>
            <button className={`btn small ${choice[c.key] === 'agent' ? 'selected' : ''}`} onClick={() => onChoose(c.key, 'agent')}>
              Use agent's: {c.field === '(delete)' ? 'delete it' : fmtValue(c.agent)}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span className="muted">{k.replace(/_/g, ' ')}</span>
      <span>{children}</span>
    </>
  );
}

export function QuestionCard({ q }: { q: Question }) {
  const mutate = useMutate();
  const [answer, setAnswer] = useState('');
  return (
    <div className="change" data-testid="question">
      <div className="small muted">
        Agent asks{q.task_title ? ` about “${q.task_title}”` : q.project_name ? ` about ${q.project_name}` : ''} · {fmtRelative(q.created_at)}
      </div>
      <div style={{ margin: '4px 0 8px' }}>{q.text}</div>
      {q.status === 'answered' ? (
        <div className="small">
          <span className="muted">Your answer: </span>
          {q.answer}
        </div>
      ) : (
        <div className="row">
          <input className="input grow" placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
          <button
            className="btn primary small"
            disabled={!answer.trim()}
            onClick={() => mutate(() => api.post(`/api/questions/${q.id}/answer`, { answer }), { success: 'Answer sent to answers/.' })}
          >
            Send answer
          </button>
        </div>
      )}
    </div>
  );
}

export function FilePanel({ file }: { file: AgentFile }) {
  const mutate = useMutate();
  const { data } = useQuery({ queryKey: ['preview', file.id, file.status], queryFn: () => api.get<Preview>(`/api/inbox/${file.id}/preview`) });
  const [choice, setChoice] = useState<Record<string, 'mine' | 'agent'>>({});
  const conflicts = data?.conflicts ?? [];
  const unresolved = conflicts.filter((c) => !choice[c.key]).length;
  const [showAll, setShowAll] = useState(false);
  const items = data?.items ?? [];
  const shown = showAll ? items : items.slice(0, 25);

  return (
    <div className="card inbox-file" data-testid="inbox-file">
      <div className="row wrap">
        <span className="mono">{file.file_name}</span>
        <span className="muted small">
          {file.change_count} change{file.change_count === 1 ? '' : 's'} · received {fmtDateTime(file.received_at)}
          {file.agent ? ` · from ${file.agent}` : ''}
        </span>
        <span className="grow" />
        {data && (data.valid ? <span className="pill ok">Valid</span> : <span className="pill blocked">Not valid now</span>)}
      </div>
      {file.summary && <div>{file.summary}</div>}
      {data?.error && <div className="error-box">{data.error}</div>}
      {file.error && !data?.error && <div className="error-box">{file.error}</div>}
      {conflicts.length > 0 && (
        <div className="banner">
          {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}: you changed these since the agent read them. Choose which value to keep.
        </div>
      )}
      {data?.has_deletes && conflicts.length === 0 && <div className="banner">This file deletes something, so it waits for you.</div>}
      {shown.map((it) => (
        <ChangeRow key={it.change_id} item={it} choice={choice} onChoose={(k, v) => setChoice((c) => ({ ...c, [k]: v }))} />
      ))}
      {items.length > shown.length && (
        <button className="btn small" onClick={() => setShowAll(true)}>
          Show all {items.length} changes
        </button>
      )}
      {(data?.questions ?? []).map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}
      <div className="row">
        <button
          className="btn primary"
          disabled={!data?.valid || unresolved > 0}
          title={unresolved ? 'Resolve every conflict first' : undefined}
          onClick={() => mutate(() => api.post(`/api/inbox/${file.id}/apply`, { resolutions: choice }), { success: `Applied ${file.file_name}.` })}
        >
          Apply
        </button>
        <button className="btn danger" onClick={() => mutate(() => api.post(`/api/inbox/${file.id}/reject`), { success: 'Moved to rejected/.' })}>
          Reject
        </button>
        {unresolved > 0 && <span className="muted small">{unresolved} conflict{unresolved === 1 ? '' : 's'} left to resolve</span>}
      </div>
    </div>
  );
}

/** Pending files (optionally for one project) and open questions. */
export function PendingInbox({ project }: { project?: string }) {
  const qs = new URLSearchParams({ status: 'pending' });
  if (project) qs.set('project', project);
  const files = useQuery({ queryKey: ['inbox', 'pending', project ?? ''], queryFn: () => api.get<AgentFile[]>(`/api/inbox?${qs}`) });
  const qq = new URLSearchParams({ status: 'open' });
  if (project) qq.set('project', project);
  const questions = useQuery({ queryKey: ['questions', 'open', project ?? ''], queryFn: () => api.get<Question[]>(`/api/questions?${qq}`) });
  const pendingIds = new Set((files.data ?? []).map((f) => f.id));
  const looseQuestions = (questions.data ?? []).filter((q) => !pendingIds.has(q.agent_file_row_id));
  if (!files.data || !questions.data) return <div className="muted small">Loading…</div>;
  if (files.data.length === 0 && looseQuestions.length === 0) return <div className="muted small">Nothing waiting for you.</div>;
  return (
    <div className="side-stack">
      {files.data.map((f) => (
        <FilePanel key={f.id} file={f} />
      ))}
      {looseQuestions.map((q) => (
        <QuestionCard key={q.id} q={q} />
      ))}
    </div>
  );
}
