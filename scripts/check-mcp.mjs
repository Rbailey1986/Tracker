// Read-only check of the MCP server against the running tracker: node scripts/check-mcp.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'test', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['C:/Users/rober/Desktop/Agent helper/tracker/mcp/tracker-mcp.mjs'],
    cwd: 'C:/Users/rober/Desktop/Robert Built/openGym/frontend',
  }),
);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text.startsWith('#') ? '{}' : r.content[0].text);
};
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const here = await call('tracker_project');
console.log('from openGym/frontend:', here.project?.name, '| tasks', here.tasks?.length, '| next:', here.next_step?.title);
const byName = await call('tracker_project', { project: 'ScriptFlow2' });
console.log('by name:', byName.project?.name, '| open questions', byName.open_questions?.length, '| ideas', byName.ideas?.length);
console.log('unknown:', (await call('tracker_project', { project: 'nope' })).error);
console.log('projects:', (await call('tracker_projects')).map((p) => p.name).join(', '));
const rules = await client.callTool({ name: 'tracker_rules', arguments: {} });
console.log('rules start:', rules.content[0].text.split('\n')[0]);
await client.close();
