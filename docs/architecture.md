# Hive architecture

This page describes how Hive is built, as the code on `main` stands. The README says what Hive does;
[CONTRIBUTING.md](../CONTRIBUTING.md) says how to work on it. File names below are under `src/` unless noted.

## Process model

Hive is an Electron app with three kinds of code and one rule: anything privileged happens in the main process.

```
 renderer (React)                preload                     main process (Node)
 ───────────────────            ─────────────               ────────────────────────────────────────
 threads, panels,      invoke    window.api      ipcMain    index.ts   IPC handlers, window, menus
 settings, composer  ───────►   (contextBridge) ────────►   chat.ts    one Agent SDK query per thread
                     ◄───────                   ◄────────   status.ts  idle query for account + usage
                      events     chat:event,                git.ts, devStack.ts, pull.ts   plain git
                                 todos:changed, ...         terminal.ts                    node-pty
                                                            watchers.ts, dependabot.ts     schedulers
                                                            search.ts ──► searchWorker.ts  (worker thread)
                                                                 │
                                                                 ▼
                                                     Claude Code engine (child process per query)
```

- **Main** (`main/index.ts`) creates the window, registers the `hive-file:` protocol, wires every IPC handler and
  starts the background services (search indexing, watchers, the Dependabot reviewer, the status process).
- **Preload** (`preload/index.ts`) exposes `window.api`: request/response calls over `ipcRenderer.invoke` and a few
  subscriptions (`chat:event`, `todos:changed`, `watchers:changed`, `search:progress`, ...). The renderer gets no
  other Node or Electron access.
- **Renderer** (`renderer/src`) is React 19 with plain hooks and small stores (`statusStore.ts`, `threads.ts`,
  `tabs.ts`). Each tab folds its chat events into a session view (`chat.ts`) and a live status
  (`shared/statusCore.ts`).
- **Shared** (`shared/*Core.ts`) holds the decisions as pure functions: parsing, schedules, reducers, the deploy
  wizard state machine, git output parsing, worktree plans. No Electron, no I/O, which is why most of the test
  suite can exercise them directly.

The page never names a command. Buttons send an identifier (a script name, a repo folder Hive already listed, a
deploy step) and main looks up what to run in its own configuration.

## One SDK query per thread

Every open thread is one long-lived `query()` from `@anthropic-ai/claude-agent-sdk` in **streaming-input mode**
(`main/chat.ts`). The prompt is an async iterable Hive keeps open, so each new message is pushed into the same
Claude Code process. The conversation continues, the prompt cache stays warm, and resuming a past session is just
`resume: <sessionId>` on a new query.

- **Engine.** `main/engine.ts` points the SDK at the user's installed `claude` executable when there is one (the
  same version as their terminal), else the copy bundled with the SDK. Hive reuses the user's login, settings,
  `CLAUDE.md`, skills, plugins, hooks and MCP servers through `settingSources: ['user', 'project', 'local']`.
- **System prompt.** The `claude_code` preset plus a short appendix that tells the agent it runs inside Hive and
  which Hive tools it has.
- **Events.** Every SDK message is sent to the tab as a `chat:event`, with partial messages on for streaming.
  `main/liveStatus.ts` adds hooks (a Stop hook that reports scheduled loops and effort, `/goal` verdicts tailed
  from the transcript) and answers the UI's questions about models, commands and MCP servers.
- **Queue.** Messages typed while a turn runs wait in `main/queueCore.ts`, not in the SDK, so they can still be
  edited, removed or sent now; the next one is handed over when the turn's result arrives.
- **Permission modes.** Foreground threads run in bypass mode (there are no approval prompts yet, and the composer
  says so). Background threads, the ones Hive or another thread started, run in `auto`, where a classifier approves
  or denies each tool call (`shared/modeCore.ts`). A live query switches mode when it moves between the two.
- **Ending.** Closing a tab ends its query and any Codex runs it started. A thread whose process ended is
  remembered so another thread can still message it (Hive resumes the session) or read its last reply.

A separate idle query (`main/status.ts`) is started with a prompt stream that never sends a message. It costs no
usage and only answers control requests: account, plan, 5-hour and 7-day limits, MCP connection status.

## In-process MCP tools

Each thread's query gets an MCP server created in-process with `createSdkMcpServer` (`main/chat.ts`), so the
tools run inside Hive's main process with direct access to its state. The agent sees them as `mcp__hive__*`:

| Tool | What it does |
| --- | --- |
| `show_to_user` | Opens a file (image, HTML, PDF, video, text) in the preview panel and inline in the chat. |
| `add_todo` | Adds an item to the user's to-do list, optionally with a due date and status. |
| `search_sessions` | Keyword search over past Claude Code sessions, or within one session. |
| `organize_thread` | Pins, snoozes, closes or archives the thread, or marks it as waiting for the user. |
| `worktree` | Opens (or reuses) a git worktree of a repo for a branch or ticket; see below. |
| `dev_stack`, `dev_stack_logs` | Starts, stops or reports a configured dev stack and reads one service's logs. |
| `codex` | Runs OpenAI Codex (`codex exec`, on the user's own login) as a background subagent. |
| `list_threads`, `start_thread`, `message_thread`, `wait_for_thread` | Threads hand work to each other: start a background thread, message an existing one, wait for it to go idle and read its reply. Messages arrive labelled `[From thread "..." (id)]` (`shared/threadTalkCore.ts`). |
| `create_watcher`, `list_watchers`, `update_watcher`, `enable_watcher`, `disable_watcher`, `run_watcher_now`, `delete_watcher` | Manage watchers from any conversation. |

Tool inputs are validated with zod schemas, and the checks that matter (paths, repo names, branch names) live in
pure modules such as `shared/worktreeCore.ts` and `main/organize.ts`.

## The worktree model

Agents never edit a repo's main checkout. When a thread needs to change code it calls `worktree` with a repo and a
branch, or a ticket key plus a few words (`PROJ-123 Fix login` becomes `feat/PROJ-123-fix-login`):

1. `shared/worktreeCore.ts` plans the request: reuse a worktree that already has the branch, add one for an
   existing local branch, or create a new branch. It refuses the main checkout's branch, invalid names and repo
   names that would leave the workspace root.
2. `main/devStack.ts` carries it out under `<workspace>/.hive-worktrees/<repo>/<branch>` (configurable). A new
   branch starts from a freshly fetched `origin/<default>`, the repo's untracked root `.env` files are copied in,
   `node_modules` is linked from the main checkout, and no upstream is set, so nothing is pushed by accident.
3. `main/threadWorktrees.ts` records the link from the Claude session to the worktree in
   `~/.claude/hive-thread-worktrees.json`, so cleanup still happens after a restart.
4. When the thread is closed or archived, uncommitted work is saved as a `WIP: auto-saved when thread closed`
   commit on the branch (the copied `.env` files are never included), the worktree folder is removed and the
   branch is kept. A failing commit hook, a dev service still running from that folder, or the main checkout
   itself stops the cleanup and keeps everything.

The Git panel (`main/git.ts`) lists the repos under the workspace root plus every extra worktree, so the user can
review, commit and push what a thread did. Commits always run the repo's hooks; pushes happen only on click.

## Watchers

A watcher (`main/watchers.ts`, `shared/watchersCore.ts`, `shared/watchCore.ts`) is a scheduled agent that keeps one
long-lived background thread. Each one is a folder under `~/.claude/hive/watchers/<id>/`:

```
watcher.json     name, enabled, schedule (interval or adaptive tiers, daily / weekly report times), prompt file
prompt.md        the goal, read fresh before every run
state.json       last run per kind, the thread's session id, recent runs
memory/<id>.db   a SQLite database the watcher's agent owns
reports/         daily and weekly reports
findings.jsonl   one JSON finding per line, shown newest first
```

Every run is a new turn in the same thread, prefixed with a header (run kind, time, last run, where the memory and
reports live). A run never starts while the thread is still working. Adaptive schedules pick the sweep interval
from the weekly usage limit, so watchers slow down as the limit fills. Deleting a watcher moves its folder to
`_deleted/`. The older single "Watch" feature is migrated into a watcher called `watch` on first start.

The Dependabot reviewer (`main/dependabot.ts`) is a built-in scheduler of the same kind: once a day it lists open
Dependabot PRs with `gh` (read-only) and starts one background review thread per new PR head. It never merges,
approves or comments.

## Search

`main/search.ts` indexes the user and assistant messages of every session the sidebar lists for keyword search:
BM25 (MiniSearch). The index lives in `userData/search` and is keyed by session path, size and mtime, so only
changed sessions are re-read. (An earlier local semantic search with an embedding model kept several cores busy on
busy sessions and was removed.)

## State files

Hive keeps its own state as small JSON files; the settings store and UI state are written atomically (a temp file, then a rename).

| Where | What |
| --- | --- |
| `~/.claude/hive-settings.json` | The settings store behind the Settings tab. Seeded once from `.env` and `scripts.json`; afterwards it wins. Keys that look like credentials never enter it and stay in `.env`. |
| `~/.claude/hive-threads.json`, `~/.claude/hive-prefs.json` | Thread pins, snoozes, closes and small UI preferences (`main/uiStore.ts`), independent of how Hive was started. |
| `~/.claude/hive-thread-worktrees.json` | Which worktrees each session created, for cleanup. |
| `~/.claude/hive-todos.json` | The to-do list. |
| `~/.claude/hive-disabled-hooks.json` | Hooks switched off in the Hooks menu (Claude Code has no per-hook off flag). Every settings write first saves a `.hive-bak` copy. |
| `~/.claude/hive/watchers/` | One folder per watcher, see above. |
| `userData/search`, `userData/sessions-cache.json` | Search index and the session list cache. |
| `.env`, `scripts.json` next to the app | Workspace-specific configuration and credentials; git-ignored. |

Claude Code's own files (`~/.claude/projects/**.jsonl` transcripts, settings, plugins) are read, never rewritten,
except for the explicit hook and plugin switches.

## Test mode and test isolation

Two mechanisms keep automated runs away from real data:

- `HIVE_TEST_MODE=1` stops everything that would run on its own: watchers do not start runs, and the Dependabot
  reviewer does not review. Creating a watcher still writes its folder, so the UI can be exercised.
- Every state file has an override (`HIVE_SETTINGS_FILE`, `HIVE_ENV_FILE`, `HIVE_SCRIPTS_FILE`, `HIVE_TODOS_FILE`,
  `HIVE_WATCHERS_DIR`, or `HIVE_DATA_DIR` for the watchers root). The Vitest setup file points all of them at a
  fresh temp folder per test file, and the e2e harness does the same for the built app.

## Security notes

- The renderer is isolated: context isolation on, one preload API, links in replies open in the system browser,
  and navigation away from the app is blocked.
- Previews are served through `hive-file://<token>/<file>`, where each previewed folder gets a random host; a
  previewed page can reach files in its own folder and nothing else on disk.
- Foreground threads run with permissions bypassed, as in `claude --dangerously-skip-permissions`. That is a
  deliberate trade-off for a single-user desktop tool and is shown in the UI.
- Git actions are plain and conservative: no discard, reset, force push or `--no-verify` anywhere.

## Packaging

`electron-builder.yml` builds a Windows NSIS installer and a portable exe. node-pty, onnxruntime-node and sharp
are unpacked from the asar archive because native modules must load from real files; their N-API prebuilds work
in Electron without a rebuild. Other platforms' native binaries are left out, and so is the Claude Code binary the
SDK bundles: the installed app runs the user's own `claude`, which they need for `/login` anyway. Icons are generated from code by
`scripts/make-icons.mjs` into `build/`.
