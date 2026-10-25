import { useQuery } from '@tanstack/react-query';
import { api, type FolderStatus, type Overview } from '../api';
import { fmtRelative, go, type Route, Swatch } from '../ui';

export function Sidebar({ route }: { route: Route }) {
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview') });
  const { data: folder } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get<FolderStatus>('/api/agent/status'),
    refetchInterval: 15000,
  });
  const projects = (o?.projects ?? []).filter((p) => p.status !== 'archived');
  const areas = [...new Set(projects.map((p) => p.area || 'Other'))];
  const nav = (r: Route, label: string, extra?: React.ReactNode) => (
    <button className={`nav-item ${route.name === r.name && (r.name !== 'project' || (route as any).id === (r as any).id) ? 'active' : ''}`} onClick={() => go(r)}>
      {label}
      {extra}
    </button>
  );
  const waiting = (o?.counts.pending_agent_files ?? 0) + (o?.counts.open_questions ?? 0);

  return (
    <nav className="sidebar">
      <div className="brand">Tracker</div>
      {nav({ name: 'today' }, 'Today', o && o.counts.due_today + o.counts.overdue > 0 ? <span className="count">{o.counts.due_today + o.counts.overdue}</span> : null)}
      {nav({ name: 'projects' }, 'All projects')}
      {nav({ name: 'weekly' }, 'Weekly review')}
      {nav({ name: 'inbox' }, 'Agent inbox', waiting > 0 ? <span className="badge" data-testid="inbox-badge">{waiting}</span> : null)}
      {nav({ name: 'ideas' }, 'Ideas', o && o.counts.new_ideas > 0 ? <span className="count">{o.counts.new_ideas} new</span> : null)}

      {areas.map((area) => (
        <div key={area} className="nav-group">
          <button
            className={`nav-group-title area-link ${route.name === 'area' && route.area === area ? 'active' : ''}`}
            onClick={() => go({ name: 'area', area })}
            title={`Open the ${area} area`}
          >
            {area}
          </button>
          {projects
            .filter((p) => (p.area || 'Other') === area)
            .map((p) => (
              <button
                key={p.id}
                className={`nav-item ${route.name === 'project' && route.id === p.id ? 'active' : ''}`}
                onClick={() => go({ name: 'project', id: p.id })}
              >
                <Swatch color={p.color} size={10} />
                <span className="ellipsis">{p.name}</span>
                {p.status === 'paused' && <span className="count">paused</span>}
              </button>
            ))}
        </div>
      ))}

      <div className="nav-group">{nav({ name: 'settings' }, 'Settings')}</div>

      <div className="folder-status" data-testid="folder-status">
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="dot" style={{ background: folder?.watching ? '#3ecf6e' : '#e5534b' }} />
          <span>{folder?.watching ? 'Watching agent folder' : 'Not watching'}</span>
        </div>
        <div className="path mono" style={{ fontSize: 11 }}>
          {folder?.path}
        </div>
        <div style={{ marginTop: 4 }}>Last import: {fmtRelative(folder?.last_import_at)}</div>
        {folder?.error && <div style={{ color: '#ff9b93', marginTop: 4 }}>{folder.error}</div>}
      </div>
    </nav>
  );
}
