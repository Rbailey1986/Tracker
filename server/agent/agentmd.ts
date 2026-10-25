import { zodToJsonSchema } from 'zod-to-json-schema';
import { Snapshot, UpdateFile } from '../../shared/schemas/index.js';

/** Rules the app writes to AGENT.md. The numbered list is the spec's text; the reference below it is extra help. */
export const AGENT_MD = `# Working with this tracker

You can read and propose changes to the user's project tracker through this folder.

1. Read snapshot.json for the current state. Use its ids and versions.
2. Read any files in answers/ that you have not seen. They are the user's replies to your questions.
   Also read "ideas" in snapshot.json. Those with added_by "you" are new ideas the user wrote down for you:
   act on each one, then mark it picked_up in your update file and say what you did.
   Also read "messages" in snapshot.json: notes and answers the user left on tasks and ideas, and tasks the user
   sent you to do next (kind "do_next", oldest first). Answer each in "message_replies".
3. To propose changes, write ONE update file to inbox/ that matches schema/update-file.schema.json.
   Write it as inbox/.<file_id>.tmp, then rename it to inbox/<file_id>.json.
4. Every update or delete must include base_version: the item's version from snapshot.json.
5. Use a new UUID for every change_id. Never reuse one.
6. You may ask questions in the same file. Do not guess at things only the user knows.
7. Do not edit or delete anything else in this folder. Clean files apply automatically; the user reviews conflicts and deletes.

## Reference

- \`op\` is create, update, upsert or delete. \`entity\` is project, task, subtask, note, dependency or idea.
- \`fields\` may only hold that entity's editable columns. ids, versions and timestamps are set by the app.
- Give a created item a \`temp_id\`, then refer to it later in the same file as \`"$<temp_id>"\`.
- Projects and tasks can carry a \`key\`: your own stable name for the item (for example \`ep04-record-narration\`),
  unique among projects, or within a project for tasks. An upsert with a key creates the item if the key is new and
  updates it otherwise, so you can resend a whole project without duplicating anything.
  Notes upsert by their parent, subtasks by task and text.
- Dependencies: \`create\` or \`delete\` with \`fields: { task_id, depends_on_task_id }\`. No cycles.
- Ideas from the user (added_by "you"): mark them with \`update\` on entity \`idea\`, \`status: "picked_up"\`,
  \`result_type\` (task, project, note, question or none), \`result_id\` (may be a \`$temp_id\`) and a one-line
  \`agent_note\`. If you can't place an idea, leave it and ask a question instead.
- Your own ideas: when you and the user come up with a feature or plan that isn't decided yet, add it with
  \`upsert\` on entity \`idea\`, \`fields: { text, project_id }\` (project_id optional). The same text matches the
  same idea, so resending is safe. It shows in the user's ideas box marked "from agent" and waits there; don't
  pick up your own ideas. When the user hands one to you, it comes back with added_by "you".
- Messages: reply in the file's top-level \`message_replies\`: \`[{ "message_id": "...", "reply": "..." }]\`. The reply
  shows under the user's message, and the message counts as handled. Add \`"handled": false\` to reply but keep it
  open (for example a do_next task you have started but not finished). For a do_next task: do the work, update
  the task (status, subtasks), then reply with what you did. A file can hold only message_replies and no changes.
- Milestones: releases, new features and major changes, per project. \`upsert\` on entity \`milestone\` with a \`key\`
  (for example \`v1-4-0\` or \`desktop-app\`) and \`fields: { project_id, key, title, kind, version_label, status,
  target_date, achieved_on, description, achieved }\`. \`kind\` is release, feature or change; \`status\` planned or
  achieved (\`achieved_on\` defaults to today). \`description\` is one or two sentences on what it is; \`achieved\`
  is short Markdown bullets of what was actually delivered. Add one whenever a version ships, a feature lands or
  something major changes, and plan upcoming ones as \`planned\` with a \`target_date\`.
- Statuses: projects active, paused, archived. Tasks not_started, in_progress, blocked, done.
  Owner you or agent. Priority low, medium, high or null. Due dates are YYYY-MM-DD.
- Windows paths: a backslash in JSON must be written \`\\\\\`. Write the file with a file-writing tool or
  \`tracker_update\`, not a shell heredoc or \`echo\`, which can eat backslashes (\`C:\\Users\\rober\` turning into
  \`C:Users\\rober\` with a line break). In a project note the folder line looks like
  - Folder: \`C:\\Users\\rober\\Desktop\\MyProject\`  (the tracker links the folder through this line).
- A file holds at most 2,000 changes and is at most 5 MB. Archived projects can't be changed.
- Invalid files are moved to rejected/ with a <name>.error.txt that says why. Nothing is applied from them.
- First run on an empty tracker: write one bootstrap file that creates every project with its tasks, subtasks,
  notes and dependencies. Use upserts with keys so later runs can resend safely.
`;

export function updateFileJsonSchema() {
  return zodToJsonSchema(UpdateFile, { name: 'UpdateFile', $refStrategy: 'none' });
}

export function snapshotJsonSchema() {
  return zodToJsonSchema(Snapshot, { name: 'Snapshot', $refStrategy: 'none' });
}

export function agentPrompt(folder: string, empty: boolean): string {
  if (empty) {
    return [
      `My project tracker is empty and you're going to fill it. Its agent folder is: ${folder}`,
      '',
      'Read AGENT.md in that folder first and follow it. Then write ONE bootstrap update file to inbox/ that creates my',
      'projects, with their tasks, subtasks, notes and dependencies, from what you know about my work. Use upserts with',
      'keys so later runs can resend safely. Ask me questions in the same file about anything only I would know.',
    ].join('\n');
  }
  return [
    'Update my project tracker with what we have worked on in this chat.',
    '',
    `The tracker's agent folder is: ${folder}`,
    'First read AGENT.md there and follow its rules, then read snapshot.json (what the tracker holds now) and any new',
    'files in answers/ (my answers to your earlier questions). Then write ONE update file to inbox/ that covers:',
    '',
    '- Progress: tasks started, finished or blocked (status, and the reason if blocked); subtasks ticked off.',
    '- New work: new tasks and subtasks we decided on, with owner, priority, estimate_minutes (your honest guess)',
    '  and a due date (YYYY-MM-DD) when we agreed one. Give every task a one to three sentence description: what it',
    '  is and what "done" looks like. Add a new project (upsert with a key) only if the work belongs to none of mine.',
    '- Changes: due dates moved, priorities changed, tasks renamed or reordered, dependencies between tasks. When a',
    '  due date moves, add a line to the task description saying why.',
    '- One next step: leave exactly one task per project in_progress, or the only high priority among the open ones.',
    '- Notes: decisions, where things live, how to run or build things. Add to the project note; keep what is already',
    '  there. It starts with a "## Where it lives" section holding "- Folder: `<the project folder\'s full path>`",',
    '  and ends with a "## Log" section: add one line for this session, newest first,',
    '  "- YYYY-MM-DD · ~time spent · what got done" (a shipped version gets its own line). Keep the newest 30.',
    '- Ideas: add every feature or plan idea we came up with but did not decide on as an idea (upsert on entity',
    '  idea, with its project). Ideas I wrote for you (added_by "you") that fit this work: turn them into tasks and',
    '  mark them picked up.',
    '- Milestones: a new version, a new feature or a major change we finished or planned becomes a milestone',
    '  (upsert on entity milestone with a key): kind, version, status, a short description and what was achieved.',
    '- Messages: read my notes and "do next" tasks in the snapshot\'s messages, act on the ones about this work, and',
    '  answer them in message_replies.',
    '- Questions: anything only I can answer, instead of guessing.',
    '',
    'Match existing items by their id or key so nothing is duplicated, and use base_version from the snapshot.',
    "Don't delete anything unless I asked. Keep the summary to one plain sentence. Set agent to the app you are and",
    'the project, for example "Claude Code · <project>" or "Antigravity · <project>". When the file is written, tell me',
    'in two or three lines what you sent.',
  ].join('\n');
}
