// scripts/uninstall.mjs - 1-click uninstaller for Tracker
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function step(title) {
  console.log(`\n\x1b[36m=== ${title} ===\x1b[0m`);
}

function run(cmd, args, description) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.warn(`\x1b[33mNotice: ${description} finished with code ${result.status}\x1b[0m`);
  }
  return result;
}

console.log('\x1b[33m====================================================\x1b[0m');
console.log('\x1b[33m          Tracker - Uninstaller                      \x1b[0m');
console.log('\x1b[33m====================================================\x1b[0m');

// 1. Remove desktop shortcuts
step('1. Removing Shortcuts');
run('node', ['scripts/desktop.mjs', 'remove'], 'Removing desktop shortcuts');

// 2. Remove Antigravity integration
step('2. Removing Antigravity MCP Integration');
run('node', ['scripts/antigravity-setup.mjs', 'remove'], 'Removing Antigravity MCP');

// 3. Remove Claude Code integration
step('3. Removing Claude Code MCP Integration');
run('node', ['scripts/claude-setup.mjs', 'remove'], 'Removing Claude Code MCP');

step('Uninstallation Complete');
console.log('\x1b[32mShortcuts and MCP integrations removed.\x1b[0m');
