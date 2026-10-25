import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type AgentFile, type Idea, type Project, type Question, type Settings as SettingsT } from '../api';
import { IdeaGroups, IdeasBox } from '../components/Ideas';
import { FilePanel, QuestionCard } from '../components/Inbox';
import { CopyPromptButton, fmtDateTime, Swatch, useMutate } from '../ui';

// ---------- Agent inbox (full page) ----------

export function InboxPage() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const { data: files } = useQuery({ queryKey: ['inbox', 'all'], queryFn: () => api.get<AgentFile[]>('/api/inbox') });
  const { data: questions } = useQuery({ queryKey: ['questions', 'all'], queryFn: () => api.get<Question[]>('/api/questions') });
  const { data: projects } = useQuery({ queryKey: ['projects', ''], queryFn: () => api.get<Project[]>('/api/projects') });
  const pending = (files ?? []).filter((f) => f.status === 'pending');
  const done = (files ?? []).filter((f) => f.status !== 'pending');
  const pendingIds = new Set(pending.map((f) => f.id));
  const openQ = (questions ?? []).filter((q) => q.status === 'open' && !pendingIds.has(q.agent_file_row_id));
  const answered = (questions ?? []).filter((q) => q.status === 'answered');
  const projectName = (id: string) => projects?.find((p) => p.id === id);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div className="grow">
          <h1>Agent inbox</h1>
          <div className="muted small">Files the agent wrote to inbox/, and its questions for you.</div>
        </div>
        <CopyPromptButton />
      </div>
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>
          Waiting for you ({pending.length + openQ.length})
        </button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          Applied and rejected ({done.length})
        </button>
      </div>

      {tab === 'pending' ? (
        <div className="side-stack" style={{ maxWidth: 900 }}>
          {pending.length === 0 && openQ.length === 0 && <div className="card card-pad muted">Nothing waiting for you. Clean agent files apply by themselves and show in the activity feed.</div>}
          {pending.map((f) => (
            <FilePanel key={f.id} file={f} />
          ))}
          {openQ.length > 0 && <h2 className="section-title">Questions from the agent</h2>}
          {openQ.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}
        </div>
      ) : (
        <div style={{ maxWidth: 1000 }}>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Changes</th>
                  <th>Projects</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {done.map((f) => [
                  <tr key={f.id} className="clickable" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                    <td>
                      <div className="mono">{f.file_name}</div>
                      {f.summary && <div className="small muted">{f.summary}</div>}
                    </td>
                    <td>
                      <span className={`pill ${f.status === 'applied' ? 'done' : f.status === 'rejected' ? 'blocked' : 'not_started'}`}>{f.status}</span>
                    </td>
                    <td>{f.change_count}</td>
                    <td>
                      <div className="row wrap" style={{ gap: 6 }}>
                        {f.project_ids.map((id) => {
                          const p = projectName(id);
                          return p ? (
                            <span key={id} className="row small" style={{ gap: 4 }}>
                              <Swatch color={p.color} size={9} />
                              {p.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="small">{fmtDateTime(f.received_at)}</td>
                  </tr>,
                  expanded === f.id && f.error ? (
                    <tr key={f.id + '-err'}>
                      <td colSpan={5}>
                        <div className="error-box">{f.error}</div>
                      </td>
                    </tr>
                  ) : null,
                ])}
                {done.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No files yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {answered.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: 20 }}>
                Answered questions
              </h2>
              <div className="side-stack">
                {answered.map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Settings ----------

export function SettingsPage() {
  const mutate = useMutate();
  const { data: s } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsT>('/api/settings') });
  const [folder, setFolder] = useState('');
  useEffect(() => {
    if (s) setFolder(s.agent_folder);
  }, [s?.agent_folder]);
  if (!s) return <div className="page muted">Loading…</div>;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="card card-pad side-stack">
        <div>
          <span className="field-label">Agent folder</span>
          <div className="row">
            <input className="input grow mono" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Agent folder" />
            <button
              className="btn"
              disabled={folder.trim() === s.agent_folder}
              onClick={() => mutate(() => api.put('/api/settings', { agent_folder: folder }), { success: 'Now watching the new folder.' })}
            >
              Save
            </button>
            <button className="btn" onClick={() => mutate(() => api.post('/api/agent/open-folder'))}>
              Open folder
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {s.folder_status.watching ? 'Watching.' : 'Not watching.'} {s.folder_status.message}
          </div>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={s.auto_apply}
            onChange={(e) => mutate(() => api.put('/api/settings', { auto_apply: e.target.checked }))}
          />
          <span>
            Auto-apply clean agent files
            <div className="small muted">Files with no conflicts and no deletes apply straight away, with Undo in the feed. Turn off to review everything.</div>
          </span>
        </label>
        <div className="row">
          <CopyPromptButton primary />
          <span className="small muted">Copies the prompt with the folder path included, ready to paste into Claude.</span>
        </div>
      </div>
      <div className="card card-pad side-stack" style={{ marginTop: 16 }}>
        <div>
          <span className="field-label">Database</span>
          <div className="mono">{s.db_path}</div>
        </div>
        <div>
          <span className="field-label">Backups (daily + on start, last 14 kept)</span>
          <div className="row wrap" style={{ alignItems: 'center', gap: 8 }}>
            <div className="mono grow">{s.backups_path}</div>
            <button
              className="btn small"
              onClick={() => mutate(() => api.post('/api/settings/backup'), { success: 'Database backup created.' })}
            >
              Back up now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Ideas ----------

export function IdeasPage() {
  const { data: ideas } = useQuery({ queryKey: ['ideas'], queryFn: () => api.get<Idea[]>('/api/ideas') });
  const { data: projects } = useQuery({ queryKey: ['projects', 'active'], queryFn: () => api.get<Project[]>('/api/projects?status=active') });
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-header">
        <h1>Ideas</h1>
      </div>
      <IdeasBox limit={3} />
      <h2 className="section-title" style={{ marginTop: 20 }}>
        All ideas
      </h2>
      <div className="card card-pad">
        {(ideas ?? []).length === 0 && <div className="muted">No ideas yet.</div>}
        <IdeaGroups ideas={ideas ?? []} projects={projects ?? []} />
      </div>
    </div>
  );
}
