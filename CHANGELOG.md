# Changelog

All notable changes to Hive are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-11-10

### Changed

- Hive keeps its own state in `~/.hive`, not inside Claude Code's folder.
- Title bar, tabs, status line and the older pages follow the new frame.

### Added

- **Threads cut off when Hive closed carry on at the next start**: one message from Hive, a notice, a phone notification.
- **Phone 1.1**: a thread's mode, model and effort, Queue and Interrupt, Notes, To do, Watchers; messages as bubbles.
- The status line shows a per-model weekly limit when the plan reports one.

## [1.1.0] - 2026-11-10

### Changed

- **A new frame, laid out like a code editor**: an icon bar down the left with one icon per section. Files, Threads and
  Git open a side bar beside the tabs; Codex, Environments, Allow IP, Deploy, Notes, To do, Watchers, Running,
  Scheduled, Pull, Scripts, Dependabot, Usage, Quarry and Accounts are whole pages. The frame adapts to the window.
- **The conversation reads as a chat**: your messages in a bubble at the right, Claude's at the left, in the order
  Claude saw them. Thread groups (Pinned, Today, Yesterday, ...) fold from their heading.
- The default look takes the code editor's colours and type (Segoe UI, Consolas); Ctrl+= and Ctrl+- change the size.
- A snoozed thread stays snoozed when opened; a message brings it back.

### Added

- **Terminals of your own** in the bottom panel (new, kill, a list), beside each thread's terminal and environment logs.
- **Codex** as a section: a task box that runs `codex exec` once, with what it did and its answer.
- **Permission modes per thread** from the message box (bypass, auto, accept edits, ask, plan), with a card to allow or
  deny a tool in the modes that ask. Queue, Interrupt and Stop are always shown there; the advisor has its own picker.
- **Advisor calls** show as rows in the conversation. A question card takes number keys and Enter.
- **Activity** lists Subagents, Shells, Monitors, Wake-ups, Loops and Rewind points; a **PR gate** tab shows a
  workspace's review checklist for the commit at HEAD.
- The message box names the default model and effort and sets them; a small call names a thread after five messages.
- The status line shows every plan limit with when it resets (a per-model week too), and the Claude Code and SDK
  versions; newer ones are installed by themselves.
- Allow IP shows the command's output and can keep an address as already allowed.

### Fixed

- Watcher and Dependabot runs no longer wait on "the window is not ready" while something loads inside the page.

## [1.0.0] - 2026-11-10

### Added

- **Advisor per thread**: the model menu in the message box ends with an Advisor group (Off, Default with the
  Settings > General value, and the same models), switched live for that thread; the message box line says
  "advisor <model>" while the thread has one and nothing otherwise, and the Status page shows it.

- **Quarry inside Hive.** When the Quarry SQL app is installed (found from where it records itself, or named in
  Settings > General; "off" turns it off), Hive gets a Quarry page with Quarry's own UI, and threads get
  `quarry_connections`, `quarry_schema`, `quarry_query` and `quarry_explain`. Quarry enforces its own rules (one
  statement per call, read-only reads, no writes on production or read-only connections); a write runs only after you
  confirm that statement in the thread. Without Quarry nothing of it shows.

- **A new window.** The left rail opens on what needs you: each waiting question with its answer buttons right
  there, each failed thread with its reason and Retry. Below it, working and recent threads as plain one-line rows.
  Threads open as tabs and side-by-side panes; the right inspector has Activity (a timeline of subagents, shells,
  monitors and wake-ups with Output, Stop, Message and Open), Changes, Files and Status. Running, Scheduled,
  Deploys, Status and usage, Watchers and teams, Workspace and Settings are pages of their own.
- **Ten themes** in Settings > Appearance and the command palette: Quiet (the default), Graphite, Classic (the
  earlier Hive look), Midnight, Forest, Slate, Mocha, Light, Paper and High contrast. Ctrl+Alt+T moves to the next
  one. The editor keeps VS Code's own colours in every theme.
- **Fonts.** Inter and Cascadia Mono by default, with a choice of UI and code font in Settings > Appearance.
- **Phone app.** A "Needs me" inbox, answering a question from its notification, Stop everything, a Scheduled
  list with Run now, a usage guard and quiet hours. A relay already running must be updated for the notification
  buttons (`POST /v1/send`).
- **Advisor model** (Settings > General, empty = off): Claude Code's server-side advisor for new threads; a thread can
  pick its own, live; `/status` shows which one a thread runs with.
- **Workflows** switch (Settings > General: on, off, or Claude Code's default for your plan).
- A workflow run shows as Workflow with its script's name in Activity, on the Running page and on the phone, with Stop.
  A Workflow call in auto mode is never refused by Hive's permission handler.
- **Switch account without a restart.** Quiet threads move to the new login at once, working ones when their work
  ends; the dialog says how many follow.
- **Several accounts signed in at once.** Every login is saved as a profile (Add account is the browser sign-in once);
  switching to a saved one takes a moment, with no browser. Only the login's own keys are swapped (MCP logins and the
  CLI's other state stay), with a backup of the last five switches and a rollback if a write fails.
- Stop everything (palette and phone), optionally pausing wake-ups and automatic continues until resumed; run a
  wake-up now; quiet hours shared with the phone (desktop notifications go silent then, except failures).
- **Idle threads free their Claude process** after Settings > General "Close idle threads after" (default 30
  minutes, 0 = never); the tab stays and the next message resumes the session. A thread with anything still going
  (a turn, background work, a Codex run, a loop or wake-up, a question, a queued or unread message) never closes.
- **Defaults per kind of thread:** a background model and effort for watcher runs, Dependabot reviews and `/btw`, and a
  team model and effort for teammates (empty = the main default).
- **`/status` and `/usage`** show a live card for the thread: account, plan, model, effort, permission mode, session,
  context, MCP servers, plan limits with their reset times, and the thread's own token totals. The `/` menu also
  lists the CLI-only commands; picking one runs it in the thread's terminal.
- **Wake-ups and automatic continues** are listed in the command palette; picking one cancels it.
- **Allow my IP remembers every address it allowed**, so going between home and office no longer asks again; an
  address can be forgotten from the command palette, and Settings can make allowed addresses expire.
- Hive writes `~/.claude/usage/latest.json` from its plan-limit readings, so a usage-guard hook that reads it keeps
  working while only Hive is open.
- Threads in a repo or worktree under the workspace root share the root's Claude Code auto-memory.
- The Dependabot reviewer runs at most `HIVE_DEPENDABOT_MAX_REVIEWS` reviews at once (default 3).
- A teammate's brief carries the newest role memory within a size budget (default 6 KB per file) and names the file.
- Closing or archiving a thread that would delete worktrees asks first and lists them.
- A watcher's name in the sidebar, the title-bar list or Settings opens that watcher.
- Phone: drafts are kept per thread; every action says when it failed; the thread you start opens at once.

- **Seen by Claude.** A message shows "seen" once Claude has taken it in; one steered into a running turn says
  "not read yet" until Claude reaches it (its next step, when the running tool call ends).

- **Tool rows open.** Click a tool call to see the whole command and its output (a FAILED one too), with Copy.
- **Desktop notifications.** A Windows toast and a taskbar flash when a thread waits for you, asks a question,
  finishes, fails or hits the usage limit while Hive is not focused; clicking it opens that thread. Settings has
  the switch (on by default).
- **Drafts and tabs survive a restart.** Unsent message text and the open thread tabs come back.
- **Model change note.** A line in the conversation when the answering model changes.
- **Export.** Copy or save a conversation as Markdown from the chat header.
- **Files in the message box.** Attach or drop any file (its path goes in as `@path`), and type `@` for a file
  picker.
- **Phone app.** Claude's replies render as Markdown, message text can be selected, the thread list has search,
  pull to refresh and a time on each row.
- **Command palette finds files.** From two typed characters, files under the current folder whose name or path
  match are listed under Files (Enter opens one as a tab); matches rank label-starts-with first, then word-start,
  then anywhere.
- **Keyboard shortcuts.** Ctrl+N new thread, Ctrl+W close the tab, Ctrl+Tab / Ctrl+Shift+Tab next / previous tab,
  Ctrl+1 to 9 the Nth tab of the focused pane. Not while the terminal or the editor has the focus (except Ctrl+Tab).
- **Find in conversation.** Ctrl+F in a chat opens a find bar at the top right of the thread with n of m,
  previous / next and close.
- **Sidebar arrow keys.** Up / Down (and Home / End) move between thread rows.

- **Teams.** Ask a thread for a team: a Lead plans the job on a shared board, picks teammates from a role library,
  each teammate runs as its own thread. Team view with an animated office, chat with a teammate, pause and resume,
  and a memory per role kept across teams.
- **Wake-ups that survive restarts.** A thread can schedule its own follow-up; Hive keeps it on disk and wakes the
  thread after a restart or sleep.
- **Rewind a turn.** Put back the files Claude changed since one of your messages and fork the conversation from
  before it, or rewind the conversation only.
- **Handoff offer.** A thread that has grown large (200k tokens of context by default, `HIVE_HANDOFF_AT`) or has
  just compacted is offered a fresh thread: Claude writes a handoff file and a new thread in the same folder starts
  by reading it, taking the worktrees with it.
- **Switch account** in the status bar (Claude Code's own browser sign-in, then the app restarts on the new login).
- **`agent_status` tool.** What a thread's subagents, shells, workflows and Codex runs are doing right now.
- **Auto-update.** The installed app checks GitHub Releases at start and every 6 hours, downloads in the background
  and offers Restart to update in the status bar; the portable build shows the new version. Check for updates is
  in the command palette.
- **Phone app, Teams.** The Android app gets a Teams screen (state words, members, latest posts, Pause / Resume).
- **Deploy watch command.** `HIVE_DEPLOY_WATCH_CMD` runs your own landed check after the push and streams its
  lines into the deploy wizard.
- **Interactive CLI commands in the terminal.** Claude Code commands only the interactive CLI runs
  (`/design-login`, `/login`, `/mcp`, ...) open in the thread's terminal.
- **Claude in Chrome setting.** Threads Hive starts can use your Chrome through the Claude extension
  (`claude --chrome`); on by default, switchable in Settings.

- **Threads.** Each tab is a live Claude Code session through the Claude Agent SDK: one long-running query per
  thread in streaming-input mode, so every message continues the same conversation and reuses the prompt cache.
  Replies stream in, tool calls show as one-line rows, file edits show as `+12 −3 path` rows that open a diff.
  Messages typed while Claude works are queued and can be edited, removed or sent now.
- **Thread management.** Working and waiting states, pin, snooze, close and archive; background threads that run in
  auto permission mode; threads can start, message and wait for each other through Hive's own tools.
- **Composer.** A `/` command menu, model and effort pickers, `ultrathink` highlighting, image paste and drop,
  a one-click clipboard suggestion, and a live status strip for `/goal`, loops, workflows and subagents.
- **Session history and search.** Every past Claude Code session in the sidebar; hybrid search over them with BM25
  (MiniSearch) and local MiniLM embeddings fused by reciprocal rank, with the model running in a worker thread.
- **In-process MCP tools** for the agent: show a file in the preview panel, add a to-do, search past sessions,
  organize the thread, open a git worktree, drive the dev stack, run Codex as a subagent, talk to other threads,
  and create and manage watchers.
- **A worktree per thread.** The agent works in a git worktree made for its branch or ticket; closing or archiving
  the thread saves uncommitted work as a WIP commit and removes the worktree, keeping the branch.
- **Git panel.** Repos under the workspace and their worktrees: stage, unstage, commit (hooks always run), branch,
  log and push on click, with split or unified diffs. No discard, reset or force actions.
- **Files and preview.** A file tree with VS Code style git colours; a preview panel for images, HTML, PDF, video and
  text, served through a sandboxed custom protocol.
- **Terminal drawer.** A real shell per thread (node-pty) that survives switching tabs; closing it ends the whole
  process tree.
- **Watchers.** Scheduled background agents, each a folder with its own long-lived thread, prompt, memory, SQLite
  database, reports and findings; fixed intervals, daily and weekly report slots, or an adaptive interval that
  follows the weekly usage limit.
- **Ops panels.** Pull latest across repos, a dev stack runner (docker compose services and local processes),
  a deploy wizard driven by your own scripts, a scripts panel for recurring commands, and a daily Dependabot
  reviewer that only reports.
- **To-dos** that you and Claude can add to, with due dates and statuses.
- **Settings tab** for every feature, stored in one settings file; credential-looking keys stay in `.env`.
- **Status bar** with MCP connections, plan and 5-hour / 7-day usage, context size and prompt-cache countdown.
- **Hooks and plugins** switches for Claude Code settings, with a backup before every write.
- **Engineering.** Vitest suite (unit tests for the pure cores, integration tests against real git, pty and
  Python), ESLint with typescript-eslint and react-hooks, GitHub Actions CI on Windows and Ubuntu, and an
  electron-builder Windows installer and portable build published from version tags.

### Changed

- Background, team and watcher threads switch off the learning and explanatory output styles.
- `/btw` runs on the background model.
- Every watcher run header starts with a fixed mark, so a watcher's session stays read-only whatever it is called
  (old transcripts are still recognised). Watcher names cannot hold `[ ]` or line breaks; intervals have a 5-minute floor.
- More credential-looking keys stay out of the settings store (access keys, `*_PASS`, `*_KEY`, DSNs, webhook and
  database URLs); one effort list everywhere, with `xhigh`.
- Phone: the pairing key is kept in the phone's keystore behind its screen lock (the app needs one); pairing needs an
  `https://` relay; nothing of the app goes into a backup; a release build must be signed with your own keystore
  (`HIVE_KEYSTORE`, `HIVE_KEYSTORE_PASSWORD`, `HIVE_KEY_ALIAS`), never the debug key; the desk token goes in the
  Authorization header.
- e2e: every thread runs on Haiku at low effort without Chrome, nothing is checked against GitHub, sessions are listed
  from a seeded folder (`HIVE_PROJECTS_DIR`), and a teardown deletes the run's folder and transcripts. It still uses
  your real Claude login.
- CI: actions pinned to commit SHAs, checks on Ubuntu and the build on Windows; a manual release builds the tag given;
  Dependabot watches npm, Actions and the phone's Gradle build.

- Spinners and blinking dots stop under `prefers-reduced-motion`, not only the office view.

- **Usage in the status bar** reads the limits from the running threads within seconds of each reply, shows only
  the windows your plan has, and a thread that hits a limit continues by itself after the reset.

### Notes

First public release.
