// The window: title bar, rail, tab row and panes, inspector, drawer, status line, and the overlays. Each region
// reads its own slice of the stores (store.ts), so this component re-renders only when the layout, the open pages
// or the deploy / scripts rows change, never for a streaming reply.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TitleBar, type Command, type PaletteSources } from './TitleBar'
import { ActivityBar, FullSections, SideBar, Welcome, isFull, showSide, sideView } from './Workbench'
import { Panes, TabRow } from './PaneArea'
import { Inspector } from './Inspector'
import { StatusLine, runPull } from './StatusLine'
import { Drawer } from './Drawer'
import { Preview } from './Preview'
import { DropPrompt } from './DropPrompt'
import { FileEditor } from './EditorView'
import { ThreadPane } from './ThreadPane'
import { useDeploy } from './useDeploy'
import { useScripts } from './useScripts'
import { CODE_FONTS, UI_FONTS, cycleTheme, getAppearance, getThemes, setFonts, setLayout, setTheme, toggleLayout, useAppearance } from './appearance'
import { DROP_TYPES, dropMessage, dropTitle, pickDropFile, type DropChoice } from '../../shared/dropCore'
import {
  activate, activeId, closeSession, dismissNotice, focusPaneAt, live as liveStore, moveToBackground, newBeside, newSession, nextNeedsMe, notice, notices,
  openFileTab, openPage, place, preview, reopenClosed, runUndo, sendFailed, setExtraRows, setPreview, stepTab, stopEverything, tabAt, toggleTerminal,
} from './actions'
import { PAGE_LABEL, PAGE_KEYS, type ToolTab } from './chat'
import { panes as panesStore, setSessions, useSessionMetas, useStore } from './store'
import { focusedTab, activate as activateIn } from './panes'
import { RunningPage } from './pages/RunningPage'
import { QuarryPage, useQuarry } from './pages/QuarryPage'
import { ScheduledPage } from './pages/ScheduledPage'
import { DeploysPage } from './pages/DeploysPage'
import { StatusPage } from './pages/StatusPage'
import { WatchersPage } from './pages/WatchersPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { SettingsPage, pickSettingsSection } from './pages/SettingsPage'
import { DiffPage } from './pages/DiffPage'
import { insertIntoComposer } from './SessionView'
import { accountsList, accountUse, engineCommands } from './api/next'
import { Boundary, Btn } from './kit'
import { NEXT } from '../../shared/edition'

// slash commands that print a screen in the terminal open a real view here instead
const SLASH_VIEW: Record<string, ToolTab | 'accounts' | 'settings-claude'> = {
  status: 'status', usage: 'status', cost: 'status', context: 'status', mcp: 'status', login: 'accounts',
  hooks: 'settings-claude', permissions: 'settings-claude', memory: 'settings-claude', config: 'settings', settings: 'settings',
}

export function Shell() {
  const { layout } = useAppearance()
  const metas = useSessionMetas()
  const focus = useStore(panesStore, focusedTab)
  const focused = metas.find((s) => s.id === focus)
  const onScreen = useStore(panesStore, (p) => p.panes.map((x) => x.active ?? '').filter(Boolean).join(' ')).split(' ').filter(Boolean)
  const [paletteN, setPaletteN] = useState(0)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const deploy = useDeploy()
  const scripts = useScripts((p) => setPreview(p))
  const live = useStore(liveStore, (l) => l)
  const pv = useStore(preview, (p) => p)
  const toasts = useStore(notices, (n) => n)
  const quarry = useQuarry() // Quarry's page only when it is installed and usable

  // the deploy wizard's and the scripts' rows join the threads in Needs you / Working
  useEffect(() => { setExtraRows([...(deploy.liveRow ? [deploy.liveRow] : []), ...scripts.liveRows]) }, [deploy.liveRow, scripts.liveRows])

  // ---- the command field's sources ----
  const commands: Command[] = useMemo(() => [
    ...[...live.waiting, ...live.working].map((r): Command => ({ id: `live:${r.id}`, group: 'Threads', label: r.title, hint: r.state === 'working' ? 'working' : 'needs you', run: () => activate(r.id) })),
    ...metas.filter((s) => !s.tool && !s.file && ![...live.waiting, ...live.working].some((r) => r.id === s.id)).map((s): Command => ({ id: `open:${s.sessionId ?? s.id}`, group: 'Threads', label: s.title, hint: 'open', run: () => activate(s.id) })),
    ...(['running', 'scheduled', 'deploys', 'status', 'watchers', 'workspace', 'settings', ...(quarry?.available ? ['quarry'] : [])] as ToolTab[]).map((v): Command => ({ id: `view:${v}`, group: 'Views', label: PAGE_LABEL[v], hint: PAGE_KEYS[v]?.replace(/ /g, '+'), run: () => openPage(v) })),
    { id: 'new', group: 'Actions', label: 'New thread', hint: 'Ctrl+N', run: () => newSession() },
    { id: 'new-beside', group: 'Actions', label: 'New thread beside', hint: 'Ctrl+\\', run: () => newBeside() },
    { id: 'next-needs', group: 'Actions', label: 'Next thread that needs me', hint: 'Ctrl+.', run: () => nextNeedsMe() },
    { id: 'reopen', group: 'Actions', label: 'Reopen the last closed thread', hint: 'Ctrl+Shift+T', run: () => reopenClosed() },
    { id: 'stop-all', group: 'Actions', label: 'Stop everything', hint: 'Ctrl+Alt+Esc', run: () => void stopEverything() },
    { id: 'pull', group: 'Actions', label: 'Pull latest', run: () => void runPull() },
    { id: 'focus', group: 'Actions', label: getAppearance().layout.focus ? 'Leave Focus mode' : 'Focus mode', hint: 'Ctrl+Shift+F', run: () => toggleLayout('focus') },
    { id: 'rail', group: 'Actions', label: 'Show or hide the rail', hint: 'Ctrl+[', run: () => toggleLayout('rail') },
    { id: 'inspector', group: 'Actions', label: 'Show or hide the inspector', hint: 'Ctrl+]', run: () => toggleLayout('inspector') },
    { id: 'terminal', group: 'Actions', label: 'Terminal', hint: 'Ctrl+`', run: () => toggleTerminal() },
    { id: 'rail-right', group: 'Actions', label: getAppearance().layout.railRight ? 'Rail on the left' : 'Rail on the right', run: () => toggleLayout('railRight') },
    ...getThemes().map((t): Command => ({ id: `theme:${t.id}`, group: 'Actions', label: `Theme: ${t.label}`, hint: t.description, run: () => setTheme(t.id) })),
    { id: 'theme-next', group: 'Actions', label: 'Next theme', hint: 'Ctrl+Alt+T', run: () => { cycleTheme(1) } },
    ...UI_FONTS.map((f): Command => ({ id: `font:${f.id}`, group: 'Actions', label: `UI font: ${f.label}`, run: () => setFonts({ ui: f.id }) })),
    ...CODE_FONTS.map((f): Command => ({ id: `code-font:${f.id}`, group: 'Actions', label: `Code font: ${f.label}`, run: () => setFonts({ code: f.id }) })),
    ...(focus && focused && !focused.tool && !focused.file ? [
      { id: 'bg', group: 'Actions' as const, label: 'Move this thread to the background', run: () => moveToBackground(focus) },
      { id: 'close', group: 'Actions' as const, label: 'Close this tab', hint: 'Ctrl+W', run: () => closeSession(focus) },
      { id: 'export', group: 'Actions' as const, label: 'Export this thread as Markdown', run: () => window.dispatchEvent(new CustomEvent('hive:export', { detail: focus })) },
    ] : []),
    { id: 'update', group: 'Actions', label: 'Check for Hive updates', run: () => void window.api.updateCheck().then(() => window.api.updateState()).then((u) => notice(u ? `Hive ${u.version} is ${u.kind === 'ready' ? 'downloaded: restart from the status line' : 'available'}` : 'No newer Hive release')).catch(() => {}) },
  ], [live, metas, focus, focused, quarry?.available])
  const src: PaletteSources = useMemo(() => ({
    commands,
    files: async (q) => {
      const folder = place.get().folder
      if (!folder) return []
      const sep = folder.includes('\\') ? '\\' : '/'
      return (await window.api.searchFiles(folder, q)).map((rel): Command => {
        const i = rel.lastIndexOf('/')
        return { id: `file:${rel}`, group: 'Files', label: rel.slice(i + 1), hint: i < 0 ? '' : rel.slice(0, i), run: () => openFileTab(folder.replace(/[\\/]$/, '') + sep + rel.split('/').join(sep)) }
      })
    },
    engine: async () => { const r = await engineCommands(activeId() ?? undefined); return r.ok ? [...r.data, { name: 'btw', description: 'Ask a quick side question; the answer stays out of the conversation', argumentHint: '<question>', builtin: true }] : [] },
    runSlash: (c) => {
      const v = SLASH_VIEW[c.name]
      if (v === 'accounts') return setAccountsOpen(true)
      if (v === 'settings-claude') { pickSettingsSection('claude'); return openPage('settings') }
      if (v) return openPage(v as ToolTab)
      // anything else goes into the focused thread's message box, ready to send (a new thread when none)
      const id = focused && !focused.tool && !focused.file ? focused.id : newSession()
      insertIntoComposer(id, `/${c.name} `)
    },
  }), [commands, focused])

  // a new build is on disk but a thread is working, so the page was not reloaded by itself
  useEffect(() => {
    const say = () => notice('A new build is ready. Ctrl+R loads it; threads that are working stop.')
    window.addEventListener('hive:build', say)
    return () => window.removeEventListener('hive:build', say)
  }, [])

  // ---- keyboard ----
  useEffect(() => {
    const inTermOrEditor = () => !!(document.activeElement as HTMLElement | null)?.closest('.xterm, .monaco-editor')
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const ctrl = e.ctrlKey && !e.metaKey
      if (ctrl && e.altKey && e.key === 'Escape') { e.preventDefault(); void stopEverything(); return }
      // while the app is being rebuilt: F5, or Ctrl+R outside a terminal (where it searches the shell's history), loads the newest build
      if (NEXT && (e.key === 'F5' || (ctrl && !e.shiftKey && !e.altKey && k === 'r' && !(document.activeElement as HTMLElement | null)?.closest('.xterm')))) { e.preventDefault(); location.reload(); return }
      // Ctrl+Alt+T: the next theme (Shift: the one before), at once and kept
      if (ctrl && e.altKey && e.code === 'KeyT') { e.preventDefault(); notice(`Theme: ${cycleTheme(e.shiftKey ? -1 : 1).label}`); return }
      if (ctrl && e.altKey && /^[1-9]$/.test(k)) {
        e.preventDefault()
        void accountsList().then(async (r) => {
          if (!r.ok) { notice(r.reason); return }
          const a = r.data[Number(k) - 1]
          if (!a) return
          const done = await accountUse(a.id)
          notice(done.ok ? `New threads use ${a.label}` : done.reason)
        })
        return
      }
      if (e.altKey && !e.ctrlKey && /^[1-4]$/.test(k)) { e.preventDefault(); focusPaneAt(Number(k) - 1); return }
      if (!ctrl) return
      if (!e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); setPaletteN((n) => n + 1) }
      else if (!e.shiftKey && e.key === '.') { e.preventDefault(); nextNeedsMe() }
      else if (!e.shiftKey && e.key === '[') { e.preventDefault(); toggleLayout('rail') }
      else if (!e.shiftKey && e.key === ']') { e.preventDefault(); toggleLayout('inspector') }
      else if (!e.shiftKey && !e.altKey && e.code === 'Backquote') { e.preventDefault(); toggleTerminal() }
      else if (!e.shiftKey && e.key === ',') { e.preventDefault(); openPage('settings') }
      else if (!e.shiftKey && e.key === '\\') { e.preventDefault(); newBeside() }
      else if (!e.altKey && e.key === 'Tab') { e.preventDefault(); stepTab(e.shiftKey ? -1 : 1) }
      else if (e.shiftKey && !e.altKey && k === 't') { e.preventDefault(); reopenClosed() }
      else if (e.shiftKey && !e.altKey && k === 'f') { e.preventDefault(); toggleLayout('focus') }
      else if (e.shiftKey && !e.altKey && k === 'r') { e.preventDefault(); openPage('running') }
      else if (e.shiftKey && !e.altKey && k === 's') { e.preventDefault(); openPage('scheduled') }
      else if (e.shiftKey && !e.altKey && k === 'd') { e.preventDefault(); openPage('deploys') }
      else if (e.shiftKey && !e.altKey && k === 'u') { e.preventDefault(); openPage('status') }
      else if (!e.shiftKey && !e.altKey && k === 'z' && !(e.target as HTMLElement | null)?.closest('input, textarea, .monaco-editor, .xterm')) { if (runUndo()) e.preventDefault() }
      else if (!e.shiftKey && !e.altKey && !inTermOrEditor() && (k === 'n' || k === 'w' || /^[1-9]$/.test(k))) {
        e.preventDefault()
        if (k === 'n') newSession()
        else if (k === 'w') { const id = activeId(); if (id) closeSession(id) }
        else tabAt(Number(k) - 1)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // ---- a file dropped outside a message box: start a skill on it (HIVE_DROP_SKILLS) ----
  const [dropChoices, setDropChoices] = useState<DropChoice[]>([])
  const [dropped, setDropped] = useState<string | null>(null)
  useEffect(() => { void window.api.dropChoices().then(setDropChoices).catch(() => {}) }, [])
  const onWindowDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => { try { return window.api.pathForFile(f) } catch { return '' } }).filter(Boolean)
    if (!paths.length) return
    if (!dropChoices.length) return notice('Set HIVE_DROP_SKILLS in your config to start a skill on a dropped file')
    const file = pickDropFile(paths)
    if (file) setDropped(file); else notice(`Drop a ${DROP_TYPES.join(', ')} file to start work on it`)
  }
  const startFromFile = (c: DropChoice, path: string) => {
    setDropped(null)
    const id = `new-${Date.now()}`
    const title = dropTitle(c, path)
    const text = dropMessage(c, path)
    const cwd = place.get().workspace || place.get().folder
    setSessions((all) => [...all, { id, title, cwd, items: [{ kind: 'user', text, images: [] }], streaming: '', busy: true, loaded: true, background: true, mode: 'auto' }])
    window.api.chatSend(id, cwd, undefined, { title, text, images: [], background: true }).catch(sendFailed(id, undefined, false))
  }

  // ---- what a pane shows ----
  const render = (tab: string, isFocused: boolean): ReactNode => {
    const s = metas.find((x) => x.id === tab)
    if (!s) return null
    if (s.file) return <FileEditor key={s.id} path={s.file} onClosed={() => closeSession(s.id)} />
    if (s.tool) return <Boundary key={s.id} name={PAGE_LABEL[s.tool]}><PageFor page={s.tool} deploy={deploy} onAccounts={() => setAccountsOpen(true)} /></Boundary>
    return <Boundary key={s.id} name="This thread"><ThreadPane id={s.id} focused={isFocused} /></Boundary>
  }
  const empty = <Welcome onPalette={() => setPaletteN((n) => n + 1)} />
  const currentPage = focused?.tool ?? null
  // a whole-page section (Codex, Environments, Allow IP, Deploy, Notes, To do, Quarry) takes the window: no side bar,
  // tabs or inspector beside it. A tab that opens or takes the focus meanwhile (a thread from a notification, a diff,
  // a file) brings the tab area back, under Threads.
  const section = useStore(sideView, (v) => v)
  const full = isFull(section) && !layout.focus
  const lastFocus = useRef(focus)
  useEffect(() => {
    if (focus && focus !== lastFocus.current && isFull(sideView.get())) showSide('threads')
    lastFocus.current = focus
  }, [focus])
  const showRail = layout.rail && !layout.focus
  // pages take the whole centre; threads, files and a diff keep the inspector. It follows what is on screen, not which
  // pane has the focus, so clicking from one pane into another never moves the layout under the pointer
  const showInsp = layout.inspector && !layout.focus && (onScreen.length === 0 || onScreen.some((id) => { const m = metas.find((x) => x.id === id); return !m?.tool || m.tool === 'diff' }))

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={onWindowDrop}>
      <TitleBar src={src} paletteN={paletteN} accountsOpen={accountsOpen} setAccountsOpen={setAccountsOpen} />
      <div className={`body${layout.railRight ? ' rail-right' : ''}`}>
        {!layout.focus && <ActivityBar onAccounts={() => setAccountsOpen(true)} />}
        {showRail && !full && <SideBar currentPage={currentPage} />}
        <FullSections deploy={deploy} />
        <div className="centre" style={full ? { display: 'none' } : undefined}>
          <TabRow />
          <Panes render={render} empty={empty} />
        </div>
        {showInsp && !full && <Inspector />}
      </div>
      {layout.drawer && <Drawer />}
      <StatusLine />
      {pv && (
        <div className="pv-full" data-testid="preview-full">
          <Preview path={pv} onClose={() => preview.set(null)} onSide={() => preview.set(null)} onEdit={(p) => { preview.set(null); openFileTab(p) }} />
        </div>
      )}
      {dropped && <DropPrompt path={dropped} choices={dropChoices} onPick={(c) => startFromFile(c, dropped)} onCancel={() => setDropped(null)} />}
      {toasts.length > 0 && (
        <div className="toasts" role="status">
          {toasts.map((n) => (
            <div key={n.id} className="toast"><span>{n.text}</span><Btn kind="link" onClick={() => dismissNotice(n.id)} testid="notice-dismiss">Dismiss</Btn></div>
          ))}
        </div>
      )}
    </div>
  )
}

function PageFor({ page, deploy, onAccounts }: { page: ToolTab; deploy: ReturnType<typeof useDeploy>; onAccounts: () => void }) {
  switch (page) {
    case 'running': return <RunningPage />
    case 'scheduled': return <ScheduledPage />
    case 'deploys': return <DeploysPage deploy={deploy} />
    case 'status': return <StatusPage />
    case 'watchers': return <WatchersPage />
    case 'workspace': return <WorkspacePage />
    case 'settings': return <SettingsPage onAccounts={onAccounts} />
    case 'diff': return <DiffPage />
    case 'quarry': return <QuarryPage />
  }
}

// a background thread opened from elsewhere (phone, notification) lands in a pane
export function showThread(id: string) {
  setSessions((all) => all.map((s) => (s.id === id ? { ...s, background: false } : s)))
  panesStore.set((p) => activateIn(p, id))
}
export { setLayout }
