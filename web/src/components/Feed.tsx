import { useQuery } from '@tanstack/react-query';
import { api, type Batch, type Change } from '../api';
import { ActorChip, fmtDateTime, fmtValue, useMutate } from '../ui';

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  due_date: 'due date',
  body_md: 'text',
  blocked_reason: 'blocked reason',
  estimate_minutes: 'estimate',
  project_id: 'project',
  completed_at: 'completed',
  sort_order: 'order',
  depends_on_task_id: 'dependency',
  picked_up_at: 'picked up',
  agent_note: 'agent note',
  result_type: 'result',
  result_id: 'result',
};

function describe(c: Change): string {
  const what = c.entity === 'dependency' ? 'dependency' : c.entity;
  const label = c.entity_label ? `“${c.entity_label}”` : '';
  switch (c.op) {
    case 'create':
      return `Created ${what} ${label}`;
    case 'delete':
      return `Deleted ${what} ${label}`;
    case 'restore':
      return `Restored ${what} ${label}`;
    case 'update': {
      const f = FIELD_LABEL[c.field!] ?? c.field;
      if (c.field === 'done') return `${c.after ? 'Ticked' : 'Unticked'} ${label}`;
      if (c.field === 'body_md') return `Edited ${label}`;
      return `Changed ${f} of ${label}: ${fmtValue(c.before)} → ${fmtValue(c.after)}`;
    }
  }
}

/** Hides automatic side fields when the main field is in the same batch. */
function visibleChanges(b: Batch): Change[] {
  const fields = new Set(b.changes.map((c) => `${c.entity_id}:${c.field}`));
  return b.changes.filter(
    (c) =>
      !(c.field === 'completed_at' && fields.has(`${c.entity_id}:status`)) &&
      !(c.field === 'picked_up_at' && fields.has(`${c.entity_id}:status`)),
  );
}

export function BatchItem({ batch, compact }: { batch: Batch; compact?: boolean }) {
  const mutate = useMutate();
  const changes = visibleChanges(batch);
  const shown = compact ? changes.slice(0, 3) : changes;
  const more = changes.length - shown.length;
  const isUndo = !!batch.reverts_batch_id;
  return (
    <div className={`feed-item ${batch.undone ? 'undone' : ''}`} data-testid="feed-item">
      <ActorChip actor={batch.actor} />
      <div className="grow">
        <div className="feed-text">
          {isUndo && <strong>Undo: </strong>}
          {shown.map((c) => (
            <div key={c.id}>{describe(c)}</div>
          ))}
          {more > 0 && <div className="muted">and {more} more change{more === 1 ? '' : 's'}</div>}
        </div>
        <div className="small muted row wrap" style={{ gap: 6 }}>
          <span>{fmtDateTime(batch.created_at)}</span>
          {batch.source_file && <span className="tag">{batch.source_file}</span>}
          {batch.undone && <span>· undone</span>}
        </div>
      </div>
      {!batch.undone && (
        <button
          className="btn small ghost"
          onClick={() => mutate(() => api.post(`/api/changes/batches/${batch.batch_id}/undo`), { success: 'Undone.' })}
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function Feed({ project, task, limit = 20, compact }: { project?: string; task?: string; limit?: number; compact?: boolean }) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (project) qs.set('project', project);
  if (task) qs.set('task', task);
  const { data } = useQuery({ queryKey: ['changes', project ?? '', task ?? '', limit], queryFn: () => api.get<Batch[]>(`/api/changes?${qs}`) });
  if (!data) return <div className="muted small">Loading…</div>;
  if (data.length === 0) return <div className="muted small">No changes yet.</div>;
  return (
    <div className="feed">
      {data.map((b) => (
        <BatchItem key={b.batch_id} batch={b} compact={compact} />
      ))}
    </div>
  );
}
