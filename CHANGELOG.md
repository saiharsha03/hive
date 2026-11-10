# Changelog

All notable changes to Hive are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Advisor model** (Settings > General, empty = off): Claude Code's server-side advisor for new threads; a thread can
  pick its own, live; `/status` shows which one a thread runs with.
- **Workflows** switch (Settings > General: on, off, or Claude Code's default for your plan).
- A workflow run shows as Workflow with its script's name in Activity, on the Running page and on the phone, with Stop.

### Fixed

- A Workflow call in auto mode is never refused by Hive's permission handler.

### Added

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

### Fixed

- Ctrl+R and F5 no longer reload the built app (a reload stopped every thread and terminal).
- A thread started while the page was still starting is no longer stopped by the page's reset.
- A steered message Claude already read is no longer sent again after Hive was closed mid-turn.
- Messages queued in a thread whose process ended go back to its message box instead of being resent at the next start;
  a send that fails always says so on the message.
- Your own messages go through a paused team's hold; phone messages, watcher runs and automatic continues queue
  behind a running turn like a typed message; a message sent after an `ultrathink` one no longer overtakes it.
- An ended team's thread with work still running after 10 minutes stays open, marked waiting, instead of closing.
- The phone can start a thread only in a folder Hive offered it.
- File names with `[` `]` `*` `?` are plain names in the Git panel and in worktree cleanup; only real `.env` files are
  copied into a worktree (not `.envrc`), and they never land in the WIP commit.
- A cleared Worktrees folder setting is the default again (worktrees landed inside the main checkout); a quoted
  `.env` value with a comment after it loses its quotes.
- Deploy: a late diffs.sh failure no longer fails a running deploy; a failed re-watch goes back to stuck; a landed
  check fails at once on an image without a commit tag.
- Adaptive watchers no longer fall to the slowest tier after a restart; a watcher run that ends is not marked waiting;
  the read-only check catches more write commands (`gh` verbs behind flags, `git push` behind options, curl data flags,
  PowerShell `-Method:Post`).
- A wake-up or background task no longer stays "running" when its end event is missed.
- Editor: a save never overwrites a file changed on disk, and a failed save keeps the tab and its edits.
- Notes: a deleted note does not come back; a note changed elsewhere shows its new text.
- Keyboard and dialogs: one Escape closes only the top layer; dialogs keep the focus; menus, chat tabs, Git rows and
  to-dos work without the mouse.
- Much less disk reading and CPU: the session list, search index and status bar read only what changed; whole
  transcripts are streamed; the chat re-renders only threads on screen; idle language servers stop after 10 minutes.

## [1.1.1] - 2026-11-09

### Added

- **Seen by Claude.** A message shows "seen" once Claude has taken it in; one steered into a running turn says
  "not read yet" until Claude reaches it (its next step, when the running tool call ends).

### Fixed

- Run from source, Hive no longer shows a second taskbar icon beside its pinned shortcut.
- The status bar no longer runs off the right edge of a narrow window: it drops the secondary words first (reset
  times, plan, MCP detail, UI and theme names), then the account and "cache"; the hover titles keep them.

## [1.1.0] - 2026-11-09

### Added

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

### Changed

- Spinners and blinking dots stop under `prefers-reduced-motion`, not only the office view.

### Fixed

- Threads mark themselves waiting again: the prompt's waiting instruction named no tool and read as the dev
  stack's, so the sidebar and the phone were not told.
- Phone app: the thread no longer jumps to the bottom on every refresh, a failed send keeps the text, and Unpair
  asks first.

## [1.0.0] - 2026-11-09

### Added

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
- **Phone app 2.0.** The Android app gets a Teams screen (state words, members, latest posts, Pause / Resume).
- **Deploy watch command.** `HIVE_DEPLOY_WATCH_CMD` runs your own landed check after the push and streams its
  lines into the deploy wizard.
- **Interactive CLI commands in the terminal.** Claude Code commands only the interactive CLI runs
  (`/design-login`, `/login`, `/mcp`, ...) open in the thread's terminal.
- **Claude in Chrome setting.** Threads Hive starts can use your Chrome through the Claude extension
  (`claude --chrome`); on by default, switchable in Settings.

### Changed

- **Usage in the status bar** reads the limits from the running threads within seconds of each reply, shows only
  the windows your plan has, and a thread that hits a limit continues by itself after the reset.


## [0.1.0] - 2026-10-31

First public release.

### Added

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

[Unreleased]: https://github.com/saiharsha03/hive/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/saiharsha03/hive/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/saiharsha03/hive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/saiharsha03/hive/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/saiharsha03/hive/releases/tag/v0.1.0
