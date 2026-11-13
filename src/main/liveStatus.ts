// Live status of each thread beyond its messages: the Stop hook's scheduled jobs and effort level, the /goal
// verdicts tailed from the transcript, model and effort switches (with "ultrathink" as max effort for one turn),
// plus the per-thread lists the UI asks for (commands, models, MCP servers) and stopping background tasks.
// chat.ts calls sessionOptions / observe / forgetTab; index.ts registers the IPC below.
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { goalMarks } from '../shared/goalCore'
import { hasUltrathink } from '../shared/composerCore'
import { idle } from './status'
import { menuCommands } from './threadCore'
import { EFFORTS } from '../shared/settingsCore'

type Send = (event: unknown) => void

// Plugins Hive already covers itself (its own Codex runner, deploy, to-dos and status) or that only draw in the
// terminal (mods). They stay on in the terminal; Hive's SDK sessions turn them off in the flag-settings layer,
// which outranks user, project and local settings without writing any settings file.
export const HIVE_OFF_PLUGINS = [
  'codex-panel', 'ship-panel',
  'clawd-spinner', 'fortune-clawd', 'pomodawd', 'streaks', 'verb-toasts', 'usage-pills', 'claude-resume', 'usage-file',
]

// Output styles that tell the agent to leave the code to a human ("write this part yourself", explain instead of do):
// right for the user's own threads, wrong for a thread nobody watches. Background, team and watcher threads also turn
// them off; foreground threads keep them.
export const UNATTENDED_OFF_PLUGINS = ['learning-output-style', 'explanatory-output-style']

const readJson = (file: string): any => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
// the user's own auto-memory folder setting, which Hive never overrides
export const userMemoryDir = (): string | null => {
  const v = readJson(join(homedir(), '.claude', 'settings.json'))?.autoMemoryDirectory
  return typeof v === 'string' && v.trim() ? v : null
}

// "name@marketplace": false for every installed or enabled id whose name is on the list
export function hiveOffPlugins(names = HIVE_OFF_PLUGINS): Record<string, false> {
  const dir = join(homedir(), '.claude')
  const ids = new Set<string>([
    ...Object.keys(readJson(join(dir, 'settings.json'))?.enabledPlugins ?? {}),
    ...Object.keys(readJson(join(dir, 'plugins', 'installed_plugins.json'))?.plugins ?? {}),
  ])
  const out: Record<string, false> = {}
  for (const id of ids) if (names.includes(id.split('@')[0])) out[id] = false
  return out
}

type Tab = {
  send: Send
  path?: string // transcript being tailed for goal_status
  offset: number
  rest: string // a partial last line, kept for the next read
  reading: Promise<void>
  watcher?: FSWatcher
  timer?: ReturnType<typeof setTimeout>
  model?: string // picked in Hive; also passed when the process restarts
  effort?: string // picked in Hive (null-ish = the user's default)
  reported?: string // the level the Stop hook last reported outside an ultrathink turn
  advisor?: string // picked in Hive for this thread ('' = none); also passed when the process restarts
  fast?: boolean // fast mode turned on in Hive for this thread; also passed when the process restarts
  advisorNow?: string | null // what the running process has (the pick, else Settings > General), for /status
  advisorAtStart?: string // the advisor the running process was started with ('' = none): Off has to override that one
  boost?: { prev: string | undefined; left: number } // ultrathink: what to go back to, after how many turn ends
}
const tabs = new Map<string, Tab>()
const tab = (id: string): Tab => {
  let t = tabs.get(id)
  if (!t) tabs.set(id, (t = { send: () => {}, offset: 0, rest: '', reading: Promise.resolve() }))
  return t
}

// what every Hive session adds to its query options. unattended: a background, team or watcher thread (the output
// styles above go off too); memoryDir: the auto-memory folder it shares (chat.ts), both in the flag-settings layer
// flags: Settings > General's Claude Code settings (settings.sessionFlags: advisor model, Workflows); a thread's own
// advisor pick wins over the default one
export function sessionOptions(tabId: string, send: Send, o: { unattended?: boolean; memoryDir?: string | null; flags?: { advisorModel?: string; enableWorkflows?: boolean } } = {}): Partial<Options> {
  const t = tab(tabId)
  t.send = send
  t.boost = undefined
  const { advisorModel: dflt, ...flags } = o.flags ?? {}
  const advisor = t.advisor !== undefined ? t.advisor : dflt ?? ''
  t.advisorNow = advisor || null
  t.advisorAtStart = advisor
  return {
    // plugin hook output (security warnings on edits) reaches the stream only with this on
    includeHookEvents: true,
    settings: {
      enabledPlugins: hiveOffPlugins(o.unattended ? [...HIVE_OFF_PLUGINS, ...UNATTENDED_OFF_PLUGINS] : HIVE_OFF_PLUGINS),
      ...(o.memoryDir ? { autoMemoryDirectory: o.memoryDir } : {}),
      ...flags,
      ...(advisor ? { advisorModel: advisor } : {}),
      // an SDK session runs fast only with the flag layer's fastMode on (else sdk_opt_in_required)
      ...(t.fast ? { fastMode: true } : {}),
    },
    ...(t.model ? { model: t.model } : {}),
    ...(t.effort ? { effort: t.effort as Options['effort'] } : {}),
    hooks: {
      Stop: [{
        hooks: [async (input: any) => {
          if (!input.agent_id) onStop(tabId, input)
          return {}
        }],
      }],
    },
  }
}

function onStop(tabId: string, input: any) {
  const t = tab(tabId)
  const level: string | undefined = input.effort?.level
  if (level && !t.boost) t.reported = level
  t.send({ type: 'hive_stop', crons: input.session_crons ?? [], tasks: input.background_tasks ?? [], effort: level ?? null, at: Date.now() })
  // the /goal evaluator runs as a Stop hook too; its verdict lands in the transcript shortly after
  later(tabId, 800)
}

// ---- /goal: tail the transcript for goal_status attachments ----

function later(tabId: string, ms: number) {
  const t = tab(tabId)
  clearTimeout(t.timer)
  t.timer = setTimeout(() => readGoal(tabId, false), ms)
}

function readGoal(tabId: string, initial: boolean) {
  const t = tab(tabId)
  t.reading = t.reading.then(async () => {
    const path = t.path
    if (!path) return
    let text = ''
    try {
      const f = await open(path, 'r')
      try {
        const { size } = await f.stat()
        if (size < t.offset) { t.offset = 0; t.rest = '' } // rewritten
        if (size > t.offset) {
          const buf = Buffer.alloc(size - t.offset)
          await f.read(buf, 0, buf.length, t.offset)
          t.offset = size
          text = buf.toString('utf8')
        }
      } finally { await f.close() }
    } catch { return } // not written yet
    if (t.path !== path) return
    const lines = (t.rest + text).split('\n')
    t.rest = lines.pop() ?? ''
    const marks = goalMarks(lines)
    if (marks.length) t.send({ type: 'hive_goal', marks, initial })
    const last = marks.at(-1)?.status
    if (last) setWatching(tabId, !last.met) // set or not yet met: keep watching; met or cleared: stop
  }).catch(() => {})
}

// while a goal runs, any write to the transcript is read at once (the verdict can come at any time)
function setWatching(tabId: string, on: boolean) {
  const t = tab(tabId)
  if (!on || !t.path) { t.watcher?.close(); t.watcher = undefined; return }
  if (t.watcher) return
  try {
    t.watcher = watch(t.path, () => later(tabId, 250))
    t.watcher.on('error', () => { t.watcher?.close(); t.watcher = undefined })
  } catch { /* the file appears with the first message; the turn-end reads cover it */ }
}

const textOf = (m: any): string => (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')

// every message of a Hive session passes through here (after chat.ts handled it)
export function observe(tabId: string, m: SDKMessage, pathOf: (sessionId: string) => string, q: Query): void {
  const t = tab(tabId)
  const msg = m as any
  if (msg.type === 'system' && msg.subtype === 'init') {
    const path = pathOf(msg.session_id)
    // Claude's thinking comes as text (a summary), the way the CLI shows it; SDK sessions otherwise get it empty.
    // null keeps the session's own thinking budget, only the display changes
    q.setMaxThinkingTokens(null, 'summarized').catch(() => { /* an older engine: thinking stays hidden */ })
    if (path !== t.path) {
      setWatching(tabId, false)
      Object.assign(t, { path, offset: 0, rest: '' })
      readGoal(tabId, true)
    }
    return
  }
  if (msg.type === 'assistant' && msg.message?.model === '<synthetic>' && !msg.parent_tool_use_id) {
    const text = textOf(msg)
    if (/^Goal set:/.test(text)) setWatching(tabId, true)
    else if (/^(Goal cleared:|No goal set)/.test(text)) setWatching(tabId, false)
    return
  }
  if (msg.type === 'result') {
    readGoal(tabId, false)
    endTurn(tabId, q)
  }
}

// ---- model, effort, ultrathink ----

// "ultrathink" in an outgoing message: max effort until that turn ends, then back to the earlier level.
// A queued message runs after the current turn, so its own turn is the second one to end.
// null when the message has no "ultrathink", so the caller sends it straight away (keeping send order).
export function boostForMessage(tabId: string, q: Query, text: string, queued: boolean): Promise<void> | null {
  if (!hasUltrathink(text)) return null
  const t = tab(tabId)
  t.boost = { prev: t.boost ? t.boost.prev : t.effort, left: queued ? 2 : 1 }
  return q.applyFlagSettings({ effortLevel: 'max' })
    .then(() => t.send({ type: 'hive_effort', level: 'max', ultrathink: true }))
    .catch((e: any) => {
      t.boost = undefined
      t.send({ type: 'hive_effort', level: t.effort ?? t.reported ?? null, error: `Could not raise effort for ultrathink: ${e?.message ?? e}` })
    })
}

function endTurn(tabId: string, q: Query) {
  const t = tab(tabId)
  if (!t.boost || --t.boost.left > 0) return
  const prev = t.boost.prev
  t.boost = undefined
  // null drops Hive's flag so the user's own default applies again
  q.applyFlagSettings({ effortLevel: (prev ?? null) as any })
    .then(() => t.send({ type: 'hive_effort', level: prev ?? t.reported ?? null }))
    .catch((e: any) => t.send({ type: 'hive_effort', level: 'max', error: `Could not restore effort after ultrathink: ${e?.message ?? e}` }))
}

export async function setModel(tabId: string, q: Query | undefined, model: string): Promise<void> {
  const t = tab(tabId)
  if (q) await q.setModel(model)
  t.model = model
  t.send({ type: 'hive_model', model })
}

// any level the pickers offer (low, medium, high, xhigh, max); anything else is refused before it reaches the engine
export async function setEffort(tabId: string, q: Query | undefined, level: string): Promise<void> {
  if (!(EFFORTS as readonly string[]).includes(level)) throw new Error(`${level} is not an effort level`)
  const t = tab(tabId)
  t.boost = undefined // a level picked by hand wins over an ultrathink turn
  if (q) await q.applyFlagSettings({ effortLevel: level as any })
  t.effort = level
  t.send({ type: 'hive_effort', level })
}

// a thread's advisor model, switched live. '' = none: Hive's flag goes, so the user's own settings apply again. A
// process started with an advisor keeps that one under whatever is applied later (clearing the key with null brings
// it back, seen on a live process), so there Off is sent as an empty advisor, which the process runs as no advisor
export async function setAdvisor(tabId: string, q: Query | undefined, model: string): Promise<void> {
  const t = tab(tabId)
  const m = model.trim()
  if (q) await q.applyFlagSettings({ advisorModel: m || (t.advisorAtStart ? '' : null) })
  t.advisor = m
  t.advisorNow = m || null
  t.send({ type: 'hive_advisor', model: m || null })
}
// fast mode for this thread, live (Alt+O); takes effect from the next turn, as /fast does
export async function setFast(tabId: string, q: Query | undefined, on: boolean): Promise<void> {
  const t = tab(tabId)
  try {
    if (q) await q.applyFlagSettings({ fastMode: on })
  } catch (e: any) {
    t.send({ type: 'hive_fast', on: !!t.fast, error: `Could not turn fast mode ${on ? 'on' : 'off'}: ${e?.message ?? e}` })
    throw e
  }
  t.fast = on
  t.send({ type: 'hive_fast', on })
}

export const advisorNow = (tabId: string): string | null => tabs.get(tabId)?.advisorNow ?? null

export function forgetTab(tabId: string): void {
  const t = tabs.get(tabId)
  if (!t) return
  clearTimeout(t.timer)
  t.watcher?.close()
  tabs.delete(tabId)
}

// ---- IPC ----

type Deps = { liveQuery: (tabId: string) => Query | undefined; stopCodex: (id: string) => boolean }
type Handle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => void

// a live session answers for itself; a tab with no process yet asks the idle status process
const ask = (deps: Deps, tabId: unknown) => deps.liveQuery(String(tabId ?? '')) ?? idle()

export function registerStatusIpc(handle: Handle, deps: Deps): void {
  handle('chat:setModel', (_e, tabId: string, model: string) => setModel(String(tabId), deps.liveQuery(String(tabId)), String(model)))
  handle('chat:setEffort', (_e, tabId: string, level: string) => setEffort(String(tabId), deps.liveQuery(String(tabId)), String(level)))
  // a thread's advisor model ('' = none), live; a thread with no process gets it when it starts
  handle('chat:setAdvisor', (_e, tabId: string, model: string) => setAdvisor(String(tabId), deps.liveQuery(String(tabId)), String(model ?? '')))
  handle('chat:setFast', (_e, tabId: string, on: boolean) => setFast(String(tabId), deps.liveQuery(String(tabId)), !!on))
  // every command the engine reports, plus the interactive CLI's own ones it leaves out (threadCore.menuCommands)
  handle('chat:commands', async (_e, tabId?: string) => menuCommands(await ask(deps, tabId).supportedCommands()))
  handle('chat:models', (_e, tabId?: string) => ask(deps, tabId).supportedModels())
  handle('chat:mcp', async (_e, tabId?: string) => {
    const live = deps.liveQuery(String(tabId ?? ''))
    const rows = (await (live ?? idle()).mcpServerStatus()).map((s) => ({
      name: s.name, status: s.status, source: s.source ?? s.scope ?? '', error: s.error, tools: s.tools?.length ?? null,
    }))
    if (live) return rows
    // the idle process loads plain settings: show what a new Hive session gets instead, its own hive server added and
    // the plugins Hive turns off left out
    const off = new Set(HIVE_OFF_PLUGINS)
    return [{ name: 'hive', status: 'connected', source: 'built in', error: undefined, tools: null },
      ...rows.filter((r) => !off.has(r.name.replace(/^plugin:/, '').split(':')[0]))]
  })
  handle('chat:stopTask', async (_e, tabId: string, taskId: string) => {
    const id = String(taskId)
    if (id.startsWith('codex:')) return deps.stopCodex(id.slice(6))
    const q = deps.liveQuery(String(tabId))
    if (!q) return false
    await q.stopTask(id)
    return true
  })
}
