import type { EntityName } from '../../shared/schemas/index.js';
import type { DB } from '../db/db.js';
import { DomainError, invalid, notFound } from './errors.js';
import { inBatch } from './store.js';

export interface ChangeRow {
  id: string;
  batch_id: string;
  actor: string;
  source_file: string | null;
  entity: EntityName;
  entity_id: string;
  op: 'create' | 'update' | 'delete' | 'restore';
  field: string | null;
  before_json: string | null;
  after_json: string | null;
  entity_version_after: number;
  created_at: string;
  undone_by_change_id: string | null;
  project_id: string | null;
  task_id: string | null;
  entity_label: string | null;
  reverts_batch_id: string | null;
}

/**
 * A later change "blocks" undoing `row` if it touched the same field (or the item's existence) and
 * is still in effect: not undone itself, and not the undo of something newer than `row`.
 */
function blockingLaterChange(db: DB, row: ChangeRow): ChangeRow | undefined {
  const fieldClause =
    row.op === 'update'
      ? `AND ((L.op = 'update' AND L.field = @field) OR L.op IN ('delete', 'restore', 'create'))`
      : '';
  return db
    .prepare(
      `SELECT * FROM changes L
       WHERE L.entity = @entity AND L.entity_id = @entity_id AND L.id > @id AND L.batch_id <> @batch_id
         AND L.undone_by_change_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM changes O WHERE O.undone_by_change_id = L.id AND O.id > @id)
         ${fieldClause}
       ORDER BY L.id LIMIT 1`,
    )
    .get({ entity: row.entity, entity_id: row.entity_id, id: row.id, batch_id: row.batch_id, field: row.field }) as
    | ChangeRow
    | undefined;
}

export function undoBatch(db: DB, batchId: string): { batchId: string } {
  const rows = db.prepare('SELECT * FROM changes WHERE batch_id = ? ORDER BY id').all(batchId) as ChangeRow[];
  if (rows.length === 0) throw notFound('Change batch');
  const pending = rows.filter((r) => !r.undone_by_change_id);
  if (pending.length === 0) throw invalid('This change has already been undone.');

  for (const r of pending) {
    const later = blockingLaterChange(db, r);
    if (later) {
      const what = r.op === 'update' ? `"${r.field}" on ${r.entity_label ?? r.entity}` : `${r.entity_label ?? r.entity}`;
      throw new DomainError(
        409,
        `Can't undo: ${what} was changed again later (${later.created_at.slice(0, 16).replace('T', ' ')} UTC, by ${later.actor}). Undo that later change first.`,
        { blocking_batch_id: later.batch_id },
      );
    }
  }

  let newBatchId = '';
  inBatch(db, { actor: 'you', revertsBatchId: batchId }, (w) => {
    newBatchId = w.batchId;
    const link = db.prepare('UPDATE changes SET undone_by_change_id = ? WHERE id = ?');

    // Updates are grouped per item so each item gets one reverse update holding all its fields.
    const updatesByEntity = new Map<string, ChangeRow[]>();
    const steps: (ChangeRow | ChangeRow[])[] = [];
    for (const r of [...pending].reverse()) {
      if (r.op === 'update') {
        const k = `${r.entity}:${r.entity_id}`;
        if (!updatesByEntity.has(k)) {
          updatesByEntity.set(k, []);
          steps.push(updatesByEntity.get(k)!);
        }
        updatesByEntity.get(k)!.push(r);
      } else {
        steps.push(r);
      }
    }

    for (const step of steps) {
      if (Array.isArray(step)) {
        const first = step[0];
        const patch: Record<string, unknown> = {};
        for (const r of step) patch[r.field!] = JSON.parse(r.before_json ?? 'null');
        const { fieldChangeIds } = w.update(first.entity, first.entity_id, patch, { raw: true });
        for (const r of step) {
          const cid = fieldChangeIds[r.field!];
          // A field already back at its old value needs no reverse row; point at the item's latest change instead.
          link.run(cid ?? w.changeIds[w.changeIds.length - 1] ?? r.id, r.id);
        }
      } else if (step.op === 'create' || step.op === 'restore') {
        link.run(w.delete(step.entity, step.entity_id), step.id);
      } else if (step.op === 'delete') {
        link.run(w.restore(step.entity, step.entity_id), step.id);
      }
    }
  });
  return { batchId: newBatchId };
}
