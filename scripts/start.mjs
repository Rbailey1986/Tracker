// npm start: build the web app if it's missing or older than its sources, then run the server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist', 'index.html');

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

const sources = Math.max(newest(path.join(root, 'web', 'src')), newest(path.join(root, 'shared')), fs.statSync(path.join(root, 'web', 'index.html')).mtimeMs);
if (!fs.existsSync(dist) || fs.statSync(dist).mtimeMs < sources) {
  console.log('Building the web app...');
  const r = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const r = spawnSync('npx', ['tsx', 'server/main.ts', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', shell: true });
process.exit(r.status ?? 0);
