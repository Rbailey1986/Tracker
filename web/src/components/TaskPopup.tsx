import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Task, type TaskStatus } from '../api';
import { BlurInput, Markdown, STATUS_LABEL, useMutate } from '../ui';
import { Feed } from './Feed';
import { MessageThread, openHandoff, useThread } from './Messages';

export function TaskPopup({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const mutate = useMutate();
  const { data: task, error } = useQuery({ queryKey: ['task', taskId], queryFn: () => api.get<Task>(`/api/tasks/${taskId}`) });
  const { data: siblings } = useQuery({
    queryKey: ['tasks', task?.project_id ?? '', ''],
    queryFn: () => api.get<Task[]>(`/api/projects/${task!.project_id}/tasks`),
    enabled: !!task,
  });
  const [editingDesc, setEditingDesc] = useState(false);
  const [newSub, setNewSub] = useState('');
  const { data: thread } = useThread('task', taskId);
  const handoff = openHandoff(thread);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (error) {
    return (
      <div className="overlay" onMouseDown={onClose}>
        <div className="modal modal-body" onMouseDown={(e) => e.stopPropagation()}>
          This task no longer exists. <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  if (!task) return null;

  const save = (fields: Partial<Task>, version = task.version) => mutate(() => api.patch(`/api/tasks/${task.id}`, { version, ...fields }));
  const others = (siblings ?? []).filter((t) => t.id !== task.id && !task.depends_on.includes(t.id));

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={task.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <select
            className={`pill ${task.status}`}
            value={task.status}
            aria-label="Status"
            onChange={(e) => save({ status: e.target.value as TaskStatus })}
          >
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {task.overdue && <span className="pill overdue">Overdue</span>}
          {task.blocked && task.status !== 'blocked' && <span className="pill blocked">Blocked by a dependency</span>}
          <span className="muted">{task.project_name}</span>
          {handoff && <span className="chip sent-chip">Sent to agent</span>}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className="modal-body">
          <BlurInput className="title-input" value={task.title} version={task.version} onSave={(title, v) => title.trim() && save({ title }, v)} aria-label="Title" />

          <div className="details">
            <span className="k">Owner</span>
            <div className="seg" style={{ width: 'fit-content' }}>
              {(['you', 'agent'] as const).map((o) => (
                <button key={o} className={task.owner === o ? 'on' : ''} onClick={() => task.owner !== o && save({ owner: o })}>
                  {o === 'you' ? 'You' : 'Agent'}
                </button>
              ))}
            </div>

            <span className="k">Due date</span>
            <BlurInput type="date" value={task.due_date ?? ''} version={task.version} onSave={(d, v) => save({ due_date: d || null }, v)} aria-label="Due date" />

            {task.status === 'blocked' && (
              <>
                <span className="k">Blocked because</span>
                <BlurInput value={task.blocked_reason ?? ''} version={task.version} placeholder="What is it waiting for?" onSave={(r, v) => save({ blocked_reason: r || null }, v)} />
              </>
            )}

            <span className="k">Depends on</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {task.depends_on_tasks.map((d) => (
                <span key={d.id} className={`pill ${d.status}`}>
                  {d.title}
                  <button
                    className="btn ghost small"
                    style={{ padding: '0 2px' }}
                    aria-label={`Remove dependency ${d.title}`}
                    onClick={() =>
                      mutate(() => api.put(`/api/tasks/${task.id}/dependencies`, { depends_on: task.depends_on.filter((x) => x !== d.id) }))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <select
                className="select small"
                value=""
                aria-label="Add dependency"
                onChange={(e) =>
                  e.target.value && mutate(() => api.put(`/api/tasks/${task.id}/dependencies`, { depends_on: [...task.depends_on, e.target.value] }))
                }
              >
                <option value="">+ Add</option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>

            <span className="k">Priority</span>
            <select
              className="select"
              style={{ width: 'fit-content' }}
              value={task.priority ?? ''}
              aria-label="Priority"
              onChange={(e) => save({ priority: (e.target.value || null) as Task['priority'] })}
            >
              <option value="">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>

            <span className="k">Estimate</span>
            <div className="row" style={{ gap: 6 }}>
              <BlurInput
                value={task.estimate_minutes ? String(task.estimate_minutes) : ''}
                version={task.version}
                placeholder="minutes, e.g. 30"
                aria-label="Estimate in minutes"
                style={{ width: 140 }}
                onSave={(v, ver) => {
                  const num = v.trim() ? parseInt(v.trim(), 10) : null;
                  save({ estimate_minutes: Number.isNaN(num) ? null : num }, ver);
                }}
              />
              <span className="small muted">min</span>
            </div>

            <span className="k">Created from</span>
            <span className="small">
              {task.created_from === 'agent_file' ? (
                <>
                  Agent file <span className="tag">{task.created_from_ref}</span>
                </>
              ) : task.created_from === 'template' ? (
                'Template'
              ) : (
                'Manual'
              )}
              {task.key && (
                <>
                  {' '}
                  · key <span className="tag">{task.key}</span>
                </>
              )}
            </span>
          </div>

          <div>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="section-title" style={{ margin: 0 }}>
                Description
              </span>
              <button className="btn small ghost" onClick={() => setEditingDesc((x) => !x)}>
                {editingDesc ? 'Done' : 'Edit'}
              </button>
            </div>
            {editingDesc ? (
              <BlurInput multiline rows={6} value={task.description} version={task.version} onSave={(description, v) => save({ description }, v)} aria-label="Description" />
            ) : task.description ? (
              <div onDoubleClick={() => setEditingDesc(true)}>
                <Markdown source={task.description} />
              </div>
            ) : (
              <div className="muted small" onClick={() => setEditingDesc(true)} style={{ cursor: 'text' }}>
                No description. Click to add one.
              </div>
            )}
          </div>

          <div>
            <div className="section-title">
              Subtasks{' '}
              <span className="muted small">
                {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
              </span>
            </div>
            {task.subtasks.map((s) => (
              <div key={s.id} className={`subtask ${s.done ? 'done' : ''}`}>
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={s.text}
                  onChange={() => mutate(() => api.patch(`/api/subtasks/${s.id}`, { version: s.version, done: !s.done }))}
                />
                <BlurInput
                  className="text"
                  value={s.text}
                  version={s.version}
                  onSave={(text, version) => text.trim() && mutate(() => api.patch(`/api/subtasks/${s.id}`, { version, text }))}
                />
                <button
                  className="btn ghost small"
                  aria-label={`Delete subtask ${s.text}`}
                  onClick={() => mutate(() => api.del(`/api/subtasks/${s.id}?version=${s.version}`))}
                >
                  ×
                </button>
              </div>
            ))}
            <form
              className="row"
              style={{ marginTop: 4 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                const r = await mutate(() => api.post('/api/subtasks', { task_id: task.id, text: newSub }));
                if (r) setNewSub('');
              }}
            >
              <input className="input grow" placeholder="Add a subtask" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
              <button className="btn small" type="submit">
                Add
              </button>
            </form>
          </div>

          <div>
            <div className="section-title">Notes for the agent</div>
            <MessageThread parentType="task" parentId={task.id} />
          </div>

          <div>
            <div className="section-title">History</div>
            <Feed task={task.id} limit={50} />
          </div>
        </div>

        <div className="modal-foot">
          <button
            className="btn danger"
            onClick={async () => {
              const r = await mutate(() => api.del(`/api/tasks/${task.id}?version=${task.version}`), { success: 'Task deleted. Undo it from the activity feed.' });
              if (r) onClose();
            }}
          >
            Delete
          </button>
          {task.status !== 'done' && (
            task.status === 'on_hold' ? (
              <button
                className="btn"
                data-testid="resume-on-hold-btn"
                onClick={() => save({ status: 'not_started' })}
              >
                Resume task
              </button>
            ) : (
              <button
                className="btn"
                data-testid="put-on-hold-btn"
                onClick={() => save({ status: 'on_hold' })}
              >
                Put on hold
              </button>
            )
          )}
          <span className="grow" />
          {task.status === 'done' ? (
            <button className="btn" onClick={() => mutate(() => api.post(`/api/tasks/${task.id}/reopen`, { version: task.version }))}>
              Reopen
            </button>
          ) : (
            <button className="btn primary" onClick={() => mutate(() => api.post(`/api/tasks/${task.id}/complete`, { version: task.version }))}>
              Mark complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
