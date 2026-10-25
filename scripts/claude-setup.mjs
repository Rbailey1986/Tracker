// npm run claude:install - link Claude Code to the tracker in every folder:
//   - registers the tracker MCP server at user level (claude mcp add --scope user tracker)
//   - adds two hooks to ~/.claude/settings.json: SessionStart and UserPromptSubmit run mcp/hook.mjs
// npm run claude:remove - undo both. settings.json is backed up before each change.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'mcp', 'tracker-mcp.mjs');
const hook = path.join(root, 'mcp', 'hook.mjs');
const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
const HOOKS = { SessionStart: 'session-start', UserPromptSubmit: 'prompt' };
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('hook.mjs') && h.command.includes('tracker');

function claude(args) {
  return spawnSync('claude', args, { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
}

function editSettings(fn) {
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, `${settingsFile}.before-tracker.bak`);
  fn(settings);
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
}

function removeOurHooks(settings) {
  for (const event of Object.keys(HOOKS)) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    settings.hooks[event] = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

const mode = process.argv[2];
if (mode === 'install') {
  claude(['mcp', 'remove', '--scope', 'user', 'tracker']);
  // shell: true on Windows joins args unquoted, so quote the path or a space in it splits it.
  const r = claude(['mcp', 'add', '--scope', 'user', 'tracker', '--', 'node', `"${server}"`]);
  if (r.status !== 0) {
    console.error(`Could not register the MCP server:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  console.log('Registered the tracker MCP server for all folders (user scope).');

  editSettings((settings) => {
    removeOurHooks(settings);
    settings.hooks ??= {};
    for (const [event, arg] of Object.entries(HOOKS)) {
      settings.hooks[event] ??= [];
      settings.hooks[event].push({ hooks: [{ type: 'command', command: `node "${hook}" ${arg}`, timeout: 10 }] });
    }
  });
  console.log(`Added the SessionStart and UserPromptSubmit hooks to ${settingsFile} (backup: settings.json.before-tracker.bak).`);
  console.log('Open a new Claude Code chat in a project folder to use it.');
} else if (mode === 'remove') {
  claude(['mcp', 'remove', '--scope', 'user', 'tracker']);
  console.log('Removed the tracker MCP server.');
  if (fs.existsSync(settingsFile)) {
    editSettings(removeOurHooks);
    console.log('Removed the tracker hooks.');
  }
} else {
  console.log('Use: node scripts/claude-setup.mjs install | remove');
  process.exit(1);
}
