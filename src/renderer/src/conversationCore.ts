// Pure parts of the conversation view: the "since you looked" line, and what a tool row shows (its verb word and
// colour, what it touched, its result). No React, no window, so they are tested on their own.
import { ADVISOR_TOOL } from '../../shared/advisorCallCore'

type ToolItem = { kind: 'tool'; id: string; name: string; input: any; status: 'running' | 'done' | 'error'; output?: string }
type AnyItem = { kind: string; [k: string]: any }

const FILE_EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const AGENTS = new Set(['Agent', 'Task'])

// "3 files edited, 1 subagent finished, 1 failed, Claude is working: Ran pytest"; empty when nothing happened
export function sinceSummary(items: AnyItem[], from: number, busy: boolean, workingOn?: string): string {
  const fresh = items.slice(Math.max(0, from))
  const files = new Set<string>()
  let agents = 0, failed = 0, replies = 0, asks = 0, yours = 0
  for (const it of fresh) {
    if (it.kind === 'tool') {
      if (FILE_EDIT.has(it.name) && it.status === 'done' && typeof it.input?.file_path === 'string') files.add(it.input.file_path.toLowerCase())
      else if (AGENTS.has(it.name) && it.status === 'done') agents++
      else if (it.name === 'AskUserQuestion') asks++
      if (it.status === 'error' && exitOnly(it.name, it.status, it.output) === null) failed++
    } else if (it.kind === 'assistant') replies++
    else if (it.kind === 'error') failed++
    else if (it.kind === 'user' || it.kind === 'thread') yours++
  }
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const parts = [
    files.size ? `${n(files.size, 'file')} edited` : '',
    agents ? `${n(agents, 'subagent')} finished` : '',
    asks ? `${n(asks, 'question')} for you` : '',
    failed ? `${failed} failed` : '',
    !files.size && !agents && replies ? `${n(replies, 'reply', 'replies')}` : '',
    yours && !replies && !files.size ? `${n(yours, 'message')} sent in` : '',
  ].filter(Boolean)
  if (busy) parts.push(workingOn ? `working now: ${workingOn}` : 'working now')
  if (!parts.length) return ''
  const s = parts.join(', ')
  return `${s[0].toUpperCase()}${s.slice(1)}.`
}

export type VerbTone = 'read' | 'edit' | 'add' | 'run' | 'agent' | 'search' | 'other' | 'advisor'
// the coloured word at the start of a tool row: the tool's own short name
export function toolVerb(name: string): { word: string; tone: VerbTone } {
  if (name === 'Read' || name === 'NotebookRead') return { word: 'Read', tone: 'read' }
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return { word: 'Edit', tone: 'edit' }
  if (name === 'Write') return { word: 'Write', tone: 'add' }
  if (name === 'Bash' || name === 'PowerShell') return { word: name === 'Bash' ? 'Bash' : 'Shell', tone: 'run' }
  if (name === 'Grep' || name === 'Glob') return { word: name, tone: 'search' }
  if (AGENTS.has(name) || name === 'Workflow') return { word: 'Agent', tone: 'agent' }
  if (name === 'WebFetch' || name === 'WebSearch') return { word: 'Web', tone: 'search' }
  if (name === 'TodoWrite') return { word: 'Plan', tone: 'other' }
  if (name === ADVISOR_TOOL) return { word: 'Advisor', tone: 'advisor' } // a second model was asked: its own colour, so it is not read as one more tool call
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) return { word: mcp[1] === 'orbit' || mcp[1] === 'hive' ? 'Orbit' : mcp[1].replace(/^claude_ai_/, '').replace(/[-_]/g, ' ').split(' ')[0], tone: mcp[1] === 'orbit' || mcp[1] === 'hive' ? 'agent' : 'other' }
  return { word: name, tone: 'other' }
}

// the dim result at the end of a done row: "212 lines", "7 hits", "exit 0" ... (edits show their counts elsewhere)
export function toolResult(t: ToolItem): string {
  if (t.status !== 'done' || t.output === undefined) return ''
  const out = t.output.trim()
  const lines = out ? out.split('\n').length : 0
  if (t.name === 'Read') return lines ? `${lines} lines` : ''
  if (t.name === 'Grep') return lines ? `${lines} hit${lines === 1 ? '' : 's'}` : 'no hits'
  if (t.name === 'Glob') return lines ? `${lines} file${lines === 1 ? '' : 's'}` : 'none'
  if (t.name === 'Bash' || t.name === 'PowerShell') {
    const code = out.match(/exit code (\d+)/i)?.[1]
    return code ? `exit ${code}` : lines ? `${lines} line${lines === 1 ? '' : 's'}` : 'no output'
  }
  return ''
}

// what a running tool is doing, one line: a shell's own description when it has one ("Run the billing tests"),
// else the verb and its object ("Read OutboxQueue.kt")
export function nowLine(verb: string, what: string, input: any): string {
  const d = typeof input?.description === 'string' ? input.description.trim() : ''
  if (d && (verb === 'Ran' || verb === 'Agent')) return d
  return `${verb} ${what}`.trim()
}

// where a failed tool's output first says it failed, so the opened row starts on the error lines
export function errorLine(output: string): number {
  const lines = output.split('\n')
  const i = lines.findIndex((l) => /error|failed|exception|traceback|not found|denied|refused/i.test(l))
  return i < 0 ? 0 : i
}

// A shell command whose only "error" is its exit code: the engine marks any non-zero exit as an error, but a search
// that found nothing or a process that was already gone is an answer, not a failure. Such a row says its exit code
// in a plain tone; FAILED stays for a tool that could not run, was denied, or timed out. null: not that case.
export function exitOnly(name: string, status: string, output: unknown): number | null {
  if (status !== 'error' || !/^(Bash|PowerShell)$/.test(name) || typeof output !== 'string') return null
  const m = output.trimStart().match(/^Exit code (\d+)/)
  return m && Number(m[1]) !== 0 ? Number(m[1]) : null
}

// Up and Down in an empty message box walk the prompts already sent in this thread, newest first, the way a shell
// does. at: -1 is the box's own text, 0 the newest prompt. Returns the next position, or null when the key should do
// what it always does (the box holds text of its own, or there is nowhere further to go).
export function promptHistory(items: { kind: string; text?: string }[]): string[] {
  const out: string[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i].kind === 'user' ? (items[i].text ?? '').trim() : ''
    if (t && out[out.length - 1] !== t) out.push(t)
  }
  return out
}
export function historyStep(key: string, at: number, count: number, boxEmpty: boolean): number | null {
  if (key === 'ArrowUp') return (at >= 0 || boxEmpty) && at + 1 < count ? at + 1 : null
  if (key === 'ArrowDown') return at >= 0 ? at - 1 : null
  return null
}

// An attached image is named in the text where it was added: "[Image 1]", "[Image 2]", in the order they are sent,
// so a message can say which picture it means. Taking image n away takes its tag out and moves the later ones down.
export const imageTag = (n: number): string => `[Image ${n}]`
export function dropImageTag(text: string, n: number): string {
  // one pass: the tag itself goes (with the space after it), a later tag moves down one, an earlier one stays
  return text.replace(/\[Image (\d+)\]( ?)/g, (whole, d, space) => (Number(d) === n ? '' : Number(d) > n ? `${imageTag(Number(d) - 1)}${space}` : whole))
}
