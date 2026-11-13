# Orbit architecture

This page describes how Orbit (called Hive until 2.0) is built, as the code on `main` stands. The README says what Orbit does;
[CONTRIBUTING.md](../CONTRIBUTING.md) says how to work on it. File names below are under `src/` unless noted.

## Process model

Orbit is an Electron app with three kinds of code and one rule: anything privileged happens in the main process.

```
 renderer (React)                preload                     main process (Node)
 ───────────────────            ─────────────               ────────────────────────────────────────
 threads, panels,      invoke    window.api      ipcMain    index.ts   IPC handlers, window, menus
 settings, composer  ───────►   (contextBridge) ────────►   chat.ts    one Agent SDK query per thread
                     ◄───────                   ◄────────   status.ts  idle query for account + usage
                      events     chat:event,                git.ts, devStack.ts, pull.ts   plain git
                                 todos:changed, ...         terminal.ts                    node-pty
                                                            watchers.ts, dependabot.ts     schedulers
                                                            sessions.ts, search.ts         session list, index
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

The page never names a command. Buttons send an identifier (a script name, a repo folder Orbit already listed, a
deploy step) and main looks up what to run in its own configuration.

## One SDK query per thread

Every open thread is one long-lived `query()` from `@anthropic-ai/claude-agent-sdk` in **streaming-input mode**
(`main/chat.ts`). The prompt is an async iterable Orbit keeps open, so each new message is pushed into the same
Claude Code process. The conversation continues, the prompt cache stays warm, and resuming a past session is just
`resume: <sessionId>` on a new query.

- **Engine.** `main/engine.ts` points the SDK at the user's installed `claude` executable when there is one (the
  same version as their terminal), else the copy bundled with the SDK. Orbit reuses the user's login, settings,
  `CLAUDE.md`, skills, plugins, hooks and MCP servers through `settingSources: ['user', 'project', 'local']`.
- **Defaults per class.** `main/settings.ts` `threadDefaults(kind)`: the user's own threads take Settings > General
  model and effort; watcher runs, Dependabot reviews and `/btw` the background ones; teammates and a team's own Lead
  the team ones (`main/threadCore.ts` `threadClass`). An empty one falls back to the main default. Claude in Chrome
  (`general.chrome`) reaches every thread except a watcher's.
- **Teams.** Orbit Teams are the team layer: Claude Code's own agent teams are not spawned in SDK sessions, and Orbit
  does not set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (what else that variable changes in the engine is not documented).
- **Advisor and Workflows.** Settings > General's advisor model and Workflows switch go to every new thread as the
  `advisorModel` and `enableWorkflows` settings (the flag-settings layer); `chat:setAdvisor` changes one thread's live.
  Orbit's permission handler lets the Workflow tool through (auto mode can hand a call to it); it is never refused.
- **Flag settings.** `main/liveStatus.ts` `sessionOptions` puts Orbit's switches in the SDK's flag-settings layer
  (above user, project and local settings, no file written): the plugins Orbit covers itself are off; unattended
  threads (background at start, teammates, watcher runs) also turn off the `learning-output-style` and
  `explanatory-output-style` plugins; and a thread whose folder is inside the workspace root or its worktrees folder
  (but is not the root) gets `autoMemoryDirectory` set to the root's auto-memory folder, so every thread shares it
  (left alone when the user set `autoMemoryDirectory` themselves).
- **System prompt.** The `claude_code` preset plus a short appendix that tells the agent it runs inside Orbit and
  which Orbit tools it has.
- **Events.** Every SDK message is sent to the tab as a `chat:event`, with partial messages on for streaming.
  `main/liveStatus.ts` adds hooks (a Stop hook that reports scheduled loops and effort, `/goal` verdicts tailed
  from the transcript) and answers the UI's questions about models, commands and MCP servers.
- **Queue.** Messages typed while a turn runs wait in `main/queueCore.ts`, not in the SDK, so they can still be
  edited, removed or sent now; the next one is handed over when the turn's result arrives. Sends to one tab go in
  the order they were made (an `ultrathink` message waits for its effort change; the ones after it wait for it). A
  paused team holds its threads' queues for team posts; what the user typed still goes through. Messages Orbit
  delivers on someone's behalf (the phone, watcher runs, automatic continues) take the same path as a window message.
- **Nothing lost.** A message sent or queued while Claude works is kept in `~/.orbit/hive-pending.json` (pictures
  as files) until Claude takes it in: the CLI echoes each message back (`replay-user-messages`) with its uuid, and
  the echo removes it (`hive_seen`); the end of the turn it rode is the fallback. On the next start what is left goes
  to its threads again, after the page has reset. When a thread's process ends by itself with messages queued or
  unread, they go back to the window (`hive_unsent`) and off the pending file.
- **Permission modes.** Foreground threads run in bypass mode (there are no approval prompts yet, and the composer
  says so). Background threads, the ones Orbit or another thread started, run in `auto`, where a classifier approves
  or denies each tool call (`shared/modeCore.ts`). A live query switches mode when it moves between the two.
- **Ending.** Closing a tab ends its query and any Codex runs it started. A thread whose process ended is
  remembered so another thread can still message it (Orbit resumes the session) or read its last reply.
- **Idle processes.** A thread whose process has been idle for Settings > General `idleCloseMinutes` (default 30,
  0 = never) closes it, like a process that ended by itself: the tab and session stay and the next message resumes
  it. Never while anything still runs or waits: a turn, background tasks (the live list and the Stop hook's
  `background_tasks`), a Codex run, session crons or loops (`session_crons`), a scheduled wake-up, an active goal, an
  open question, a queued or unread message, or a rewind. Watcher runs close themselves.
- **Account switch.** `account:switch` runs `claude auth login`; on success nothing restarts. The idle status
  process starts again, every quiet thread closes its process (its next message resumes it on the new login) and a
  busy one does the same when its work ends; the window hears `account:switched`.
- **Page ready.** The page's first effect calls `chat:reset`, which stops every live thread. The main window counts
  as ready for threads only after that reset (and not again after it starts loading), so Orbit never starts a
  thread the reset would kill. Ctrl+R / F5 reload only in development.

A separate idle query (`main/status.ts`) is started with a prompt stream that never sends a message. It costs no
usage and only answers control requests: account, plan, 5-hour and 7-day limits, MCP connection status.

## In-process MCP tools

Each thread's query gets an MCP server created in-process with `createSdkMcpServer` (`main/chat.ts`), so the
tools run inside Orbit's main process with direct access to its state. The agent sees them as `mcp__orbit__*`:

| Tool | What it does |
| --- | --- |
| `show_to_user` | Opens a file (image, HTML, PDF, video, text) in the preview panel and inline in the chat. |
| `add_todo` | Adds an item to the user's to-do list, optionally with a due date and status. |
| `add_note` | Adds to the note with that title in Notes, or makes one. |
| `notify_phone` | Sends a notification to the paired phone. |
| `search_sessions` | Keyword search over past Claude Code sessions, or within one session. |
| `rename_thread` | Names the thread (stored like Claude Code's `/rename`). |
| `organize_thread` | Pins, snoozes, closes or archives the thread, or marks it as waiting for the user. |
| `schedule_wakeup`, `list_wakeups`, `cancel_wakeup` | Wakes this thread later with a prompt, kept on disk across restarts. |
| `agent_status` | What the thread's subagents, shells, workflows and Codex runs are doing now. |
| `worktree` | Opens (or reuses) a git worktree of a repo for a branch or ticket; see below. |
| `dev_stack`, `dev_stack_logs` | Starts, stops or reports a configured dev stack and reads one service's logs. |
| `codex` | Runs OpenAI Codex (`codex exec`, on the user's own login) as a background subagent. |
| `list_threads`, `start_thread`, `message_thread`, `wait_for_thread` | Threads hand work to each other: start a background thread, message an existing one, wait for it to go idle and read its reply. Messages arrive labelled `[From thread "..." (id)]` (`shared/threadTalkCore.ts`). |
| `create_watcher`, `list_watchers`, `update_watcher`, `enable_watcher`, `disable_watcher`, `run_watcher_now`, `delete_watcher` | Manage watchers from any conversation. |
| `start_team`, `add_teammate`, `team_post`, `team_note`, `team_status`, `pause_team`, `resume_team`, `end_team` | Run a team of threads. |
| `todo_add`, `todo_update`, `todo_list` | A team's board and each teammate's own list. |
| `list_roles`, `define_role`, `remember` | The role library and the lessons kept per role and for every role. |

A watcher's thread gets only the tools that cannot start, steer or reconfigure other threads, edit code or run
services (`WATCHER_TOOLS` in `main/chat.ts`), and its shell commands go through the read-only check
(`main/readOnly.ts`).

Tool inputs are validated with zod schemas, and the checks that matter (paths, repo names, branch names) live in
pure modules such as `shared/worktreeCore.ts` and `main/organize.ts`.

## Quarry

Quarry, a separate SQL desktop app, can be used from Orbit when it is installed (`main/quarry.ts`, `main/quarryCore.ts`,
following Quarry's `docs/embedding.md`):

- **Finding it.** Settings > General `quarryPath`: a path, `off`, or empty to use what Quarry records each time it
  starts (`%APPDATA%\Quarry\install.json`, `HKCU\Software\Quarry` `InstallPath`) or a default install folder. Orbit runs
  `quarry --capabilities` and uses it only when it speaks protocol 1 with every method Orbit calls. Test mode never
  does (it would reach the user's real databases).
- **Running it.** One `quarry serve` per Orbit, started on the first call and kept: JSON-RPC 2.0 over its stdin and
  stdout, one object per line, answers matched by id (no port, no token). A serve that dies is started again after
  1 s, doubling to at most 30 s; quitting Orbit closes its stdin, which makes it finish, close its database sessions
  and exit (killed after 5 s otherwise). Its stderr is counted, never printed; call parameters are never logged.
- **The page.** Quarry's UI is served from `quarry://app/` (each file from `ui.index` / `ui.asset`) into a `<webview>`
  on the Quarry page. Main fixes that view's source, preload (`preload/quarry.ts`, which exposes
  `window.quarryHost`), sandbox and context isolation (`will-attach-webview`), keeps it from navigating away, and
  answers `quarry:invoke` and `quarry:saveFile` only from it: those are the user's own actions. The rail link and the
  palette entry exist only while Quarry is usable.
- **Thread tools.** `quarry_connections`, `quarry_schema`, `quarry_query` and `quarry_explain` call Quarry's agent
  interface, for every thread but a watcher's. Orbit adds no filter: Quarry enforces its rules itself. For a write the
  tool asks the user to confirm that statement in the thread (a question card), and only then sets `allowWrite`, as
  Quarry asks of its host.
- **Tests.** Unit tests run on a fake serve; `test/main/quarryReal.test.ts` and `e2e/08-quarry-live.spec.ts` run
  against a real Quarry only when `HIVE_QUARRY_EXE` names one. That e2e launch alone sets `HIVE_E2E_QUARRY=1`, the one
  case test mode starts Quarry: its data then lives in the run's folder (Quarry's `QUARRY_HOME`, no registry entry, an
  in-memory keyring, nothing to import), so it starts with no connections and opens none.
  `e2e/09-quarry-db.spec.ts` (also needs Docker with the `postgres:17` image already pulled; it never pulls) starts a
  throwaway Postgres container on a loopback port with an invented `orchard` schema, makes two connections through
  Quarry's bridge, runs the thread tools' own handlers against them (`quarry:e2eTool`, registered only in that run):
  list, schema, rows, a write that asks on a card and runs only on "Run it", a read-only connection that refuses it,
  and a CSV export from the embedded page (the save dialog answers a path in the run folder), then removes the container.

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
   `~/.orbit/hive-thread-worktrees.json`, so cleanup still happens after a restart.
4. When the thread is closed or archived, uncommitted work is saved as a `WIP: auto-saved when thread closed`
   commit on the branch (the copied `.env` files are never included), the worktree folder is removed and the
   branch is kept. A failing commit hook, a dev service still running from that folder, or the main checkout
   itself stops the cleanup and keeps everything.

The Git panel (`main/git.ts`) lists the repos under the workspace root plus every extra worktree, so the user can
review, commit and push what a thread did. Commits always run the repo's hooks; pushes happen only on click.

## GitHub: the read and write split

`main/gh.ts` is the only place `gh` (the GitHub CLI) runs. It exports two functions over one `execFile` runner.

- `gh(args)` reads. It rejects any `pr merge` outright, so a read path cannot write by accident.
- `ghWrite(args)` runs only what `allowedGhWrite` (`shared/prCore.ts`) accepts, and rejects the rest with
  "gh: ... is not a write Orbit makes". The allowed shapes are exactly three:
  - `pr merge <n> --squash|--merge|--rebase --match-head-commit <40-hex sha>`
  - `pr merge <n> --auto --squash|--merge|--rebase --match-head-commit <40-hex sha>`
  - `pr merge <n> --disable-auto`

  `<n>` is a positive integer. There is no `--admin`, no `--delete-branch`, no push, comment or approval.

Orbit never commits, pushes or opens a PR itself. Ship (`shared/ciCore.ts` `shipPrompt`) sends the thread a message
and the project's own rules do the rest.

## Pull request checks and merge

`main/git.ts` reads a folder's PR live and runs the decisions in `shared/`:

- `prChecks(dir)`: `gh pr view --json ...statusCheckRollup`, parsed by `ciCore.parsePrView`. `summarizeChecks` counts
  each entry as passed, failed or pending (skipped and neutral pass; cancelled and timed out fail) and gives one
  state: none, pending, failing or passing. `failingChecks` names the failed ones. `prViewError` turns "no pull
  requests found" into `null` and anything else into `{ unavailable }`.
- `prMergeInfo(dir)`: the PR (with `headRefOid`, `mergeable`, `mergeStateStatus`, `autoMergeRequest`, comments and
  reviews) plus `gh repo view` for the merge methods the repo allows. `prCore.parseMergeInfo` returns the PR, the
  method (`pickMergeMethod`: squash, then merge, then rebase) and two verdicts, `block` and `autoBlock`.
- `prMerge(dir, headSha)` runs `runMerge`; `prAutoMerge(dir, headSha, on)` runs `runAutoMerge`. Both read the info
  again right before writing and take the PR number and method from it, never from the caller. Test mode refuses.

`mergeBlock` refuses unless all of these hold: the PR is open and not a draft; it targets the repo's default branch,
which is not a release or production branch (`protectedBranch`); the head sha passed in equals the PR's current head;
checks exist and all passed; there are no conflicts and GitHub's merge state is `CLEAN`; the repo allows a method.
`autoMergeBlock` is the same list without the checks and merge-state rules, which auto-merge waits for.

`branchChanges` and `fileDiff` build the file list and one file's diff for the Changes panel and the phone. They
compare with `origin/<base>...HEAD` when the branch has a PR (`safeBranch` guards the base name), and `capDiff` cuts a
diff to 1500 lines or 200 KB.

## Auto-fix, auto-merge and auto-archive

`shared/prAutoCore.ts` holds the decisions; the Changes panel polls (every 30 s while a PR is open and something
waits on it) and sends what they return.

- `autoFixNow(state, pr)` returns a message or nothing. Only while Auto-fix is on, the thread is idle and the PR is
  `OPEN`. Failing checks are sent once per head sha (`sentSha`). Review comments (`prCore.reviewFeedback`: not by the
  PR's author; by the owner, a member, a collaborator or an app; no empty approvals, pending or dismissed) newer than
  both the switch-on time and the last ones sent are sent once (`sentAt`).
- `autoArchiveNow` is true when Auto-archive is on, the thread is idle and not archived, and the PR is merged or
  closed. The worktree and branch stay.
- "Merge when ready" is GitHub's own auto-merge (`prAutoMerge` above), not Orbit waiting.

## Agent threads

Another command-line agent runs in a terminal tab of its own. `shared/agentThreadCore.ts` is the pure part;
`main/terminal.ts` the process.

- Definitions come from Settings > Agents (`general.agents`; `parseAgents` drops entries with no name or command).
  `openTerminal(id, cwd, cols, rows, agent)` starts the agent instead of a shell. `agentLaunch` finds the command on
  PATH and wraps an npm-style `.cmd` or `.bat` for node-pty on Windows, refusing arguments with `"`, `%`, `!` or a
  line break.
- State is a guess, since the agent's conversation is not readable. `nextState(prev, signal)` takes the signals
  `output` (running), `bell` (waiting), `idle` (waiting only after `IDLE_MS` = 4 s of quiet with a last line that
  looks like a prompt) and `exit` (code 0 is exited, otherwise failed; final until a restart). `terminal.ts` raises the
  signals from the pty and calls the sink's `state`; the word in the tab, rail and running bar is `agentLabel`.
- The command palette has "New agent thread: <name>" for each definition.

## Plan approval

Plan mode follows Claude Code. `shared/planCore.ts` defines the question ("Would you like to proceed?"), its three
options and `planDecision(answer)`: the two approvals allow the tool and switch the thread to accept edits or manual;
anything else denies it, with the typed text as feedback. In `main/chat.ts` the query's `canUseTool` catches
`ExitPlanMode` (not for watchers) and sends the plan as a `hive_ask` question, so it travels like `AskUserQuestion`
(the card in `renderer/src/PlanCard.tsx`, the phone, the waiting state, a notification). It waits for the answer and
returns the decision. `nextMode` is the Shift+Tab cycle: Manual, Accept edits, Plan.

## Command panels

`/mcp`, `/agents`, `/permissions`, `/hooks`, `/memory`, `/resume`, `/branch` and `/add-dir` open in the app.
`shared/claudeConfigCore.ts` `localCommand` recognises the typed command and holds the pure reading of Claude Code's
files: subagent frontmatter, the permission rules and hooks of a settings file, where `CLAUDE.md` files are looked
for, an MCP server's row (names of variables and headers, never values). `main/claudeConfig.ts` does the I/O. MCP
state and forks go through the SDK (`mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `forkSession`); the
only files it writes are permission rules and new agent files, and it never reads `~/.claude.json` or credential
files. `main/threadDirs.ts` keeps `/add-dir` folders per tab for the app's session; `chat.ts` passes them as
`additionalDirectories` to each new process, and a running one is told at once.

## Carry-over from Hive

`main/carryOver.ts` is imported first in `main/index.ts`, before anything reads the state folder or Electron opens its
storage. `shared/carryOverCore.ts` `carryOvers` lists two places: `~/.hive` to `~/.orbit` (settings, threads, to-dos,
notes, watchers, teams, wake-ups, the phone pairing) and `%APPDATA%\Hive` to `%APPDATA%\Orbit` (the page's storage and
window state). A place is copied only when Orbit's does not exist and Hive's does. The source is only read. The copy
goes into a side folder and is renamed into place at the end, so one cut short is redone at the next start.
`skipOnCarry` leaves behind lock files, `*.tmp`, Chromium caches, the search index and sessions cache, and the
read-only Python guard the app writes again at each start.

## Phone: changes, diff and merge

`main/mobile.ts` answers requests from the phone over the relay (sealed blobs; see the README). Its dependencies are
optional, and `can(deps)` builds the capability list sent to the phone, so an older desktop and a newer phone agree on
what exists: among others `changes` (needs both the `changes` and `diff` dependencies) and `prMerge`.

- `changes`: `git.branchChanges` for the thread's folder: branch, upstream, ahead and behind, the PR with its merge
  verdict, and up to 300 files.
- `diff`: `git.fileDiff` for one path and area (`branch`, `staged`, `unstaged`, `untracked`), cut by `capDiff`.
- `prMerge`: needs `confirm: 'merge'`, a request id `mid` (at most 64 characters) and the head sha the phone showed.
  `oncePerMid` makes a repeated tap run once. The merge then goes through `git.prMerge`, so every guard above applies,
  read again live. The branch and worktree are kept.
- The **limited path**: a notification's button is sealed with a separate notification key the app can use without the
  fingerprint. `limitedRequest` accepts only `stop` and an `answer` that `phoneCore.limitedAnswer` judges harmless, and
  sends no reply. A merge is not on that path.

## Worktree toggle and `.worktreeinclude`

A new thread in a listed repo shows the Worktree toggle (`renderer/src/WorktreeToggle.tsx`; off by default, remembered
per repo). With it on, the first message calls `startThreadWorktree(folder, text, branchPrefix)` (`main/devStack.ts`,
via `main/index.ts`): a branch named from Settings > General `branchPrefix` plus a slug of the message, from the repo's
current branch, linked to the thread in `hive-thread-worktrees.json` so Changes, the PR header, Ship and cleanup work
as for the `worktree` tool.

Every worktree Orbit adds (`addWorktree`) then runs `copyIncludes`: `shared/worktreeIncludeCore.ts` parses the repo's
`.worktreeinclude` (gitignore syntax), and a file is copied from the main checkout only if it matches a pattern and git
ignores it (`git ls-files --others --ignored`), never over an existing file and never through a link. Only the count is
logged.

## Watchers

A watcher (`main/watchers.ts`, `shared/watchersCore.ts`, `shared/watchCore.ts`) is a scheduled agent. Each one is a
folder under `~/.orbit/hive/watchers/<id>/`:

```
watcher.json     name, enabled, schedule (interval or adaptive tiers, daily / weekly report times), prompt file
prompt.md        the goal, read fresh before every run
state.json       last run per kind, the thread's session id, recent runs
memory/<id>.db   a SQLite database the watcher's agent owns
reports/         daily and weekly reports
findings.jsonl   one JSON finding per line, shown newest first
```

Every run is a fresh background thread with a header (run kind, time, the last run and how it ended, where the
memory and reports live) and the prompt file, closed when the run ends (a run waiting on the user stays open until
the next run). A run never starts while the previous run's thread is still working. Adaptive schedules pick the sweep interval
from the weekly usage limit, so watchers slow down as the limit fills. Deleting a watcher moves its folder to
`_deleted/`. The older single "Watch" feature is migrated into a watcher called `watch` on first start.

The Dependabot reviewer (`main/dependabot.ts`) is a built-in scheduler of the same kind: once a day it lists open
Dependabot PRs with `gh` (read-only) and starts one background review thread per new PR head, at most
`HIVE_DEPENDABOT_MAX_REVIEWS` (default 3) working at once; the rest start on later ticks. It never merges, approves or
comments.

Scheduled wake-ups (`schedule_wakeup`, `main/threadWakeups.ts`, a SQLite table) and automatic continues after a usage
limit (`main/autoContinue.ts`) have no expiry. The window lists them (`wakeups:list`), cancels one (`wakeups:cancel`)
and hears `wakeups:changed`; the phone has the same list.

## Search

`main/sessions.ts` keeps the session list in memory. A listing re-reads only the project folders whose time changed
(a session added or removed) and the transcripts a live thread reported a turn end for; every five minutes every
file is checked again, which picks up sessions the terminal wrote. Each transcript costs its first and last 32 KB.
The list's cache file (`userData/sessions-cache.json`) is written only when something changed.

`main/search.ts` indexes the user and assistant messages of every listed session for keyword search: BM25
(MiniSearch). The index lives in `userData/search` and is keyed by session path, size and mtime, plus the byte offset
indexed so far: a transcript that grew is indexed from there on, one that shrank or was rewritten from the start. A
working thread's transcript waits until its turn ends. Indexing runs in the main process (there is no worker
thread), reading in chunks and yielding between sessions; the index is saved at most every five minutes and when
Orbit quits. (An earlier local semantic search with an embedding model kept several cores busy and was removed.)

The status bar's numbers for a session (`main/sessionStats.ts`) are read the same way: per path, only the bytes
appended since the last read. The first read of a big transcript takes its head (start time) and tail (model,
context, cache) at once and scans the middle in the background for the compaction count and the token totals.

## State files

Orbit keeps its own state as small JSON files; the settings store and UI state are written atomically (a temp file, then a rename).

| Where | What |
| --- | --- |
| `~/.orbit/hive-settings.json` | The settings store behind the Settings tab. Seeded once from `.env` and `scripts.json`; afterwards it wins. Keys that look like credentials never enter it and stay in `.env`. |
| `~/.orbit/hive-threads.json`, `~/.orbit/hive-prefs.json` | Thread pins, snoozes, closes and small UI preferences (`main/uiStore.ts`), independent of how Orbit was started. |
| `~/.orbit/hive-thread-worktrees.json` | Which worktrees each session created, for cleanup. |
| `~/.orbit/hive-todos.json` | The to-do list. |
| `~/.orbit/hive-disabled-hooks.json` | Hooks switched off in the Hooks menu (Claude Code has no per-hook off flag). Every settings write first saves a `.hive-bak` copy. |
| `~/.orbit/hive/watchers/` | One folder per watcher, see above. |
| `~/.orbit/hive-pending.json`, `~/.orbit/hive-pending/` | Messages that have not reached Claude yet, and their pictures. |
| `~/.orbit/hive-autocontinue.json`, `~/.orbit/hive/thread-wakeups.db` | Automatic continues after a usage limit, and scheduled wake-ups. |
| `~/.orbit/hive/roles/` | The team role library and each role's memory (`shared-memory.md` for all roles). |
| `~/.orbit/hive/accounts/` | Saved logins: `<id>.json` holds exactly `{ claudeAiOauth, oauthAccount }` (tokens; never sent to the page or the phone), `index.json` the email, plan and dates, `backups/` the two files before each of the last five switches (`main/accounts.ts`). |
| `~/.orbit/hive-quiet.json`, `~/.orbit/hive-usage-guard.json` | Quiet hours shared with the phone; which usage-guard steps the phone was already told. |
| `~/.orbit/hive-allowlist.json` | Every public IP the allowlist command succeeded for, with when (`main/allowKnown.ts`). |
| `~/.claude/usage/latest.json` | The latest plan-limit reading, for a usage-guard hook (`main/usageFile.ts`); written, never read. |
| `userData/search`, `userData/sessions-cache.json` | Search index and the session list cache. |
| `~/.orbit`, `%APPDATA%\Orbit` | Copied from `~/.hive` and `%APPDATA%\Hive` on the first start (see Carry-over). File names inside keep their `hive-` prefix. |
| `.env`, `scripts.json` next to the app | Workspace-specific configuration and credentials; git-ignored. |

Claude Code's own files (`~/.claude/projects/**.jsonl` transcripts, settings, plugins) are read, never rewritten,
except for the explicit hook and plugin switches.

## Test mode and test isolation

The unit tests (Vitest) never start Claude. The end-to-end suite (`npm run e2e`, Playwright) does: it drives the built
app through real Claude sessions **on the user's real Claude login**, so it uses their plan's usage. Two mechanisms
keep it away from the user's other data:

- `HIVE_TEST_MODE=1` stops everything that would run on its own: watchers do not start runs, and the Dependabot
  reviewer does not review. Actions with outside effects (commits, pushes, deploys, pulls, scripts, switching the
  account, pairing a phone) answer "test mode: ... is off" instead. Creating a watcher still writes its folder, so the
  UI can be exercised.
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

`electron-builder.yml` builds a Windows NSIS installer and a portable exe. node-pty is unpacked from the asar archive
because a native module must load from real files; its N-API prebuilds work in Electron without a rebuild. Other platforms' native binaries are left out, and so is the Claude Code binary the
SDK bundles: the installed app runs the user's own `claude`, which they need for `/login` anyway. Icons are generated from code by
`scripts/make-icons.mjs` into `build/`.
