// The bottom panel, the way a code editor has it: Terminal and Environment logs as tabs at the left, the actions (new
// terminal, kill, close) at the right, and the list of terminals down the right side when there is more than one.
// Terminals are your own shells, started in the workspace folder and not tied to a thread; the threads on screen also
// each have theirs, listed after them. Closed by default; Ctrl+` opens it. A terminal keeps running while the panel is
// closed. The top edge drags to resize.
import { useEffect, useRef, useState } from 'react'
import { drawer, notice, place } from './actions'
import { setLayout } from './appearance'
import { createStore, panes as panesStore, useSessionMetas, useStore } from './store'
import { focusedTab } from './panes'
import { getPref, setPref } from './prefs'
import { TerminalView, disposeTerminal, type TermTarget } from './TerminalView'
import { insertIntoComposer } from './SessionView'
import { useDev } from './useDev'

// your own terminals, for as long as the app runs
const own = createStore<TermTarget[]>([])
let made = 0
export function newTerminal(): string {
  const p = place.get()
  const id = `own-term-${++made}`
  own.set((l) => [...l, { tabId: id, title: `Terminal ${made}`, cwd: p.workspace || p.folder || '' }])
  drawer.set((x) => ({ ...x, tab: 'terminal', termTab: id, focusN: x.focusN + 1 }))
  return id
}
function killTerminal(id: string) {
  disposeTerminal(id)
  own.set((l) => l.filter((t) => t.tabId !== id))
}

function StackLogs({ name, pick }: { name: string | null; pick: (n: string) => void }) {
  const dev = useDev()
  const services = dev.state?.services ?? []
  const shown = name ?? services[0]?.name ?? null
  const [text, setText] = useState('')
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!shown) return
    let alive = true
    const load = () => void window.api.devLogs(shown).then((t) => { if (alive) setText(t) }).catch((e) => { if (alive) setText(String(e?.message ?? e)) })
    load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [shown])
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [text])
  if (!services.length) return <div className="empty-line" style={{ padding: '10px 14px' }}>No environment is running. Start one from Environments.</div>
  return (
    <div className="panel-split">
      <pre ref={box} className="log" style={{ flex: 1, margin: 0, border: 0 }} data-testid="stack-log">{text || 'No output yet.'}</pre>
      <div className="panel-list">
        {services.map((s) => (
          <button key={s.name} className={`panel-item${s.name === shown ? ' on' : ''}`} onClick={() => pick(s.name)} data-testid={`stack-log-${s.name}`}>
            <i className="codicon codicon-server-process" aria-hidden /><span>{s.name}</span><em>{s.state}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

const MIN_H = 120, DEFAULT_H = 300

export function Drawer() {
  const d = useStore(drawer, (x) => x)
  const mine = useStore(own, (x) => x)
  const metas = useSessionMetas()
  const shown = useStore(panesStore, (p) => p.panes.map((x) => x.active ?? '').join(' '))
  const focus = useStore(panesStore, focusedTab)
  const threads: TermTarget[] = shown.split(' ').map((id) => metas.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && !s.tool && !s.file && !s.agent)
    .map((s) => ({ tabId: s.id, title: s.title, cwd: s.worktrees?.at(-1)?.path ?? s.cwd ?? '' }))
  const targets = [...mine, ...threads]
  const current = targets.find((t) => t.tabId === d.termTab) ?? mine.at(-1) ?? targets[0] ?? null
  // the Terminal tab with nothing to show starts a terminal of your own
  useEffect(() => { if (d.tab === 'terminal' && !targets.length) newTerminal() }, [d.tab, targets.length])

  const [height, setHeight] = useState(() => Math.max(MIN_H, getPref<number>('drawer.height', DEFAULT_H)))
  const drag = useRef<{ y: number; h: number } | null>(null)
  useEffect(() => {
    const max = () => Math.max(MIN_H, window.innerHeight - 160)
    const move = (e: MouseEvent) => { if (drag.current) setHeight(Math.max(MIN_H, Math.min(max(), drag.current.h + drag.current.y - e.clientY))) }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.classList.remove('panel-drag'); setHeight((h) => { setPref('drawer.height', h); return h }) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  const isMine = !!current && mine.some((t) => t.tabId === current.tabId)
  const pick = (id: string) => drawer.set((x) => ({ ...x, termTab: id, focusN: x.focusN + 1 }))
  // "Send to chat" from your own terminal goes to the focused thread's message box
  const sendTo = (id: string, text: string) => {
    const to = threads.some((t) => t.tabId === id) ? id : threads.find((t) => t.tabId === focus)?.tabId ?? threads[0]?.tabId
    if (!to) { notice('Open a thread first: the terminal output goes into its message box'); return }
    insertIntoComposer(to, text); notice('Terminal output is in the message box')
  }
  return (
    <section className="drawer panel" style={{ height }} data-testid="drawer" aria-label="Panel">
      <div className="panel-grip" onMouseDown={(e) => { drag.current = { y: e.clientY, h: height }; document.body.classList.add('panel-drag'); e.preventDefault() }} onDoubleClick={() => { setHeight(DEFAULT_H); setPref('drawer.height', DEFAULT_H) }} title="Drag to resize. Double-click for the usual height" />
      <div className="panel-head" role="tablist">
        <button role="tab" aria-selected={d.tab === 'terminal'} className={`panel-tab${d.tab === 'terminal' ? ' on' : ''}`} onClick={() => drawer.set((x) => ({ ...x, tab: 'terminal' }))} data-testid="drawer-terminal">Terminal</button>
        <button role="tab" aria-selected={d.tab === 'stacks'} className={`panel-tab${d.tab === 'stacks' ? ' on' : ''}`} onClick={() => drawer.set((x) => ({ ...x, tab: 'stacks' }))} data-testid="drawer-stacks">Environment logs</button>
        <span className="sp" />
        {d.tab === 'terminal' && <>
          <button className="panel-act" onClick={() => newTerminal()} title="New terminal" aria-label="New terminal" data-testid="terminal-new"><i className="codicon codicon-add" aria-hidden /></button>
          <button className="panel-act" onClick={() => current && killTerminal(current.tabId)} disabled={!isMine} title={isMine ? 'Kill this terminal' : "A thread's terminal closes with its thread"} aria-label="Kill terminal" data-testid="terminal-kill"><i className="codicon codicon-trash" aria-hidden /></button>
        </>}
        <button className="panel-act" onClick={() => setLayout({ drawer: false })} title="Close the panel (Ctrl+`)" aria-label="Close the panel" data-testid="drawer-close"><i className="codicon codicon-close" aria-hidden /></button>
      </div>
      <div className="drawer-body">
        {d.tab === 'terminal' ? (
          <div className="panel-split">
            <TerminalView targets={current ? [current] : []} current={current?.tabId ?? null} onPick={pick} focus={d.focusN} onSendToChat={sendTo} />
            {targets.length > 1 && (
              <div className="panel-list" data-testid="terminal-list">
                {targets.map((t) => {
                  const ownOne = mine.some((m) => m.tabId === t.tabId)
                  return (
                    <div key={t.tabId} className={`panel-item${t.tabId === current?.tabId ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => pick(t.tabId)} onKeyDown={(e) => { if (e.key === 'Enter') pick(t.tabId) }} title={`${t.title}\n${t.cwd}`} data-testid="terminal-item">
                      <i className={`codicon codicon-${ownOne ? 'terminal' : 'comment-discussion'}`} aria-hidden /><span>{t.title}</span>
                      {ownOne && <button className="panel-kill" onClick={(e) => { e.stopPropagation(); killTerminal(t.tabId) }} title="Kill this terminal" aria-label={`Kill ${t.title}`}><i className="codicon codicon-trash" aria-hidden /></button>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : <StackLogs name={d.stack} pick={(n) => drawer.set((x) => ({ ...x, stack: n }))} />}
      </div>
    </section>
  )
}
