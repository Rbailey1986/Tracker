# Tracker

A personal, PC-only tracker for all your projects. It's a local web app with a SQLite database, a full change log
with undo, and a folder through which an AI agent feeds in projects, tasks and notes. The agent is the main source of
data; you review, adjust and tick things off.

This is Phase 1 of the build spec.

## Start

Needs Node 20 or later.

### Standard Windows Setup Wizard (.exe)

You can run the standard Windows Installer setup wizard:
* **Installer file**: `dist-installer/Tracker-Setup-0.1.0.exe` (38 MB standalone setup file)
* To rebuild the installer at any time:
  ```powershell
  npm run build:installer
  ```
The installer:
* Installs Tracker to `%LOCALAPPDATA%\Programs\Tracker` (per-user, no administrator elevation required).
* Bundles all pre-built web assets, server files, and dependencies (no waiting for `npm install`).
* Creates Desktop, Start Menu, and Startup tray shortcuts.
* Automatically configures MCP tools for Antigravity and Claude Code.
* Adds a standard Windows uninstaller to **Installed Apps / Add or Remove Programs**.

### 1-Click Script Installer (Windows)

Alternatively, if working directly inside the project repository, double-click **`install.bat`**.

To uninstall shortcuts and MCP configurations anytime, run **`uninstall.bat`**.

### Manual Start

```
npm install
npm start
```

The app opens at http://127.0.0.1:4317. A new install is empty: click **Copy agent prompt**, paste it into Claude
(Claude Code or the desktop app with the folder connected), and the agent's bootstrap file fills the tracker.

## As a PC app (Windows)

```
npm run desktop:install    build Tracker.exe, Start menu shortcut "Tracker", and start with Windows
npm run desktop:remove     take the shortcuts away again
```

**Tracker.exe** (`desktop/app`, a small .NET 8 WinForms + WebView2 app) shows the tracker in its own window with
its own taskbar icon: open it, right-click the taskbar icon, **Pin to taskbar**. If the server isn't running it
starts the tray and waits for it. Only one window opens; starting it again brings that window forward. It
remembers its size and position. Building it needs the .NET 8 SDK; without it the shortcut opens Edge app mode.
`desktop/app/make-icon.ps1` redraws `tracker.ico`.

The tray icon (blue tick) runs the server hidden and restarts it if it stops. Left-click opens the tracker window;
right-click has Open agent folder, Restart server and Quit. It shows a Windows
notification when the agent asks something, a file waits for review, or the agent replies to one of your notes.
Server output goes to `%APPDATA%\Tracker\server.log`.

## Linked to Claude Code

```
npm run claude:install     the tracker MCP server for every folder, plus two hooks
npm run claude:remove      undo both (settings.json is backed up first)
```

- **MCP server** (`mcp/tracker-mcp.mjs`): `tracker_projects`, `tracker_project` (no argument = the project for the
  current folder), `tracker_search` (text across every project), `tracker_rules`, `tracker_update` (sends an update file and reports at once whether it applied)
  and `tracker_reply` (answers one of your notes). Updates still go through the inbox, so checks, review and Undo
  stay the same.
- **Hooks** (`mcp/hook.mjs`): when a chat starts in a project folder, Claude gets that project's next step, your
  open notes, do-next tasks and answers. On each message after that, anything new since. Quiet when the tracker
  isn't running or the folder isn't linked.
- A folder is linked through the `- Folder: \`<path>\`` line in the project's note; subfolders count too.
- `node scripts/check-mcp.mjs` checks the MCP server against the running tracker without changing anything.

## Linked to Gemini in Antigravity

```
npm run antigravity:install    the tracker MCP server and both tracker skills for Antigravity
npm run antigravity:remove     undo both (mcp_config.json is backed up first)
```

- Adds `tracker` to `~/.gemini/config/mcp_config.json`, with the same tools as in Claude Code.
- Copies `update-tracker` and `sync-from-tracker` from `~/.claude/skills` to `~/.gemini/config/skills`, so
  `/update-tracker` and `/sync-from-tracker` work there too. The copies sign files as `Antigravity · <project>` and
  pass the workspace folder to `tracker_project`, since Antigravity runs one MCP server for every folder. Run the
  install again after changing the Claude skills.
- No hooks: Antigravity has none, so ask it to sync from the tracker at the start of a session.

## Ask

Every task and idea has **Ask** next to its note box. The tracker runs Claude Code (`claude -p`) in the project's
folder, read-only (it may only Read, Grep and Glob, with no MCP servers), and the answer shows as a reply after
10-30 seconds. It uses your Claude Code login; `claude` must be on PATH.

## Where things live

| What | Where |
| --- | --- |
| Database | `%APPDATA%\Tracker\tracker.db` on Windows, `~/.tracker/tracker.db` elsewhere |
| Backups | `backups/` beside the database, one per start, last 14 kept |
| Agent folder | `~/Tracker/agent` (change it in Settings) |

## The agent folder

```
AGENT.md                        rules for the agent (written by the app)
schema/update-file.schema.json  what an update file must look like
schema/snapshot.schema.json     what snapshot.json looks like
snapshot.json                   current state, rewritten within a second of any change
inbox/                          the agent writes update files here
applied/  rejected/             the app moves files here (rejected ones get a .error.txt)
answers/                        your answers to the agent's questions
```

Clean files (no conflicts, no deletes) apply by themselves and show in the activity feed with Undo. Files with
conflicts or deletes wait in the Agent inbox for you to apply or reject. Turn off auto-apply in Settings to review
everything.

## Development

```
npm run seed         fill an empty database with the mockup's projects (dev and tests only)
npm run dev:server   API on 127.0.0.1:4317, restarts on change
npm run dev:web      Vite dev server on :5173, proxies /api
npm test             unit and integration tests (Vitest)
npm run test:e2e     end-to-end run (Playwright; first time: npx playwright install chromium)
npm run typecheck
npm run schemas      print the generated JSON Schemas
```

To try it without touching your real data, point it somewhere else:

```
set TRACKER_DATA_DIR=C:\temp\tracker-data
set TRACKER_AGENT_DIR=C:\temp\tracker-agent
npm run seed
npm start
```

## Layout

```
server/db/       migrations and database setup
server/domain/   the write path with the change log (store.ts), undo, queries, user operations
server/agent/    validation and planning, pipeline, folder watcher, snapshot, AGENT.md and schemas
server/api/      Fastify routes
shared/schemas/  zod schemas used by the server, the agent JSON Schemas and the web app
web/src/         React app: screens, components, API client
tests/           Vitest unit and integration tests, Playwright end-to-end test
```

See `DECISIONS.md` for the choices made where the spec left room.
