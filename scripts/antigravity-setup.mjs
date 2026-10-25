// npm run antigravity:install - link Gemini in Antigravity to the tracker:
//   - adds the tracker MCP server to ~/.gemini/config/mcp_config.json
//   - copies the update-tracker and sync-from-tracker skills from ~/.claude/skills to ~/.gemini/config/skills,
//     signed as Antigravity and told to pass the workspace folder (Antigravity runs one MCP server for every folder)
// npm run antigravity:remove - undo both. mcp_config.json is backed up before each change.
// Run it again after changing the Claude skills to copy the new versions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'mcp', 'tracker-mcp.mjs');
const configDir = path.join(os.homedir(), '.gemini', 'config');
const mcpFile = path.join(configDir, 'mcp_config.json');
const skillsDir = path.join(configDir, 'skills');
const claudeSkills = path.join(os.homedir(), '.claude', 'skills');
const SKILLS = ['update-tracker', 'sync-from-tracker'];
const MARK = '<!-- copied from ~/.claude/skills by the tracker (npm run antigravity:install) -->';

const FOLDER_NOTE = `**Antigravity:** the tracker MCP server can't see which folder is open, so always pass the workspace's full
path (for example \`C:\\Users\\rober\\Desktop\\MyProject\`) as \`project\` to \`tracker_project\` instead of leaving it empty.
`;

function editMcp(fn) {
  const config = fs.existsSync(mcpFile) ? JSON.parse(fs.readFileSync(mcpFile, 'utf8')) : {};
  if (fs.existsSync(mcpFile)) fs.copyFileSync(mcpFile, `${mcpFile}.before-tracker.bak`);
  fn(config);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2) + '\n');
}

function adapt(md) {
  const body = md
    .replaceAll('Claude Code · <project name>', 'Antigravity · <project name>')
    .replaceAll('CLAUDE.md', 'GEMINI.md, AGENTS.md, CLAUDE.md');
  // Put the folder note right after the paragraph about the tracker_* tools.
  const at = body.indexOf('\n\n', body.indexOf('MCP tools are available'));
  const withNote = at === -1 ? `${body}\n${FOLDER_NOTE}` : `${body.slice(0, at + 2)}${FOLDER_NOTE}\n${body.slice(at + 2)}`;
  // The mark goes after the frontmatter so the skill still parses.
  return withNote.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${MARK}\n`);
}

const mode = process.argv[2];
if (mode === 'install') {
  editMcp((config) => {
    config.mcpServers ??= {};
    config.mcpServers.tracker = { command: process.execPath, args: [server] };
  });
  console.log(`Added the tracker MCP server to ${mcpFile} (backup: mcp_config.json.before-tracker.bak).`);

  for (const name of SKILLS) {
    const src = path.join(claudeSkills, name, 'SKILL.md');
    if (!fs.existsSync(src)) {
      console.error(`Skipped ${name}: ${src} not found.`);
      continue;
    }
    const dest = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(dest) && !fs.readFileSync(dest, 'utf8').includes(MARK)) {
      console.error(`Skipped ${name}: ${dest} exists and wasn't written by this script.`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, adapt(fs.readFileSync(src, 'utf8').replaceAll('\r\n', '\n')));
    console.log(`Copied the ${name} skill to ${dest}.`);
  }
  console.log('Restart Antigravity (or refresh its MCP servers) to use it.');
} else if (mode === 'remove') {
  if (fs.existsSync(mcpFile)) {
    editMcp((config) => delete config.mcpServers?.tracker);
    console.log('Removed the tracker MCP server.');
  }
  for (const name of SKILLS) {
    const dest = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8').includes(MARK)) {
      fs.rmSync(path.dirname(dest), { recursive: true });
      console.log(`Removed the ${name} skill.`);
    }
  }
} else {
  console.log('Use: node scripts/antigravity-setup.mjs install | remove');
  process.exit(1);
}
