import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createApp } from './app.js';
import { backupDb, defaultDataDir, openDb } from './db/db.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.TRACKER_PORT ?? 4317);
const shouldOpen = !process.argv.includes('--no-open') && process.env.TRACKER_NO_OPEN !== '1';

/** On Windows, Edge's app mode gives the tracker its own window and taskbar icon, with no browser bars. */
function edgePath(): string | null {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA];
  for (const r of roots) {
    const p = r && path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function openBrowser(url: string) {
  const edge = process.platform === 'win32' ? edgePath() : null;
  const [cmd, args] = edge
    ? [edge, [`--app=${url}`]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port }, () => (s.end(), resolve(true)));
    s.on('error', () => resolve(false));
  });
}

async function main() {
  const url = `http://${HOST}:${PORT}`;
  if (await portInUse(PORT)) {
    console.log(`Tracker already seems to be running at ${url}`);
    if (shouldOpen) openBrowser(url);
    return;
  }

  const dbPath = path.join(defaultDataDir(), 'tracker.db');
  const backup = backupDb(dbPath);
  const db = openDb(dbPath);
  const tracker = await createApp({ db, dbPath });
  await tracker.app.listen({ host: HOST, port: PORT });

  // Daily background backup: backs up every 24 hours while the server runs, keeping newest 14
  const DAY_MS = 24 * 60 * 60 * 1000;
  const backupTimer = setInterval(() => {
    try {
      backupDb(dbPath);
    } catch (e) {
      console.error('Scheduled backup failed:', e);
    }
  }, DAY_MS);
  backupTimer.unref();

  console.log(`Tracker running at ${url}`);
  console.log(`  Database:     ${dbPath}${backup ? ` (backed up to ${path.basename(backup)})` : ''}`);
  console.log(`  Agent folder: ${tracker.folder().dir}`);
  if (shouldOpen) openBrowser(url);

  const shutdown = async () => {
    await tracker.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
