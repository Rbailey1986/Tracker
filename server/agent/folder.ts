import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { bus } from '../domain/events.js';
import { nowIso } from '../domain/time.js';
import { AGENT_MD, snapshotJsonSchema, updateFileJsonSchema } from './agentmd.js';
import type { AgentPipeline, FileSink } from './pipeline.js';
import { buildSnapshot } from './snapshot.js';

export interface FolderStatus {
  path: string;
  watching: boolean;
  last_import_at: string | null;
  message: string | null;
  error: string | null;
}

const SUBDIRS = ['schema', 'inbox', 'applied', 'rejected', 'answers'];

/** Writes to a temporary file and renames it, so readers never see half a file. Retries briefly on Windows locks. */
export function writeFileAtomic(file: string, content: string) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 10) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function writeIfChanged(file: string, content: string): boolean {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return false;
  } catch {
    /* missing */
  }
  writeFileAtomic(file, content);
  return true;
}

function moveFile(from: string, toDir: string): string | null {
  if (!fs.existsSync(from)) return null;
  fs.mkdirSync(toDir, { recursive: true });
  let target = path.join(toDir, path.basename(from));
  if (fs.existsSync(target)) {
    const ext = path.extname(from);
    target = path.join(toDir, `${path.basename(from, ext)}.${nowIso().replace(/[:.]/g, '-')}${ext}`);
  }
  fs.renameSync(from, target);
  return target;
}

/** The agent folder: layout, AGENT.md and schemas, inbox watcher, snapshot.json and answers/. */
export class AgentFolder implements FileSink {
  private watcher: FSWatcher | null = null;
  private health: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  readonly status: FolderStatus;

  constructor(
    private readonly db: DB,
    private readonly pipeline: AgentPipeline,
    dir: string,
    private readonly opts: { healthIntervalMs?: number; snapshotDelayMs?: number } = {},
  ) {
    this.status = { path: dir, watching: false, last_import_at: null, message: null, error: null };
  }

  get dir() {
    return this.status.path;
  }
  private p(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }

  async start() {
    this.ensureLayout(false);
    await this.startWatcher();
    this.unsubscribe = bus.subscribe((e) => {
      if (e.type === 'changed' || e.type === 'questions' || e.type === 'messages') this.scheduleSnapshot();
    });
    this.writeSnapshot();
    this.health = setInterval(() => this.checkHealth(), this.opts.healthIntervalMs ?? 2000);
  }

  async stop() {
    if (this.health) clearInterval(this.health);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.unsubscribe?.();
    await this.watcher?.close();
    this.watcher = null;
    this.status.watching = false;
    await this.queue;
  }

  /** Creates anything missing and refreshes AGENT.md and the schemas if out of date. */
  ensureLayout(announce: boolean): boolean {
    const existed = fs.existsSync(this.dir) && SUBDIRS.every((d) => fs.existsSync(this.p(d)));
    fs.mkdirSync(this.dir, { recursive: true });
    for (const d of SUBDIRS) fs.mkdirSync(this.p(d), { recursive: true });
    writeIfChanged(this.p('AGENT.md'), AGENT_MD);
    writeIfChanged(this.p('schema', 'update-file.schema.json'), JSON.stringify(updateFileJsonSchema(), null, 2) + '\n');
    writeIfChanged(this.p('schema', 'snapshot.schema.json'), JSON.stringify(snapshotJsonSchema(), null, 2) + '\n');
    if (!existed) {
      this.status.message = announce
        ? `The agent folder was missing or emptied, so it was recreated at ${this.dir}.`
        : `Created the agent folder at ${this.dir}.`;
      if (announce) bus.publish({ type: 'folder', message: this.status.message });
    }
    return !existed;
  }

  private async startWatcher() {
    await this.watcher?.close();
    const inbox = this.p('inbox');
    this.watcher = chokidar.watch(inbox, {
      depth: 0,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      ignored: (p: string) => path.basename(p).startsWith('.'),
    });
    const onFile = (file: string) => {
      if (path.dirname(path.resolve(file)) !== path.resolve(inbox)) return;
      if (!/\.json$/i.test(file)) return;
      this.enqueue(file);
    };
    this.watcher.on('add', onFile).on('change', onFile);
    this.watcher.on('error', (e) => {
      this.status.error = String(e);
    });
    await new Promise<void>((resolve) => this.watcher!.once('ready', () => resolve()));
    this.status.watching = true;
    this.status.error = null;
  }

  private enqueue(file: string) {
    this.queue = this.queue.then(() => this.process(file)).catch((e) => {
      this.status.error = `Couldn't read ${path.basename(file)}: ${(e as Error).message}`;
    });
  }

  private async process(file: string) {
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    this.pipeline.ingest(path.basename(file), text);
    this.status.last_import_at = nowIso();
  }

  /** Lets tests and the API wait until every queued file is handled. */
  idle() {
    return this.queue;
  }

  private checkHealth() {
    try {
      if (this.ensureLayout(true)) {
        void this.startWatcher();
        this.writeSnapshot();
      } else if (!fs.existsSync(this.p('snapshot.json'))) {
        this.writeSnapshot();
      }
    } catch (e) {
      this.status.error = (e as Error).message;
    }
  }

  scheduleSnapshot() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.writeSnapshot();
    }, this.opts.snapshotDelayMs ?? 100);
  }

  writeSnapshot() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeFileAtomic(this.p('snapshot.json'), JSON.stringify(buildSnapshot(this.db), null, 2) + '\n');
    } catch (e) {
      this.status.error = `Couldn't write snapshot.json: ${(e as Error).message}`;
    }
  }

  writeAnswer(answer: { question_id: string; file_id: string; key: string; question: string; answer: string; answered_at: string }) {
    fs.mkdirSync(this.p('answers'), { recursive: true });
    writeFileAtomic(this.p('answers', `${answer.question_id}.json`), JSON.stringify(answer, null, 2) + '\n');
  }

  moveToApplied(fileName: string) {
    moveFile(this.p('inbox', fileName), this.p('applied'));
  }

  moveToRejected(fileName: string, errorText: string) {
    const moved = moveFile(this.p('inbox', fileName), this.p('rejected'));
    const base = moved ?? this.p('rejected', fileName);
    fs.mkdirSync(this.p('rejected'), { recursive: true });
    fs.writeFileSync(`${base.replace(/\.json$/i, '')}.error.txt`, errorText + '\n');
  }
}
