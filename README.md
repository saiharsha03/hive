<p align="center">
  <img src="build/icon.png" width="96" alt="Hive logo, a honeycomb">
</p>

<h1 align="center">Hive</h1>

<p align="center"><b>One desk, many agents.</b><br>
A desktop app for running and steering several Claude Code agents at once.</p>

<p align="center">
  <a href="https://github.com/saiharsha03/hive/actions/workflows/ci.yml"><img src="https://github.com/saiharsha03/hive/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Windows">
</p>

---

Hive is a window around the real Claude Code engine. It runs on the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with your existing `claude` login,
so your settings, `CLAUDE.md`, memory, skills, MCP servers, plugins, hooks and subagents all keep working. What it
adds is a desk built for directing agents rather than reading every line: many threads side by side, background
work that reports back, agents that can start and message each other, and the everyday developer chores (pulling
repos, deploys, scripts, reviews) one click away.

It started as a personal replacement for an editor plus a terminal, and is shared as a working showcase.

## Highlights

- **Many threads, one window.** Up to four chats side by side; drag a tab onto a chat's edge to split. Every past
  session sits in a searchable sidebar (keyword search), grouped by date or project, with pin,
  snooze, close and archive.
- **Background agents that report back.** Start a thread in the background and keep working; it shows under
  *Working* or *Waiting for you* until it needs you.
- **Agents that talk to each other.** Through Hive's own MCP server, an agent can start a new thread, message
  another one, wait for its answer, or hand work to Codex.
- **A worktree per thread.** Any thread can ask for its own git worktree, so parallel agents never edit the same
  checkout. Closing or archiving the thread cleans the worktree up.
- **Watchers.** Persistent background agents on a schedule, each with its own thread, prompt, SQLite memory,
  reports and findings. Schedules can be fixed or adaptive: sweep less often as your weekly usage climbs.
- **Your tools, built in.** Git panel with split or unified diffs, terminal drawer, file tree, preview panel, to-dos,
  Pull latest, Dev stack, a Deploy wizard that drives your own scripts, a Scripts panel and a Dependabot reviewer.
- **Four layouts, five themes.** Default, Workbench, Thread strip & dock, and Focus, each with its own colour theme
  (Default, Monochrome, Colourful, Light, High Contrast). Tools open as popovers, modals or the bottom panel, never
  as a strip that pushes the chat down.
- **Everything editable in the app.** One Settings tab covers repos, stacks, deploy targets, scripts, watchers,
  appearance, and even the app's name and tagline.

## Features

### Chat

- Streaming replies, one-line tool rows, and file edits shown as `+12 −3 src/foo.ts` rows that open the diff.
- **Steer or queue**: send while a turn is running to steer it, or queue the message for after.
- Paste or drop images and files. A clipboard chip offers the latest screenshot or copied text as an attachment.
- The **`/` menu** lists every slash command the engine supports, including `/goal`, `/loop`, `/clear` and your
  own skills.
- **Model and effort pickers** switch the running session live. `ultrathink` is highlighted as you type.
- A **status strip** shows an active goal and its running time, loops, subagents, live workflow progress and
  background tasks, each with a Stop button.
- **Clean copy** puts a reply on the clipboard as both HTML and plain text, so tables paste properly.
- Security warnings from hooks and plugins show in the thread, not just in a log.

### Threads and agents

The `hive` MCP server is attached to every session Hive starts and gives the agent these tools:

| Tool | What it does |
|------|--------------|
| `start_thread`, `message_thread`, `wait_for_thread`, `list_threads` | Start, message and wait on other threads |
| `organize_thread` | Pin, snooze, close or archive a thread |
| `worktree` | Give the thread its own git worktree |
| `codex` | Run a task with the Codex CLI as a subagent |
| `create_watcher`, `update_watcher`, `run_watcher_now`, `list_watchers`, `enable_watcher`, `disable_watcher`, `delete_watcher` | Manage watchers from any chat |
| `search_sessions` | Search past sessions |
| `show_to_user` | Open a file, image, page or PDF in the preview panel |
| `add_todo` | Add to the to-do list |
| `dev_stack`, `dev_stack_logs` | Start, stop and read logs from the local dev stack |

Background threads run in plain auto mode. Hive adds no allow-lists or guards on top of what Claude Code itself
does.

### Watchers

A watcher is a scheduled agent with a durable home under `~/.claude/hive/watchers/<id>/`:

- `watcher.json`: name, goal, schedule, working folder
- a prompt file, written as goals rather than steps
- `memory/*.db`: SQLite memory the agent reads and writes between runs
- `reports/` and `findings.jsonl`: what it produced, listed in the Watchers view

Each watcher keeps one persistent thread, so every sweep continues the same conversation. Schedules are `every`
intervals, daily and weekly report times, or **adaptive** tiers keyed to your 7-day usage. The default,
`50:1h,60:3h,70:6h,100:1d`, means hourly below 50%, every 3 hours up to 60%, every 6 hours up to 70%, and daily
above that. Watchers can be toggled from the sidebar, managed from the top bar, or created by asking any agent.

### Code

- **Git panel**: repos under your workspace root and their worktrees, with branch, ahead and behind. Stage,
  unstage, commit (the repo's hooks run), switch or create a branch, see recent commits, and push only when you
  click Push. There are deliberately no discard, reset or force buttons.
- **Diff viewer**, split or unified, switchable.
- **Terminal drawer** (xterm.js and node-pty) in the bottom panel.
- **File tree** with git status colours, following the open thread's repo.

### Workspace tools

- **Pull latest**: fetches every repo under the root and fast-forwards each default branch. Repos with uncommitted
  changes, or branches with unpushed commits, are left alone. *Check only* reports what it would do.
- **Dev stack**: start and stop your local services (databases, APIs, web apps) by stack, with ports and logs.
- **Deploy**: a wizard over your own deploy scripts. Hive shows the diff and the landed check, and the script does
  the work.
- **Scripts**: one-click buttons for your recurring commands, with live output, Stop, a log per run, and an optional
  file to open when the run finishes.
- **Dependabot reviewer**: reviews open Dependabot PRs on the repos you list, in a background thread.
- **File drop**: drop a CSV, Excel, PDF or JSON file on the window to start one of your skills on it in the
  background (`HIVE_DROP_SKILLS`).

### Also

To-dos panel, MCP server status (connected, needs sign-in, failed), hooks and plugins switches, account and usage
limits in the status bar, a command palette (Ctrl+K), and a preview panel for images, HTML, PDFs, video and text.

## How it works

```
 ┌───────────────────────── Electron main ─────────────────────────┐
 │  one long-lived SDK query per thread (streaming input)         │
 │  hive MCP server (in-process tools) · watchers scheduler       │
 │  git / pull / deploy / scripts / terminal (plain processes)    │
 │  state: ~/.claude/hive-*.json, ~/.claude/hive/watchers/        │
 └───────────────▲────────────────────────────────┬────────────────┘
                 │ IPC (preload bridge)             │ events
 ┌───────────────┴──────────── renderer (React) ────▼────────────────┐
 │  layouts × themes · threads · chat panes · popovers · panels   │
 └─────────────────────────────────────────────────────────────────┘
```

Each thread is one Claude Agent SDK `query()` kept open in streaming-input mode, so messages, steering, model and
effort changes all go to the same live process. Plugins that only draw in a terminal are switched off for Hive
sessions through the SDK's flag-settings layer. They stay on in your terminal, and no settings file is written. App
state lives in small JSON files written atomically, so a crash never leaves them half-written.

[`docs/architecture.md`](docs/architecture.md) has the full write-up.

## Getting started

**Prerequisites**

- Windows 10 or 11. Other platforms are untested.
- Node 22 or newer.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude`, then `/login`).
- Optional: the [GitHub CLI](https://cli.github.com/) for the Dependabot reviewer, and the Codex CLI for the `codex`
  tool.

Hive uses your Claude subscription. If `ANTHROPIC_API_KEY` is set, the SDK uses that instead.

**From source**

```sh
git clone https://github.com/saiharsha03/hive.git
cd hive
npm install
npm run dev        # development, with hot reload
npm run build      # production build into out/
npm start          # run the production build
```

If the Electron window doesn't open after install, fetch its binary once with `node node_modules/electron/install.js`.

**Installer**

`npm run dist` builds a Windows installer and a portable build with electron-builder. The release workflow
publishes both to GitHub Releases when a version tag is pushed.

## Configuration

Everything is editable in **Settings**, which saves to `~/.claude/hive-settings.json`. On first run Hive seeds that
file from two optional local files, both git-ignored:

- `.env`: workspace values such as the repos root, stacks, deploy targets and file-drop skills. Copy
  [`.env.example`](.env.example) for the full list with comments.
- `scripts.json`: the Scripts panel buttons. Copy [`scripts.example.json`](scripts.example.json).

The app name and tagline are settings too (Settings > General), so Hive can be renamed without touching code.

## Read this before using it

- **Sessions run without approval prompts.** Claude can run commands and edit files without asking, like
  `claude --dangerously-skip-permissions`. The message box says so.
- **The hooks and plugins switches change your real Claude Code settings.** Every write saves a `.hive-bak` copy
  first.
- Don't continue the same session in Hive and in a terminal at the same time: both write to one transcript.

## Development

```sh
npm run check      # typecheck + lint + unit tests
npm test           # Vitest unit tests
npm run e2e        # build, then Playwright end-to-end tests against the real app
```

The end-to-end suite drives the built Electron app through threads, slash commands, pickers, panels, watchers,
deploy and Pull latest. It runs in **test mode** (`HIVE_TEST_MODE`) against an isolated data folder, so tests never
send email, post alerts, push, deploy or touch your real Hive state. Anything with outside effects answers with a
"test mode: … is off" message instead of running, and the tests check for that message.

CI runs typecheck, lint, unit tests and a build on Windows and Ubuntu for every push and pull request.

## Tech stack

Electron · React 19 · TypeScript · electron-vite · Claude Agent SDK · xterm.js and node-pty · MiniSearch ·
Vitest · Playwright · electron-builder

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
