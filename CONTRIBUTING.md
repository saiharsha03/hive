# Contributing to Hive

Thanks for taking a look. Hive is a small codebase with a few firm habits; this page covers how to run it, how it
is laid out and what a change needs before it is merged.

## Development setup

You need:

- **Node.js 22.15 or newer** (the lint setup uses `module.registerHooks`).
- **Git** on `PATH` (the Git panel, worktrees and their tests use it).
- A logged-in **Claude Code** (`claude`, then `/login`). Hive drives your own Claude Code; it does not need an API
  key. If `ANTHROPIC_API_KEY` is set, the SDK uses it instead of your subscription.
- Windows is the primary platform. Linux runs CI; macOS is untested.

```sh
git clone https://github.com/saiharsha03/hive.git
cd hive
npm install
npm run dev
```

If the Electron window does not open after a fresh install, fetch its binary once with
`node node_modules/electron/install.js`.

Workspace-specific features (Pull latest, dev stack, deploy, scripts, Dependabot) read their settings from the
Settings tab. On first run they are seeded from a local `.env` (copy `.env.example`) and `scripts.json` (copy
`scripts.example.json`); both files are git-ignored.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with the Vite dev server for the renderer. There is no hot reload: a reload would restart every running session, so press Ctrl+R to pick up renderer changes. |
| `npm run build` | Bundle main, preload and renderer into `out/` with electron-vite. |
| `npm start` | Run the built app from `out/`. |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/` and the configs (TypeScript 7). |
| `npm run lint` | ESLint (flat config, typescript-eslint, react-hooks). |
| `npm test` | The Vitest suite, once. `npm run test:watch` keeps it running. |
| `npm run check` | Typecheck, lint and test in one go; run it before you push. |
| `npm run dist` | Build the Windows NSIS installer and portable exe into `dist/`. `npm run dist:dir` builds the unpacked app only. |
| `npm run icons` | Regenerate the app icon (SVG, PNGs and ICO in `build/`) from `scripts/make-icons.mjs`. |

## Project structure

```
src/
  main/       Electron main process: windows, IPC handlers, the Agent SDK sessions, git, pty, file I/O
  preload/    the contextBridge API the renderer is allowed to call (window.api)
  renderer/   the React UI (index.html + src/)
  shared/     pure logic used by main and renderer: no Electron, no I/O
test/
  shared/     unit tests for src/shared, one file per module
  main/       tests for src/main: pure parts plus integration tests against real git, pty and Python
  support/    the electron stub, the per-file setup and helpers for real tools
  fixtures/   small, scrubbed transcript samples
scripts/      icon generator and the lint helper
docs/         architecture notes
build/        icon sources and generated icons used by the window and the installer
```

## How main, preload and renderer fit together

Hive is a standard three-part Electron app with context isolation on:

- **Main** (`src/main/index.ts`) owns everything privileged. It creates the window, registers the `hive-file:`
  protocol for previews, and answers IPC calls. Each open thread is one Claude Agent SDK `query()` that lives here
  (`chat.ts`); its events are forwarded to the renderer over `webContents.send`.
- **Preload** (`src/preload/index.ts`) exposes a single `window.api` object through `contextBridge`. Every method is
  a thin `ipcRenderer.invoke` or a subscription; nothing else from Node reaches the page.
- **Renderer** (`src/renderer/src`) is React 19. It renders threads and panels, keeps per-tab state, and calls
  `window.api.*`. It never runs commands or touches the file system itself; for example the Scripts panel sends a
  script name and option, and main looks the command up in its own settings.

Logic that can be pure lives in `src/shared/*Core.ts` (or `src/main/*Core.ts` when only main needs it). Those files
have no Electron imports and no I/O, so they are unit-tested directly. When you add a feature, put the decisions in
a core module and keep the Electron and I/O glue thin.

See [docs/architecture.md](docs/architecture.md) for the deeper picture: the process model, sessions, tools, state
files and worktrees.

## Tests

- Unit tests sit next to their module's name: `src/shared/gitCore.ts` is tested by `test/shared/gitCore.test.ts`.
- `test/support/setup.ts` runs before every test file and points Hive's state files (settings, todos, watchers,
  `.env`, `scripts.json`) at a fresh temp folder, so tests never read or write your real `~/.claude`.
- Integration tests create their own repos and folders under the OS temp directory and skip themselves when a tool
  (git, Python, node-pty's native module) is not available.
- Main-process modules that import `electron` get the stub in `test/support/electron.ts` through a Vitest alias.

## Pull requests

1. Branch from `main`.
2. Keep the change focused; describe what it does and how to check it (the PR template asks for both).
3. Run `npm run check` and `npm run build`. CI runs the same steps on Windows and Ubuntu.
4. Add or update tests for behaviour you change, preferably in a pure core module.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

Never commit secrets, a filled-in `.env`, `scripts.json`, or screenshots of real sessions.

## Releases

Bump `version` in `package.json`, move the Unreleased notes under a new version heading in the changelog, then tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The `Release` workflow builds the Windows installer and portable exe on the tag and attaches them to a GitHub
Release.
