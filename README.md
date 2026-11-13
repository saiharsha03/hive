<p align="center">
  <img src="build/icon.png" width="96" alt="Orbit logo, a satellite">
</p>

<h1 align="center">Orbit</h1>

<p align="center"><b>One desk, many agents.</b><br>
A desktop app for running and steering several Claude Code agents at once.</p>

<p align="center">
  <a href="https://github.com/saiharsha03/orbit/actions/workflows/ci.yml"><img src="https://github.com/saiharsha03/orbit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Windows">
</p>

---

Orbit (called Hive before 2.0) is a window around the real Claude Code engine. It runs on the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with your existing `claude` login,
so your settings, `CLAUDE.md`, memory, skills, MCP servers, plugins, hooks and subagents all keep working. What it
adds is a desk built for directing agents rather than reading every line: many threads side by side, background
work that reports back, agents that can start and message each other, and the everyday developer chores (pulling
repos, deploys, scripts, reviews) one click away.

It started as a personal replacement for an editor plus a terminal, and is shared as a working showcase.

<!-- screenshots to be updated: images from the Orbit 1.x layout no longer match the 2.0 shell -->

## Coming from Hive

On the first start Orbit copies Hive's data; it never moves or changes it.

- `~/.hive` is copied to `~/.orbit`: threads, to-dos, notes, watchers, teams, wake-ups, settings and the phone pairing.
- Electron's own storage (`%APPDATA%\Hive`, the page's storage and window state) is copied to `%APPDATA%\Orbit`. Lock
  files and caches that are rebuilt (including the search index) are left behind.
- The old folders stay as they are, so Hive can still run from them. A place is copied only when Orbit does not have it
  yet.
- The phone app keeps its pairing; it is the same app, now named Orbit.
- The agent's tools are `mcp__orbit__*` now. Skills, notes, hooks and permission rules that name `mcp__hive__` tools
  should say `mcp__orbit__`. Old transcripts that used the old names still read.
- Settings keys and environment variables (`HIVE_*`, `.env`, `scripts.json`) keep their names.

## Highlights

- **Laid out like a code editor.** A rail down the left with Threads, Running, Scheduled and Files, and a **More**
  menu for every other section; Terminal and Settings sit at its foot, with the plan's limits as small gauges. Files,
  Threads and Git open a side bar beside your tabs; the rest (Codex, Environments, Allow IP, Deploy, Notes, To do,
  Watchers, Board, Usage, ...) are whole pages. Your own terminals sit in a panel along the bottom. Orbit's state
  lives in `~/.orbit`.
- **What a thread has going, in view.** A running bar above the message box lists its subagents, shells and monitors;
  the thread's header shows its goal, loops and wake-ups.
- **Many threads, one window.** Up to four chats side by side; drag a tab onto a chat's edge to split. Every past
  session sits in a searchable sidebar (keyword search), grouped by date or project, with pin, snooze, close and
  archive. Threads name themselves after what you are doing, and long ones open at once (newest messages first).
- **A real code editor.** Files open as tabs next to your threads, like VS Code: Monaco with the same language
  servers VS Code runs (Pyright for Python and Django, TypeScript, Vue), so completions, hover, go-to-definition,
  rename and error squiggles work. HTML and Markdown open rendered, with a Code switch. Open in VS Code is one click
  away for debugging.
- **Background agents that report back.** Start a thread in the background and keep working; it shows under
  *Working* or *Waiting for you* until it needs you.
- **Agents that talk to each other.** Through Orbit's own MCP server, an agent can start a new thread, message
  another one, wait for its answer, or hand work to Codex.
- **Teams.** Ask for a team and a Lead thread plans the job on a shared board, picks teammates from a role library
  (Builder, Reviewer, ...), and runs them in parallel, each in its own worktree. Watch each one's state and
  latest post, chat with any teammate, pause and resume the whole team. Every role keeps a memory across teams.
- **Wake-ups that survive restarts.** A thread can schedule its own follow-up ("check the deploy at 3 PM"); Orbit
  keeps it on disk and wakes the thread even after the app was closed or the laptop slept.
- **A worktree per thread.** Any thread can ask for its own git worktree, or you switch on the Worktree toggle under
  the prompt box of a new thread, so parallel agents never edit the same checkout. A `.worktreeinclude` file in the
  repo names git-ignored files (such as `.env`) to copy in; Settings > General has a Branch prefix. Closing or
  archiving the thread cleans the worktree up.
- **Watchers.** Scheduled background agents, each with its own prompt, SQLite memory, reports and findings; every
  run is a fresh thread that picks up from what the last run saved. Schedules can be fixed, adaptive (sweep less often as your weekly usage climbs) or self-scheduled: the
  agent plans its own wake-ups in a table. Watcher threads are read-only by default.
- **Your tools, built in.** Files, Git (with the open thread's changes on top), To-dos, Notes, Scripts and Deploy
  each one click away in the top bar; Agents and the terminal in the bottom panel; Pull latest, Dev stack and a
  Dependabot reviewer.
- **One layout, ten themes.** The rail, inspector and bottom drawer toggle, and Focus hides the rest; the rail can sit
  on the right. Themes: Quiet (the default), Graphite, Classic, Midnight, Forest, Slate, Mocha, Light, Paper and High
  contrast; Ctrl+Alt+T steps through them.
- **Pull requests from the thread.** PR references in replies link to GitHub, and a pull request a thread opened shows
  on its header. Changes shows the branch, the PR and its checks. Ship asks the thread to ship by your project's rules
  (Update PR when one is open); Merge has a confirm; Merge when ready is GitHub auto-merge; Fix failing checks, or
  Auto-fix to do it on its own; Auto-archive after the PR merges or closes.
- **Other agents too.** Codex CLI, OpenCode or any command can run as a tab of its own (see Agent threads).
- **Jira board.** Your tickets as a column per status; start a thread from a card. Read-only.
- **Everything editable in the app.** One Settings tab covers repos, stacks, deploy targets, scripts, watchers, agents,
  appearance, and even the app's name and tagline.

## Keyboard shortcuts

The palette (Ctrl+K) lists most actions with their keys.

| Key | What it does |
|-----|--------------|
| Ctrl+K | Command palette |
| Ctrl+N / Ctrl+W | New thread / close the tab |
| Ctrl+\ | New thread beside this one |
| Ctrl+Tab, Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1 to 9 | Go to that tab |
| Alt+1 to 4 | Focus that chat pane |
| Ctrl+Shift+T | Reopen the last closed thread |
| Ctrl+. | Next thread that needs you |
| Ctrl+[ / Ctrl+] | Show or hide the rail / the inspector |
| Ctrl+Shift+F | Focus mode |
| Ctrl+\` | Terminal |
| Ctrl+, | Settings |
| Ctrl+Shift+R, S, D, U | Running, Scheduled, Deploys, Usage |
| Ctrl+Alt+T (Shift: back) | Next theme |
| Ctrl+Alt+1 to 9, twice | Switch new threads to that account |
| Ctrl+Alt+Esc | Stop everything |
| Ctrl+= / Ctrl+- / Ctrl+0 | Text size larger / smaller / reset |
| Ctrl+Z | Undo what the 5-second Undo offer shows (outside a field) |
| Esc | Stop the turn in a message box; close a file a thread opened; leave a whole-page section |
| Ctrl+F | Find in the conversation |
| Ctrl+B | Move everything that runs to the background |
| Ctrl+Down | Jump to the end of the conversation |

In the message box:

| Key | What it does |
|-----|--------------|
| Enter | Send (steers a running turn) |
| Shift+Enter | New line |
| Tab (turn running) | Queue the message |
| Ctrl+Enter | Send, and run the thread in the background |
| Ctrl+Shift+Enter | Stop Claude and send now (empty box: send what waits) |
| Shift+Tab | Next permission mode: Manual, Accept edits, Plan |
| Tab (empty box) | Take Claude Code's suggested next prompt, or the copied-text chip |
| Up / Down | Earlier prompts of this thread |
| Ctrl+R | Search earlier prompts |
| Ctrl+S | Put the draft aside; again to bring it back |
| Alt+P | Model picker |
| Alt+O | Fast mode on or off |
| Alt+T | Open Claude's thinking rows by default |

## Features

### Chat

- Streaming replies, one-line tool rows, and file edits shown as `+12 −3 src/foo.ts` rows that open the diff.
  Click a tool row to see the whole command and its output, so a failed step explains itself.
- **Steer or queue**: send while a turn is running to steer it, or queue the message for after.
- Paste or drop images and files (a file goes in as `@path`), or type **`@`** to pick a file from the thread's
  folder. A clipboard chip offers the latest screenshot or copied text as an attachment.
- The **`/` menu** lists every slash command the engine supports, including `/goal`, `/loop`, `/clear`,
  `/insights` and your own skills.
- **`/btw <question>`** asks a quick side question about the thread. The answer shows above the message box and
  stays out of the conversation (a throwaway fork answers it, without tools).
- **Plan approval.** When Claude finishes a plan, a card asks: approve into accept edits, approve and review each
  edit, or keep planning and say what to change. The phone gets it as a question.
- **Thinking rows**, a **context meter** with a **Compact** button, and fast mode (Alt+O).
- **Claude Code's own screens in the app**: `/mcp`, `/agents`, `/permissions`, `/hooks`, `/memory`, `/resume`,
  `/branch` and `/add-dir` open as panels instead of running in the engine.
- **Diff line comments**: the `+` beside a diff line leaves a comment; they go to the thread as one message.
- **Model and effort pickers** switch the running session live. `ultrathink` is highlighted as you type. A line in
  the conversation says when the answering model changes.
- A **status strip** shows an active goal and its running time, loops, subagents, live workflow progress and
  background tasks, each with a Stop button.
- **Rewind**: hover one of your messages and rewind to just before it. Orbit previews the files Claude changed since
  (with +/- counts), puts them back, cuts the chat to that point (the old transcript is kept as it was) and puts your
  message back in the box to edit and resend. Or rewind the conversation only.
- **Find** (Ctrl+F) searches the conversation; **Export** copies or saves it as Markdown.
- Unsent drafts and the open thread tabs come back after a restart.
- **Handoff**: a thread that has grown large or just compacted is offered a fresh one. Claude writes a handoff
  file, and a new thread in the same folder starts by reading it.
- **Clean copy** puts a reply on the clipboard as both HTML and plain text, so tables paste properly.
- Security warnings from hooks and plugins show in the thread, not just in a log.
- **★ Insight** boxes from the Learning and Explanatory output styles render as callouts.
- Background work folds to one line above the message box; click it to see each subagent's live status and message
  one directly. Finished work drops out a minute after it ends; the full history is in the Agents view. An
  interrupt stops only the turn: background agents keep running.

### Threads and agents

The `orbit` MCP server is attached to every session Orbit starts and gives the agent these tools:

| Tool | What it does |
|------|--------------|
| `start_thread`, `message_thread`, `wait_for_thread`, `list_threads` | Start, message and wait on other threads |
| `organize_thread` | Pin, snooze, close or archive a thread; mark it waiting for the user, or resolved |
| `rename_thread` | Name the thread after what the user is doing (stored like Claude Code's `/rename`) |
| `worktree` | Give the thread its own git worktree |
| `codex` | Run a task with the Codex CLI as a subagent |
| `create_watcher`, `update_watcher`, `run_watcher_now`, `list_watchers`, `enable_watcher`, `disable_watcher`, `delete_watcher` | Manage watchers from any chat |
| `search_sessions` | Search past sessions |
| `show_to_user` | Open a file, image, page or PDF in a full-window preview |
| `add_todo` | Add to the to-do list |
| `add_note` | Write to Notes (adds to the note with that title, or makes one) |
| `notify_phone` | Send a notification to the paired phone |
| `dev_stack`, `dev_stack_logs` | Start, stop and read logs from the local dev stack |
| `start_team`, `team_post`, `team_note`, `team_status`, `add_teammate`, `pause_team`, `resume_team`, `end_team` | Run a team of threads (see Teams) |
| `todo_add`, `todo_update`, `todo_list` | A team's shared board and each teammate's own list |
| `list_roles`, `define_role`, `remember` | The team role library, and lessons kept for a role or for every role |
| `schedule_wakeup`, `list_wakeups`, `cancel_wakeup` | Wake this thread later, even after Orbit was closed |
| `agent_status` | What the thread's subagents, shells, workflows and Codex runs are doing right now |

Threads on screen run in bypass mode (no approval prompts, the message box says so); background threads (hidden
tabs, and threads Orbit or another thread started) run in Claude Code's auto mode, where its classifier approves each
tool call. A thread switches live when its tab moves between the two. Orbit adds no allow-lists or guards on top of
what Claude Code itself does; watcher threads are the exception (see below).

A thread whose Claude process sits idle (Settings > General, 30 minutes by default, 0 = never) closes that process,
and the MCP servers it started, to free memory; the tab and its session stay, and the next message resumes it. A
thread with anything still going (a turn, background work, a Codex run, a loop or scheduled wake-up, an open
question, a queued message, a rewind) is never closed. Threads that work in a repo or worktree under the workspace
root share the root's Claude Code auto-memory folder, so they all see the same memory.

### Agent threads

Other command-line coding agents (Codex CLI, OpenCode, Gemini CLI, any command) run in a terminal tab of their own,
next to your Claude threads.

1. Settings > Agents: add one with a name, the command (on PATH, or a path) and its arguments on one line.
2. Start it from the command palette (Ctrl+K): *New agent thread: <name>*. It runs in a folder you pick.

Orbit cannot read another agent's conversation, so its state is a guess from the terminal: output means it works; a
bell, or four quiet seconds after a prompt, shows "needs you?"; the exit code decides exited or failed. The tab, the
rail and the running bar show it. Restart and Stop are on the tab. Each agent uses its own sign-in and permission rules, and its usage is not counted in Orbit's limits.

### Watchers

A watcher is a scheduled agent with a durable home under `~/.orbit/hive/watchers/<id>/`:

- `watcher.json`: name, goal, schedule, working folder
- a prompt file, written as goals rather than steps
- `memory/*.db`: SQLite memory the agent reads and writes between runs
- `reports/` and `findings.jsonl`: what it produced, listed in the Watchers view

Every run is a fresh thread, closed when the run ends (one waiting for you stays open until you answer or the next
run). What carries over is what the run saved (memory folder, database, findings, reports) and its final reply, which
the next run's header quotes. Runs show in their own Watchers section of the sidebar. Schedules are:

- `every` intervals, with daily and weekly report times;
- **adaptive** tiers keyed to your 7-day usage. The default, `50:1h,60:3h,70:6h,100:1d`, means hourly below 50%,
  every 3 hours up to 60%, every 6 hours up to 70%, and daily above that;
- **self-scheduled**: the agent plans its own wake-ups in a `wakeups` table in `schedule.db`, marks them done and
  finishes anything it missed. Orbit only wakes it, with a one-line note and no instructions; with nothing pending it
  wakes after 6 hours. Every time Orbit starts, each self-scheduled watcher gets a catch-up wake that says when Orbit
  was last running.

**Watcher threads are read-only.** Shell commands that write (`gh` writes, `git push`, curl or PowerShell sending
data) are refused; Python HTTP calls other than reads raise an error (a few read-only search POSTs are allowed:
Jira, Gong, Datadog, the Salesforce sign-in); Postgres sessions open read-only; and watchers get only the Orbit tools
that cannot start or steer other threads. Alert channels you allow (Settings > General, by the SHA-256 fingerprint
of the webhook, so the URL itself is never stored) are the one way they can post. This is best-effort, not a
sandbox: read-only credentials are the only airtight guarantee.

Watchers can be toggled from the sidebar, managed from the Watchers view (the Watchers button in the top bar), or
created by asking any agent.

### Pull requests

A thread's **Changes** panel shows its branch, its files and its pull request with the state of its checks. Orbit
never commits or pushes itself: Ship (Update PR when one is open) sends the thread a message to do it by the
project's own rules. The one thing Orbit writes to GitHub is a merge, and every merge goes through these guards:

- the PR is open, not a draft, and targets the repo's default branch (never a release or production branch);
- the head commit is the one on screen (`--match-head-commit`), so a push since you looked refuses the merge;
- all checks have reported and passed (there must be some), GitHub says the PR is clean (no conflicts, not behind,
  not blocked), and the repo allows a merge method (squash, then merge, then rebase);
- a confirm shows the PR, the method and the checks before **Merge**; **Merge when ready** turns GitHub's auto-merge
  on or off under the same rules, minus the checks it waits for;
- no `--admin`, no `--delete-branch`.

**Auto-fix** asks the thread to fix failing checks once per head commit, and to answer new review comments from the
owner, members, collaborators or apps once; it only acts on an idle thread with an open PR. **Auto-archive** archives
the thread after the PR merges or closes.

### Teams

Ask any thread for a team and it becomes the team's **Lead**, or its **Owner** with a separate Lead thread that
reports back. The Lead breaks the job into items on a shared to-do board, picks how many of each role it needs
(roles may repeat: two Builders and a Reviewer), and each teammate runs as its own thread, usually in its own
worktree. A team lives in `~/.orbit/hive/teams/<id>/`: `team.json` (who is in it), `plan.md`, `knowledge.md` (what
the team learned) and `log.jsonl` (every post).

- **Team view** in the bottom panel, or popped out into its own window: a roster with each member's role,
  state and latest post, beside the log, the plan, the boards and what was learned. Message any member or a
  whole role from there.
- **Role library** in `~/.orbit/hive/roles/`: each role has editable instructions and a memory of what everyone in
  that role learned, kept across teams, plus one shared memory for all roles.
- **Pause and resume** a whole team; a running team picks up again after Orbit restarts.
- Running teams sit folded in the sidebar, each member with its role word (LEAD, BUILDER, REVIEWER).

Push, merge and deploy decisions go back to you; the Lead does not make them.

### Code

- **Editor**: any file from the file tree opens as a tab next to the threads. Monaco (the editor inside VS Code),
  with tabs you can drag and split like threads, an unsaved dot, Ctrl+S, and a prompt when the file changes on disk
  while you edit it. Closing a tab with unsaved changes asks Save / Discard / Cancel.
- **Language servers**, one per language per repo, started on the first file you open there: Pyright (Python and
  Django, using the repo's `.venv` / `venv`), typescript-language-server (using the repo's own TypeScript) and Volar
  (Vue). Completions, hover, go-to-definition across files, references, rename and diagnostics.
- **HTML and Markdown** open rendered, with a **Rendered | Code** switch; images, PDFs and media are shown.
- **Git**: the open thread's changed files on top, then the repos under your workspace root and their worktrees,
  with branch, ahead and behind. Stage, unstage, commit (the repo's hooks run), switch or create a branch, see recent
  commits, and push only when you click Push. There are deliberately no discard, reset or force buttons.
- **Diff viewer**, split or unified, switchable.
- **Terminal drawer** (xterm.js and node-pty) in the bottom panel.
- **File tree** with git status colours, following the open thread's repo.

### Workspace tools

- **Pull latest**: fetches every repo under the root and fast-forwards each default branch. Repos with uncommitted
  changes, or branches with unpushed commits, are left alone. *Check only* reports what it would do.
- **Dev stack**: start and stop your local services (databases, APIs, web apps) by stack, with ports and logs.
- **Deploy**: a wizard over your own deploy scripts. Orbit shows the diff and the landed check, and the script does
  the work.
- **Scripts**: one-click buttons for your recurring commands, with live output, Stop, a log per run, and an optional
  file to open when the run finishes.
- **Dependabot reviewer**: reviews open Dependabot PRs on the repos you list, in a background thread.
- **File drop**: drop a CSV, Excel, PDF or JSON file on the window to start one of your skills on it in the
  background (`HIVE_DROP_SKILLS`).

### Also

- **To-dos** and **Notes** (markdown files in `~/.orbit/hive/notes`, searchable, saved as you type). Ask any thread
  to note something and it writes to Notes (`add_note`: adds to the note with that title, or makes one).
- **Auto-update**: the installed app checks GitHub Releases at start and every 6 hours, downloads a new version in
  the background and offers *Restart to update* in the status bar (it also installs when you quit). The portable
  build shows *vX available* and opens the release page. *Check for updates* is in the command palette.
- **Account and usage** in the status bar: the plan's 5-hour and 7-day limits (only the windows your plan has), read
  from the running threads within seconds of each reply, and **Switch account** (Claude Code's own browser
  sign-in). Nothing restarts: quiet threads move to the new login at once (their next message resumes the session
  on it) and busy ones when their work ends. A thread that hits a usage limit continues by itself
  after the reset, or as soon as any turn goes through again.
- **Desktop notifications**: a Windows toast and a taskbar flash when a thread waits for you, asks a question,
  finishes, fails or hits the usage limit while Orbit is not focused. Clicking it opens the thread; Settings has the
  switch.
- **Allow my IP**: a button for your own allowlist command (`HIVE_ALLOWLIST_CMD`), lit when your public IP changes.
- MCP server status (connected, needs sign-in, failed), hooks and plugins switches, a command palette (Ctrl+K) that finds
  threads, tools and files, and a full-window preview for what Claude shows you.
- **Keys**: see Keyboard shortcuts below.

### Phone app

An Android app (`mobile/`) for when you're away from the computer:
- Claude's notifications reach your phone: the `notify_phone` tool, a thread waiting for you, a background thread finished.
- You can read threads (replies render as Markdown), send or steer, answer Claude's questions, stop Claude or one
  of its background tasks, and start a new thread in any repo. The thread list has search and pull to refresh.
- Teams (members, latest posts, Pause / Resume), scheduled wake-ups (with Cancel) and plan usage have their own
  screens.
- Per thread: its permission mode, model and effort, and Queue or Interrupt while Claude works. Notes, To do and
  Watchers (with Run now) have screens too.
- **Changes** for a thread: its branch, pull request and files, and one file's diff (long diffs are cut). **Merge**
  asks for a confirm and follows the same guards as the computer, with the head commit the phone showed; a second tap
  before the screen redraws sends nothing.
- A fingerprint (or the screen lock) opens the app.

The phone and Orbit never talk directly. Both dial out to a small **relay** (`relay/relay.mjs`), so neither has to be
reachable from the internet. The relay only passes blobs sealed with AES-256-GCM, using a key that only your computer
and phone have. A relay that gets broken into can't read or send your messages; at most it can drop them.

**1. Firebase (for notifications).** Create a free Firebase project and add an Android app with package name
`dev.hive.mobile`. You need two files from it, and neither goes in git:
- `google-services.json`: the app is built with it.
- a service-account key (Project settings > Service accounts > Generate new private key): the relay sends pushes
  with it.

The pushes are data-only and still sealed: the app opens them on the phone, so Google never sees the text.

**2. Run the relay**, in one of two ways (Node 20+; `cd relay && npm install`). A relay you already run must be updated
to this version for the phone app's notification buttons (Stop, a one-tap answer) to work: they post through its new
`POST /v1/send` while the app is closed.

- **On a server you have (VPS)**, behind a reverse proxy with TLS. With Caddy:

  ```
  hive.example.com {
      reverse_proxy 127.0.0.1:8787
  }
  ```

  and start it as a service, for example with systemd:

  ```
  HIVE_RELAY_ADMIN_TOKEN=<long random string> HIVE_RELAY_FCM_ACCOUNT=/path/service-account.json node relay.mjs
  ```

- **No server**: run the relay on your own computer and publish it with a free Cloudflare Tunnel:

  ```
  winget install Cloudflare.cloudflared        # or brew install cloudflared
  node relay/relay.mjs                         # with the same environment variables as above
  cloudflared tunnel --url http://127.0.0.1:8787
  ```

  cloudflared prints an `https://….trycloudflare.com` address; that is your relay URL. A quick tunnel gets a new
  address every time it starts. For a fixed one, log in (`cloudflared tunnel login`) and create a named tunnel on
  your own domain. The phone can reach Orbit only while the computer is on, which is true of any setup.

**3. Pair.** In Orbit, open Settings > General and set the relay URL (`HIVE_MOBILE_RELAY`) and the same admin token
(`HIVE_MOBILE_ADMIN_TOKEN`). Then use **Phone app > Pair**: Orbit shows a QR code holding the relay URL, the pair id,
the phone's token and the key. Scan it from the app (or paste it); it is shown once.

**4. Build and install the app.** Put `google-services.json` in `../Hive-mobile/secrets/` next to the Orbit checkout
(or point `HIVE_FIREBASE_DIR` at it). Then run `cd mobile && ./gradlew assembleDebug` (JDK 17+, Android SDK 35), and
install `app/build/outputs/apk/debug/app-debug.apk` with `adb install` or by copying it to the phone.

For the copy you keep on your phone, build a release (`./gradlew assembleRelease`) signed with **your own** keystore,
never the debug key (its password is public, so anyone could sign an update that replaces the app). Name it in
`~/.gradle/gradle.properties` or the environment, never in the repo: `HIVE_KEYSTORE` (the `.jks` file),
`HIVE_KEYSTORE_PASSWORD`, `HIVE_KEY_ALIAS` (and `HIVE_KEY_PASSWORD` if the key's own password differs). Without them
the release build stops and says why. Make one with
`keytool -genkeypair -v -keystore hive-release.jks -alias hive -keyalg RSA -keysize 4096 -validity 10000`.

The phone needs a **screen lock** (PIN, pattern or password): the pairing key is kept in the phone's keystore behind
it, and the app does not open without one. Pairing needs an **`https://` relay address**; the app refuses a code with
a plain `http://` relay.

## How it works

```
 ┌───────────────────────── Electron main ─────────────────────────┐
 │  one long-lived SDK query per thread (streaming input)         │
 │  orbit MCP server (in-process tools) · watchers scheduler       │
 │  git / pull / deploy / scripts / terminal (plain processes)    │
 │  state: ~/.orbit/hive-*.json, ~/.orbit/hive/watchers/        │
 └───────────────▲────────────────────────────────┬────────────────┘
                 │ IPC (preload bridge)             │ events
 ┌───────────────┴──────────── renderer (React) ────▼────────────────┐
 │  layouts × themes · threads · chat panes · popovers · panels   │
 └─────────────────────────────────────────────────────────────────┘
```

Each thread is one Claude Agent SDK `query()` kept open in streaming-input mode, so messages, steering, model and
effort changes all go to the same live process. Plugins that only draw in a terminal are switched off for Orbit
sessions through the SDK's flag-settings layer. They stay on in your terminal, and no settings file is written. App
state lives in small JSON files written atomically, so a crash never leaves them half-written.

[`docs/architecture.md`](docs/architecture.md) has the full write-up.

## Getting started

**Prerequisites**

- Windows 10 or 11. Other platforms are untested.
- Node 22.15 or newer.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude`, then `/login`).
- Optional: the [GitHub CLI](https://cli.github.com/) for the Dependabot reviewer, and the Codex CLI for the `codex`
  tool.

Orbit uses your Claude subscription. If `ANTHROPIC_API_KEY` is set, the SDK uses that instead.

**From source**

```sh
git clone https://github.com/saiharsha03/orbit.git
cd orbit
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

Everything is editable in **Settings**, which saves to `~/.orbit/hive-settings.json`. On first run Orbit seeds that
file from two optional local files, both git-ignored:

- `.env`: workspace values such as the repos root, stacks, deploy targets and file-drop skills. Copy
  [`.env.example`](.env.example) for the full list with comments.
- `scripts.json`: the Scripts panel buttons. Copy [`scripts.example.json`](scripts.example.json).

The Board reads your Jira Cloud tickets with `HIVE_TRACKER_SITE`, `HIVE_TRACKER_EMAIL` and a token (`HIVE_TRACKER_TOKEN`,
or `HIVE_TRACKER_TOKEN_FILE`); see `.env.example`. Nothing is written to Jira.

The app name and tagline are settings too (Settings > General), so Orbit can be renamed without touching code.

Settings > General also holds what new threads start with:

- **Model and effort** for your own threads; **background model and effort** for watcher runs, Dependabot reviews
  and `/btw`; **team model and effort** for teammates. An empty one means the same as the main default.
- **Close idle threads after** (minutes, default 30, 0 = never).
- **Team memory in briefs** (KB per memory file, default 6): a teammate's brief carries the newest role and shared
  memory entries up to that size and names the full file; nothing is cut on disk.

The Dependabot reviewer starts at most `HIVE_DEPENDABOT_MAX_REVIEWS` review threads at once (default 3); the rest
start as earlier ones finish. **Allow my IP** remembers every address its command succeeded for, so moving between
known places asks nothing; `HIVE_ALLOWLIST_TRUST_HOURS` makes an allowed address expire (empty = never), and the
command palette forgets one.

Orbit writes each plan-limit reading to `~/.claude/usage/latest.json` (at most once a minute, the same shape as the
terminal's usage-file plugin), so a hook that guards usage by reading that file keeps working inside Orbit.

## Read this before using it

- **Sessions run without approval prompts.** On screen, Claude can run commands and edit files without asking, like
  `claude --dangerously-skip-permissions`; the message box says so. In the background, Claude Code's auto mode
  decides each tool call.
- **The hooks and plugins switches change your real Claude Code settings.** Every write saves a `.hive-bak` copy
  first.
- Don't continue the same session in Orbit and in a terminal at the same time: both write to one transcript.
- **The editor's language servers run code from the repo you open**: its own TypeScript and its virtualenv's Python,
  as VS Code does for a trusted folder. Open only repos you trust.
- **Watcher threads' read-only guard is best-effort** (see Watchers), not a sandbox.

## Development

```sh
npm run check      # typecheck + lint + unit tests
npm test           # Vitest unit tests
npm run e2e        # build, then Playwright end-to-end tests against the real app
```

The end-to-end suite drives the built Electron app through threads, slash commands, pickers, panels, watchers,
deploy and Pull latest. **It runs real Claude sessions on your real Claude login**, so it uses your plan's usage. It
runs in **test mode** (`HIVE_TEST_MODE`) against an isolated data folder: Orbit's own state files are kept apart, and
whatever Orbit itself would do with outside effects (watcher runs, Dependabot reviews, commits, pushes, deploys,
switching the account) answers with a "test mode: … is off" message instead, which the tests check for.

CI runs typecheck, lint and the unit tests on Ubuntu and the build on Windows for every push and pull request.

## Tech stack

Electron · React 19 · TypeScript · electron-vite · Claude Agent SDK · Monaco · Pyright, typescript-language-server and
Volar · xterm.js and node-pty · MiniSearch · Vitest · Playwright · electron-builder

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
