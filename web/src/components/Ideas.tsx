import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Idea, type Project } from '../api';
import { ActorChip, BlurInput, fmtDate, href, Swatch, useMutate } from '../ui';
import { MessageThread } from './Messages';

function resultLink(i: Idea) {
  if (i.result_type === 'project' && i.result_id) return href({ name: 'project', id: i.result_id });
  return null;
}

export function IdeaItem({ idea, projects }: { idea: Idea; projects: Project[] }) {
  const mutate = useMutate();
  const [notesOpen, setNotesOpen] = useState(false);
  const editable = idea.status === 'new';
  const link = resultLink(idea);
  return (
    <div className="idea" data-testid="idea">
      <div className="grow">
        {editable ? (
          <BlurInput
            className="inline-input"
            value={idea.text}
            version={idea.version}
            onSave={(text, version) => text.trim() && mutate(() => api.patch(`/api/ideas/${idea.id}`, { version, text }))}
            aria-label="Idea text"
          />
        ) : (
          <div>{idea.text}</div>
        )}
        <div className="small muted row wrap" style={{ marginTop: 4, gap: 6 }}>
          {editable ? (
            <select
              className="select small"
              value={idea.project_id ?? ''}
              aria-label="Idea project"
              onChange={(e) => mutate(() => api.patch(`/api/ideas/${idea.id}`, { version: idea.version, project_id: e.target.value || null }))}
            >
              <option value="">Any project or a new one</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : idea.project_name ? (
            <span className="row" style={{ gap: 4 }}>
              <Swatch color={idea.project_color ?? '#999'} size={9} /> {idea.project_name}
            </span>
          ) : (
            <span>Any project</span>
          )}
          <span>· {fmtDate(idea.created_at)}</span>
          <span>·</span>
          {idea.status === 'new' && idea.added_by === 'agent' ? (
            <>
              <ActorChip actor="agent" />
              <span>Suggested by the agent</span>
              <button
                className="btn ghost small"
                title="The agent works it out into tasks next time it runs"
                onClick={() =>
                  mutate(() => api.patch(`/api/ideas/${idea.id}`, { version: idea.version, added_by: 'you' }), {
                    success: 'Handed to the agent.',
                  })
                }
              >
                Hand to agent
              </button>
            </>
          ) : idea.status === 'new' ? (
            <span>Waiting for agent</span>
          ) : idea.status === 'picked_up' ? (
            <span style={{ color: '#5b34a8' }}>
              Picked up{idea.agent_note ? `: ${idea.agent_note}` : ''} {link && <a href={link}>Open</a>}
            </span>
          ) : (
            <span>Dismissed</span>
          )}
          <span>·</span>
          <button className="btn ghost small" aria-expanded={notesOpen} onClick={() => setNotesOpen((x) => !x)}>
            {idea.message_count ? `Notes (${idea.message_count})` : 'Add a note'}
          </button>
        </div>
        {notesOpen && (
          <div style={{ marginTop: 6 }}>
            <MessageThread parentType="idea" parentId={idea.id} />
          </div>
        )}
      </div>
      {editable && (
        <button className="btn ghost small" aria-label="Remove idea" onClick={() => mutate(() => api.del(`/api/ideas/${idea.id}?version=${idea.version}`))}>
          ×
        </button>
      )}
    </div>
  );
}

/** The idea textarea. With `fixedProjectId` the idea always goes to that project and there's no picker. */
function NewIdeaForm({ projects, fixedProjectId }: { projects: Project[]; fixedProjectId?: string }) {
  const mutate = useMutate();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');

  const saveIdea = async () => {
    if (!text.trim()) return;
    const project_id = fixedProjectId ?? (projectId || null);
    const r = await mutate(() => api.post('/api/ideas', { text, project_id }), { success: 'Idea saved for the agent.' });
    if (r) setText('');
  };

  return (
    <div>
      <textarea
        className="textarea"
        rows={3}
        placeholder="Write down an idea. The agent will pick it up next time it runs."
        value={text}
        aria-label="New idea"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void saveIdea();
          }
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        {fixedProjectId ? (
          <span className="grow" />
        ) : (
          <select className="select grow" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project for idea">
            <option value="">Any project or a new one</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn primary" disabled={!text.trim()} onClick={saveIdea} title="Ctrl+Enter">
          Save idea
        </button>
      </div>
    </div>
  );
}

/** Ideas under a heading per project, projects A–Z, ideas for no project last. */
export function IdeaGroups({ ideas, projects }: { ideas: Idea[]; projects: Project[] }) {
  const groups = new Map<string, Idea[]>();
  for (const i of ideas) groups.set(i.project_id ?? '', [...(groups.get(i.project_id ?? '') ?? []), i]);
  const order = [...groups.keys()].sort((a, b) =>
    !a ? 1 : !b ? -1 : (groups.get(a)![0].project_name ?? '').localeCompare(groups.get(b)![0].project_name ?? ''),
  );
  return (
    <>
      {order.map((key) => {
        const list = groups.get(key)!;
        const first = list[0];
        return (
          <div key={key || 'none'} className="idea-group" data-testid="idea-group">
            <div className="row section-title" style={{ gap: 6, marginTop: 14 }}>
              {key ? <Swatch color={first.project_color ?? '#999'} size={10} /> : null}
              {key ? <a href={href({ name: 'project', id: key })}>{first.project_name}</a> : <span>Any project</span>}
              <span className="muted">{list.length}</span>
            </div>
            {list.map((i) => (
              <IdeaItem key={i.id} idea={i} projects={projects} />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** The Ideas tab on a project: add one for this project, then open ideas first and handled ones below. */
export function ProjectIdeas({ projectId }: { projectId: string }) {
  const { data: ideas } = useQuery({ queryKey: ['ideas', 'project', projectId], queryFn: () => api.get<Idea[]>(`/api/ideas?project=${projectId}`) });
  const { data: projects } = useQuery({ queryKey: ['projects', 'active'], queryFn: () => api.get<Project[]>('/api/projects?status=active') });
  const all = ideas ?? [];
  const sections: [string, Idea[]][] = [
    ['From the agent', all.filter((i) => i.status === 'new' && i.added_by === 'agent')],
    ['Waiting for the agent', all.filter((i) => i.status === 'new' && i.added_by === 'you')],
    ['Picked up', all.filter((i) => i.status === 'picked_up')],
    ['Dismissed', all.filter((i) => i.status === 'dismissed')],
  ];
  return (
    <div className="card-pad">
      <NewIdeaForm projects={projects ?? []} fixedProjectId={projectId} />
      {ideas && all.length === 0 && <div className="muted small" style={{ marginTop: 14 }}>No ideas for this project yet.</div>}
      {sections.map(([label, list]) =>
        list.length ? (
          <div key={label} data-testid="project-idea-section">
            <div className="section-title muted" style={{ marginTop: 16 }}>
              {label} <span>{list.length}</span>
            </div>
            {list.map((i) => (
              <IdeaItem key={i.id} idea={i} projects={projects ?? []} />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

export function IdeasBox({ limit = 5 }: { limit?: number }) {
  const { data: ideas } = useQuery({ queryKey: ['ideas'], queryFn: () => api.get<Idea[]>('/api/ideas') });
  const { data: projects } = useQuery({ queryKey: ['projects', 'active'], queryFn: () => api.get<Project[]>('/api/projects?status=active') });

  return (
    <div className="card card-pad">
      <div className="ideas-box">
        <div>
          <h2>Ideas</h2>
          <NewIdeaForm projects={projects ?? []} />
        </div>
        <div>
          <div className="section-title muted">Recent ideas</div>
          {(ideas ?? []).length === 0 && <div className="muted small">No ideas yet.</div>}
          {(ideas ?? []).slice(0, limit).map((i) => (
            <IdeaItem key={i.id} idea={i} projects={projects ?? []} />
          ))}
          {(ideas ?? []).length > limit && (
            <a className="small" href={href({ name: 'ideas' })}>
              All {ideas!.length} ideas
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
