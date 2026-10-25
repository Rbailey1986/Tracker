import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AgentMessage } from '../api';
import { ActorChip, fmtRelative, Markdown, useMutate } from '../ui';

export const threadKey = (parentType: string, parentId: string) => ['messages', parentType, parentId];

export function useThread(parentType: 'task' | 'idea', parentId: string, enabled = true) {
  return useQuery({
    queryKey: threadKey(parentType, parentId),
    queryFn: () => api.get<AgentMessage[]>(`/api/messages?parent_type=${parentType}&parent_id=${parentId}`),
    enabled,
  });
}

/** The open "do this next" hand-off on a task, if there is one. */
export const openHandoff = (thread: AgentMessage[] | undefined) =>
  (thread ?? []).find((m) => m.kind === 'do_next' && m.author === 'you' && m.status === 'open');

/** Sends a task to the agent as the thing to do next, with optional instructions. */
export function SendToAgentButton({ taskId, text = '', onSent }: { taskId: string; text?: string; onSent?: () => void }) {
  const mutate = useMutate();
  return (
    <button
      className="btn"
      title="The agent sees this task as the next thing to do, with your note, when it next syncs"
      onClick={async () => {
        const r = await mutate(() => api.post('/api/messages', { parent_type: 'task', parent_id: taskId, kind: 'do_next', text }), {
          success: 'Sent to the agent. It picks it up on its next sync.',
        });
        if (r) onSent?.();
      }}
    >
      Send to agent
    </button>
  );
}

function MessageLine({ m, reply }: { m: AgentMessage; reply?: boolean }) {
  const mutate = useMutate();
  return (
    <div className={`message ${reply ? 'reply' : ''}`} data-testid="agent-message">
      <div className="row small wrap" style={{ gap: 6 }}>
        <ActorChip actor={m.author} />
        {m.kind === 'do_next' && <span className="pill in_progress">Do this next</span>}
        {m.kind === 'ask' && <span className="pill not_started">Question</span>}
        <span className="muted">{fmtRelative(m.created_at)}</span>
        {m.kind === 'ask' && m.status === 'open' && <span className="muted">· Thinking… Claude Code is reading the project</span>}
        {m.author === 'you' &&
          m.kind !== 'ask' &&
          (m.status === 'open' ? (
            <span className="muted">· Waiting for the agent</span>
          ) : (
            <span style={{ color: 'var(--chip-agent-fg)' }}>· Seen by the agent</span>
          ))}
        <span className="grow" />
        {m.author === 'you' && m.status === 'open' && m.kind !== 'ask' && (
          <button className="btn ghost small" aria-label="Take back" title="Take back" onClick={() => mutate(() => api.del(`/api/messages/${m.id}`))}>
            ×
          </button>
        )}
      </div>
      {m.text &&
        (m.author === 'agent' ? (
          <div className="message-text md-reply">
            <Markdown source={m.text} />
          </div>
        ) : (
          <div className="message-text">{m.text}</div>
        ))}
    </div>
  );
}

/** Notes and answers for the agent on a task or idea, with the agent's replies under each. */
export function MessageThread({ parentType, parentId }: { parentType: 'task' | 'idea'; parentId: string }) {
  const mutate = useMutate();
  const [text, setText] = useState('');
  const { data: thread } = useThread(parentType, parentId);
  const roots = (thread ?? []).filter((m) => !m.reply_to);
  const replies = (id: string) => (thread ?? []).filter((m) => m.reply_to === id);
  const handoff = openHandoff(thread);

  const askNow = async () => {
    if (!text.trim()) return;
    const r = await mutate(() => api.post('/api/messages/ask', { parent_type: parentType, parent_id: parentId, text }));
    if (r) setText('');
  };

  const sendNote = async () => {
    if (!text.trim()) return;
    const r = await mutate(() => api.post('/api/messages', { parent_type: parentType, parent_id: parentId, kind: 'note', text }), {
      success: 'Note saved. The agent reads it on its next sync.',
    });
    if (r) setText('');
  };

  return (
    <div className="messages">
      {roots.length === 0 && <div className="muted small">No notes for the agent yet.</div>}
      {roots.map((m) => (
        <div key={m.id}>
          <MessageLine m={m} />
          {replies(m.id).map((r) => (
            <MessageLine key={r.id} m={r} reply />
          ))}
        </div>
      ))}
      <textarea
        className="textarea"
        rows={2}
        placeholder={parentType === 'task' ? 'A question, note or instructions for the agent' : 'A question, or a note for the agent about this idea'}
        value={text}
        aria-label="Note for the agent"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void sendNote();
          }
        }}
        style={{ marginTop: 8 }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="grow" />
        <button
          className="btn"
          disabled={!text.trim()}
          onClick={askNow}
          title="Ask now: Claude Code reads the project's folder and answers here in a few seconds. It changes nothing."
        >
          Ask
        </button>
        {parentType === 'task' && !handoff && <SendToAgentButton taskId={parentId} text={text.trim()} onSent={() => setText('')} />}
        <button className="btn primary" disabled={!text.trim()} onClick={sendNote} title="Ctrl+Enter">
          Add note
        </button>
      </div>
    </div>
  );
}
