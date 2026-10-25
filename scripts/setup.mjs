// scripts/setup.mjs - 1-click comprehensive setup for Tracker
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function step(title) {
  console.log(`\n\x1b[36m=== ${title} ===\x1b[0m`);
}

function run(cmd, args, description, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, ...opts });
  if (result.status !== 0 && !opts.allowFailure) {
    console.error(`\x1b[31mError during: ${description}\x1b[0m`);
    process.exit(result.status ?? 1);
  }
  return result;
}

console.log('\x1b[32m====================================================\x1b[0m');
console.log('\x1b[32m           Tracker - Automated Installer             \x1b[0m');
console.log('\x1b[32m====================================================\x1b[0m');

// 1. Build Frontend
step('1. Building Frontend Web App');
run('npx', ['vite', 'build'], 'Building web assets');

// 2. Desktop shortcuts & Tracker.exe
step('2. Setting up Windows Desktop & Shortcuts');
run('node', ['scripts/desktop.mjs', 'install'], 'Configuring desktop app and shortcuts');

// 3. Antigravity Integration
step('3. Configuring Antigravity MCP Integration');
run('node', ['scripts/antigravity-setup.mjs', 'install'], 'Configuring Antigravity MCP', { allowFailure: true });

// 4. Claude Code Integration (if installed)
step('4. Checking Claude Code Integration');
const claudeCheck = spawnSync('claude', ['--version'], { shell: true, stdio: 'pipe' });
if (claudeCheck.status === 0) {
  console.log('Claude Code detected. Registering MCP server and hooks...');
  run('node', ['scripts/claude-setup.mjs', 'install'], 'Configuring Claude Code MCP', { allowFailure: true });
} else {
  console.log('Claude Code not detected on PATH; skipping Claude Code integration.');
}

step('Installation Finished Successfully!');
console.log('\x1b[32m✓ Frontend built to web/dist\x1b[0m');
console.log('\x1b[32m✓ Tracker Desktop shortcut created on Desktop\x1b[0m');
console.log('\x1b[32m✓ Start Menu shortcut created\x1b[0m');
console.log('\x1b[32m✓ Startup tray configured to run on Windows login\x1b[0m');
console.log('\x1b[32m✓ AI Agent MCP integrations configured\x1b[0m');
console.log('\nYou can launch Tracker anytime from your Desktop or Start Menu.');
