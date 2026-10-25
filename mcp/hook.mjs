// Claude Code hook: tells Claude what's waiting in the tracker for the project in the current folder.
//   node hook.mjs session-start   at the start of a chat: next step, do-next tasks, notes, open questions, answers
//   node hook.mjs prompt          on each message: only what's new since the last time
// Prints nothing (and never fails the chat) when the tracker isn't running or the folder isn't a tracker project.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = `http://127.0.0.1:${process.env.TRACKER_PORT ?? 4317}`;
const STATE_DIR = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.tracker'), 'Tracker', 'hook-state');
const mode = process.argv[2];

async function get(url) {
  const res = await fetch(BASE + url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const line = (s, max = 300) => s.replace(/\s+/g, ' ').trim().slice(0, max);

async function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();
  let ctx;
  try {
    const { project_id } = await get(`/api/agent/project-for-folder?path=${encodeURIComponent(cwd)}`);
    ctx = await get(`/api/agent/projects/${project_id}`);
  } catch {
    return; // no tracker or no linked project: say nothing
  }

  const stateFile = path.join(STATE_DIR, `${(input.session_id ?? 'default').replace(/[^\w-]/g, '')}.json`);
  const seen = new Set(mode === 'prompt' && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : []);

  const items = [
    ...ctx.messages.map((m) => ({
      id: `m:${m.id}`,
      text:
        m.kind === 'do_next'
          ? `DO NEXT (sent by the user): task "${m.about}"${m.text ? ` - ${line(m.text)}` : ''} [message_id ${m.id}]`
          : `Note from the user on ${m.parent_type} "${line(m.about, 80)}": ${line(m.text)} [message_id ${m.id}]`,
    })),
    ...ctx.recent_answers.map((q) => ({ id: `a:${q.id}`, text: `The user answered "${line(q.text, 120)}": ${line(q.answer)}` })),
    ...ctx.open_questions.map((q) => ({ id: `q:${q.id}`, text: `Still waiting on the user: ${line(q.text, 160)}` })),
  ];
  const fresh = items.filter((i) => !seen.has(i.id));

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(items.map((i) => i.id)));

  const name = ctx.project.name;
  if (mode === 'session-start') {
    const out = [
      `This folder is the tracker project "${name}" (${ctx.project.progress.done}/${ctx.project.progress.total} tasks done).`,
      ctx.next_step ? `Next step: ${ctx.next_step.title} (${ctx.next_step.status}).` : 'No next step is set.',
      ...items.map((i) => `- ${i.text}`),
      '',
      'Tracker tools are available (tracker_project, tracker_update, tracker_reply). When you finish a piece of work, ' +
        'record it in the tracker, and reply to any user note or do-next task you acted on. Mention the do-next tasks to the user first.',
    ];
    console.log(out.join('\n'));
  } else if (mode === 'prompt' && fresh.length) {
    console.log([`New in the tracker for "${name}" since your last message:`, ...fresh.map((i) => `- ${i.text}`)].join('\n'));
  }
}

main().catch(() => {});
