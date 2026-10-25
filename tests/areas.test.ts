import { describe, expect, it } from 'vitest';
import { areaView, logLines } from '../server/domain/areas.js';
import { inBatch } from '../server/domain/store.js';
import { memoryDb } from './helpers.js';

describe('logLines', () => {
  it('takes the Log bullets, newest first as written, and ignores the rest', () => {
    const body = [
      '## Where it lives',
      '- Folder: `C:\\x`',
      '',
      '## Log',
      '- 2026-10-23 · ~5m · newest',
      '- 2026-10-22 · ? · older',
      'not a bullet',
      '- 2026-10-21 · ~1h · oldest',
    ].join('\n');
    expect(logLines(body, 2)).toEqual(['2026-10-23 · ~5m · newest', '2026-10-22 · ? · older']);
  });

  it('is empty when there is no Log section', () => {
    expect(logLines('## Where it lives\n- Folder: `C:\\x`')).toEqual([]);
  });
});

describe('areaView', () => {
  it('groups active and paused projects by area and leaves archived ones out', () => {
    const db = memoryDb();
    const w = <T,>(fn: (w: any) => T) => inBatch(db, { actor: 'you' }, fn);
    const code = w((b) => b.create('project', { name: 'Tracker', area: 'Code' }));
    w((b) => b.create('project', { name: 'PixelForge', area: 'Code', status: 'paused' }));
    w((b) => b.create('project', { name: 'Old', area: 'Code', status: 'archived' }));
    w((b) => b.create('project', { name: 'Ukulele', area: 'Music' }));
    w((b) => b.create('task', { project_id: code.id, title: 'Next thing', priority: 'high' }));

    const v = areaView(db, 'Code')!;
    expect(v.projects.map((p) => p.name).sort()).toEqual(['PixelForge', 'Tracker']);
    expect(v.projects.find((p) => p.name === 'Tracker')!.next_step?.title).toBe('Next thing');
    expect(v.projects.find((p) => p.name === 'PixelForge')!.next_step).toBeNull();
    expect(areaView(db, 'Music')!.projects.map((p) => p.name)).toEqual(['Ukulele']);
  });

  it('is null for an area with no active projects', () => {
    expect(areaView(memoryDb(), 'School')).toBeNull();
  });
});
