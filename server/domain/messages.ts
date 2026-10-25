import { z } from 'zod';
import type { DB } from '../db/db.js';
import { DomainError, invalid, notFound } from './errors.js';
import { bus } from './events.js';
import { getRow } from './store.js';
import { newId, nowIso } from './time.js';

/** Notes and "do this next" hand-offs you leave on a task or idea for the agent, plus the agent's replies. */
export interface MessageRow {
  id: string;
  parent_type: 'task' | 'idea';
  parent_id: string;
  project_id: string | null;
  kind: 'note' | 'do_next' | 'ask';
  author: 'you' | 'agent';
  text: string;
  status: 'open' | 'handled';
  reply_to: string | null;
  file_id: string | null;
  created_at: string;
  handled_at: string | null;
}

const PostBody = z
  .object({
    parent_type: z.enum(['task', 'idea']),
    parent_id: z.string().min(1),
    kind: z.enum(['note', 'do_next']).default('note'),
    text: z.string().trim().max(5000).default(''),
  })
  .strict();

const SELECT = `SELECT m.*, t.title AS task_title, i.text AS idea_text, p.name AS project_name FROM agent_messages m
  LEFT JOIN tasks t ON m.parent_type = 'task' AND t.id = m.parent_id
  LEFT JOIN ideas i ON m.parent_type = 'idea' AND i.id = m.parent_id
  LEFT JOIN projects p ON p.id = m.project_id`;

export function listMessages(
  db: DB,
  q: { parent_type?: string; parent_id?: string; status?: string; kind?: string; project?: string },
) {
  const where: string[] = [];
  const args: string[] = [];
  if (q.parent_type) (where.push('m.parent_type = ?'), args.push(q.parent_type));
  if (q.parent_id) (where.push('m.parent_id = ?'), args.push(q.parent_id));
  if (q.status) (where.push('m.status = ?'), args.push(q.status));
  if (q.kind) (where.push('m.kind = ?'), args.push(q.kind));
  if (q.project) (where.push('m.project_id = ?'), args.push(q.project));
  return db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.created_at, m.id LIMIT 500`).all(...args);
}

export function postMessage(db: DB, body: unknown) {
  const r = PostBody.safeParse(body);
  if (!r.success) throw invalid('A message needs parent_type (task or idea), parent_id and text');
  const { parent_type, parent_id, kind, text } = r.data;
  if (kind === 'note' && !text) throw invalid('Write a note first');
  if (kind === 'do_next' && parent_type !== 'task') throw invalid('Only tasks can be sent to the agent');
  const parent = getRow(db, parent_type, parent_id);
  if (!parent) throw notFound(parent_type === 'task' ? 'Task' : 'Idea');
  if (kind === 'do_next') {
    const open = db
      .prepare(`SELECT id FROM agent_messages WHERE parent_type = 'task' AND parent_id = ? AND kind = 'do_next' AND status = 'open'`)
      .get(parent_id);
    if (open) throw new DomainError(409, 'This task is already waiting for the agent.');
  }
  const id = newId();
  db.prepare(
    `INSERT INTO agent_messages (id, parent_type, parent_id, project_id, kind, author, text, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'you', ?, 'open', ?)`,
  ).run(id, parent_type, parent_id, parent.project_id ?? null, kind, text, nowIso());
  bus.publish({ type: 'messages' });
  return db.prepare(`${SELECT} WHERE m.id = ?`).get(id);
}

/** Take back one of your messages the agent hasn't handled yet. */
export function withdrawMessage(db: DB, id: string) {
  const m = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as MessageRow | undefined;
  if (!m) throw notFound('Message');
  if (m.author !== 'you' || m.status !== 'open') throw new DomainError(400, 'Only your messages the agent has not handled can be taken back.');
  db.prepare('DELETE FROM agent_messages WHERE id = ?').run(id);
  bus.publish({ type: 'messages' });
}

/** Open messages from you, oldest first: what the agent should read on its next run. */
export function openMessagesForAgent(db: DB) {
  return (db.prepare(`${SELECT} WHERE m.author = 'you' AND m.status = 'open' AND m.kind <> 'ask' ORDER BY m.created_at, m.id`).all() as any[]).map((m) => ({
    id: m.id as string,
    kind: m.kind as 'note' | 'do_next',
    parent_type: m.parent_type as 'task' | 'idea',
    parent_id: m.parent_id as string,
    project_id: (m.project_id ?? null) as string | null,
    about: (m.parent_type === 'task' ? m.task_title : m.idea_text) ?? '',
    text: m.text as string,
    created_at: m.created_at as string,
  }));
}

export interface MessageReply {
  message_id: string;
  reply?: string;
  handled?: boolean;
}

/** Problems with an update file's message_replies, in the same style as the plan's step 4. */
export function replyProblems(db: DB, replies: MessageReply[]): string[] {
  const get = db.prepare('SELECT author FROM agent_messages WHERE id = ?');
  return replies.flatMap((r, i) => {
    const m = get.get(r.message_id) as { author: string } | undefined;
    if (!m) return [`message_replies[${i}]: message ${r.message_id} does not exist`];
    if (m.author !== 'you') return [`message_replies[${i}]: message ${r.message_id} is one of yours; reply to the user's messages only`];
    return [];
  });
}

/** Writes the agent's replies and marks messages handled. Runs inside the apply transaction. */
export function applyReplies(db: DB, replies: MessageReply[], fileId: string) {
  const now = nowIso();
  for (const r of replies) {
    const m = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(r.message_id) as MessageRow;
    if (r.reply?.trim()) {
      db.prepare(
        `INSERT INTO agent_messages (id, parent_type, parent_id, project_id, kind, author, text, status, reply_to, file_id, created_at, handled_at)
         VALUES (?, ?, ?, ?, 'note', 'agent', ?, 'handled', ?, ?, ?, ?)`,
      ).run(newId(), m.parent_type, m.parent_id, m.project_id, r.reply.trim(), m.id, fileId, now, now);
    }
    if (r.handled !== false && m.status === 'open') {
      db.prepare(`UPDATE agent_messages SET status = 'handled', handled_at = ? WHERE id = ?`).run(now, m.id);
    }
  }
}
