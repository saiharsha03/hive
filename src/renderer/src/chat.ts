// Chat state for one tab, and how each SDK event changes it.
import { hookWarning, isContinuation } from '../../shared/summaryCore'
import { isWatcherTab } from '../../shared/readOnlyCore'
// tools that open as tabs in the main window, like threads and files
export type ToolTab = 'git' | 'todos' | 'notes' | 'watchers' | 'scripts' | 'deploy'
export const TOOL_TABS: ToolTab[] = ['git', 'todos', 'notes', 'scripts', 'deploy', 'watchers']

export type Session = {
  id: string // tab id
  title: string
  cwd?: string
  sessionId?: string // Claude Code session; set for reopened sessions and after a new one starts
  path?: string // its transcript file
  items: Item[]
  streaming: string // text of the reply being written right now
  busy: boolean
  continueRev?: number // bumped when this thread's automatic continue (after a usage limit) is set or ends
  endedRun?: boolean // a finished watcher run opened from the list: its thread is closed until a message reopens it
  asks?: string[] // AskUserQuestion tool calls waiting for the user's answer (their cards take it)
  compacting?: boolean // the engine is summarising the conversation to free context (can take minutes)
  compactions?: number // how many times it compacted while open (a handoff is offered after one)
  turnOpen?: boolean // during a compaction: a turn is still running underneath it
  loaded: boolean // history read (reopened sessions)
  // a reopened thread shows its recent end first: earlier = how many items came from its transcript, more = there is
  // earlier conversation not loaded yet
  history?: { count: number; more: boolean }
  file?: string // a file tab (id "file:<path>"): the editor, not a conversation
  tool?: ToolTab // a tool tab (id "tool:<name>"): that panel, full size
  background: boolean // live but hidden from the tab bar
  waitingReason?: string // why the user is needed (Claude's words, or Finished / Failed + first line)
  waitingSince?: number
  mode?: string // the live session's permission mode (auto while in the background)
  modeError?: string // the last mode switch failed
  worktrees?: { repo: string; path: string; branch: string }[] // made by this thread through the worktree tool
}

export const SHOW = 'mcp__hive__show_to_user'
export const CODEX = 'mcp__hive__codex'

// what the main area shows for a tool call, one line
export function toolLine(name: string, input: any): { verb: string; what: string } {
  const file = (p?: string) => (p ? p.split(/[\\/]/).at(-1)! : '')
  const short = (s?: string, n = 90) => (s ? (s.length > n ? s.slice(0, n) + '…' : s).replace(/\s+/g, ' ') : '')
  switch (name) {
    case 'Read': return { verb: 'Read', what: file(input?.file_path) }
    case 'Write': return { verb: 'Wrote', what: file(input?.file_path) }
    case 'Edit': case 'MultiEdit': return { verb: 'Edited', what: file(input?.file_path) }
    case 'Bash': case 'PowerShell': return { verb: 'Ran', what: short(input?.description || input?.command) }
    case 'Grep': return { verb: 'Searched', what: short(input?.pattern, 60) }
    case 'Glob': return { verb: 'Found files', what: short(input?.pattern, 60) }
    case 'WebFetch': return { verb: 'Fetched', what: short(input?.url, 70) }
    case 'WebSearch': return { verb: 'Searched the web', what: short(input?.query, 70) }
    case 'Agent': case 'Task': return { verb: 'Agent', what: short(input?.description) }
    case 'TodoWrite': return { verb: 'Updated the plan', what: '' }
    case SHOW: return { verb: 'Showed you', what: file(input?.path) }
    case CODEX: return { verb: 'Codex', what: short(input?.task) }
    case 'mcp__hive__list_threads': return { verb: 'Listed threads', what: '' }
    case 'mcp__hive__agent_status': return { verb: 'Checked background work', what: '' }
    case 'mcp__hive__start_thread': return { verb: 'Started thread', what: short(input?.title) }
    case 'mcp__hive__message_thread': return { verb: 'Messaged thread', what: short(`${input?.thread}: ${input?.text ?? ''}`) }
    case 'mcp__hive__wait_for_thread': return { verb: input?.timeout_s === 0 ? 'Checked thread' : 'Waited for thread', what: short(input?.thread) }
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return { verb: mcp[2].replace(/_/g, ' '), what: mcp[1].replace(/^claude_ai_/, '').replace(/_/g, ' ') }
  return { verb: name, what: '' }
}

// "codex-panel" -> "Codex"
export const agentName = (plugin?: string) => (plugin?.startsWith('codex') ? 'Codex' : plugin ?? 'Agent')
// drop the delivery wrapper the plugin adds around the agent's words
export function cleanAgentText(t: string): string {
  return t
    .replace(/^The [\w-]+ plugin sent a message:\s*/, '')
    .replace(/^\[from Codex, answering your codex message "[\s\S]*?"; reply with the codex tool only if needed\]\s*/, '')
    .replace(/\n*This is how Claude Code surfaces a prompt a plugin submits[\s\S]*$/, '')
    .trim()
}

// what Claude is doing right now, one line (shown on a message that steered it)
export function workingOn(items: Item[]): string | undefined {
  const t = items.filter((i) => i.kind === 'tool' && i.status === 'running' && i.name !== SHOW && i.name !== CODEX).at(-1)
  if (t?.kind !== 'tool') return undefined
  const { verb, what } = toolLine(t.name, t.input)
  return `${verb} ${what}`.trim()
}

const settle = (items: Item[], status: 'done' | 'error'): Item[] =>
  items.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status } : it))

export function applyEvent(s: Session, ev: any): Session {
  // subagent traffic stays out of the main conversation
  if (ev.parent_tool_use_id) return s
  switch (ev.type) {
    case 'hive_session':
      return { ...s, sessionId: ev.sessionId, path: ev.path, endedRun: undefined } // running again
    case 'hive_continue':
      return { ...s, continueRev: (s.continueRev ?? 0) + 1 }
    case 'hive_ask':
      return { ...s, asks: [...(s.asks ?? []).filter((x) => x !== ev.id), ev.id] }
    case 'hive_ask_done':
      return { ...s, asks: (s.asks ?? []).filter((x) => x !== ev.id) }
    case 'hive_mode':
      return { ...s, mode: ev.mode ?? s.mode, modeError: ev.error }
    case 'hive_worktree': {
      const rest = (s.worktrees ?? []).filter((w) => w.path !== ev.path)
      return { ...s, worktrees: [...rest, { repo: ev.repo, path: ev.path, branch: ev.branch }] }
    }
    case 'hive_queue': {
      // a queued message was handed to Claude (starts a turn), sent now into the running turn, or removed before delivery
      if (ev.phase === 'removed') return { ...s, items: s.items.filter((it) => !((it.kind === 'user' || it.kind === 'thread') && it.queue?.id === ev.id)) }
      const during = ev.phase === 'steered' ? workingOn(s.items) : undefined
      return {
        ...s,
        busy: true,
        items: s.items.map((it) => ((it.kind === 'user' || it.kind === 'thread') && it.queue?.id === ev.id
          ? { ...it, queue: { id: ev.id, pending: false }, ...(ev.phase === 'steered' ? { steer: true, during } : {}) }
          : it)),
      }
    }
    case 'hive_thread_msg': {
      // another thread's message: queued ones wait like the user's, the rest start or steer a turn
      const item: Item = { kind: 'thread', fromId: ev.fromId, fromTitle: ev.fromTitle, text: ev.text,
        ...(ev.steer ? { steer: true } : {}), ...(ev.queueId ? { queue: { id: ev.queueId, pending: true } } : {}) }
      return { ...s, busy: true, items: [...s.items, item] }
    }
    case 'hive_codex': {
      if (ev.phase === 'start') {
        const box: Item = { kind: 'codex', id: ev.id, task: ev.task, model: ev.model, allowEdits: ev.allowEdits, status: 'running', lines: [], answer: '' }
        return { ...s, items: [...s.items, box] }
      }
      const items = s.items.map((it) => {
        if (it.kind !== 'codex' || it.id !== ev.id) return it
        if (ev.phase === 'line') return { ...it, lines: [...it.lines, ev.line] }
        return { ...it, status: ev.ok ? ('done' as const) : ('error' as const), answer: ev.answer }
      })
      return { ...s, items }
    }
    case 'system':
      if (ev.subtype === 'init' && ev.permissionMode) return { ...s, mode: ev.permissionMode }
      // compaction starting: shown as working, with its own label, so minutes of silence never look like a hang
      // (turnOpen: a turn is still running under it, so the thread stays busy after; otherwise it goes idle)
      if (ev.subtype === 'status') {
        const on = ev.status === 'compacting'
        if (on === !!s.compacting) return s
        return on ? { ...s, compacting: true, turnOpen: s.busy, busy: true } : { ...s, compacting: false, busy: !!s.turnOpen }
      }
      // auto-compact (or /compact): the engine summarised the conversation to free context
      if (ev.subtype === 'compact_boundary') {
        const how = ev.compact_metadata?.trigger === 'manual' ? 'compacted' : 'auto-compacted'
        const ended = s.compacting ? { compacting: false, busy: !!s.turnOpen } : {}
        return { ...s, ...ended, compactions: (s.compactions ?? 0) + 1, items: [...s.items, { kind: 'note', text: `Conversation ${how} to free up context` }] }
      }
      // a hook said something to the user (security warning on an edit, a blocked call); empty output stays hidden
      {
        const w = hookWarning(ev)
        if (w) return { ...s, items: [...s.items, { kind: 'warning', event: w.event, name: w.name, text: w.text }] }
      }
      return s
    case 'conversation_reset':
      // /clear: a fresh conversation in the same tab
      return { ...s, streaming: '', items: [{ kind: 'note', text: 'Conversation cleared' }] }
    case 'stream_event': {
      const e = ev.event
      // a turn can start without the user (a plugin message woke Claude): show it as working
      if (e?.type === 'message_start') return { ...s, streaming: '', busy: true }
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') return { ...s, streaming: s.streaming + e.delta.text }
      return s
    }
    case 'assistant': {
      const items = [...s.items]
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) items.push({ kind: 'assistant', text: b.text, at: Date.now() })
        else if (b.type === 'tool_use') {
          if (b.name === SHOW) items.push({ kind: 'show', path: b.input?.path })
          items.push({ kind: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' })
        }
      }
      return { ...s, items, streaming: '' }
    }
    case 'user': {
      // a message another agent sent in (codex-panel delivers Codex's replies this way)
      if (ev.origin?.kind === 'plugin') {
        const c = ev.message?.content
        const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '')
        return { ...s, busy: true, items: [...s.items, { kind: 'agent', from: agentName(ev.origin.name), text: cleanAgentText(text) }] }
      }
      // the compaction summary a continued conversation starts from: one collapsed line, not a giant "You"
      {
        const c = ev.message?.content
        const plain = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '')
        if (ev.isCompactSummary || isContinuation(plain)) return { ...s, items: [...s.items, { kind: 'summary', text: plain }] }
      }
      const results = (Array.isArray(ev.message?.content) ? ev.message.content : []).filter((b: any) => b.type === 'tool_result')
      if (!results.length) return s
      const items = s.items.map((it) => {
        if (it.kind !== 'tool') return it
        const r = results.find((b: any) => b.tool_use_id === it.id)
        if (!r) return it
        // an Edit / MultiEdit / Write result carries the change as hunks with real line numbers
        const patch = results.length === 1 && Array.isArray(ev.tool_use_result?.structuredPatch) && ev.tool_use_result.structuredPatch.length ? ev.tool_use_result.structuredPatch : undefined
        return { ...it, status: r.is_error ? ('error' as const) : ('done' as const), ...(patch ? { patch } : {}) }
      })
      return { ...s, items }
    }
    case 'result': {
      // the turn is over: any tool still marked running never got its result (stopped or failed)
      const items: Item[] = settle(s.items, ev.is_error ? 'error' : 'done')
      if (ev.is_error) {
        const why = [...(ev.errors ?? []), ev.result].filter(Boolean).join('\n')
        // the engine's internal end-of-turn diagnostic: say what it means, keep the raw line for reference
        const text = why.startsWith('[ede_diagnostic]') ? `The turn stopped before Claude finished (usually a full context: it compacts and carries on). ${why}` : why
        items.push({ kind: 'error', text: text || `The turn ended: ${ev.subtype ?? 'error'}` })
      }
      // still busy while a compaction runs after the turn
      return { ...s, items, busy: !!s.compacting, turnOpen: false, streaming: '' }
    }
    case 'hive_error':
      return { ...s, busy: false, compacting: false, turnOpen: false, streaming: '', items: [...settle(s.items, 'error'), { kind: 'error', text: ev.message }] }
    case 'hive_closed':
      // queued messages died with the process; a watcher run's tab closes when the run ends: it shows the closed-run notice
      return { ...s, ...(isWatcherTab(s.id) ? { endedRun: true } : {}), busy: false, compacting: false, turnOpen: false, streaming: '', items: settle(s.items, 'error').filter((it) => !((it.kind === 'user' || it.kind === 'thread') && it.queue?.pending)) }
  }
  return s
}
