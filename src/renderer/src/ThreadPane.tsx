// One thread in a pane: its conversation, wired to the actions, with the handoff offer line. It subscribes to its own
// thread only.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SessionView, type PanelTab, type ThreadCallbacks } from './SessionView'
import { loadEarlier, moveToBackground, newBeside, openPage, openTerminal, send, sendNow, setPreview, showDiff, toggleInspector, inspectorTab, drawer } from './actions'
import { handoffs, handOff, notNow } from './engine'
import { setSessions, useSession, useStore, panes } from './store'
import { isWatcherTab } from '../../shared/readOnlyCore'
import { getAppearance, setLayout, useAppearance } from './appearance'
import { Btn } from './kit'
import { runLocalCommand } from './ClaudePanels'

const OFFER_MS = 10_000
let permissionMode = ''
const modeReady = window.api.chatMode().then((m) => { permissionMode = m }).catch(() => {})

export function ThreadPane({ id, focused }: { id: string; focused: boolean }) {
  const session = useSession(id)
  const h = useStore(handoffs, (all) => all[id])
  const canSplit = useStore(panes, (p) => p.panes.length < 4)
  // which header button is pressed: the detail panel's tab while it is open
  const open = useAppearance().layout.inspector
  const tab = useStore(inspectorTab, (t) => t)
  const panel: PanelTab | null = open && (tab === 'changes' || tab === 'activity' || tab === 'rewind') ? tab : null
  const [mode, setMode] = useState(permissionMode)
  useEffect(() => { void modeReady.then(() => setMode(permissionMode)) }, [])
  const cb: ThreadCallbacks = useMemo(() => ({
    // /mcp, /agents, /permissions, /hooks, /memory, /resume, /branch, /add-dir open Orbit's own screens (ClaudePanels.tsx)
    onSend: (text, images, m) => { if (!images.length && runLocalCommand(id, text)) return; send(id, text, images, m) },
    onDequeue: (q) => window.api.chatDequeue(id, q),
    onPromote: (q) => void window.api.chatPromote(id, q),
    onSendNow: (x) => sendNow(id, x),
    onStop: () => void window.api.chatInterrupt(id),
    onBackground: (toolUseId) => void window.api.chatBackground(id, toolUseId),
    onRunInBackground: () => moveToBackground(id),
    onOpen: (p) => setPreview(p),
    onDiff: showDiff,
    onTerminal: () => { const d = drawer.get(); if (getAppearance().layout.drawer && d.tab === 'terminal' && d.termTab === id) setLayout({ drawer: false }); else openTerminal(id) },
    onPanel: toggleInspector,
    onLoadEarlier: () => loadEarlier(id),
    onStatusView: () => openPage('status'),
    onScheduled: () => openPage('scheduled'),
    onRewound: (index) => setSessions((all) => all.map((x) => (x.id === id ? { ...x, items: x.items.slice(0, index), history: undefined } : x))),
  }), [id])
  // the hand-off offer does not wait for ever: left alone for OFFER_MS it closes as "Not now" (it comes back when the
  // thread compacts or grows again, as after a click on Not now)
  const offering = !!session && !session.tool && !session.file && !isWatcherTab(session.id) && !!h?.offer && !h.pending && !session.busy
  useEffect(() => {
    if (!offering) return
    const t = setTimeout(() => notNow(id), OFFER_MS)
    return () => clearTimeout(t)
  }, [offering, id])
  if (!session) return null
  let banner: ReactNode = null
  const can = !session.tool && !session.file && !isWatcherTab(session.id)
  if (can && h?.pending) banner = <div className="hold-line" data-testid="handoff-bar">Writing the handoff; a fresh thread opens when it is done.</div>
  else if (can && h?.offer && !session.busy) {
    const compacted = (session.compactions ?? 0) > (h.dismissed?.compactions ?? 0)
    const why = h.failed ? 'The handoff was not written (the turn stopped or failed).' : compacted ? 'This thread just compacted.' : `This thread is at ${Math.round(h.total / 1000)}k tokens of context.`
    banner = (
      <div className="hold-line" data-testid="handoff-bar">
        <span>{why} {h.failed ? 'Try again?' : 'Every reply reads all of it again. Hand off to a fresh thread?'}</span>
        <Btn kind="quiet" onClick={() => void handOff(id)} testid="handoff-yes">Hand off</Btn>
        <Btn kind="link" onClick={() => notNow(id)} testid="handoff-no">Not now</Btn>
      </div>
    )
  }
  return <SessionView session={session} mode={mode} focused={focused} banner={banner} panel={panel} {...cb} onSplit={canSplit ? () => newBeside() : undefined} />
}
