# Hive

A desktop home for Claude Code sessions and agents. Hive runs the real Claude Code engine through the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), on your existing
`claude` login, and puts a window around it instead of a terminal.

It is a personal project: built for one person's way of working, run locally, shared as a showcase.

## What it does

- **Chat with Claude Code** in tabs. Replies stream in, tool calls show as one-line rows, and **Stop** interrupts.
- **Every past session** in a searchable sidebar, newest first. Opening one loads its history and the next
  message resumes it.
- **Status strip**: MCP connections, account and plan, 5-hour and 7-day usage with reset times, and for the open
  session its context size, prompt-cache countdown, compaction count, model and start time.
- **Preview panel**: images, HTML pages, PDFs, video and text open beside the chat. Claude gets a
  `show_to_user` tool to put things there, and images show inline in the conversation. Paste or drop images
  into the message box.
- **Files**: a tree of the working folder (follows the open session's repo, or **Open folder…**).
- **Hooks and Plugins** dropdowns to switch Claude Code hooks and plugins on and off.

Everything Claude Code already has keeps working: your settings, `CLAUDE.md`, memory, skills, MCP servers,
plugins, hooks, subagents and auto-compact, because the SDK runs the same engine.

## Run it

Needs Node 22+ and a logged-in Claude Code (`claude` then `/login`). No API key is used; if
`ANTHROPIC_API_KEY` is set, the SDK uses it instead of your subscription.

```sh
npm install
npm run dev
```

If the Electron window doesn't start after install, fetch its binary once: `node node_modules/electron/install.js`.

## Read this before using it

- **Sessions run with permissions bypassed.** There are no approval prompts yet, so Claude can run commands and
  edit files without asking, like `claude --dangerously-skip-permissions`. The message box says so in amber.
- **Hook and plugin switches change your real Claude Code settings** (`~/.claude/settings.json` and the project's
  `.claude/settings*.json`). Turning a hook off moves it to `~/.claude/hive-disabled-hooks.json`; every write
  first saves `<file>.hive-bak`. Changes apply to sessions started afterwards.
- Don't continue the same session in Hive and in a terminal at the same time: both write one transcript.

## Stack

Electron, electron-vite, React, TypeScript and `@anthropic-ai/claude-agent-sdk`. Windows-first; other platforms
are untested.

## License

MIT
