// What Orbit's /mcp, /agents, /permissions, /hooks, /memory, /branch and /add-dir screens read and change. MCP state
// and forks go through the Agent SDK (mcpServerStatus, reconnectMcpServer, toggleMcpServer, forkSession); the rest
// reads Claude Code's own files. Only permission rules and new agent files are ever written. MCP rows carry names of
// env variables and headers, never their values; ~/.claude.json and credential files are never read here.
import { forkSession, type Query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  RULE_KINDS, agentOf, agentTemplate, agentsDir, editRule, hooksOf, indentOf, mcpArgs, mcpRow, memorySpots, ruleProblem,
  rulesOf, settingsFiles, validAgentName, type AgentRow, type AgentScope, type HookRow, type McpRow, type MemoryScope,
  type RuleKind, type SettingsScope,
} from '../shared/claudeConfigCore'
import { writeFileSafe } from './safeWrite'
import { addThreadDir, threadDirs } from './threadDirs'

type Handle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => void
type Deps = { liveQuery: (tabId: string) => Query | undefined; idle: () => Query; transcriptPath: (cwd: string, sessionId: string) => string }

// a local folder given as an absolute path (no network share: Windows would send the login there)
function folder(p: unknown): string {
  const s = String(p ?? '')
  if (!s || !isAbsolute(s) || s.startsWith('\\\\') || s.startsWith('//')) throw new Error('Not a local folder')
  return s
}
const readText = (file: string): string | null => { try { return readFileSync(file, 'utf8') } catch { return null } }

// ---- MCP ----
export type McpView = { live: boolean; rows: McpRow[] }
async function mcpList(deps: Deps, tabId: string, cwd: string): Promise<McpView> {
  const q = deps.liveQuery(tabId)
  const rows = (await (q ?? deps.idle()).mcpServerStatus()).map((s) => mcpRow(s, cwd, homedir()))
  return { live: !!q, rows }
}
async function mcpDo(deps: Deps, tabId: string, server: string, action: string): Promise<void> {
  const q = deps.liveQuery(tabId)
  if (!q) throw new Error('This thread has no running Claude process. Send it a message first.')
  const a = mcpArgs(`${action} ${server}`)
  if (!a) throw new Error('Unknown action')
  const names = a.server === 'all' ? (await q.mcpServerStatus()).map((s) => s.name) : [a.server]
  for (const n of names) {
    if (a.action === 'reconnect') await q.reconnectMcpServer(n)
    else await q.toggleMcpServer(n, a.action === 'enable')
  }
}

// ---- subagents ----
function agentList(cwd: string): AgentRow[] {
  const out: AgentRow[] = []
  for (const scope of ['project', 'user'] as AgentScope[]) {
    const dir = agentsDir(scope, cwd, homedir())
    let names: string[] = []
    try { names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md')).sort() } catch { /* no folder */ }
    for (const n of names) { const f = join(dir, n); const t = readText(f); if (t !== null) out.push(agentOf(t, f, scope)) }
  }
  return out
}
function agentNew(cwd: string, scope: AgentScope, name: string): string {
  if (!validAgentName(name)) throw new Error('Use lower-case letters, digits and hyphens, like code-reviewer')
  const dir = agentsDir(scope, cwd, homedir())
  const file = join(dir, `${name}.md`)
  if (existsSync(file)) throw new Error(`${file} already exists`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, agentTemplate(name), { encoding: 'utf8', flag: 'wx' })
  return file
}

// ---- settings: permission rules and hooks ----
export type SettingsView = { scope: SettingsScope; path: string; exists: boolean; error?: string; rules: Record<RuleKind, string[]>; hooks: HookRow[] }
function settingsList(cwd: string): SettingsView[] {
  return settingsFiles(cwd, homedir()).map(({ scope, path }) => {
    const text = readText(path)
    if (text === null) return { scope, path, exists: false, rules: { allow: [], ask: [], deny: [] }, hooks: [] }
    try {
      const json = text.trim() ? JSON.parse(text) : {}
      return { scope, path, exists: true, rules: rulesOf(json), hooks: hooksOf(json) }
    } catch (e) {
      return { scope, path, exists: true, error: `Not valid JSON: ${(e as Error).message}`, rules: { allow: [], ask: [], deny: [] }, hooks: [] }
    }
  })
}
function ruleEdit(cwd: string, scope: SettingsScope, kind: RuleKind, rule: string, add: boolean): SettingsView[] {
  const file = settingsFiles(cwd, homedir()).find((f) => f.scope === scope)
  if (!file || !RULE_KINDS.includes(kind)) throw new Error('Unknown settings file or rule list')
  const problem = add ? ruleProblem(rule) : null
  if (problem) throw new Error(problem)
  const text = readText(file.path) ?? ''
  let json: unknown
  try { json = text.trim() ? JSON.parse(text) : {} } catch { throw new Error(`${file.path} is not valid JSON; fix it in the editor first`) }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${file.path} is not a settings object`)
  if (!writeFileSafe(file.path, `${JSON.stringify(editRule(json, kind, rule, add), null, indentOf(text))}\n`)) throw new Error(`Could not save ${file.path}`)
  return settingsList(cwd)
}

// ---- CLAUDE.md files that apply here ----
export type MemoryFile = { path: string; scope: MemoryScope; rule: boolean }
function mdBelow(dir: string, depth = 0): string[] {
  if (depth > 6) return []
  let names: string[]
  try { names = readdirSync(dir).sort() } catch { return [] }
  return names.flatMap((n) => {
    const p = join(dir, n)
    try { return statSync(p).isDirectory() ? mdBelow(p, depth + 1) : n.toLowerCase().endsWith('.md') ? [p] : [] } catch { return [] }
  })
}
function memoryList(cwd: string): MemoryFile[] {
  return memorySpots(cwd, homedir(), process.platform).flatMap((s): MemoryFile[] => {
    if (s.rules) return mdBelow(s.path).map((path) => ({ path, scope: s.scope, rule: true }))
    try { return statSync(s.path).isFile() ? [{ path: s.path, scope: s.scope, rule: false }] : [] } catch { return [] }
  })
}

// ---- /branch: a copy of the conversation as a new session ----
async function fork(deps: Deps, cwd: string, sessionId: string, title: string): Promise<{ sessionId: string; path: string; title: string }> {
  if (!/^[\w-]{8,}$/.test(sessionId)) throw new Error('This thread has no saved conversation to branch yet')
  const t = `${title || 'Thread'} (fork)`
  const r = await forkSession(sessionId, { dir: cwd, title: t })
  return { sessionId: r.sessionId, path: deps.transcriptPath(cwd, r.sessionId), title: t }
}

// ---- /add-dir ----
async function addDir(deps: Deps, tabId: string, dir: string): Promise<{ dirs: string[]; live: boolean }> {
  let ok = false
  try { ok = statSync(dir).isDirectory() } catch { /* missing */ }
  if (!ok) throw new Error(`${dir} is not a folder`)
  const dirs = addThreadDir(tabId, dir)
  // a running process takes it now, through the flag-settings layer; the next process starts with it anyway
  const q = deps.liveQuery(tabId)
  let live = false
  if (q) {
    try { await q.applyFlagSettings({ permissions: { additionalDirectories: dirs } } as Parameters<Query['applyFlagSettings']>[0]); live = true } catch { /* next start */ }
  }
  return { dirs, live }
}

export function registerClaudeConfigIpc(handle: Handle, deps: Deps): void {
  handle('cc:mcp', (_e, tabId: string, cwd: string) => mcpList(deps, String(tabId ?? ''), folder(cwd)))
  handle('cc:mcpDo', (_e, tabId: string, server: string, action: string) => mcpDo(deps, String(tabId ?? ''), String(server ?? ''), String(action ?? '')))
  handle('cc:agents', (_e, cwd: string) => agentList(folder(cwd)))
  handle('cc:agentNew', (_e, cwd: string, scope: string, name: string) => agentNew(folder(cwd), scope === 'user' ? 'user' : 'project', String(name ?? '').trim()))
  handle('cc:settings', (_e, cwd: string) => settingsList(folder(cwd)))
  handle('cc:rule', (_e, cwd: string, scope: SettingsScope, kind: RuleKind, rule: string, add: boolean) => ruleEdit(folder(cwd), scope, kind, String(rule ?? ''), !!add))
  handle('cc:memory', (_e, cwd: string) => memoryList(folder(cwd)))
  handle('cc:fork', (_e, cwd: string, sessionId: string, title: string) => fork(deps, folder(cwd), String(sessionId ?? ''), String(title ?? '')))
  handle('cc:addDir', (_e, tabId: string, dir: string) => addDir(deps, String(tabId ?? ''), folder(dir)))
  handle('cc:dirs', (_e, tabId: string) => threadDirs(String(tabId ?? '')))
}
