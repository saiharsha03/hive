// Turns a session transcript into chat items, so a reopened session shows its conversation.
import { open, readFile } from 'node:fs/promises'
import { parseFromThread } from '../shared/threadTalkCore'
import { isContinuation } from '../shared/summaryCore'
import { appName } from '../shared/appName'
import { resultText } from '../shared/toolOutputCore'

export type Item =
  | { kind: 'user'; text: string; images: string[]; at?: number; uuid?: string } // images as data: URLs; at = when it was sent (ms); uuid = its transcript entry (Rewind)
  | { kind: 'assistant'; text: string; at?: number } // at = when Claude wrote it
  | { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'; patch?: unknown; output?: string }
  | { kind: 'show'; path: string }
  | { kind: 'note'; text: string }
  | { kind: 'summary'; text: string } // the compaction summary a continued session starts from, shown collapsed
  | { kind: 'agent'; from: string; text: string }
  | { kind: 'thread'; fromId: string; fromTitle: string; text: string }
  | { kind: 'codex'; id: string; task: string; model: string; allowEdits: boolean; status: 'running' | 'done' | 'error'; lines: string[]; answer: string }

const SHOW = 'mcp__hive__show_to_user'
const CODEX = 'mcp__hive__codex'
// "[Codex finished task ab12cd34]" / "... with an error]": the answer a background Codex run sent back
const CODEX_DONE = /^\[Codex finished task (\w+)( with an error)?\]\s*/
// Claude Code's own wrappers stored as user turns (slash commands, reminders, notifications),
// not something the user typed; a message that merely starts with "<" (pasted HTML) is kept
const WRAPPER = /^<(command-|local-command|system-reminder|task-notification|bash-|user-prompt|ide_)/

// a message from another Hive thread carries its label (threadTalkCore); anything else the user typed
function userItem(text: string, images: string[], at?: number, uuid?: string): Item {
  const t = parseFromThread(text)
  return t ? { kind: 'thread', fromId: t.from.id, fromTitle: t.from.title, text: t.text } : { kind: 'user', text, images, ...(at ? { at } : {}), ...(uuid ? { uuid } : {}) }
}

export async function loadHistory(path: string): Promise<Item[]> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch { return [] }
  return parseHistory(text)
}

// The end of a long transcript only, so a reopened thread shows at once: the last `bytes` from the first whole line on,
// doubled until it holds `minItems` (tool output makes some lines huge). more = earlier lines were left out
// (loadHistory reads them all when asked).
export async function loadRecentHistory(path: string, bytes = RECENT_BYTES, minItems = RECENT_ITEMS): Promise<{ items: Item[]; more: boolean }> {
  let fh
  try { fh = await open(path, 'r') } catch { return { items: [], more: false } }
  try {
    const { size } = await fh.stat()
    for (let n = bytes; ; n *= 2) {
      if (size <= n) return { items: parseHistory(await fh.readFile('utf8')), more: false }
      const buf = Buffer.alloc(n)
      await fh.read(buf, 0, n, size - n)
      const text = buf.toString('utf8')
      const items = parseHistory(text.slice(text.indexOf('\n') + 1))
      if (items.length >= minItems) return { items, more: true }
    }
  } finally {
    await fh.close()
  }
}
export const RECENT_BYTES = 2 * 1024 * 1024
const RECENT_ITEMS = 150

function parseHistory(text: string): Item[] {
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  const seen = new Set<string>() // assistant content blocks repeat across streamed lines
  const codexByCall = new Map<string, Extract<Item, { kind: 'codex' }>>() // tool_use id -> box
  const codexByTask = new Map<string, Extract<Item, { kind: 'codex' }>>() // Codex task id -> box

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
    const at = Date.parse(e.timestamp ?? '') || undefined

    if (e.type === 'user' && e.origin?.kind === 'plugin') {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : ''
      const from = String(e.origin.name ?? '').startsWith('codex') ? 'Codex' : (e.origin.name ?? 'Agent')
      items.push({ kind: 'agent', from, text: text
        .replace(/^The [\w-]+ plugin sent a message:\s*/, '')
        .replace(/^\[from Codex, answering your codex message "[\s\S]*?"; reply with the codex tool only if needed\]\s*/, '')
        .replace(/\n*This is how Claude Code surfaces a prompt a plugin submits[\s\S]*$/, '')
        .trim() })
      continue
    }

    if (e.type === 'user') {
      const plain = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : ''
      if (e.isCompactSummary || isContinuation(plain)) { items.push({ kind: 'summary', text: plain }); continue }
      if (typeof c === 'string') {
        const done = c.match(CODEX_DONE)
        const box = done && codexByTask.get(done[1])
        if (box) { box.answer = c.replace(CODEX_DONE, '').replace(/^Below is the output of the Codex subagent[^\n]*\n/, '').replace(/<\/?codex_output(_\w+)?>/g, '').trim(); box.status = done![2] ? 'error' : 'done'; continue }
        if (!WRAPPER.test(c)) items.push(userItem(c, [], at, e.uuid))
        continue
      }
      if (!Array.isArray(c)) continue
      for (const b of c) if (b.type === 'tool_result') {
        const t = tools.get(b.tool_use_id)
        if (t) { t.status = b.is_error ? 'error' : 'done'; t.output = resultText(b.content) }
        // an Edit / MultiEdit / Write result carries the change as hunks with real line numbers
        if (t && Array.isArray(e.toolUseResult?.structuredPatch) && e.toolUseResult.structuredPatch.length) t.patch = e.toolUseResult.structuredPatch
        // the codex tool's result names the task id its answer will come back under
        const box = codexByCall.get(b.tool_use_id)
        const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
        const task = out.match(/task (\w{8})/)?.[1]
        if (box && task) codexByTask.set(task, box)
        if (box && /^Codex failed/.test(out)) { box.status = 'error'; box.answer = out }
        else if (box && !task) { box.status = 'done'; box.answer = out } // wait=true: the answer is the result
      }
      const words = c.filter((b: any) => b.type === 'text' && !WRAPPER.test(b.text)).map((b: any) => b.text).join('\n')
      const images = c.filter((b: any) => b.type === 'image' && b.source?.type === 'base64').map((b: any) => `data:${b.source.media_type};base64,${b.source.data}`)
      if (words || images.length) items.push(userItem(words, images, at, e.uuid))
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        const key = `${e.message.id}:${b.type}:${b.id ?? b.text}`
        if (seen.has(key)) continue
        seen.add(key)
        if (b.type === 'text' && b.text.trim()) items.push({ kind: 'assistant', text: b.text, ...(at ? { at } : {}) })
        else if (b.type === 'tool_use') {
          if (b.name === SHOW) items.push({ kind: 'show', path: b.input?.path })
          if (b.name === CODEX) {
            const box = { kind: 'codex' as const, id: b.id, task: b.input?.task ?? '', model: b.input?.model ?? '', allowEdits: !!b.input?.allowEdits, status: 'running' as const, lines: [], answer: '' }
            codexByCall.set(b.id, box)
            items.push(box)
          }
          const t = { kind: 'tool' as const, id: b.id, name: b.name, input: b.input, status: 'running' as const }
          tools.set(b.id, t)
          items.push(t)
        }
      }
    }
  }
  // a tool with no result in the transcript was cut off
  for (const t of tools.values()) if (t.status === 'running') t.status = 'done'
  // a background Codex run whose answer never came back was stopped (tab closed, Hive restarted)
  for (const b of codexByCall.values()) if (b.status === 'running') {
    b.status = 'error'
    b.answer = `Stopped before Codex answered (the tab was closed or ${appName()} restarted).`
  }
  return items
}
