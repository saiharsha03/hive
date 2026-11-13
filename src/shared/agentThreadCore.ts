// Agent threads: another command-line coding agent (Codex CLI, OpenCode, Gemini CLI, any command) run in a terminal
// that is a tab of its own. Orbit cannot read its conversation, so its state is a guess from the terminal: output means
// it works, a bell or a quiet prompt means it may want you, the exit code says how it ended. Pure, so it is tested
// without a pty.
import { stripAnsi } from './devCore'

export { stripAnsi }
export type AgentDef = { name: string; command: string; args: string[] }
export type AgentState = 'running' | 'waiting' | 'exited' | 'failed'
export type AgentSignal = { type: 'output'; tail: string } | { type: 'bell' } | { type: 'idle'; ms: number; tail: string } | { type: 'exit'; code: number }

// how long the output must stay quiet, on a prompt, before the agent is taken to be waiting for you
export const IDLE_MS = 4000

// the Settings value as a list of agents: entries without a name or a command are dropped; args may be a list or one
// space-separated line
export function parseAgents(raw: unknown): AgentDef[] {
  if (!Array.isArray(raw)) return []
  const out: AgentDef[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const command = typeof o.command === 'string' ? o.command.trim() : ''
    if (!name || !command) continue
    const args = Array.isArray(o.args) ? o.args.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
      : typeof o.args === 'string' ? splitArgs(o.args) : []
    out.push({ name, command, args })
  }
  return out
}
export const splitArgs = (line: string): string[] => line.split(/\s+/).filter(Boolean)

// OSC sequences (a window title, a hyperlink) end in a BEL of their own; that one is not the agent ringing
// eslint-disable-next-line no-control-regex -- matching terminal escape codes is the point
const stripOsc = (s: string) => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
export const hasBell = (chunk: string): boolean => stripOsc(chunk).includes('\x07')

// the last line of output with text on it, as the screen shows it (a carriage return overwrites the line)
export function lastLine(tail: string): string {
  const lines = stripAnsi(stripOsc(tail)).split('\n').map((l) => (l.split('\r').filter((p) => p.trim()).at(-1) ?? '').trimEnd())
  return lines.filter((l) => l.trim()).at(-1) ?? ''
}
// a prompt that waits for input: it ends in >, ❯, ›, ? or :, or asks yes or no
export function looksLikePrompt(tail: string): boolean {
  const line = lastLine(tail)
  if (!line) return false
  return /[>❯›?:]$/.test(line) || /\(\s*y(es)?\s*\/\s*n(o)?\s*\)|\[\s*y\s*\/\s*n\s*\]/i.test(line)
}

export function nextState(prev: AgentState, s: AgentSignal): AgentState {
  if (prev === 'exited' || prev === 'failed') return prev // final until a restart
  switch (s.type) {
    case 'output': return 'running'
    case 'bell': return 'waiting'
    case 'idle': return prev === 'running' && s.ms >= IDLE_MS && looksLikePrompt(s.tail) ? 'waiting' : prev
    case 'exit': return s.code === 0 ? 'exited' : 'failed'
  }
}

// the word the rail and the tab show; waiting is a guess, so it asks
export const agentLabel = (state: AgentState): string =>
  state === 'running' ? 'running' : state === 'waiting' ? 'needs you?' : state === 'exited' ? 'exited' : 'failed'
