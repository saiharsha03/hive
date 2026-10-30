// Turns a session transcript into chat items, so a reopened session shows its conversation.
import { readFile } from 'node:fs/promises'

export type Item =
  | { kind: 'user'; text: string; images: string[] } // images as data: URLs
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error' }
  | { kind: 'show'; path: string }
  | { kind: 'note'; text: string }

const SHOW = 'mcp__hive__show_to_user'
// Claude Code's own wrappers stored as user turns (slash commands, reminders, notifications),
// not something the user typed; a message that merely starts with "<" (pasted HTML) is kept
const WRAPPER = /^<(command-|local-command|system-reminder|task-notification|bash-|user-prompt|ide_)/

export async function loadHistory(path: string): Promise<Item[]> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch { return [] }
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  const seen = new Set<string>() // assistant content blocks repeat across streamed lines

  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.isSidechain || e.isMeta) continue
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      items.push({ kind: 'note', text: `Conversation ${e.compactMetadata?.trigger === 'manual' ? 'compacted' : 'auto-compacted'} to free up context` })
      continue
    }
    const c = e.message?.content

    if (e.type === 'user') {
      if (typeof c === 'string') {
        if (!WRAPPER.test(c)) items.push({ kind: 'user', text: c, images: [] })
        continue
      }
      if (!Array.isArray(c)) continue
      for (const b of c) if (b.type === 'tool_result') { const t = tools.get(b.tool_use_id); if (t) t.status = b.is_error ? 'error' : 'done' }
      const words = c.filter((b: any) => b.type === 'text' && !WRAPPER.test(b.text)).map((b: any) => b.text).join('\n')
      const images = c.filter((b: any) => b.type === 'image' && b.source?.type === 'base64').map((b: any) => `data:${b.source.media_type};base64,${b.source.data}`)
      if (words || images.length) items.push({ kind: 'user', text: words, images })
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        const key = `${e.message.id}:${b.type}:${b.id ?? b.text}`
        if (seen.has(key)) continue
        seen.add(key)
        if (b.type === 'text' && b.text.trim()) items.push({ kind: 'assistant', text: b.text })
        else if (b.type === 'tool_use') {
          if (b.name === SHOW) items.push({ kind: 'show', path: b.input?.path })
          const t = { kind: 'tool' as const, id: b.id, name: b.name, input: b.input, status: 'running' as const }
          tools.set(b.id, t)
          items.push(t)
        }
      }
    }
  }
  // a tool with no result in the transcript was cut off
  for (const t of tools.values()) if (t.status === 'running') t.status = 'done'
  return items
}
