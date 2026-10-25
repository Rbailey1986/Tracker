import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentFolder } from './agent/folder.js';
import { AgentPipeline } from './agent/pipeline.js';
import { registerRoutes } from './api/routes.js';
import { defaultAgentDir, getSetting, setSetting, type DB } from './db/db.js';
import { DomainError } from './domain/errors.js';

export interface AppOptions {
  db: DB;
  dbPath: string;
  /** Overrides the saved agent folder setting (tests). */
  agentDir?: string;
  serveWeb?: boolean;
  folderOptions?: ConstructorParameters<typeof AgentFolder>[3];
}

export interface TrackerApp {
  app: FastifyInstance;
  db: DB;
  dbPath: string;
  pipeline: AgentPipeline;
  folder: () => AgentFolder;
  setAgentDir(dir: string): Promise<void>;
  close(): Promise<void>;
}

const WEB_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

export async function createApp(opts: AppOptions): Promise<TrackerApp> {
  const { db } = opts;
  if (opts.agentDir) setSetting(db, 'agent_folder', opts.agentDir);
  let folder: AgentFolder;
  const pipeline = new AgentPipeline(db, () => folder);
  const agentDir = getSetting(db, 'agent_folder') ?? defaultAgentDir();
  folder = new AgentFolder(db, pipeline, agentDir, opts.folderOptions);
  await folder.start();

  const app = Fastify({ logger: false, bodyLimit: 6 * 1024 * 1024, forceCloseConnections: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.status(err.status).send({ error: err.message, details: err.details ?? null });
    }
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply.status((err as { statusCode: number }).statusCode).send({ error: err.message });
    }
    console.error(err);
    return reply.status(500).send({ error: err.message || 'Something went wrong' });
  });

  const tracker: TrackerApp = {
    app,
    db,
    dbPath: opts.dbPath,
    pipeline,
    folder: () => folder,
    async setAgentDir(dir: string) {
      const resolved = path.resolve(dir);
      await folder.stop();
      setSetting(db, 'agent_folder', resolved);
      folder = new AgentFolder(db, pipeline, resolved, opts.folderOptions);
      await folder.start();
    },
    async close() {
      await folder.stop();
      await app.close();
    },
  };

  registerRoutes(tracker);

  if (opts.serveWeb !== false && fs.existsSync(WEB_DIST)) {
    // wildcard serving reads the folder on each request, so a rebuild while running is picked up.
    await app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return tracker;
}
