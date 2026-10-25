import { useState } from 'react';
import { api, type Task, type TaskStatus } from '../api';
import { fmtDate, formatMinutes, go, STATUS_LABEL, useMutate, useToast } from '../ui';

const COLUMNS: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done'];

/** Same grouping as the List tab: a task with an unfinished dependency sits in Blocked. */
const columnOf = (t: Task): TaskStatus => (t.status === 'done' ? 'done' : t.blocked ? 'blocked' : t.status);

/**
 * Board tab: one column per status. Drag a card to another column to change its status (a normal PATCH, so it
 * shows in Activity with Undo); the toast has its own Undo too. Clicking a card opens it.
 */
export function Board({ projectId, tasks, sent }: { projectId: string; tasks: Task[]; sent: Set<string> }) {
  const mutate = useMutate();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  const move = async (t: Task, status: TaskStatus) => {
    if (columnOf(t) === status) return;
    const before = t.status;
    const r = await mutate(() => api.patch<Task>(`/api/tasks/${t.id}`, { version: t.version, status }));
    if (!r) return;
    const waits = status !== 'done' && status !== 'blocked' && r.blocked;
    toast({
      text: `Moved “${t.title}” to ${STATUS_LABEL[status]}${waits ? ' (still shown as Blocked: it waits on another task)' : ''}`,
      kind: 'info',
      action: { label: 'Undo', run: () => mutate(() => api.patch(`/api/tasks/${t.id}`, { version: r.version, status: before })) },
    });
  };

  return (
    <div className="board" data-testid="board">
      {COLUMNS.map((status) => {
        const cards = tasks.filter((t) => columnOf(t) === status);
        return (
          <section
            key={status}
            className={`board-col ${over === status ? 'over' : ''}`}
            data-testid={`board-col-${status}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (over !== status) setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || dragId;
              setOver(null);
              setDragId(null);
              const t = tasks.find((x) => x.id === id);
              if (t) void move(t, status);
            }}
          >
            <header className="board-col-head">
              <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
              <span className="muted small">{cards.length}</span>
            </header>
            <div className="board-cards">
              {cards.map((t) => (
                <article
                  key={t.id}
                  className={`board-card ${dragId === t.id ? 'dragging' : ''}`}
                  data-testid="board-card"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(t.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onClick={() => go({ name: 'project', id: projectId, taskId: t.id })}
                >
                  <div className={`board-title ${t.status === 'done' ? 'done' : ''}`}>{t.title}</div>
                  {status === 'blocked' && <div className="board-why small">{blockedWhy(t)}</div>}
                  <div className="board-meta">
                    <span className={`chip ${t.owner}`}>{t.owner === 'you' ? 'You' : 'Agent'}</span>
                    {t.estimate_minutes ? <span className="small muted">~{formatMinutes(t.estimate_minutes)}</span> : null}
                    {t.priority && <span className={`prio ${t.priority}`}>{t.priority[0].toUpperCase() + t.priority.slice(1)}</span>}
                    {t.due_date && <span className={t.overdue ? 'pill overdue' : 'small muted'}>{fmtDate(t.due_date)}</span>}
                    {t.subtasks.length > 0 && (
                      <span className="small muted">
                        {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                      </span>
                    )}
                    {sent.has(t.id) && <span className="chip sent-chip">Sent to agent</span>}
                  </div>
                </article>
              ))}
              {cards.length === 0 && <div className="board-empty small muted">{dragId ? 'Drop here' : 'Nothing here'}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function blockedWhy(t: Task): string {
  if (t.blocked_reason) return t.blocked_reason;
  const waits = t.depends_on_tasks.filter((d) => d.status !== 'done').map((d) => d.title);
  return waits.length ? `Waiting on ${waits.join(', ')}` : 'No reason given';
}
