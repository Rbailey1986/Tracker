import crypto from 'node:crypto';
import type { UpdateFile } from '../../shared/schemas/index.js';
import { getSetting, type DB } from '../db/db.js';
import { DomainError, notFound } from '../domain/errors.js';
import { bus } from '../domain/events.js';
import { applyReplies } from '../domain/messages.js';
import { getRow, inBatch } from '../domain/store.js';
import { newId, nowIso } from '../domain/time.js';
import { buildPlan, FileRejection, parseUpdateFile, type Plan } from './plan.js';

/** Where files physically go. The folder watcher implements it; another route (MCP in Phase 2) can pass null. */
export interface FileSink {
  moveToApplied(fileName: string): void;
  moveToRejected(fileName: string, errorText: string): void;
}

export interface AgentFileRow {
  id: string;
  file_id: string;
  file_name: string;
  sha256: string;
  status: 'pending' | 'applied' | 'rejected' | 'duplicate';
  received_at: string;
  decided_at: string | null;
  error: string | null;
  summary: string | null;
  agent: string | null;
  change_count: number;
  body_json: string | null;
  batch_id: string | null;
  project_ids: string;
}

export type IngestResult =
  | { outcome: 'rejected'; row: AgentFileRow; error: string }
  | { outcome: 'duplicate' | 'pending' | 'applied' | 'already_pending'; row: AgentFileRow };

/** Resolution per conflict key ("<change_id>:<field>"). */
export type Resolutions = Record<string, 'mine' | 'agent'>;

export class AgentPipeline {
  constructor(
    private readonly db: DB,
    private readonly sink: () => FileSink | null = () => null,
  ) {}

  private row(id: string): AgentFileRow {
    const r = this.db.prepare('SELECT * FROM agent_files WHERE id = ?').get(id) as AgentFileRow | undefined;
    if (!r) throw notFound('Agent file');
    return r;
  }

  private insert(r: Omit<AgentFileRow, 'id' | 'received_at' | 'decided_at' | 'batch_id'> & { decided?: boolean }): AgentFileRow {
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO agent_files (id, file_id, file_name, sha256, status, received_at, decided_at, error, summary, agent, change_count, body_json, project_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, r.file_id, r.file_name, r.sha256, r.status, now, r.decided ? now : null, r.error, r.summary, r.agent, r.change_count, r.body_json, r.project_ids);
    return this.row(id);
  }

  /** Validates a received file in the spec's order and records the outcome. Never throws for a bad file. */
  ingest(fileName: string, text: string): IngestResult {
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');
    const samePending = this.db
      .prepare(`SELECT * FROM agent_files WHERE file_name = ? AND sha256 = ? AND status = 'pending'`)
      .get(fileName, sha256) as AgentFileRow | undefined;
    if (samePending) return { outcome: 'already_pending', row: samePending };

    let file: UpdateFile | null = null;
    const reject = (err: FileRejection): IngestResult => {
      const errorText = err.readable(fileName);
      const row = this.insert({
        file_id: file?.file_id ?? guessFileId(text, fileName),
        file_name: fileName,
        sha256,
        status: 'rejected',
        error: errorText,
        summary: file?.summary ?? null,
        agent: file?.agent ?? null,
        change_count: file?.changes.length ?? 0,
        body_json: null,
        project_ids: '[]',
        decided: true,
      });
      this.sink()?.moveToRejected(fileName, errorText);
      bus.publish({ type: 'inbox', fileRowId: row.id });
      return { outcome: 'rejected', row, error: errorText };
    };

    try {
      file = parseUpdateFile(text); // step 1
    } catch (e) {
      if (e instanceof FileRejection) return reject(e);
      throw e;
    }

    // Step 2: a file_id already seen.
    const seen = this.db
      .prepare(`SELECT * FROM agent_files WHERE file_id = ? AND status IN ('pending', 'applied') ORDER BY received_at LIMIT 1`)
      .get(file.file_id) as AgentFileRow | undefined;
    if (seen) {
      const row = this.insert({
        file_id: file.file_id,
        file_name: fileName,
        sha256,
        status: 'duplicate',
        error: `Same file_id as a file received ${seen.received_at}; nothing was changed.`,
        summary: file.summary,
        agent: file.agent,
        change_count: file.changes.length,
        body_json: null,
        project_ids: seen.project_ids,
        decided: true,
      });
      this.sink()?.moveToApplied(fileName);
      bus.publish({ type: 'inbox', fileRowId: row.id });
      return { outcome: 'duplicate', row };
    }

    let plan: Plan;
    try {
      plan = buildPlan(this.db, file); // steps 3 to 5
    } catch (e) {
      if (e instanceof FileRejection) return reject(e);
      throw e;
    }

    const f = file;
    const row = this.db.transaction(() => {
      const r = this.insert({
        file_id: f.file_id,
        file_name: fileName,
        sha256,
        status: 'pending',
        error: null,
        summary: f.summary,
        agent: f.agent,
        change_count: f.changes.length,
        body_json: JSON.stringify(f),
        project_ids: JSON.stringify(plan.project_ids),
      });
      this.insertQuestions(r, f);
      return r;
    })();
    bus.publish({ type: 'inbox', fileRowId: row.id });
    if ((f.questions ?? []).length) bus.publish({ type: 'questions' });

    const autoApply = (getSetting(this.db, 'auto_apply') ?? 'true') === 'true';
    if (autoApply && plan.conflicts.length === 0 && !plan.has_deletes) {
      try {
        return { outcome: 'applied', row: this.apply(row.id, {}) };
      } catch {
        // apply() records the error on the row; the file stays pending for review.
      }
    }
    return { outcome: 'pending', row: this.row(row.id) };
  }

  private insertQuestions(r: AgentFileRow, f: UpdateFile) {
    const stmt = this.db.prepare(
      `INSERT INTO agent_questions (id, file_id, agent_file_row_id, question_key, project_id, task_id, text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    );
    const keep = (v: string | undefined, entity: 'project' | 'task') =>
      !v ? null : v.startsWith('$') ? v : getRow(this.db, entity, v) ? v : null;
    for (const q of f.questions ?? []) {
      stmt.run(newId(), f.file_id, r.id, q.key, keep(q.project_id, 'project'), keep(q.task_id, 'task'), q.text, nowIso());
    }
  }

  preview(rowId: string) {
    const row = this.row(rowId);
    const questions = this.db.prepare('SELECT * FROM agent_questions WHERE agent_file_row_id = ? ORDER BY created_at').all(rowId);
    const base = { file: publicFile(row), questions };
    if (row.status !== 'pending' || !row.body_json) return { ...base, valid: row.status !== 'rejected', items: [], conflicts: [] };
    try {
      const plan = buildPlan(this.db, JSON.parse(row.body_json));
      return { ...base, valid: true, items: plan.items, conflicts: plan.conflicts, has_deletes: plan.has_deletes };
    } catch (e) {
      if (e instanceof FileRejection) return { ...base, valid: false, error: e.readable(row.file_name), items: [], conflicts: [] };
      throw e;
    }
  }

  /** Applies every change in one transaction as one batch (actor agent). On any failure nothing is applied. */
  apply(rowId: string, resolutions: Resolutions): AgentFileRow {
    const row = this.row(rowId);
    if (row.status !== 'pending' || !row.body_json) throw new DomainError(400, `This file is ${row.status}, not pending`);
    const file = JSON.parse(row.body_json) as UpdateFile;
    try {
      this.db.transaction(() => {
        const plan = buildPlan(this.db, file);
        const missing = plan.conflicts.filter((c) => !resolutions[c.key]);
        if (missing.length) {
          throw new DomainError(409, `Choose Keep mine or Use agent's for ${missing.length} conflict(s) first.`, { conflicts: missing });
        }
        const mine = new Set(plan.conflicts.filter((c) => resolutions[c.key] === 'mine').map((c) => c.key));
        const temps = new Map<string, string>();
        const resolve = (v: unknown) => (typeof v === 'string' && v.startsWith('$') ? temps.get(v.slice(1)) ?? v : v);
        const refFields = ['project_id', 'task_id', 'parent_id', 'depends_on_task_id', 'result_id'];

        const batch = inBatch(this.db, { actor: 'agent', sourceFile: row.file_name }, (w) => {
          for (const it of plan.items) {
            if (it.op === 'noop') {
              if (it.temp_id && it.id) temps.set(it.temp_id, it.id);
              continue;
            }
            const fields: Record<string, unknown> = { ...it.fields };
            for (const k of refFields) if (k in fields) fields[k] = resolve(fields[k]);
            if (it.op === 'create') {
              if (it.entity === 'task') Object.assign(fields, { created_from: 'agent_file', created_from_ref: file.file_id });
              if (it.entity === 'idea') fields.added_by = 'agent';
              const created = w.create(it.entity, fields);
              if (it.temp_id) temps.set(it.temp_id, created.id);
            } else if (it.op === 'update') {
              const patch = Object.fromEntries(
                it.changed_fields.filter((f) => !mine.has(`${it.change_id}:${f}`)).map((f) => [f, fields[f]]),
              );
              if (Object.keys(patch).length) w.update(it.entity, it.id!, patch);
              if (it.temp_id) temps.set(it.temp_id, it.id!);
            } else if (it.op === 'delete') {
              if (!mine.has(`${it.change_id}:(delete)`)) w.delete(it.entity, it.id!);
            }
          }
          return w.batchId;
        });

        const addId = this.db.prepare('INSERT INTO agent_change_ids (change_id, file_id) VALUES (?, ?)');
        for (const c of file.changes) addId.run(c.change_id, file.file_id);
        applyReplies(this.db, file.message_replies ?? [], file.file_id);
        for (const [name, id] of temps) {
          this.db.prepare('UPDATE agent_questions SET project_id = ? WHERE agent_file_row_id = ? AND project_id = ?').run(id, rowId, `$${name}`);
          this.db.prepare('UPDATE agent_questions SET task_id = ? WHERE agent_file_row_id = ? AND task_id = ?').run(id, rowId, `$${name}`);
        }
        this.db.prepare(`UPDATE agent_questions SET project_id = NULL WHERE agent_file_row_id = ? AND project_id LIKE '$%'`).run(rowId);
        this.db.prepare(`UPDATE agent_questions SET task_id = NULL WHERE agent_file_row_id = ? AND task_id LIKE '$%'`).run(rowId);
        this.db
          .prepare(`UPDATE agent_files SET status = 'applied', decided_at = ?, error = NULL, batch_id = ? WHERE id = ?`)
          .run(nowIso(), batch, rowId);
      })();
    } catch (e) {
      const msg = e instanceof FileRejection ? e.readable(row.file_name) : (e as Error).message;
      this.db.prepare('UPDATE agent_files SET error = ? WHERE id = ?').run(msg, rowId);
      bus.publish({ type: 'inbox', fileRowId: rowId });
      if (e instanceof FileRejection) throw new DomainError(409, msg);
      throw e;
    }
    this.sink()?.moveToApplied(row.file_name);
    bus.publish({ type: 'inbox', fileRowId: rowId });
    bus.publish({ type: 'changed', batchId: null });
    if (file.message_replies?.length) bus.publish({ type: 'messages' });
    return this.row(rowId);
  }

  reject(rowId: string, reason = 'Rejected by you in the Agent inbox.'): AgentFileRow {
    const row = this.row(rowId);
    if (row.status !== 'pending') throw new DomainError(400, `This file is ${row.status}, not pending`);
    this.db.transaction(() => {
      this.db.prepare(`UPDATE agent_files SET status = 'rejected', decided_at = ?, error = ? WHERE id = ?`).run(nowIso(), reason, rowId);
      this.db.prepare(`DELETE FROM agent_questions WHERE agent_file_row_id = ? AND status = 'open'`).run(rowId);
    })();
    this.sink()?.moveToRejected(
      row.file_name,
      ['This update file was rejected by the user. Nothing in the tracker was changed.', '', `File: ${row.file_name}`, `Reason: ${reason}`].join('\n'),
    );
    bus.publish({ type: 'inbox', fileRowId: rowId });
    bus.publish({ type: 'questions' });
    return this.row(rowId);
  }

  list(status?: string) {
    const rows = this.db
      .prepare(`SELECT * FROM agent_files ${status ? 'WHERE status = ?' : ''} ORDER BY received_at DESC LIMIT 200`)
      .all(...(status ? [status] : [])) as AgentFileRow[];
    return rows.map(publicFile);
  }
}

export function publicFile(r: AgentFileRow) {
  const { body_json, ...rest } = r;
  return { ...rest, project_ids: JSON.parse(r.project_ids) as string[] };
}

function guessFileId(text: string, fileName: string): string {
  const m = /"file_id"\s*:\s*"([^"]{1,120})"/.exec(text);
  return m?.[1] ?? fileName.replace(/\.json$/i, '');
}
