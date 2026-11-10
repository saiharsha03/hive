// The bottom drawer: the terminal of each thread on screen, and the dev stacks' logs. Closed by default; Ctrl+`
// opens the terminal. The terminal keeps its process when the drawer closes.
import { useEffect, useRef, useState } from 'react'
import { drawer, notice } from './actions'
import { setLayout } from './appearance'
import { panes as panesStore, useSessionMetas, useStore } from './store'
import { focusedTab } from './panes'
import { TerminalView } from './TerminalView'
import { insertIntoComposer } from './SessionView'
import { useDev } from './useDev'
import { Btn } from './kit'

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
  if (!services.length) return <div className="empty-line" style={{ padding: '10px 14px' }}>No stack services. Start a stack from Workspace, Stacks.</div>
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 200, borderRight: '1px solid var(--rule)', overflowY: 'auto' }}>
        {services.map((s) => (
          <button key={s.name} className={`rail-view${s.name === shown ? ' on' : ''}`} onClick={() => pick(s.name)} data-testid={`stack-log-${s.name}`}>
            <span>{s.name}</span><b>{s.state}</b>
          </button>
        ))}
      </div>
      <pre ref={box} className="log" style={{ flex: 1, margin: 0, border: 0 }} data-testid="stack-log">{text || 'No output yet.'}</pre>
    </div>
  )
}

export function Drawer() {
  const d = useStore(drawer, (x) => x)
  const metas = useSessionMetas()
  const shown = useStore(panesStore, (p) => p.panes.map((x) => x.active ?? '').join(' '))
  const focus = useStore(panesStore, focusedTab)
  const targets = shown.split(' ').map((id) => metas.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && !s.tool && !s.file)
    .map((s) => ({ tabId: s.id, title: s.title, cwd: s.worktrees?.at(-1)?.path ?? s.cwd ?? '' }))
  const current = targets.some((t) => t.tabId === d.termTab) ? d.termTab : (targets.find((t) => t.tabId === focus)?.tabId ?? targets[0]?.tabId ?? null)
  return (
    <section className="drawer" data-testid="drawer" aria-label="Drawer">
      <div className="drawer-tabs" role="tablist">
        <button role="tab" aria-selected={d.tab === 'terminal'} className={`itab${d.tab === 'terminal' ? ' on' : ''}`} onClick={() => drawer.set((x) => ({ ...x, tab: 'terminal' }))} data-testid="drawer-terminal">Terminal</button>
        <button role="tab" aria-selected={d.tab === 'stacks'} className={`itab${d.tab === 'stacks' ? ' on' : ''}`} onClick={() => drawer.set((x) => ({ ...x, tab: 'stacks' }))} data-testid="drawer-stacks">Stack logs</button>
        <span className="sp" />
        <Btn kind="link" onClick={() => setLayout({ drawer: false })} testid="drawer-close" title="Close (Ctrl+`)">Close</Btn>
      </div>
      <div className="drawer-body">
        {d.tab === 'terminal'
          ? <TerminalView targets={targets} current={current} onPick={(id) => drawer.set((x) => ({ ...x, termTab: id }))} focus={d.focusN}
            onSendToChat={(id, text) => { insertIntoComposer(id, text); notice('Terminal output is in the message box') }} />
          : <StackLogs name={d.stack} pick={(n) => drawer.set((x) => ({ ...x, stack: n }))} />}
      </div>
    </section>
  )
}
