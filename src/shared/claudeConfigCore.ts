// Hive's own screens for Claude Code's configuration commands (/mcp, /agents, /permissions, /hooks, /memory, /resume,
// /branch, /add-dir): which typed command opens which, and the pure reading of the files behind them (subagent
// frontmatter, the permission rules and hooks of a settings file, where CLAUDE.md files are looked for, an MCP
// server's row). No I/O and no node modules, so it runs in main, the window and the tests alike.

// ---- typed commands Hive answers itself ----
export type LocalCommand = 'mcp' | 'agents' | 'permissions' | 'hooks' | 'memory' | 'resume' | 'branch' | 'add-dir'
const NAMES: Record<string, LocalCommand> = {
  mcp: 'mcp', agents: 'agents', permissions: 'permissions', 'allowed-tools': 'permissions', hooks: 'hooks', memory: 'memory',
  resume: 'resume', branch: 'branch', fork: 'branch', 'add-dir': 'add-dir',
}
// "/mcp reconnect github" -> { name: 'mcp', args: 'reconnect github' }; anything else (or text after a new line) -> null
export function localCommand(text: string): { name: LocalCommand; args: string } | null {
  const m = String(text ?? '').trim().match(/^\/([a-z-]+)(?:[ \t]+([^\n]*))?$/)
  const name = m ? NAMES[m[1]] : undefined
  return name ? { name, args: (m![2] ?? '').trim() } : null
}
// "/mcp reconnect x", "/mcp enable all": the action the CLI takes without opening the list
export function mcpArgs(args: string): { action: 'reconnect' | 'enable' | 'disable'; server: string } | null {
  const m = args.trim().match(/^(reconnect|enable|disable)\s+(\S+)$/)
  return m ? { action: m[1] as 'reconnect' | 'enable' | 'disable', server: m[2] } : null
}

// ---- paths (no node:path here) ----
const sepOf = (p: string) => (/^[A-Za-z]:[\\/]|\\/.test(p) ? '\\' : '/')
export const joinPath = (dir: string, ...parts: string[]): string => {
  const sep = sepOf(dir)
  return parts.reduce((acc, p) => (acc.endsWith(sep) ? acc + p : acc + sep + p), dir)
}
// a folder and every folder above it, root first: C:\a\b -> C:\, C:\a, C:\a\b
export function foldersDown(dir: string): string[] {
  const sep = sepOf(dir)
  const clean = dir.replace(/[\\/]+$/, '') || sep
  const drive = clean.match(/^[A-Za-z]:/)?.[0]
  const parts = clean.slice(drive ? drive.length : 0).split(/[\\/]/).filter(Boolean)
  const root = drive ? drive + sep : sep
  const out = [root]
  for (let i = 0; i < parts.length; i++) out.push(root + parts.slice(0, i + 1).join(sep))
  return out
}
const sameKey = (p: string) => (sepOf(p) === '\\' ? p.toLowerCase() : p)

// ---- frontmatter (the small YAML subset agent and skill files use) ----
const unquote = (s: string) => { const t = s.trim(); return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t }
export function frontmatter(text: string): { data: Record<string, string | string[]>; body: string } | null {
  const t = String(text ?? '').replace(/^\uFEFF/, '')
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return null
  const data: Record<string, string | string[]> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    const value = raw.trim()
    // indented lines below: a list (- x) or a block / folded text
    const below: string[] = []
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || !lines[i + 1].trim())) below.push(lines[++i])
    if (value.startsWith('[') && value.endsWith(']')) data[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean)
    else if (!value && below.some((l) => /^\s*-\s/.test(l))) data[key] = below.filter((l) => /^\s*-\s/.test(l)).map((l) => unquote(l.replace(/^\s*-\s+/, '')))
    else if (!value || /^[|>][+-]?$/.test(value)) data[key] = below.map((l) => l.trim()).filter(Boolean).join(value.startsWith('|') ? '\n' : ' ')
    else data[key] = [unquote(value), ...below.map((l) => l.trim()).filter(Boolean)].join(' ')
  }
  return { data, body: t.slice(m[0].length) }
}
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '')
const list = (v: string | string[] | undefined): string[] | null =>
  v === undefined ? null : (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean)

// ---- subagents ----
export type AgentScope = 'user' | 'project'
export type AgentRow = { name: string; description: string; model: string; tools: string[] | null; file: string; scope: AgentScope; problem?: string }
// tools null = every tool (the field is left out). A file without a name or description is skipped by Claude Code:
// it is still listed, with why
export function agentOf(text: string, file: string, scope: AgentScope): AgentRow {
  const fm = frontmatter(text)
  const d = fm?.data ?? {}
  const base = file.split(/[\\/]/).pop()!.replace(/\.md$/i, '')
  const problem = !fm ? 'No frontmatter: Claude Code skips this file' : !str(d.name) ? 'No name: Claude Code skips this file'
    : !str(d.description) ? 'No description: Claude Code skips this file' : undefined
  return { name: str(d.name) || base, description: str(d.description), model: str(d.model) || 'inherit', tools: list(d.tools), file, scope, ...(problem ? { problem } : {}) }
}
export const validAgentName = (n: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(n)
export const agentTemplate = (name: string): string => [
  '---', `name: ${name}`, 'description: When Claude should hand work to this agent (one or two sentences)', 'tools: Read, Grep, Glob', 'model: inherit', '---', '',
  `You are ${name}. Describe the job, how to do it, and what to report back.`, '',
].join('\n')
export const agentsDir = (scope: AgentScope, cwd: string, home: string) => (scope === 'user' ? joinPath(home, '.claude', 'agents') : joinPath(cwd, '.claude', 'agents'))

// ---- settings files: permission rules and hooks ----
export type SettingsScope = 'user' | 'project' | 'local'
export const settingsFiles = (cwd: string, home: string): { scope: SettingsScope; path: string }[] => [
  { scope: 'user', path: joinPath(home, '.claude', 'settings.json') },
  { scope: 'project', path: joinPath(cwd, '.claude', 'settings.json') },
  { scope: 'local', path: joinPath(cwd, '.claude', 'settings.local.json') },
]
export const RULE_KINDS = ['allow', 'ask', 'deny'] as const
export type RuleKind = (typeof RULE_KINDS)[number]
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
export function rulesOf(settings: unknown): Record<RuleKind, string[]> {
  const p = obj(obj(settings).permissions)
  return { allow: strings(p.allow), ask: strings(p.ask), deny: strings(p.deny) }
}
// "Bash", "Bash(npm run test:*)", "mcp__github", "Read(./secrets/**)", "WebFetch(domain:example.com)"; null = fine
export function ruleProblem(rule: string): string | null {
  const r = rule.trim()
  if (!r) return 'Type a rule, like Bash(npm run test:*) or WebFetch'
  if (!/^[A-Za-z_][\w-]*(\(.+\))?$/.test(r)) return 'A rule is a tool name, optionally with a specifier in brackets: Bash(git log:*)'
  return null
}
// the settings with one rule added or removed; every other key, and the order of the rest, stays as it was
export function editRule(settings: unknown, kind: RuleKind, rule: string, add: boolean): Record<string, unknown> {
  const s = obj(settings)
  const p = obj(s.permissions)
  const cur = Array.isArray(p[kind]) ? p[kind] as unknown[] : []
  const r = rule.trim()
  const next = add ? (cur.includes(r) ? cur : [...cur, r]) : cur.filter((x) => x !== r)
  return { ...s, permissions: { ...p, [kind]: next } }
}
// the file's own indent (two spaces when it cannot tell), so a write changes as little as it can
export const indentOf = (text: string): string | number => text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? 2

export type HookRow = { event: string; matcher: string; type: string; what: string }
// what each configured hook runs, per event. An http hook shows its address without the query; header values are
// never shown
export function hooksOf(settings: unknown): HookRow[] {
  const out: HookRow[] = []
  for (const [event, groups] of Object.entries(obj(obj(settings).hooks))) {
    for (const g of Array.isArray(groups) ? groups : []) {
      const matcher = typeof obj(g).matcher === 'string' ? obj(g).matcher as string : ''
      for (const h of Array.isArray(obj(g).hooks) ? obj(g).hooks as unknown[] : []) {
        const x = obj(h)
        const type = typeof x.type === 'string' ? x.type : 'command'
        const what = type === 'command' ? String(x.command ?? '') : type === 'http' ? safeUrl(String(x.url ?? ''))
          : type === 'prompt' || type === 'agent' ? String(x.prompt ?? '').slice(0, 200) : ''
        out.push({ event, matcher, type, what })
      }
    }
  }
  return out
}

// ---- MCP servers ----
export type McpRow = {
  name: string; status: string; scope: string; file: string; transport: string; target: string
  envNames: string[]; headerNames: string[]; error?: string; tools: number | null
}
// an address without user info, query or fragment (those can hold tokens)
export function safeUrl(u: string): string {
  try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}` } catch { return u ? '(address hidden)' : '' }
}
// where a server of this scope is configured
export function mcpFile(scope: string, cwd: string, home: string): string {
  switch (scope) {
    case 'user': return joinPath(home, '.claude.json')
    case 'local': return `${joinPath(home, '.claude.json')} (this project's entry)`
    case 'project': return joinPath(cwd, '.mcp.json')
    case 'plugin': return 'a plugin'
    case 'claudeai': return 'claude.ai connectors'
    case 'sdk': case 'dynamic': return 'Hive (built in)'
    case 'managed': case 'enterprise': return 'managed-mcp.json (managed settings)'
    default: return ''
  }
}
// one server as the panel shows it: names of env variables and headers only, never their values; a command without
// its arguments
export function mcpRow(s: unknown, cwd: string, home: string): McpRow {
  const x = obj(s)
  const c = obj(x.config)
  const scope = String(x.source ?? x.scope ?? '')
  const transport = typeof c.type === 'string' ? c.type : c.command ? 'stdio' : ''
  const target = typeof c.url === 'string' ? safeUrl(c.url) : typeof c.command === 'string' ? c.command : ''
  return {
    name: String(x.name ?? ''), status: String(x.status ?? ''), scope, file: mcpFile(scope, cwd, home), transport, target,
    envNames: Object.keys(obj(c.env)), headerNames: Object.keys(obj(c.headers)),
    ...(typeof x.error === 'string' && x.error ? { error: x.error } : {}),
    tools: Array.isArray(x.tools) ? x.tools.length : null,
  }
}

// ---- CLAUDE.md discovery ----
export type MemoryScope = 'managed' | 'user' | 'project' | 'local' | 'parent'
export type MemorySpot = { path: string; scope: MemoryScope; rules?: true }
// where Claude Code looks, in the order it loads them: the managed file, the user's CLAUDE.md and rules, then from the
// root of the drive down to the thread's folder each folder's CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md and
// .claude/rules (rules: every .md below it). The folder's own files are "project" / "local"; those above, "parent".
export function memorySpots(cwd: string, home: string, platform: string): MemorySpot[] {
  const managed = platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\CLAUDE.md'
    : platform === 'darwin' ? '/Library/Application Support/ClaudeCode/CLAUDE.md' : '/etc/claude-code/CLAUDE.md'
  const out: MemorySpot[] = [
    { path: managed, scope: 'managed' },
    { path: joinPath(home, '.claude', 'CLAUDE.md'), scope: 'user' },
    { path: joinPath(home, '.claude', 'rules'), scope: 'user', rules: true },
  ]
  const here = sameKey(cwd.replace(/[\\/]+$/, ''))
  for (const dir of foldersDown(cwd)) {
    const own = sameKey(dir) === here
    out.push(
      { path: joinPath(dir, 'CLAUDE.md'), scope: own ? 'project' : 'parent' },
      { path: joinPath(dir, '.claude', 'CLAUDE.md'), scope: own ? 'project' : 'parent' },
      { path: joinPath(dir, 'CLAUDE.local.md'), scope: own ? 'local' : 'parent' },
      { path: joinPath(dir, '.claude', 'rules'), scope: own ? 'project' : 'parent', rules: true },
    )
  }
  // the home folder's own .claude/CLAUDE.md is the user file: listed once
  const seen = new Set<string>()
  return out.filter((s) => { const k = sameKey(s.path); if (seen.has(k)) return false; seen.add(k); return true })
}

// ---- /resume: the saved threads of one folder, newest first ----
export function sameFolder(a: string, b: string): boolean {
  const n = (p: string) => sameKey(p.replace(/[\\/]+$/, '').replace(/\//g, sepOf(p)))
  return !!a && !!b && n(a) === n(b)
}
