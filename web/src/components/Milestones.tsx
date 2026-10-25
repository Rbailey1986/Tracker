import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Milestone } from '../api';
import { BlurInput, fmtDate, Markdown, useMutate } from '../ui';

const KIND_LABEL: Record<Milestone['kind'], string> = { release: 'Release', feature: 'New feature', change: 'Major change' };

export const useMilestones = (projectId: string) =>
  useQuery({ queryKey: ['milestones', projectId], queryFn: () => api.get<Milestone[]>(`/api/projects/${projectId}/milestones`) });

function NewMilestone({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const mutate = useMutate();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Milestone['kind']>('feature');
  const [versionLabel, setVersionLabel] = useState('');
  const [status, setStatus] = useState<Milestone['status']>('planned');
  return (
    <form
      className="row wrap"
      style={{ gap: 8, padding: 12, borderBottom: '1px solid var(--border)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const r = await mutate(() =>
          api.post('/api/milestones', { project_id: projectId, title, kind, status, version_label: versionLabel.trim() || null }),
        );
        if (r) onDone();
      }}
    >
      <input className="input grow" autoFocus placeholder="Milestone, e.g. Desktop app ships" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Milestone title" />
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Milestone['kind'])} aria-label="Kind">
        {Object.entries(KIND_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input className="input" style={{ width: 90 }} placeholder="Version" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} aria-label="Version" />
      <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Milestone['status'])} aria-label="Status">
        <option value="planned">Planned</option>
        <option value="achieved">Achieved</option>
      </select>
      <button className="btn primary" type="submit" disabled={!title.trim()}>
        Add milestone
      </button>
    </form>
  );
}

function MilestoneCard({ m }: { m: Milestone }) {
  const mutate = useMutate();
  const [editing, setEditing] = useState(false);
  const save = (fields: Partial<Milestone>, version = m.version) => mutate(() => api.patch(`/api/milestones/${m.id}`, { version, ...fields }));
  const dateField = m.status === 'achieved' ? 'achieved_on' : 'target_date';
  return (
    <div className={`milestone ${m.status}`} data-testid="milestone">
      <div className="milestone-dot" aria-hidden />
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}>
          <span className={`pill ms-${m.kind}`}>{KIND_LABEL[m.kind]}</span>
          {m.version_label && <span className="tag">v{m.version_label.replace(/^v/i, '')}</span>}
          <BlurInput className="inline-input milestone-title grow" value={m.title} version={m.version} onSave={(title, v) => title.trim() && save({ title }, v)} aria-label="Milestone title" />
        </div>
        <div className="row wrap small muted" style={{ gap: 8, marginTop: 4 }}>
          <select className="select small" value={m.status} aria-label="Milestone status" onChange={(e) => save({ status: e.target.value as Milestone['status'] })}>
            <option value="planned">Planned</option>
            <option value="achieved">Achieved</option>
          </select>
          <span>{m.status === 'achieved' ? 'on' : 'target'}</span>
          <input
            type="date"
            className="input small"
            value={m[dateField] ?? ''}
            aria-label={m.status === 'achieved' ? 'Achieved on' : 'Target date'}
            onChange={(e) => save({ [dateField]: e.target.value || null } as Partial<Milestone>)}
          />
          <span className="grow" />
          <button className="btn ghost small" onClick={() => setEditing((x) => !x)}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button className="btn ghost small" aria-label={`Delete milestone ${m.title}`} onClick={() => mutate(() => api.del(`/api/milestones/${m.id}?version=${m.version}`))}>
            ×
          </button>
        </div>
        {editing ? (
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            <BlurInput multiline rows={2} value={m.description} version={m.version} placeholder="Short description: what this milestone is" onSave={(description, v) => save({ description }, v)} aria-label="Milestone description" />
            <BlurInput multiline rows={5} value={m.achieved} version={m.version} placeholder="What was achieved (Markdown bullets)" onSave={(achieved, v) => save({ achieved }, v)} aria-label="What was achieved" />
            <input className="input" defaultValue={m.version_label ?? ''} placeholder="Version" aria-label="Milestone version" onBlur={(e) => e.target.value !== (m.version_label ?? '') && save({ version_label: e.target.value.trim() || null })} />
          </div>
        ) : (
          <>
            {m.description && <div style={{ marginTop: 6 }}>{m.description}</div>}
            {m.achieved && (
              <div className="milestone-achieved">
                <div className="small muted" style={{ marginBottom: 2 }}>
                  What was achieved
                </div>
                <Markdown source={m.achieved} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The Milestones tab on a project: releases, new features and major changes, planned at the top. */
export function ProjectMilestones({ projectId }: { projectId: string }) {
  const [adding, setAdding] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | 'release' | 'feature' | 'change'>('all');
  const { data } = useMilestones(projectId);
  const items = (data ?? []).filter((m) => kindFilter === 'all' || m.kind === kindFilter);
  const planned = items.filter((m) => m.status === 'planned');
  const achieved = items.filter((m) => m.status === 'achieved');
  const releasesCount = (data ?? []).filter((m) => m.kind === 'release').length;

  return (
    <div>
      <div className="row wrap" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: 8, alignItems: 'center' }}>
        <div className="row" style={{ gap: 4 }}>
          <button className={`btn small ${kindFilter === 'all' ? 'active' : 'ghost'}`} onClick={() => setKindFilter('all')}>
            All
          </button>
          <button className={`btn small ${kindFilter === 'release' ? 'active' : 'ghost'}`} onClick={() => setKindFilter('release')}>
            Releases ({releasesCount})
          </button>
          <button className={`btn small ${kindFilter === 'feature' ? 'active' : 'ghost'}`} onClick={() => setKindFilter('feature')}>
            Features
          </button>
          <button className={`btn small ${kindFilter === 'change' ? 'active' : 'ghost'}`} onClick={() => setKindFilter('change')}>
            Changes
          </button>
        </div>
        <span className="muted small grow" style={{ textAlign: 'right' }}>
          {achieved.length} achieved · {planned.length} planned{achieved[0]?.achieved_on ? ` · last ${fmtDate(achieved[0].achieved_on)}` : ''}
        </span>
        <button className="btn small" onClick={() => setAdding((x) => !x)}>
          {adding ? 'Cancel' : 'New milestone'}
        </button>
      </div>
      {adding && <NewMilestone projectId={projectId} onDone={() => setAdding(false)} />}
      <div className="card-pad">
        {data && data.length === 0 && <div className="muted small">No milestones yet. The agent adds releases, new features and major changes as they happen.</div>}
        {data && data.length > 0 && items.length === 0 && (
          <div className="muted small">No {kindFilter === 'release' ? 'releases' : kindFilter === 'feature' ? 'features' : 'changes'} recorded for this project yet.</div>
        )}
        {planned.length > 0 && <div className="section-title muted">{kindFilter === 'release' ? 'Upcoming releases' : 'Planned'}</div>}
        {planned.map((m) => (
          <MilestoneCard key={m.id} m={m} />
        ))}
        {achieved.length > 0 && (
          <div className="section-title muted" style={{ marginTop: planned.length ? 16 : 0 }}>
            {kindFilter === 'release' ? 'Release history' : 'Achieved'}
          </div>
        )}
        {achieved.map((m) => (
          <MilestoneCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}
