// A thread's terminal: the person's own shell (node-pty in the main process), one per thread, shown in the bottom
// panel's Terminal tab. The xterm instances live here, outside React, so a terminal keeps its screen and buffer while
// it is not shown or while the UI changes; the view only lends it a place in the page. The agent never reads it;
// "Send to chat" fills the thread's message box. Colours are the theme's tokens and follow a theme change.
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { onThemeApplied } from './appearance'
import { Icon } from './ui'

// agent: an agent thread's terminal runs that agent (Settings > Agents), not a shell
type Entry = { term: Terminal; fit: FitAddon; host: HTMLDivElement; state: 'opening' | 'live' | 'exited'; cwd: string; agent?: string }
const entries = new Map<string, Entry>()

const v = (cs: CSSStyleDeclaration, name: string) => cs.getPropertyValue(name).trim()
function themeFromTokens() {
  const cs = getComputedStyle(document.documentElement)
  return {
    background: v(cs, '--term-bg'), foreground: v(cs, '--term-fg'), cursor: v(cs, '--term-cursor'), selectionBackground: v(cs, '--term-sel'),
    black: v(cs, '--ansi-black'), red: v(cs, '--ansi-red'), green: v(cs, '--ansi-green'), yellow: v(cs, '--ansi-yellow'), blue: v(cs, '--ansi-blue'),
    magenta: v(cs, '--ansi-magenta'), cyan: v(cs, '--ansi-cyan'), white: v(cs, '--ansi-white'), brightBlack: v(cs, '--ansi-bright-black'),
    brightRed: v(cs, '--ansi-bright-red'), brightGreen: v(cs, '--ansi-bright-green'), brightYellow: v(cs, '--ansi-bright-yellow'),
    brightBlue: v(cs, '--ansi-bright-blue'), brightMagenta: v(cs, '--ansi-bright-magenta'), brightCyan: v(cs, '--ansi-bright-cyan'), brightWhite: v(cs, '--ansi-bright-white'),
  }
}
onThemeApplied(() => { const t = themeFromTokens(); for (const e of entries.values()) e.term.options.theme = t })

// one listener pair for every terminal; output for a terminal still opening is already in the scrollback it gets back
let wired = false
function wire() {
  if (wired) return
  wired = true
  window.api.onTerminalData((id, chunk) => {
    const e = entries.get(id)
    if (e?.state === 'live') e.term.write(chunk)
  })
  window.api.onTerminalExit((id, code, closed) => {
    const e = entries.get(id)
    if (!e) return
    if (closed) { e.term.dispose(); e.host.remove(); entries.delete(id); return } // the thread was closed
    e.state = 'exited'
    e.term.write(e.agent ? `\r\n\x1b[90m[${e.agent} exited with code ${code}; Restart starts it again]\x1b[0m\r\n`
      : `\r\n\x1b[90m[shell exited with code ${code}; press Enter to start a new one]\x1b[0m\r\n`)
  })
}

async function start(id: string, e: Entry) {
  e.state = 'opening'
  let r: Awaited<ReturnType<typeof window.api.terminalOpen>>
  try { r = await window.api.terminalOpen(id, e.cwd, e.term.cols, e.term.rows, e.agent) } catch (err) {
    // the shell did not start (a wrong shell path, a folder that is gone): say so, and Enter tries again
    if (entries.get(id) !== e) return
    e.state = 'exited'
    const why = String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    if (e.agent) {
      // an agent that did not start (not on PATH, a bad argument) has failed; Restart tries again
      window.dispatchEvent(new CustomEvent('hive:agent-failed', { detail: id }))
      e.term.write(`\r\n\x1b[31m[${e.agent} did not start: ${why}]\x1b[0m\r\n\x1b[90m[Restart tries again]\x1b[0m\r\n`)
      return
    }
    e.term.write(`\r\n\x1b[31m[the shell did not start: ${why}]\x1b[0m\r\n\x1b[90m[press Enter to try again]\x1b[0m\r\n`)
    return
  }
  if (entries.get(id) !== e) return
  if (!r.fresh) e.term.write(r.scrollback)
  e.cwd = r.cwd
  e.state = 'live'
  // the view may have been fitted while the shell was starting
  void window.api.terminalResize(id, e.term.cols, e.term.rows)
}

function create(id: string, cwd: string, agent?: string): Entry {
  wire()
  const host = document.createElement('div')
  host.className = 'term-host'
  const term = new Terminal({
    theme: themeFromTokens(),
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'Consolas, monospace',
    fontSize: 14,
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: false,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const e: Entry = { term, fit, host, state: 'opening', cwd, agent }
  // Ctrl+C copies when there is a selection (else it is the interrupt), Ctrl+V pastes, Ctrl+` and Ctrl+J belong to the panel
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown' || !ev.ctrlKey || ev.altKey) return true
    if (ev.code === 'Backquote' || (ev.key.toLowerCase() === 'j' && !ev.shiftKey) || ev.key.toLowerCase() === 'k') return false
    const k = ev.key.toLowerCase()
    if (k === 'c' && !ev.shiftKey && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      ev.preventDefault()
      return false
    }
    if (k === 'v') return false // the browser's own paste event; xterm pastes it (bracketed, as a terminal should)
    return true
  })
  term.onData((d) => {
    if (e.state === 'live') void window.api.terminalWrite(id, d)
    else if (e.state === 'exited' && d === '\r' && !e.agent) { term.reset(); void start(id, e) }
  })
  term.onResize(({ cols, rows }) => { if (e.state === 'live') void window.api.terminalResize(id, cols, rows) })
  entries.set(id, e)
  return e
}

// the selection, or else the last 200 lines of output, as a fenced block for the message box
function terminalTextForChat(id: string): string | null {
  const e = entries.get(id)
  if (!e) return null
  let text = e.term.hasSelection() ? e.term.getSelection() : ''
  if (!text) {
    const b = e.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < b.length; i++) {
      const line = b.getLine(i)
      if (!line) continue
      const s = line.translateToString(true)
      if (line.isWrapped && lines.length) lines[lines.length - 1] += s
      else lines.push(s)
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    text = lines.slice(-200).join('\n')
  }
  text = text.replace(/\s+$/, '')
  if (!text) return null
  const fence = text.includes('```') ? '````' : '```'
  return `${fence}\n${text}\n${fence}\n`
}

export type TermTarget = { tabId: string; title: string; cwd: string }

/** end a terminal for good: its shell is killed and its screen is dropped */
export function disposeTerminal(id: string) {
  const e = entries.get(id)
  if (e) { e.host.remove(); try { e.term.dispose() } catch { /* already gone */ } entries.delete(id) }
  void window.api.terminalKill(id).catch(() => {})
}

// an agent thread's Restart: its process stops and starts again under the same id, in the same screen
export async function restartTerminal(id: string) {
  const e = entries.get(id)
  if (!e || e.state === 'opening') return
  e.state = 'opening'
  await window.api.terminalKill(id, true).catch(() => {})
  e.term.reset()
  await start(id, e)
}
// an agent thread's Stop: its process ends, the screen and the tab stay
export async function stopTerminal(id: string) {
  const e = entries.get(id)
  if (!e || e.state !== 'live') return
  e.state = 'exited'
  await window.api.terminalKill(id, true).catch(() => {})
  e.term.write(`\r\n\x1b[90m[stopped; Restart starts it again]\x1b[0m\r\n`)
}

// lend a terminal the slot (made and started on first use); returns the cleanup that takes it back, not disposes it
function lend(el: HTMLDivElement, id: string, cwd: string, agent: string | undefined, started: () => void): () => void {
  const fresh = !entries.has(id)
  const e = entries.get(id) ?? create(id, cwd, agent)
  el.appendChild(e.host)
  if (!e.term.element) e.term.open(e.host)
  const refit = () => { if (el.offsetHeight > 0 && el.offsetWidth > 0) try { e.fit.fit() } catch { /* not laid out yet */ } }
  refit()
  if (fresh) void start(id, e).then(started)
  const ro = new ResizeObserver(refit)
  ro.observe(el)
  return () => { ro.disconnect(); e.host.remove() }
}

// an agent thread's tab body: its terminal, focused while the tab is
export function AgentTerminal({ id, cwd, agent, focused }: { id: string; cwd: string; agent: string; focused: boolean }) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = slot.current; return el ? lend(el, id, cwd, agent, () => {}) : undefined }, [id, cwd, agent])
  useEffect(() => { if (focused) entries.get(id)?.term.focus() }, [focused, id])
  return <div className="term-slot" ref={slot} data-testid="agent-terminal" />
}

// The Terminal tab: the focused thread's shell, with a switcher when several chats are on screen
export function TerminalView({ targets, current, onPick, onSendToChat, focus }: {
  targets: TermTarget[]; current: string | null; onPick: (tabId: string) => void; onSendToChat: (tabId: string, text: string) => void; focus?: number
}) {
  const slot = useRef<HTMLDivElement>(null)
  const t = targets.find((x) => x.tabId === current) ?? targets[0]
  const [, bump] = useState(0)

  // lend this thread's terminal the slot; take it back (not dispose it) when another shows or the panel hides
  useEffect(() => {
    const el = slot.current
    if (!t || !el) return
    return lend(el, t.tabId, t.cwd, undefined, () => bump((n) => n + 1))
  }, [t?.tabId, t?.cwd])
  // Ctrl+` or the Terminal button: focus the shell
  useEffect(() => { if (t && focus) entries.get(t.tabId)?.term.focus() }, [focus])

  if (!t) return <div className="pane-empty">Open a thread to get its terminal.</div>
  const send = () => { const s = terminalTextForChat(t.tabId); if (s) onSendToChat(t.tabId, s) }
  return (
    <div className="termview" data-testid="terminal">
      <div className="term-bar">
        {targets.length > 1 && targets.map((x, i) => (
          <button key={x.tabId} className={x.tabId === t.tabId ? 'term-pick on' : 'term-pick'} onClick={() => onPick(x.tabId)} title={x.title} data-testid={`terminal-pick-${i + 1}`}>
            {`Chat ${i + 1}`}<span className="term-pick-t">{x.title}</span>
          </button>
        ))}
        <span className="term-cwd" title={entries.get(t.tabId)?.cwd ?? t.cwd}>{targets.length <= 1 && <b>{t.title}</b>} {entries.get(t.tabId)?.cwd ?? t.cwd}</span>
        <button onClick={send} title="Put the selection, or else the last 200 lines, in the message box" data-testid="terminal-send"><Icon name="reply" />Send to chat</button>
        <button onClick={() => entries.get(t.tabId)?.term.clear()} title="Clear the scrollback" data-testid="terminal-clear"><Icon name="clear-all" />Clear</button>
      </div>
      <div className="term-slot" ref={slot} />
    </div>
  )
}
