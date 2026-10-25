// MCP server for the tracker. Claude Code and Antigravity start it (registered once at user level), so every folder
// gets tools to read the tracker and send updates straight away. Updates still go through the tracker's inbox, checks and undo.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const BASE = `http://127.0.0.1:${process.env.TRACKER_PORT ?? 4317}`;
const AGENT_DIR = process.env.TRACKER_AGENT_DIR ?? path.join(os.homedir(), 'Tracker', 'agent');

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('The tracker is not running. Start it from the Start menu (Tracker), or run npm start in its folder.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${method} ${url} failed with ${res.status}`);
  return json;
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (e) => ({ content: [{ type: 'text', text: e.message }], isError: true });
const tool = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return failure(e);
  }
};

/** A project by id, key, name or folder path; with nothing given, the project for the folder Claude Code runs in. */
async function resolveProject(project) {
  if (!project) {
    try {
      return (await api('GET', `/api/agent/project-for-folder?path=${encodeURIComponent(process.cwd())}`)).project_id;
    } catch (e) {
      if (e.message.startsWith('The tracker is not running')) throw e;
      throw new Error(`No tracker project is linked to ${process.cwd()}. Name the project, or add this folder with tracker_update (a project note with "- Folder: \`<path>\`").`);
    }
  }
  const list = await api('GET', '/api/agent/projects');
  const p = project.toLowerCase();
  const hit = list.find((x) => x.id === project || x.key === project || x.name.toLowerCase() === p);
  if (hit) return hit.id;
  if (path.isAbsolute(project)) {
    try {
      return (await api('GET', `/api/agent/project-for-folder?path=${encodeURIComponent(project)}`)).project_id;
    } catch {
      /* fall through */
    }
  }
  throw new Error(`No active project matches "${project}". Use tracker_projects to list them.`);
}

async function submit(file) {
  const result = await api('POST', '/api/agent/files', { file });
  return text({ file_id: file.file_id, ...result });
}

const server = new McpServer({ name: 'tracker', version: '1.0.0' });

server.registerTool(
  'tracker_projects',
  {
    description: "List the user's active projects in their tracker: id, key, name, progress, blocked and overdue counts, and linked folder.",
    inputSchema: {},
  },
  tool(async () => text(await api('GET', '/api/agent/projects'))),
);

server.registerTool(
  'tracker_project',
  {
    description:
      'Everything about one tracker project: tasks (with ids, versions, subtasks, due dates), the next step, the project note, milestones, ideas, ' +
      "the user's open notes and do-next hand-offs for the agent (messages), open questions and recent answers. " +
      'Leave project empty for the project linked to the current folder.',
    inputSchema: { project: z.string().optional().describe('Project id, key, name or folder path. Empty: the current folder.') },
  },
  tool(async ({ project }) => text(await api('GET', `/api/agent/projects/${await resolveProject(project)}`))),
);

server.registerTool(
  'tracker_search',
  {
    description:
      'Search the whole tracker (all projects) for text in project names and descriptions, tasks, subtasks, notes, ideas and milestones. ' +
      'Returns matches with type, id, title, a snippet, and their project and task ids.',
    inputSchema: {
      query: z.string().min(2).describe('Text to look for (case-insensitive, at least 2 characters).'),
      limit: z.number().int().min(1).max(200).default(30),
    },
  },
  tool(async ({ query, limit }) => text(await api('GET', `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`))),
);

server.registerTool(
  'tracker_rules',
  {
    description: 'The tracker rules (AGENT.md): how to write update files for tracker_update. Read once before the first tracker_update in a chat.',
    inputSchema: {},
  },
  tool(async () => {
    const agentMd = path.join(AGENT_DIR, 'AGENT.md');
    if (!fs.existsSync(agentMd)) throw new Error(`AGENT.md not found at ${agentMd}. Is the tracker running?`);
    const schema = path.join(AGENT_DIR, 'schema', 'update-file.schema.json');
    return text(fs.readFileSync(agentMd, 'utf8') + `\n\nFull JSON Schema: ${schema}\nSubmit files with tracker_update instead of writing to inbox/.`);
  }),
);

server.registerTool(
  'tracker_update',
  {
    description:
      'Send one update file to the tracker (same format as AGENT.md: schema_version, file_id, created_at, agent, summary, changes, ' +
      'optional questions and message_replies). Returns at once whether it was applied, rejected (with the reason) or waits for ' +
      "the user's review. created_at and change_ids are filled in if missing.",
    inputSchema: {
      file: z.record(z.unknown()).describe('The update file as a JSON object.'),
    },
  },
  tool(async ({ file }) => {
    const f = { schema_version: 1, created_at: new Date().toISOString(), agent: 'Claude Code', ...file };
    if (Array.isArray(f.changes)) f.changes = f.changes.map((c) => ({ change_id: randomUUID(), ...c }));
    else f.changes = [];
    return submit(f);
  }),
);

server.registerTool(
  'tracker_reply',
  {
    description:
      "Reply to one of the user's notes or do-next hand-offs (from tracker_project messages). The reply shows under their note. " +
      'handled=false keeps it open, e.g. a do-next task you started but have not finished.',
    inputSchema: {
      message_id: z.string(),
      reply: z.string().min(1),
      handled: z.boolean().default(true),
    },
  },
  tool(async ({ message_id, reply, handled }) =>
    submit({
      schema_version: 1,
      file_id: `${new Date().toISOString().slice(0, 10)}-reply-${randomUUID().slice(0, 8)}`,
      created_at: new Date().toISOString(),
      agent: 'Claude Code',
      summary: 'Reply to a note',
      changes: [],
      message_replies: [{ message_id, reply, handled }],
    }),
  ),
);

await server.connect(new StdioServerTransport());
