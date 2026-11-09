# Changelog

All notable changes to Hive are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/saiharsha03/hive/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/saiharsha03/hive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/saiharsha03/hive/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/saiharsha03/hive/releases/tag/v0.1.0
