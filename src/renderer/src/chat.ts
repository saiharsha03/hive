// Chat state for one tab, and how each SDK event changes it.
export type Session = {
  id: string // tab id
  title: string
  cwd?: string
  sessionId?: string // Claude Code session; set for reopened sessions and after a new one starts
  path?: string // its transcript file
  items: Item[]
  streaming: string // text of the reply being written right now
  busy: boolean
  loaded: boolean // history read (reopened sessions)
}

export const SHOW = 'mcp__hive__show_to_user'

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
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return { verb: mcp[2].replace(/_/g, ' '), what: mcp[1].replace(/^claude_ai_/, '').replace(/_/g, ' ') }
  return { verb: name, what: '' }
}

const settle = (items: Item[], status: 'done' | 'error'): Item[] =>
  items.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status } : it))

export function applyEvent(s: Session, ev: any): Session {
  // subagent traffic stays out of the main conversation
  if (ev.parent_tool_use_id) return s
  switch (ev.type) {
    case 'hive_session':
      return { ...s, sessionId: ev.sessionId, path: ev.path }
    case 'system':
      // auto-compact (or /compact): the engine summarised the conversation to free context
      if (ev.subtype === 'compact_boundary') {
        const how = ev.compact_metadata?.trigger === 'manual' ? 'compacted' : 'auto-compacted'
        return { ...s, items: [...s.items, { kind: 'note', text: `Conversation ${how} to free up context` }] }
      }
      return s
    case 'stream_event': {
      const e = ev.event
      if (e?.type === 'message_start') return { ...s, streaming: '' }
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') return { ...s, streaming: s.streaming + e.delta.text }
      return s
    }
    case 'assistant': {
      const items = [...s.items]
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) items.push({ kind: 'assistant', text: b.text })
        else if (b.type === 'tool_use') {
          if (b.name === SHOW) items.push({ kind: 'show', path: b.input?.path })
          items.push({ kind: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' })
        }
      }
      return { ...s, items, streaming: '' }
    }
    case 'user': {
      const results = (Array.isArray(ev.message?.content) ? ev.message.content : []).filter((b: any) => b.type === 'tool_result')
      if (!results.length) return s
      const items = s.items.map((it) => {
        if (it.kind !== 'tool') return it
        const r = results.find((b: any) => b.tool_use_id === it.id)
        return r ? { ...it, status: r.is_error ? ('error' as const) : ('done' as const) } : it
      })
      return { ...s, items }
    }
    case 'result': {
      // the turn is over: any tool still marked running never got its result (stopped or failed)
      const items: Item[] = settle(s.items, ev.is_error ? 'error' : 'done')
      if (ev.is_error) {
        const why = [...(ev.errors ?? []), ev.result].filter(Boolean).join('\n')
        items.push({ kind: 'error', text: why || `The turn ended: ${ev.subtype ?? 'error'}` })
      }
      return { ...s, items, busy: false, streaming: '' }
    }
    case 'hive_error':
      return { ...s, busy: false, streaming: '', items: [...settle(s.items, 'error'), { kind: 'error', text: ev.message }] }
    case 'hive_closed':
      return { ...s, busy: false, streaming: '', items: settle(s.items, 'error') }
  }
  return s
}
