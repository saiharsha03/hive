// Claude Code's configuration commands as screens of their own, instead of the CLI in the thread's terminal: /mcp,
// /agents, /permissions (alias /allowed-tools), /hooks, /memory, /resume, /add-dir, and /branch (alias /fork), which
// opens a copy of the thread. Typed in a thread's box (ThreadPane) or picked in the command field (Shell). Main side:
// main/claudeConfig.ts; the pure parts: shared/claudeConfigCore.ts.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './ui'
import { Btn, Empty, Section, State, Unavailable, age, type Tone } from './kit'
import { createStore, getSessions, setSessions, useStore } from './store'
import { notice, openFileTab, openSession, place } from './actions'
import { useSavedThreads } from './Rail'
import { insertIntoComposer } from './SessionView'
import {
  RULE_KINDS, localCommand, mcpArgs, sameFolder, type AgentRow, type HookRow, type LocalCommand, type McpRow, type MemoryScope,
  type RuleKind, type SettingsScope,
} from '../../shared/claudeConfigCore'
import './claudePanels.css'

type Kind = Exclude<LocalCommand, 'branch'>
type Open = { kind: Kind; tabId: string | null; cwd: string; title: string; args: string }
const panel = createStore<Open | null>(null)
const close = () => panel.set(null)

// ---- main-process calls (main/claudeConfig.ts) ----
type SettingsView = { scope: SettingsScope; path: string; exists: boolean; error?: string; rules: Record<RuleKind, string[]>; hooks: HookRow[] }
type MemoryFile = { path: string; scope: MemoryScope; rule: boolean }
const invoke = <T,>(name: string, ...args: unknown[]): Promise<T> => {
  const f = (window.api as unknown as Record<string, ((...a: unknown[]) => Promise<T>) | undefined>)[name]
  if (typeof f !== 'function') return Promise.reject(new Error('Not available in this build'))
  return f(...args).catch((e: unknown) => { throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) })
}
const why = (e: unknown) => String((e as Error)?.message ?? e)

// the thread a command is for: the given tab when it is a thread, with its folder (the workspace's when it has none)
function target(tabId: string | null) {
  const s = tabId ? getSessions().find((x) => x.id === tabId && !x.tool && !x.file && !x.agent) : undefined
  return { s, cwd: s?.cwd || place.get().workspace || place.get().folder || '' }
}

// a typed "/mcp", "/permissions", "/branch try X", ... : true when Hive answered it here (nothing goes to Claude)
export function runLocalCommand(tabId: string | null, text: string): boolean {
  const c = localCommand(text)
  if (!c) return false
  const { s, cwd } = target(tabId)
  if (c.name === 'branch') { void branch(s, c.args); return true }
  if (!cwd) { notice('Open a folder first'); return true }
  if (c.name === 'add-dir' && c.args && s) { void addDir(s.id, c.args); return true }
  if (c.name === 'mcp' && mcpArgs(c.args) && s) {
    const a = mcpArgs(c.args)!
    void invoke('ccMcpDo', s.id, a.server, a.action).then(() => notice(`MCP: ${a.action} ${a.server} done`), (e) => notice(`MCP: ${why(e)}`))
  }
  panel.set({ kind: c.name, tabId: s?.id ?? null, cwd, title: s?.title ?? '', args: c.args })
  return true
}

// /branch: the conversation so far copied into a new thread (SDK forkSession), opened as a tab; the original stays
async function branch(s: ReturnType<typeof target>['s'], prompt: string) {
  if (!s?.sessionId || !s.cwd) { notice('Nothing to branch yet: send this thread a message first'); return }
  try {
    const r = await invoke<{ sessionId: string; path: string; title: string }>('ccFork', s.cwd, s.sessionId, s.title)
    openSession({ id: r.sessionId, title: r.title, project: '', cwd: s.cwd, updated: Date.now(), started: Date.now(), path: r.path })
    if (prompt) insertIntoComposer(r.sessionId, prompt)
    notice(`Branched into "${r.title}"`)
  } catch (e) { notice(`Could not branch: ${why(e)}`) }
}

async function addDir(tabId: string, dir: string): Promise<string[] | null> {
  try {
    const r = await invoke<{ dirs: string[]; live: boolean }>('ccAddDir', tabId, dir.trim())
    // the thread says so in its conversation (a note, not a message to Claude)
    setSessions((all) => all.map((x) => (x.id === tabId ? { ...x, items: [...x.items, { kind: 'note' as const, text: `Added ${dir.trim()} to the folders this thread may work in, for the rest of this session` }] } : x)))
    notice(r.live ? `Added ${dir.trim()}` : `Added ${dir.trim()}; it applies from the thread's next message`)
    return r.dirs
  } catch (e) { notice(`Could not add the folder: ${why(e)}`); return null }
}

const TITLES: Record<Kind, string> = {
  mcp: 'MCP servers', agents: 'Subagents', permissions: 'Permission rules', hooks: 'Hooks', memory: 'Memory files', resume: 'Resume a thread', 'add-dir': 'Folders this thread may work in',
}

export function ClaudePanel() {
  const p = useStore(panel, (x) => x)
  if (!p) return null
  return (
    <Modal title={<>{TITLES[p.kind]}<span className="ccp-for">{p.title || p.cwd}</span></>} onClose={close} wide testid={`cc-${p.kind}`}>
      <div className="ccp">
        {p.kind === 'mcp' && <McpPanel p={p} />}
        {p.kind === 'agents' && <AgentsPanel p={p} />}
        {p.kind === 'permissions' && <SettingsPanel p={p} what="rules" />}
        {p.kind === 'hooks' && <SettingsPanel p={p} what="hooks" />}
        {p.kind === 'memory' && <MemoryPanel p={p} />}
        {p.kind === 'resume' && <ResumePanel p={p} />}
        {p.kind === 'add-dir' && <DirsPanel p={p} />}
      </div>
    </Modal>
  )
}

// load once and on reload(); err is the reason it could not be read
function useLoad<T>(f: () => Promise<T>, deps: unknown[]): { data: T | null; err: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [n, setN] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(f, deps)
  useEffect(() => {
    let on = true
    run().then((d) => { if (on) { setData(d); setErr(null) } }, (e) => { if (on) setErr(why(e)) })
    return () => { on = false }
  }, [run, n])
  return { data, err, reload: () => setN((x) => x + 1) }
}
const openFile = (path: string) => { close(); openFileTab(path) }
const FileLink = ({ path }: { path: string }) => <Btn kind="link" onClick={() => openFile(path)} testid="cc-open-file">Open file</Btn>

// ---- /mcp ----
const TONE: Record<string, Tone> = { connected: 'done', failed: 'fail', 'needs-auth': 'wait', pending: 'work', disabled: 'idle' }
function McpPanel({ p }: { p: Open }) {
  const { data, err, reload } = useLoad(() => invoke<{ live: boolean; rows: McpRow[] }>('ccMcp', p.tabId ?? '', p.cwd), [p.tabId, p.cwd])
  const [busy, setBusy] = useState('')
  const act = (name: string, action: 'reconnect' | 'enable' | 'disable') => {
    setBusy(name)
    void invoke('ccMcpDo', p.tabId, name, action).catch((e) => notice(`${name}: ${why(e)}`)).finally(() => { setBusy(''); reload() })
  }
  if (err) return <Unavailable reason={err} />
  if (!data) return <Empty>Asking Claude Code</Empty>
  return (
    <Section title={data.live ? 'This thread\'s servers, live' : 'No running process for this thread: what a new session loads'} note={<Btn kind="link" onClick={reload}>Refresh</Btn>}>
      {!data.rows.length && <Empty>No MCP servers configured.</Empty>}
      {data.rows.map((r) => (
        <div key={r.name} className="ccp-row" data-testid="cc-mcp-row">
          <div className="ccp-main">
            <div><span className="ccp-name">{r.name}</span> <State word={r.status} tone={TONE[r.status] ?? 'idle'} />{r.tools !== null && <span className="ccp-dim"> {r.tools} tools</span>}</div>
            <div className="ccp-dim">{[r.scope, r.file].filter(Boolean).join(': ') || 'source not reported'}</div>
            {r.target && <div className="ccp-mono">{r.transport ? `${r.transport} ` : ''}{r.target}</div>}
            {(r.envNames.length > 0 || r.headerNames.length > 0) && (
              <div className="ccp-dim">{r.envNames.length > 0 && `env: ${r.envNames.join(', ')}`}{r.envNames.length > 0 && r.headerNames.length > 0 && '; '}{r.headerNames.length > 0 && `headers: ${r.headerNames.join(', ')}`} (values hidden)</div>
            )}
            {r.error && <div className="ccp-err">{r.error}</div>}
          </div>
          {data.live && r.scope !== 'sdk' && (
            <span className="ccp-acts">
              {r.status !== 'disabled' && <Btn kind="quiet" disabled={busy === r.name} onClick={() => act(r.name, 'reconnect')} testid="cc-mcp-reconnect">Reconnect</Btn>}
              <Btn kind="quiet" disabled={busy === r.name} onClick={() => act(r.name, r.status === 'disabled' ? 'enable' : 'disable')} testid="cc-mcp-toggle">{r.status === 'disabled' ? 'Enable' : 'Disable'}</Btn>
            </span>
          )}
        </div>
      ))}
    </Section>
  )
}

// ---- /agents ----
function AgentsPanel({ p }: { p: Open }) {
  const { data, err, reload } = useLoad(() => invoke<AgentRow[]>('ccAgents', p.cwd), [p.cwd])
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const create = () => {
    void invoke<string>('ccAgentNew', p.cwd, scope, name.trim()).then((file) => { reload(); openFile(file) }, (e) => notice(why(e)))
  }
  if (err) return <Unavailable reason={err} />
  if (!data) return <Empty>Reading the agent folders</Empty>
  return (
    <>
      {(['project', 'user'] as const).map((sc) => (
        <Section key={sc} title={sc === 'project' ? 'This project (.claude/agents)' : 'Yours, every project (~/.claude/agents)'} testid={`cc-agents-${sc}`}>
          {!data.some((a) => a.scope === sc) && <Empty>None.</Empty>}
          {data.filter((a) => a.scope === sc).map((a) => (
            <div key={a.file} className="ccp-row ccp-click" onClick={() => openFile(a.file)} data-testid="cc-agent-row" title={a.file}>
              <div className="ccp-main">
                <div><span className="ccp-name">{a.name}</span> <span className="ccp-dim">model {a.model}; tools {a.tools ? a.tools.join(', ') || 'none' : 'all'}</span></div>
                <div className="ccp-dim">{a.description}</div>
                {a.problem && <div className="ccp-err">{a.problem}</div>}
              </div>
            </div>
          ))}
        </Section>
      ))}
      <Section title="New agent">
        <div className="drow">
          <input className="sin" placeholder="name, like code-reviewer" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create() }} data-testid="cc-agent-name" />
          <select className="sin" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'user')} aria-label="Where">
            <option value="project">This project</option><option value="user">Every project</option>
          </select>
          <Btn kind="primary" disabled={!name.trim()} onClick={create} testid="cc-agent-new">New agent</Btn>
        </div>
      </Section>
    </>
  )
}

// ---- /permissions and /hooks: the user, project and local settings files ----
const SCOPE_LABEL: Record<SettingsScope, string> = { user: 'User', project: 'Project (shared)', local: 'Local (this machine only)' }
function SettingsPanel({ p, what }: { p: Open; what: 'rules' | 'hooks' }) {
  const loaded = useLoad(() => invoke<SettingsView[]>('ccSettings', p.cwd), [p.cwd])
  const [files, setFiles] = useState<SettingsView[] | null>(null)
  useEffect(() => { setFiles(loaded.data) }, [loaded.data])
  const edit = (scope: SettingsScope, kind: RuleKind, rule: string, add: boolean) =>
    invoke<SettingsView[]>('ccRule', p.cwd, scope, kind, rule, add).then((f) => { setFiles(f); return true }, (e) => { notice(why(e)); return false })
  if (loaded.err) return <Unavailable reason={loaded.err} />
  if (!files) return <Empty>Reading the settings files</Empty>
  return (
    <>
      {files.map((f) => (
        <Section key={f.scope} title={<>{SCOPE_LABEL[f.scope]} <span className="ccp-mono">{f.path}</span></>} note={f.exists ? <FileLink path={f.path} /> : 'no file yet'} testid={`cc-settings-${f.scope}`}>
          {f.error && <div className="ccp-err">{f.error}</div>}
          {what === 'rules' && !f.error && <Rules f={f} edit={edit} />}
          {what === 'hooks' && !f.error && (f.hooks.length ? f.hooks.map((h, i) => (
            <div key={i} className="ccp-row" data-testid="cc-hook-row">
              <div className="ccp-main">
                <div><span className="ccp-name">{h.event}</span>{h.matcher && <span className="ccp-dim"> matcher {h.matcher}</span>} <span className="ccp-dim">{h.type}</span></div>
                {h.what && <div className="ccp-mono">{h.what}</div>}
              </div>
            </div>
          )) : <Empty>No hooks.</Empty>)}
        </Section>
      ))}
      {what === 'hooks' && <div className="ccp-dim">Hooks are edited in the settings file itself: Open file.</div>}
    </>
  )
}
function Rules({ f, edit }: { f: SettingsView; edit: (scope: SettingsScope, kind: RuleKind, rule: string, add: boolean) => Promise<boolean> }) {
  const [kind, setKind] = useState<RuleKind>('allow')
  const [rule, setRule] = useState('')
  const add = () => { void edit(f.scope, kind, rule, true).then((ok) => { if (ok) setRule('') }) }
  return (
    <>
      {RULE_KINDS.map((k) => f.rules[k].length > 0 && (
        <div key={k} className="ccp-rules">
          <span className="ccp-kind">{k}</span>
          {f.rules[k].map((r) => (
            <span key={r} className="ccp-rule" data-testid="cc-rule"><span className="ccp-mono">{r}</span><Btn kind="link" onClick={() => void edit(f.scope, k, r, false)} title="Remove this rule" testid="cc-rule-remove">Remove</Btn></span>
          ))}
        </div>
      ))}
      {!RULE_KINDS.some((k) => f.rules[k].length) && <Empty>No rules.</Empty>}
      <div className="drow">
        <select className="sin" value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} aria-label="List">{RULE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <input className="sin wide" placeholder="Bash(npm run test:*), WebFetch(domain:example.com), mcp__github" value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && rule.trim()) add() }} data-testid={`cc-rule-input-${f.scope}`} />
        <Btn kind="plain" disabled={!rule.trim()} onClick={add} testid={`cc-rule-add-${f.scope}`}>Add</Btn>
      </div>
    </>
  )
}

// ---- /memory ----
const MEM_LABEL: Record<MemoryScope, string> = { managed: 'Managed', user: 'User', project: 'Project', local: 'Local', parent: 'Parent folder' }
function MemoryPanel({ p }: { p: Open }) {
  const { data, err } = useLoad(() => invoke<MemoryFile[]>('ccMemory', p.cwd), [p.cwd])
  if (err) return <Unavailable reason={err} />
  if (!data) return <Empty>Looking for CLAUDE.md files</Empty>
  return (
    <Section title="Loaded in this order (later ones are read last)" note="Subfolders' CLAUDE.md files load when Claude works there">
      {!data.length && <Empty>No CLAUDE.md files apply to this folder.</Empty>}
      {data.map((m) => (
        <div key={m.path} className="ccp-row ccp-click" onClick={() => openFile(m.path)} data-testid="cc-memory-row">
          <span className="ccp-kind">{MEM_LABEL[m.scope]}{m.rule ? ' rule' : ''}</span>
          <span className="ccp-main ccp-mono">{m.path}</span>
        </div>
      ))}
    </Section>
  )
}

// ---- /resume ----
function ResumePanel({ p }: { p: Open }) {
  const saved = useSavedThreads()
  const [q, setQ] = useState(p.args)
  const rows = useMemo(() => (saved ?? [])
    .filter((s) => sameFolder(s.cwd, p.cwd) && !s.watcherRun && (!q.trim() || s.id === q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => b.updated - a.updated), [saved, p.cwd, q])
  const pick = (s: SessionInfo) => { close(); openSession(s) }
  return (
    <>
      <div className="drow">
        <input className="sin wide" autoFocus placeholder="Filter by title or session id" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && rows[0]) pick(rows[0]) }} data-testid="cc-resume-filter" />
      </div>
      {saved === null ? <Empty>Reading the saved threads</Empty> : !rows.length ? <Empty>No saved thread in {p.cwd} matches.</Empty> : rows.slice(0, 200).map((s) => (
        <div key={s.id} className="ccp-row ccp-click" onClick={() => pick(s)} data-testid="cc-resume-row">
          <span className="ccp-main ccp-name">{s.title}</span><span className="ccp-dim">{age(s.updated)}</span>
        </div>
      ))}
    </>
  )
}

// ---- /add-dir ----
function DirsPanel({ p }: { p: Open }) {
  const { data, err } = useLoad(() => invoke<string[]>('ccDirs', p.tabId ?? ''), [p.tabId])
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [dir, setDir] = useState(p.args)
  useEffect(() => { setDirs(data) }, [data])
  if (!p.tabId) return <Unavailable reason="Open a thread first: added folders belong to one thread." />
  const add = (d: string) => { if (d.trim()) void addDir(p.tabId!, d).then((r) => { if (r) { setDirs(r); setDir('') } }) }
  const browse = () => { void window.api.pickFolder().then((d: string | null) => { if (d) add(d) }) }
  let body: ReactNode = <Empty>Reading</Empty>
  if (err) body = <Unavailable reason={err} />
  else if (dirs) body = dirs.length ? dirs.map((d) => <div key={d} className="ccp-row ccp-mono" data-testid="cc-dir-row">{d}</div>) : <Empty>Only the thread&apos;s own folder.</Empty>
  return (
    <>
      <Section title="Added for the rest of this session" note={p.cwd}>{body}</Section>
      <div className="drow">
        <input className="sin wide" placeholder="Absolute path of a folder" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(dir) }} data-testid="cc-dir-input" />
        <Btn kind="plain" onClick={browse}>Browse</Btn>
        <Btn kind="primary" disabled={!dir.trim()} onClick={() => add(dir)} testid="cc-dir-add">Add</Btn>
      </div>
      <div className="ccp-dim">Claude may read and edit files there. Most .claude configuration in it is not loaded.</div>
    </>
  )
}
