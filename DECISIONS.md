# Decisions

Where the spec left something open, the simplest option was chosen and noted here.

## Data model

- **Dependencies have an `id`.** The pair (task_id, depends_on_task_id) is unique among live rows (a partial unique
  index), but each row also has a ULID `id` and the standard version and timestamp columns. That way the change log
  treats dependencies like any other entity, and undo can restore one.
- **One note per parent.** `GET/PUT /api/notes/:parentType/:parentId` reads and saves a single note, so notes are
  unique per (parent_type, parent_id) among live rows.
- **Ideas use the change log too**, so creating, editing and the agent marking an idea are all undoable.
- **The agent can add ideas** (beyond the spec, which only lets it mark them), for features you plan together but
  haven't decided on. `ideas.added_by` is `you` or `agent`. The agent acts only on `you` ideas; its own wait in the
  ideas box marked "from agent" until you click **Hand to agent**, which flips them to `you`. Agent ideas upsert by
  their exact text, so a resend never brings back one you dismissed or that was picked up.
- **`changes` has four extra columns**: `project_id` and `task_id` (so the feed and task history filter without
  walking the tree), `entity_label` (the item's title when it was written, for readable feed lines) and
  `reverts_batch_id` (set on the rows an undo writes).
- **`agent_files` is keyed by its own `id`**, not `file_id`, because a duplicate or a rejected attempt with the same
  `file_id` gets its own row. Inbox routes take that row id as `:fileId`. Extra columns: `body_json` (the validated
  file, needed to apply it later), `agent`, `change_count`, `batch_id`, `project_ids`.
- **`agent_questions.agent_file_row_id`** links a question to the exact file row it came with.
- **Messages for the agent** (beyond the spec): `agent_messages` holds notes and answers you leave on a task or
  idea, and "do this next" hand-offs (**Send to agent** on a task, one open at a time). Open ones from you are
  listed in `snapshot.json` as `messages`, oldest first. The agent answers in a top-level `message_replies` in its
  update file; each reply is stored under your message and marks it handled unless it says `handled: false`.
  Replies apply when the file applies, and an unknown message id rejects the file at step 4. Like questions,
  messages sit outside the change log (no undo); an open one of yours can be taken back.
- **Timestamps are UTC; "today" is the PC's local date**, since due dates are calendar dates.
- **Status `done` sets `completed_at`** in the same batch, and leaving `done` clears it. A picked-up idea gets `picked_up_at`.

## Change log and undo

- **Undo groups by item.** Reversing a batch writes one update per item holding all its fields, linked back through
  `undone_by_change_id`. Undo writes values back exactly, skipping the automatic fields above.
- **"Touched the same field since"** means a later change to that field (or a delete, restore or create of the item)
  that is still in effect: not undone itself, and not the undo of something newer. So undoing the later change first
  frees the earlier one, as the spec says.
- **Undoing a create or restore soft-deletes; undoing a delete restores.** Undoing an undo (redo) works the same way.

## Agent files

- **Upserts.** Projects match by `key`; tasks by `key` within their project; notes by their parent; subtasks by task
  and identical text (so a resent bootstrap doesn't duplicate subtasks). A `temp_id` on an upsert that matched an
  existing item means that item, so `"$proj"` works on both the first run and later runs.
- **Create where the item already exists**: a project or task key that's taken, or a second note on one parent, is
  rejected with "use upsert". Creating a dependency that already exists, or deleting one that doesn't, is a no-op.
- **Dependencies** are created and deleted by `fields: { task_id, depends_on_task_id }` (the snapshot lists
  `depends_on`, not dependency ids). Deleting one is a delete, so the file waits for review.
- **Conflicts only count changes by someone other than the agent.** An earlier agent file changing the same field
  isn't a conflict. A field where the agent's value equals the current value is never a conflict.
- **An upsert without `base_version`** on an item the agent never touched (base 0) conflicts on every field the user
  set that the agent wants to change.
- **"No update to an archived project"** covers the project itself and anything in it (tasks, subtasks, notes,
  dependencies). Archived items are also left out of the snapshot.
- **Questions are stored when the file arrives** (if it's valid), so they show in the inbox while the file waits.
  `$temp_id` references in questions resolve when the file is applied. Rejecting a file removes its unanswered questions.
- **A rejected `file_id` can be reused**: only pending and applied files count as "already seen".
- **Error files** are named `rejected/<name>.error.txt` (for `<name>.json`).
- **Tasks the agent creates** get `created_from = agent_file` and `created_from_ref = <file_id>`. Owner defaults to
  `you` unless the agent sets it.
- **The pipeline doesn't know about the folder.** `AgentPipeline.ingest(fileName, text)` takes any text; the folder
  watcher is one caller and moves files through a `FileSink`. The Phase 2 MCP server can call the same pipeline.
- Search (`GET /api/search?q=`, `search()` in `server/domain/queries.ts`) is a case-insensitive LIKE over projects,
  tasks, subtasks, notes, ideas and milestones, with title matches first. No FTS index: at a few hundred rows it
  answers instantly and needs no migration or triggers to keep in sync. Revisit if it ever feels slow.

## App

- **`npm start`** builds the web app if it's missing or older than its sources, then runs the server with `tsx`
  (no separate compile step). If port 4317 is already in use, it opens the browser on the running app and exits.
- **Environment overrides** (for tests and portable use): `TRACKER_DATA_DIR`, `TRACKER_AGENT_DIR`, `TRACKER_PORT`,
  `TRACKER_NO_OPEN=1` or `--no-open`.
- **Routing is hash-based** (`#/project/<id>/task/<id>`), so there's no router dependency and links survive reloads.
- **Inputs remember the version from when editing started.** If someone else (another tab, or the agent) saves first,
  your save gets the 409 conflict message instead of silently overwriting, and the field shows the latest value.
- **Live updates** come over server-sent events: the UI refetches after any committed change, inbox event or folder message.
- **Fonts are bundled** (@fontsource) so the app works offline.
- **A PC app without a rebuild:** the tracker stays a web app. `desktop/tray.ps1` (PowerShell + WinForms, no extra
  dependencies) runs the server, restarts it if it dies, and polls every 15 s for new questions, files to review and
  agent replies to show as notifications. The window is Edge in app mode. `scripts/desktop.mjs` makes the Start
  menu and Startup shortcuts. A Tauri or Electron shell would add an installer and a second codebase for little gain.
- **The MCP server talks to the running tracker over HTTP** rather than opening the database, so there's still one
  writer. `POST /api/agent/files` drops the file into inbox/ and waits for the watcher's decision (up to 10 s), so
  MCP updates take exactly the same path as file-based agents and are kept in applied/ like theirs.
- **Projects link to folders through the note's `Folder:` line** (already written by the bootstrap files and
  skills), not a new column; the deepest matching folder wins, so subfolders work.
- **Ask runs `claude -p` read-only** in the project folder (`--allowedTools Read Grep Glob`, `--strict-mcp-config`),
  with the item's details in the prompt, a 3-minute limit, and the answer stored as an agent reply. Questions are
  `kind = 'ask'` (migration 004 rebuilds `agent_messages` to allow it) and never appear in the snapshot.
  `TRACKER_ASK_COMMAND` swaps the command in tests.
- **Milestones are a full item type** (beyond the spec), with the change log, Undo, versions and conflicts like tasks:
  `kind` release / feature / change, `version_label` (the item's own `version` column is taken by edit tracking),
  `status` planned / achieved, `target_date`, `achieved_on` (set to today when it becomes achieved), a short
  `description` and `achieved` (Markdown bullets). Agents upsert them by `key` within the project. They show in the
  snapshot, the MCP project context and a Milestones tab: planned first by target date, then achieved newest first.
- **Project tabs:** List, Ideas (this project's ideas, with a box to add one), Milestones, Board, Timeline and
  Activity (the project's change feed with Undo, which used to sit in the side column).
- **Board** (`web/src/components/Board.tsx`): four columns (Not started, In progress, Blocked, Done) grouped the same
  way as the List tab, so a task waiting on an unfinished dependency sits in Blocked whatever its status. Dragging a
  card uses native HTML5 drag and drop and sends a normal task PATCH, so it lands in Activity with Undo; the toast
  has its own Undo. No new column or order field: cards keep the saved task order. On touch screens (no HTML5
  drag), open the card and change the status in the popup. Decided 2026-10-24.
- **Timeline** (`web/src/components/Timeline.tsx`): one row per week (Monday first) with tasks on their due date and
  milestones on their target date (achieved ones on `achieved_on`). It runs from the week of the earliest open item
  (or this week) to the last dated item, at least four weeks and at most 26. A week with 5 or more open items is
  marked busy. Built in the browser from the task and milestone lists already loaded; no new endpoint.
- **This week on Today:** `GET /api/today` also returns `week` (the next seven days, today first, with the open tasks
  due each day), `week_start` (this week's Monday) and `done_this_week` (tasks completed since that Monday, local
  dates). Shown as a strip under Focus so Focus stays at the top.
- **Ideas page** is a simple list.
- **Today (Phase 3)** is one read, `GET /api/today` (`server/domain/today.ts`): waiting for you (open questions,
  answerable in place, and agent files to review), overdue, due today, each active project's next step (same rule
  as the agent's: in progress, else the open high-priority task that isn't blocked; `pickNextStep` in queries.ts),
  blocked tasks with why, do-next hand-offs still open or finished in the last 24 hours with the agent's reply, and
  tasks completed today (local date). Archived projects are left out; paused ones don't get a next step.
  The page (`web/src/screens/Today.tsx`) is a landing dashboard that fits about one screen: tiles that filter or jump,
  one Focus list (overdue, due today and next steps merged, no task twice) with tick-to-complete plus Undo, Start
  and Send to agent, project cards, and short side cards that clamp to a few rows. Tasks open in the task popup
  in place, without leaving Today.
- **Markdown** renders with `marked`; raw HTML in notes is shown as text, never run.
- **Agent schedule: none.** The agent runs only when the user starts it (`/update-tracker`, `/sync-from-tracker`, or
  Antigravity's equivalents). A scheduled run would spend Claude usage on quiet days and make changes nobody watched.
  Decided 2026-10-23.
- **Sync between PCs: none.** The database and agent folder stay on this PC. The database can't safely run on two
  machines at once, and remote control reaches this PC anyway. Decided 2026-10-23.
- **Copy agent prompt** (`server/agent/agentmd.ts`) follows the skills' rules: estimates, descriptions, one next step,
  folder line and session log in the note, and an agent name per app. Decided 2026-10-23.
- **Project folder & Open folder button:** Projects table has a first-class `folder` column (migration 006), editable
  in the project header. An "Open folder" button opens the local File Explorer (`POST /api/projects/:id/open-folder`).
  Folder resolution (`projectFolders` and `projectForFolder`) checks `projects.folder` first, falling back to note parsing.
  Decided 2026-10-25.
- **Automatic daily backups & Back up now button:** `server/main.ts` sets up a daily background timer (every 24h) while
  the server is running in the tray, creating timestamped backups in `backups/` and keeping the newest 14. A manual
  "Back up now" button (`POST /api/settings/backup`) is available on Settings. Decided 2026-10-25.
- **Milestones kind filtering (Release history):** The Milestones tab includes quick filters (`All`, `Releases`,
  `Features`, `Changes`), letting users switch to a dedicated "Release history" view for the project. Decided 2026-10-25.
