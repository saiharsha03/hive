// The app: threads and their live sessions, the chat panes, and the regions the current UI arranges around them.
// A UI (appearance.ts + views.ts) only decides where regions sit; switching it keeps every chat, terminal and scroll.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileTree } from './FileTree'
import { Preview } from './Preview'
import { Sidebar, liveLook, refreshThreadList } from './Sidebar'
import { StatusBar } from './StatusBar'
import { SessionView, draftEmpty, prefillDraft, insertIntoComposer, type Attachment } from './SessionView'
import { DeployPanel } from './DeployPanel'
import { useDeploy } from './useDeploy'
import { PullPanel } from './PullPanel'
import { DevPanel } from './DevPanel'
import { GitPanel } from './GitPanel'
import { DiffPanel, type DiffSpec } from './DiffPanel'
import { useDev } from './useDev'
import { ScriptsPanel } from './ScriptsPanel'
import { useScripts } from './useScripts'
import { WatchersView, type OpenThread } from './WatchersView'
import { SettingsPanel } from './SettingsPanel'
import { TodoPanel } from './TodoPanel'
import { NotesPanel } from './NotesPanel'
import { setShowAgents } from './ThreadStatus'
import { FileEditor, fileOfTab, fileTabId, openInEditor, releaseFile, setFileOpener } from './EditorView'
import { useTodos } from './useTodos'
import { todoBadge } from '../../shared/todoCore'
import { workingOn, type Session } from './chat'
import { activateSession, findSession, liveRows, markWaiting, onSessionEvent, type LiveRow } from './background'
import { TabMenu } from './TabMenu'
import { tabsToClose, type TabCloseAction } from './tabs'
import { keepVisible, organize, setRetireHandler } from './threads'
import { DropPrompt } from './DropPrompt'
import type { AllowStatus } from '../../shared/allowCore'
import { DROP_TYPES, dropMessage, dropTitle, pickDropFile, type DropChoice } from '../../shared/dropCore'
import { HooksMenu } from './HooksMenu'
import { PluginsMenu } from './PluginsMenu'
import { McpMenu } from './McpMenu'
import { ChatArea } from './ChatArea'
import { ChangesView } from './ChangesView'
import { AgentsView } from './AgentsView'
import { TerminalView } from './TerminalView'
import { CommandPalette, type Command } from './CommandPalette'
import { TitleBar, type Menu, type MenuItem } from './TitleBar'
import { ActivityBar, BottomPanel, Dock, Fold, SideTabs, ThreadStrip, ToolList, type Badges, type ToolRow } from './regions'
import { AppearancePicker } from './AppearancePicker'
import { getThemes, getUIs, setTheme, setUI, useAppearance } from './appearance'
import { activate as activateIn, addPaneFor, emptyPanes, focusPane, focusedTab, moveTab, reconcile, splitWith, type PaneState } from './panes'
import { ARRANGE, VIEW, placeOf, type Region, type ViewId } from './views'
import { WatcherRows, WatchersPopover, useWatcherCounts } from './watchers'
import { Divider, Icon, Modal, Popover, anchorOf, useSize, type Anchor } from './ui'
import { getPref, setPref } from './prefs'
import { useAppName, useAppTagline } from './appSettings'
import { HiveMark } from './HiveMark'

type Pop = { kind: 'pull' | 'dev' | 'mcp' | 'hooks' | 'plugins' | 'threads' | 'watchers' | 'appearance' | 'live-waiting' | 'live-working'; anchor: Anchor }
type ModalKind = 'deploy' | 'settings' | null
const centre = (): Anchor => anchorOf(null)

// per-UI open regions and their tabs, kept in prefs
function usePerUI<T>(key: string, ui: string, fallback: T): [T, (v: T) => void] {
  const [all, setAll] = useState<Record<string, T>>(() => getPref<Record<string, T>>(key, {}))
  const v = ui in all ? all[ui] : fallback
  return [v, (next: T) => setAll((cur) => { const n = { ...cur, [ui]: next }; setPref(key, n); return n })]
}

export function App() {
  const { ui } = useAppearance()
  const arr = ARRANGE[ui]
  const appName = useAppName()
  const tagline = useAppTagline()
  const [sessions, setSessions] = useState<Session[]>([])
  const [paneState, setPaneState] = useState<PaneState>(emptyPanes)
  // Files view folder: the workspace root until a session or "Open folder" picks another
  const [folder, setFolder] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [preview, setPreviewPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffSpec | null>(null)
  // a diff picked in the Git view shows under it, so staging and committing stay in reach
  const [gitDiff, setGitDiff] = useState<DiffSpec | null>(null)
  const [gitDiffH, setGitDiffH, saveGitDiffH] = useSize('git.diff', 360)
  const [gitFocus, setGitFocus] = useState<{ dir: string; n: number } | null>(null)
  const [mode, setMode] = useState('')
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // a file dropped on the window waiting for a choice of skill (HIVE_DROP_SKILLS); result notes (worktree cleanup, drops) bottom right
  const [dropped, setDropped] = useState<string | null>(null)
  const [dropChoices, setDropChoices] = useState<DropChoice[]>([])
  useEffect(() => { void window.api.dropChoices().then(setDropChoices) }, [])
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([])
  const notice = (...texts: string[]) => setNotices((n) => [...n, ...texts.map((text, i) => ({ id: Date.now() + i + Math.random(), text }))])
  const deploy = useDeploy()
  const dev = useDev()
  const todos = useTodos()
  const wc = useWatcherCounts()
  const [pop, setPop] = useState<Pop | null>(null)
  const [modal, setModal] = useState<ModalKind>(null)
  const [palette, setPalette] = useState(false)
  const [termTab, setTermTab] = useState<string | null>(null)
  const [termFocus, setTermFocus] = useState(0)

  // regions: open state, tab and size per UI
  const [leftOpen, setLeftOpen] = usePerUI('open.left', ui, !arr.closed.includes('left'))
  const [rightOpen, setRightOpen] = usePerUI('open.right', ui, !arr.closed.includes('right'))
  const [bottomOpen, setBottomOpen] = usePerUI('open.bottom', ui, !arr.closed.includes('bottom'))
  const [leftView, setLeftView] = usePerUI<ViewId>('view.left', ui, arr.left[0] ?? 'threads')
  const [rightView, setRightView] = usePerUI<ViewId>('view.right', ui, arr.right[0] ?? 'files')
  // a view saved before the panel's views were merged (Changes, Preview) falls back to the first one
  const rv: ViewId = arr.right.includes(rightView) ? rightView : arr.right[0]
  const [bottomView, setBottomView] = usePerUI<ViewId>('view.bottom', ui, arr.bottom[0] ?? 'agents')
  const [bottomMax, setBottomMax] = useState(false)
  const [leftW, setLeftW, saveLeftW] = useSize(`${ui}.left`, ui === 'workbench' ? 280 : 300)
  const [rightW, setRightW, saveRightW] = useSize(`${ui}.right`, ui === 'strip' ? 420 : ui === 'workbench' ? 440 : 520)
  const [bottomH, setBottomH, saveBottomH] = useSize(`${ui}.bottom`, 240)

  // a preview opens over the whole window (Esc or x closes it); "Side panel" docks it in the preview view instead
  const [previewFull, setPreviewFull] = useState(false)
  const setPreview = (p: string | null) => { setPreviewPath(p); setPreviewFull(!!p) }
  useEffect(() => {
    if (!previewFull) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewFull])
  const showDiff = (d: DiffSpec | null) => { setDiff(d); if (d) showView('git') }
  const scripts = useScripts((p) => setPreview(p))

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const visible = useMemo(() => sessions.filter((s) => !s.background).map((s) => s.id), [sessions])
  const panes = useMemo(() => reconcile(paneState, visible), [paneState, visible])
  useEffect(() => { if (panes !== paneState) setPaneState(panes) }, [panes])
  const activeId = focusedTab(panes)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const visibleNow = () => sessionsRef.current.filter((s) => !s.background).map((s) => s.id)

  // ---- opening views wherever this UI keeps them ----
  // a file from Files opens in the Open file view: code and text editable, images, PDFs and media shown
  // the Default UI's sides: threads on the right and the tool panel on the left (on by default)
  const [swapped, setSwappedState] = useState(() => getPref<boolean>('sidesSwapped', true))
  const setSwapped = (on: boolean) => { setSwappedState(on); setPref('sidesSwapped', on) }
  const openFile = (p: string) => openInEditor(p)
  // a file opens as a tab next to the threads, in the focused pane (one tab per file)
  useEffect(() => setFileOpener((path) => {
    const id = fileTabId(path)
    setSessions((all) => (all.some((s) => s.id === id) ? all : [...all, {
      id, file: path, title: path.split(/[\\/]/).pop() ?? path, cwd: path.replace(/[\\/][^\\/]*$/, ''), items: [], streaming: '', busy: false, loaded: true, background: false,
    }]))
    setPaneState((p) => activateIn(p, id))
  }), [])
  useEffect(() => setShowAgents(() => showView('agents')))
  function showView(v: ViewId, el?: HTMLElement | null) {
    const at = placeOf(ui, v)
    if (at === 'left') { setLeftView(v); setLeftOpen(true) }
    else if (at === 'right') { setRightView(v); setRightOpen(true) }
    else if (at === 'bottom') { setBottomView(v); setBottomOpen(true) }
    else if (v === 'threads') setPop({ kind: 'threads', anchor: anchorOf(el) })
    else if (v === 'pull' || v === 'dev') setPop({ kind: v, anchor: el ? anchorOf(el) : centre() })
  }
  // tools: Deploy and Settings are focused modals; Pull latest, Dev stack, MCP, hooks and plugins are popovers
  // Pull latest runs in the background from any layout's button: a note when it is done, a popup only when a repo failed
  const [pulling, setPulling] = useState(false)
  const [pullFail, setPullFail] = useState<{ repo: string; result: string }[] | null>(null)
  const runPull = async () => {
    if (pulling) return
    setPulling(true)
    try {
      const rows = await window.api.pullRun(false)
      const bad = (r: { result: string }) => r.result.startsWith('failed')
      if (rows.some(bad)) setPullFail([...rows.filter(bad), ...rows.filter((r) => !bad(r))])
      else {
        const n = (p: string) => rows.filter((r) => r.result.startsWith(p)).length
        const rest = rows.length - n('updated') - n('skipped')
        notice(rows.length === 1 && !n('updated') && !n('skipped') ? `Pull latest: ${rows[0].result}` : `Pull latest: ${n('updated')} updated, ${n('skipped')} skipped, ${rest} already up to date`)
      }
    } catch (e: any) {
      setPullFail([{ repo: 'Pull latest', result: `failed: ${e?.message ?? e}` }])
    } finally {
      setPulling(false)
    }
  }
  const pullButton = (
    <button className="dk" title="Pull latest: fetch every repo and fast-forward its default branch" onClick={() => void runPull()} disabled={pulling} data-testid="dock-pull">
      <span className="dk-i"><Icon name={pulling ? 'sync' : 'repo-pull'} className={pulling ? 'mk-pull spin' : 'mk-pull'} /></span>
      <span className="dk-l">{pulling ? 'Pulling…' : 'Pull latest'}</span>
    </button>
  )

  // IP allowlist (HIVE_ALLOWLIST_CMD): on when the public IP changed since the command last succeeded; a note when done,
  // a popup with the command's output when it fails
  const [allow, setAllow] = useState<AllowStatus | null>(null)
  const [allowFail, setAllowFail] = useState<string | null>(null)
  useEffect(() => { void window.api.allowStatus().then(setAllow); return window.api.onAllowStatus(setAllow) }, [])
  const allowOn = !!allow?.changed && !allow.running
  const allowTitle = !allow ? '' : allow.running ? 'Allowing your IP…'
    : !allow.ip ? `IP allowlist: ${allow.error || 'public IP not read yet'}. Click to run it anyway`
    : allow.changed ? `Your IP is now ${allow.ip} (last allowed: ${allow.lastIp ?? 'never'}). Click to allow it`
    : `Your IP ${allow.ip} is already allowed`
  const runAllow = async () => {
    if (!allowOn) return
    try {
      const r = await window.api.allowRun()
      if (r.ok) notice(r.ip ? `IP allowlist: ${r.ip} allowed` : `IP allowlist: ${r.output}`)
      else setAllowFail(r.output)
    } catch (e: any) {
      setAllowFail(String(e?.message ?? e))
    }
  }
  const allowButton = allow?.configured && (
    <button className="dk" title={allowTitle} onClick={() => void runAllow()} disabled={!allowOn} data-testid="dock-allow">
      <span className="dk-i"><Icon name={allow.running ? 'sync' : 'shield'} className={allow.running ? 'mk-other spin' : 'mk-other'} /></span>
      <span className="dk-l">{allow.running ? 'Allowing…' : 'Allow my IP'}</span>
    </button>
  )

  function openTool(id: string, el?: HTMLElement | null) {
    if (id === 'deploy') return setModal('deploy')
    if (id === 'settings') return setModal('settings')
    if (id === 'pull') return void runPull()
    if (id === 'allow') return void runAllow()
    if (id === 'mcp' || id === 'hooks' || id === 'plugins') return setPop({ kind: id, anchor: el ? anchorOf(el) : centre() })
    if (id === 'dev' && placeOf(ui, 'dev') === 'popover') return setPop({ kind: 'dev', anchor: el ? anchorOf(el) : centre() })
    if (id === 'terminal') { openTerminal(); return }
    showView(id as ViewId, el)
  }
  const openTerminal = (tab?: string) => {
    if (tab) setTermTab(tab)
    setBottomView('terminal'); setBottomOpen(true); setTermFocus((n) => n + 1)
  }

  // a chat diff's "Open in Git panel": that repo in the Git view, and the file's uncommitted diff in Changes
  const openInGit = async (file: string) => {
    try {
      const at = await window.api.gitLocate(file)
      if (!at) { notice(`${file} is not in a repo the Git view lists`); return }
      showView('git')
      setGitFocus({ dir: at.dir, n: Date.now() })
      const d = await window.api.gitDetail(at.dir)
      const area = d.unstaged.some((e) => e.path === at.path) ? 'unstaged' : d.staged.some((e) => e.path === at.path) ? 'staged' : d.untracked.some((e) => e.path === at.path) ? 'untracked' : null
      if (!area) { notice(`${at.path} has no uncommitted changes in ${at.name}`); return }
      setGitDiff({ t: 'file', dir: at.dir, repo: at.name, path: at.path, area, orig: d.staged.find((e) => e.path === at.path)?.orig })
    } catch (e: any) {
      notice(`Git: ${e?.message ?? e}`)
    }
  }

  useEffect(() => {
    window.api.chatMode().then(setMode)
    // new threads and the Files view start in the workspace root; the home folder only if there is none
    window.api.workspaceRoot().then(async (root) => {
      const start = root || (await window.api.homeDir())
      setWorkspace(start)
      setFolder((f) => f || start)
    })
    // a reload starts with no tabs, so stop any session still running from before it
    void window.api.chatReset()
  }, [])

  // every live session's events land here (backgrounded ones too); Claude's "show" opens the preview
  useEffect(() => window.api.onChatEvent((tabId, ev) => {
    const cur = sessionsRef.current.find((s) => s.id === tabId)
    if (ev.type === 'hive_show' && ev.path && !cur?.background) setPreview(ev.path)
    if (ev.type === 'hive_title' && ev.title) {
      setSessions((all) => all.map((s) => (s.id === tabId ? { ...s, title: ev.title } : s)))
      refreshThreadList()
      return
    }
    if (ev.type === 'result') refreshThreadList() // a new thread is saved after its first turn
    if (ev.type === 'hive_organize') {
      if (ev.action === 'waiting') {
        setSessions((all) => all.map((s) => (s.id === tabId ? markWaiting(s, ev.reason, Date.now(), activeIdRef.current === s.id && !s.background) : s)))
        return
      }
      if (ev.action === 'resolved') {
        setSessions((all) => all.map((s) => (s.id === tabId ? { ...s, waitingReason: undefined, waitingSince: undefined } : s)))
        return
      }
      if (cur?.sessionId) organize(cur.sessionId, ev.action, ev.until)
      return
    }
    setSessions((all) => all.map((s) => (s.id === tabId ? onSessionEvent(s, ev, activeIdRef.current, Date.now()) : s)))
  }), [ui])
  // a thread the app started by itself (a watcher's thread) or another thread started or resumed (from):
  // a background tab that is already working; a tab still open for it gets the message
  useEffect(() => window.api.onThread((t) => {
    const first: Item = t.from ? { kind: 'thread', fromId: t.from.id, fromTitle: t.from.title, text: t.prompt } : { kind: 'user', text: t.prompt, images: [] }
    setSessions((all) => (all.some((s) => s.id === t.tabId) ? all.map((s) => (s.id === t.tabId ? { ...s, busy: true, items: [...s.items, first] } : s)) : [...all, {
      id: t.tabId, title: t.title, cwd: t.cwd, sessionId: t.sessionId, path: t.path, items: [first], streaming: '', busy: true, loaded: !t.path, background: true,
    }]))
    if (t.path) window.api.loadRecentHistory(t.path).then(({ items, more }) =>
      setSessions((all) => all.map((s) => (s.id === t.tabId && !s.loaded ? { ...s, items: [...items, ...s.items], loaded: true, history: { count: items.length, more } } : s))))
  }), [])
  const active = sessions.find((s) => s.id === activeId)

  // a thread closed or archived: the worktrees it made are deleted and the result noted
  useEffect(() => {
    setRetireHandler((thread) => {
      window.api.worktreeCleanup(thread).then((notes) => {
        if (!notes.length) return
        notice(...notes)
        void window.api.worktreeLinks(thread).then((left) => setSessions((all) => all.map((s) => (s.sessionId === thread || s.id === thread
          ? { ...s, worktrees: left.map(({ repo, path, branch }) => ({ repo, path, branch })) } : s))))
      }).catch((e) => notice(`Worktree cleanup failed: ${e?.message ?? e}`))
    })
    return () => setRetireHandler(null)
  }, [])

  // background tabs run in auto mode: tell main whenever a session moves between the panes and the background
  const sentBackground = useRef(new Map<string, boolean>())
  useEffect(() => {
    const seen = sentBackground.current
    for (const id of [...seen.keys()]) if (!sessions.some((s) => s.id === id)) seen.delete(id)
    for (const s of sessions) {
      if (seen.get(s.id) === s.background) continue
      seen.set(s.id, s.background)
      void window.api.chatSetBackground(s.id, s.background)
    }
  }, [sessions])

  // the working folder follows the focused session's repo
  useEffect(() => { if (active?.cwd) setFolder(active.cwd) }, [active?.cwd])
  // the terminal follows the focused thread
  useEffect(() => { if (activeId) setTermTab(activeId) }, [activeId])

  const makeSession = (title?: string): Session => ({
    id: `new-${Date.now()}`, title: title ?? `New thread ${sessionsRef.current.filter((s) => s.id.startsWith('new-')).length + 1}`, cwd: workspace || folder,
    items: [], streaming: '', busy: false, loaded: true, background: false,
  })
  const newSession = () => {
    const s = makeSession()
    setSessions((all) => [...all, s])
    setPaneState((p) => activateIn(p, s.id))
  }
  // a new thread in a new pane beside `beside` (up to four)
  const newBeside = (beside: string) => {
    const s = makeSession()
    setSessions((all) => [...all, s])
    setPaneState((p) => addPaneFor(p, s.id, beside) ?? activateIn(p, s.id))
  }

  // show a session (bringing a backgrounded one back) and clear its waiting
  const activate = (id: string) => {
    if (id === 'deploy') { setModal('deploy'); return }
    if (id.startsWith('dev:')) { openTool('dev'); return }
    if (id.startsWith('script:')) { showView('scripts'); return }
    setSessions((all) => activateSession(all, id))
    setPaneState((p) => activateIn(p, id))
  }
  // a tab that becomes focused by any route is no longer waiting
  useEffect(() => {
    if (activeId) setSessions((all) => (all.some((s) => s.id === activeId && (s.waitingSince || s.background)) ? activateSession(all, activeId) : all))
  }, [activeId])

  // reopen a past session as a tab, with its conversation; the next message resumes it. One already live is reused.
  const replaceUntouched = () => {
    const cur = sessions.find((s) => s.id === activeId)
    if (cur && cur.id.startsWith('new-') && !cur.items.length && !cur.busy && draftEmpty(cur.id)) setSessions((all) => all.filter((s) => s.id !== cur.id))
  }
  const openSession = (info: SessionInfo) => {
    const live = findSession(sessions, info.id)
    if (live) return activate(live.id)
    replaceUntouched()
    setSessions((all) => [...all, {
      id: info.id, title: info.title, path: info.path, cwd: info.cwd, sessionId: info.id,
      items: [], streaming: '', busy: false, loaded: false, background: false,
    }])
    setPaneState((p) => activateIn(p, info.id))
    window.api.worktreeLinks(info.id).then((links) => links.length && setSessions((all) => all.map((s) => (s.id === info.id
      ? { ...s, worktrees: links.map(({ repo, path, branch }) => ({ repo, path, branch })) } : s)))).catch(() => {})
    window.api.loadRecentHistory(info.path).then(({ items, more }) =>
      setSessions((all) => all.map((s) => (s.id === info.id ? { ...s, items: [...items, ...s.items], loaded: true, history: { count: items.length, more } } : s))))
  }
  // the rest of a long thread's transcript, on request: the full history replaces the recent part, live items stay
  const loadEarlier = (id: string) => {
    const s = sessionsRef.current.find((x) => x.id === id)
    if (!s?.path || !s.history?.more) return
    void window.api.loadHistory(s.path).then((items) => setSessions((all) => all.map((x) => (x.id === id && x.history?.more
      ? { ...x, items: [...items, ...x.items.slice(x.history.count)], history: { count: items.length, more: false } } : x))))
  }

  // close sessions (each stops its live process); each pane picks its nearest tab
  const closeTabs = (closing: string[]) => {
    // a file tab with unsaved edits stays open and asks in its editor (Save / Discard / Cancel)
    closing = closing.filter((id) => { const f = fileOfTab(id); if (!f || releaseFile(f)) return true; setPaneState((p) => activateIn(p, id)); return false })
    if (!closing.length) return
    setSessions((all) => all.filter((s) => !closing.includes(s.id)))
    closing.forEach((id) => { if (!fileOfTab(id)) void window.api.chatClose(id) })
  }
  const closeSession = (id: string) => (id.startsWith('script:') ? void window.api.scriptsStop(id.slice(7)) : id.startsWith('dev:') ? void (id !== 'dev:docker' && window.api.devStop(id.slice(4))) : id === 'deploy' ? (deploy.w.phase !== 'deploying' && deploy.act({ t: 'stop' })) : closeTabs([id]))
  const paneTabsOf = (id: string) => panes.panes.find((p) => p.tabs.includes(id))?.tabs ?? [id]
  const tabAction = (target: string, a: TabCloseAction) => closeTabs(tabsToClose(paneTabsOf(target), target, a))

  // hide a tab but keep its process running
  const moveToBackground = (id: string) => {
    if (!visible.includes(id)) return
    setSessions((all) => all.map((s) => (s.id === id ? { ...s, background: true } : s)))
  }

  const live = useMemo(() => liveRows(sessions, [...(deploy.liveRow ? [deploy.liveRow] : []), ...dev.liveRows, ...scripts.liveRows]), [sessions, deploy.liveRow, dev.liveRows, scripts.liveRows])
  const failedCount = live.waiting.filter((r) => liveLook(r).word === 'FAILED').length

  // Diagnose: a new thread with the prompt filled in, not sent
  const diagnose = (prompt: string, cwd: string) => {
    const s = { ...makeSession('Diagnose deploy'), cwd: cwd || folder }
    setSessions((all) => [...all, s])
    prefillDraft(s.id, prompt)
    setPaneState((p) => activateIn(p, s.id))
    setModal(null)
  }

  const send = (target: Session, text: string, images: Attachment[], mode?: 'steer' | 'queue') => {
    // while Claude works, a message either steers the running turn or waits in the queue for the next one
    const busyMode = target.busy ? (mode ?? 'steer') : undefined
    const queueId = busyMode === 'queue' ? crypto.randomUUID() : undefined
    const item: Item = {
      kind: 'user', text, images: images.map((i) => i.url),
      ...(busyMode === 'steer' ? { steer: true, during: workingOn(target.items) } : {}),
      ...(queueId ? { queue: { id: queueId, pending: true } } : {}),
    }
    setSessions((all) => all.map((s) => (s.id === target.id ? { ...s, busy: true, items: [...s.items, item] } : s)))
    void window.api.chatSend(target.id, target.cwd || folder, target.sessionId, {
      title: target.title, text, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })), mode: busyMode, queueId, background: target.background,
    })
  }

  // a file dropped outside a message box: ask what to do with it (only types the app can start work on)
  const onWindowDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => { try { return window.api.pathForFile(f) } catch { return '' } }).filter(Boolean)
    if (!paths.length) return
    if (!dropChoices.length) return notice('Set HIVE_DROP_SKILLS in your config to start a skill on a dropped file')
    const file = pickDropFile(paths)
    if (file) setDropped(file)
    else notice(`Drop a ${DROP_TYPES.join(', ')} file to start work on it`)
  }
  // a new background thread in the workspace root, started by the app (so in auto mode), with the skill and the file
  const startFromFile = (c: DropChoice, path: string) => {
    setDropped(null)
    const id = `new-${Date.now()}`
    const title = dropTitle(c, path)
    const text = dropMessage(c, path)
    const cwd = workspace || folder
    setSessions((all) => [...all, {
      id, title, cwd, items: [{ kind: 'user', text, images: [] }], streaming: '', busy: true, loaded: true, background: true, mode: 'auto',
    }])
    void window.api.chatSend(id, cwd, undefined, { title, text, images: [], background: true })
  }

  // ---- keyboard ----
  const toggleRegion = (r: Region) => (r === 'left' ? setLeftOpen(!leftOpen) : r === 'right' ? setRightOpen(!rightOpen) : setBottomOpen(!bottomOpen))
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); setPalette((p) => !p) }
      else if (e.ctrlKey && e.shiftKey && k === 'b' && activeId) { e.preventDefault(); moveToBackground(activeId) }
      else if (e.ctrlKey && !e.shiftKey && k === 'j') { e.preventDefault(); toggleRegion('bottom') }
      else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'Backquote') {
        e.preventDefault()
        if (bottomOpen && bottomView === 'terminal') setBottomOpen(false); else openTerminal()
      }
      else if (e.ctrlKey && !e.shiftKey && e.key === ',') { e.preventDefault(); setModal('settings') }
      else if (e.ctrlKey && !e.shiftKey && e.key === '\\') { e.preventDefault(); newBeside(panes.focus) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ---- badges, tools, menus, palette ----
  const tb = todoBadge(todos.todos, todos.today)
  const runningScripts = scripts.runs.filter((r) => r.phase === 'running').length
  const devUp = (dev.state?.services ?? []).filter((s) => s.state === 'running').length
  const agentsRunning = live.working.length
  const badges: Badges = {
    threads: live.waiting.length ? { n: live.waiting.length, cls: 'wait', title: 'waiting for you' } : undefined,
    agents: agentsRunning ? { n: agentsRunning, title: 'working' } : undefined,
    watchers: wc.waiting ? { n: '!', cls: 'wait blink', title: 'a watcher waits for you' } : wc.running ? { n: wc.running, title: 'running' } : undefined,
    todos: tb.open ? { n: tb.open, cls: tb.late ? 'wait' : '', title: tb.late ? 'some are overdue' : 'open' } : undefined,
    scripts: runningScripts ? { n: runningScripts } : undefined,
    deploy: deploy.liveRow ? { n: deploy.liveRow.state === 'waiting' ? '!' : '1', cls: deploy.liveRow.state === 'waiting' ? 'wait' : '' } : undefined,
    dev: devUp ? { n: devUp } : undefined,
  }
  const toolRows: ToolRow[] = [
    { id: 'deploy', label: 'Deploy', icon: 'rocket', mk: 'mk-deploy', status: deploy.liveRow ? deploy.liveRow.note || deploy.liveRow.title : '', cls: deploy.liveRow?.state === 'waiting' ? 's-wait' : deploy.liveRow ? 's-work' : '' },
    { id: 'pull', label: 'Pull latest', icon: pulling ? 'sync' : 'repo-pull', mk: pulling ? 'mk-pull spin' : 'mk-pull', status: pulling ? 'pulling…' : '' },
    ...(allow?.configured ? [{ id: 'allow', label: 'Allow my IP', icon: allow.running ? 'sync' : 'shield', mk: allow.running ? 'mk-other spin' : 'mk-other', status: allow.running ? 'allowing…' : allow.changed ? 'IP changed' : '', cls: allowOn ? 's-wait' : '', disabled: !allowOn, title: allowTitle }] : []),
    { id: 'dev', label: 'Dev stack', icon: 'server-process', mk: 'mk-dev', status: dev.state?.configured ? `${devUp} up` : '', cls: devUp ? 's-done' : '' },
    { id: 'scripts', label: 'Scripts', icon: 'play', mk: 'mk-scripts', status: runningScripts ? `${runningScripts} running` : '', cls: runningScripts ? 's-work' : '' },
    { id: 'todos', label: 'To-dos', icon: 'checklist', mk: 'mk-todos', status: tb.open ? `${tb.late ? 'some late, ' : ''}${tb.open} open` : '', cls: tb.late ? 's-wait' : '' },
    { id: 'notes', label: 'Notes', icon: 'note', mk: 'mk-todos' },
    { id: 'agents', label: 'Agents', icon: 'type-hierarchy', mk: 'mk-agents', status: agentsRunning ? `${agentsRunning} working` : '', cls: agentsRunning ? 's-work' : '' },
    { id: 'git', label: 'Git', icon: 'source-control', mk: 'mk-git' },
    { id: 'files', label: 'Files', icon: 'files', mk: 'mk-files' },
    { id: 'mcp', label: 'MCP servers', icon: 'plug', mk: 'mk-other' },
  ]

  const viewItems = (prefix: string): MenuItem[] => (Object.keys(VIEW) as ViewId[]).filter((v) => v !== 'threads' || placeOf(ui, 'threads') !== 'left').map((v) => ({
    label: VIEW[v].label, icon: VIEW[v].icon, onClick: (el) => openTool(v, el), testid: `${prefix}-${v}`, hint: v === 'deploy' ? 'wizard' : undefined,
  }))
  const menus: Menu[] = [
    { label: 'Thread', items: [
      { label: 'New thread', hint: '', icon: 'add', onClick: newSession, testid: 'menu-thread-new' },
      { label: 'New thread beside', hint: 'Ctrl+\\', icon: 'split-horizontal', onClick: () => newBeside(panes.focus), testid: 'menu-thread-split', disabled: panes.panes.length >= 4 },
      { label: 'All threads…', icon: 'list-unordered', onClick: (el) => showView('threads', el), testid: 'menu-thread-all' },
      { label: 'Move to background', hint: 'Ctrl+Shift+B', icon: 'eye-closed', onClick: () => activeId && moveToBackground(activeId), testid: 'menu-thread-background', disabled: !activeId, sep: true },
      { label: 'Close thread', icon: 'close', onClick: () => activeId && closeTabs([activeId]), testid: 'menu-thread-close', disabled: !activeId },
    ] },
    { label: 'View', items: [
      ...getUIs().map((u, i): MenuItem => ({ label: `${u.label} UI`, checked: ui === u.id, onClick: () => setUI(u.id), testid: `menu-view-ui-${u.id}`, sep: i === 0 && false })),
      ...getThemes(ui).map((t, i): MenuItem => ({ label: `${t.label} theme`, checked: false, icon: 'symbol-color', onClick: () => setTheme(t.id), testid: `menu-view-theme-${t.id}`, sep: i === 0 })),
      { label: 'Command palette', hint: 'Ctrl+K', icon: 'search', onClick: () => setPalette(true), testid: 'menu-view-palette', sep: true },
      ...(ui === 'default' ? [{ label: 'Threads on the right', checked: swapped, icon: 'arrow-swap', onClick: () => setSwapped(!swapped), testid: 'menu-view-swap' }] : []),
      ...(arr.left.length ? [{ label: leftOpen ? 'Hide side bar' : 'Show side bar', icon: 'layout-sidebar-left', onClick: () => toggleRegion('left'), testid: 'menu-view-left' }] : []),
      { label: bottomOpen ? 'Hide panel' : 'Show panel', hint: 'Ctrl+J', icon: 'layout-panel', onClick: () => toggleRegion('bottom'), testid: 'menu-view-bottom' },
      { label: rightOpen ? 'Hide right side' : 'Show right side', icon: 'layout-sidebar-right', onClick: () => toggleRegion('right'), testid: 'menu-view-right' },
    ] },
    { label: 'Tools', items: [
      ...viewItems('menu-tools'),
      { label: 'MCP servers', icon: 'plug', onClick: (el) => openTool('mcp', el), testid: 'menu-tools-mcp', sep: true },
      { label: 'Hooks', icon: 'symbol-event', onClick: (el) => openTool('hooks', el), testid: 'menu-tools-hooks' },
      { label: 'Plugins', icon: 'extensions', onClick: (el) => openTool('plugins', el), testid: 'menu-tools-plugins' },
      { label: 'Settings', hint: 'Ctrl+,', icon: 'settings-gear', onClick: () => setModal('settings'), testid: 'menu-tools-settings', sep: true },
    ] },
  ]
  // the View menu's theme rows show the current UI's theme as checked
  const themeNow = useAppearance().theme
  for (const it of menus[1].items) if (it.testid === `menu-view-theme-${themeNow}`) it.checked = true

  const commands: Command[] = [
    { id: 'new', group: 'Actions', label: 'New thread', icon: 'add', run: newSession },
    { id: 'new-beside', group: 'Actions', label: 'New thread beside (split)', hint: 'Ctrl+\\', icon: 'split-horizontal', run: () => newBeside(panes.focus) },
    { id: 'toggle-bottom', group: 'Actions', label: bottomOpen ? 'Hide bottom panel' : 'Show bottom panel', hint: 'Ctrl+J', icon: 'layout-panel', run: () => toggleRegion('bottom') },
    { id: 'toggle-right', group: 'Actions', label: rightOpen ? 'Hide right side' : 'Show right side', icon: 'layout-sidebar-right', run: () => toggleRegion('right') },
    ...(activeId ? [{ id: 'bg', group: 'Actions', label: 'Move this thread to the background', hint: 'Ctrl+Shift+B', icon: 'eye-closed', run: () => moveToBackground(activeId) }] : []),
    ...[...live.waiting, ...live.working].map((r) => ({ id: `live:${r.id}`, group: 'Live threads', label: r.title, hint: liveLook(r).word.toLowerCase(), icon: liveLook(r).icon, mk: liveLook(r).cls, run: () => activate(r.id) })),
    ...sessions.filter((s) => !s.background && !live.working.some((r) => r.id === s.id) && !live.waiting.some((r) => r.id === s.id)).map((s) => ({ id: `open:${s.id}`, group: 'Open threads', label: s.title, icon: 'comment-discussion', run: () => activate(s.id) })),
    ...(Object.keys(VIEW) as ViewId[]).map((v) => ({ id: `view:${v}`, group: 'Tools', label: VIEW[v].label, hint: v === 'deploy' ? 'wizard' : placeOf(ui, v) === 'popover' ? 'popover' : placeOf(ui, v), icon: VIEW[v].icon, mk: VIEW[v].mk, run: () => openTool(v) })),
    { id: 'tool:mcp', group: 'Tools', label: 'MCP servers', icon: 'plug', run: () => openTool('mcp') },
    { id: 'tool:hooks', group: 'Tools', label: 'Hooks', icon: 'symbol-event', run: () => openTool('hooks') },
    { id: 'tool:plugins', group: 'Tools', label: 'Plugins', icon: 'extensions', run: () => openTool('plugins') },
    { id: 'tool:settings', group: 'Tools', label: 'Settings', hint: 'Ctrl+,', icon: 'settings-gear', run: () => setModal('settings') },
    { id: 'tool:watchers-popover', group: 'Tools', label: 'Watchers: switch on or off', icon: 'eye', mk: 'mk-watch', run: () => setPop({ kind: 'watchers', anchor: centre() }) },
    ...getUIs().map((u) => ({ id: `ui:${u.id}`, group: 'UI', label: `UI: ${u.label}`, hint: ui === u.id ? 'current' : u.description, icon: 'layout', run: () => setUI(u.id) })),
    ...getThemes(ui).map((t) => ({ id: `theme:${t.id}`, group: 'Theme', label: `Theme: ${t.label}`, hint: themeNow === t.id ? `current for ${getUIs().find((u) => u.id === ui)?.label}` : t.description, icon: 'symbol-color', run: () => setTheme(t.id) })),
  ]
  const loadThreads = async (): Promise<Command[]> => (await window.api.listSessions()).map((s) => ({ id: `saved:${s.id}`, group: 'Threads', label: s.title, hint: s.project, icon: 'history', run: () => openSession(s) }))

  // ---- views ----
  const termTargets = panes.panes.map((p) => sessions.find((s) => s.id === p.active)).filter((s): s is Session => !!s)
    .map((s) => ({ tabId: s.id, title: s.title, cwd: s.worktrees?.at(-1)?.path ?? s.cwd ?? '' }))
  // a watcher's thread is a (background) tab while it lives; after a reload it reopens from its transcript
  // every watcher's thread stays in the sidebar's Watchers section
  const watcherSessions = wc.sessions.join(' ')
  useEffect(() => { for (const id of watcherSessions.split(' ')) if (id) keepVisible(id) }, [watcherSessions])
  const openWatcherThread = (t: OpenThread) => {
    if (t.sessionId) keepVisible(t.sessionId)
    const s = (t.tabId ? sessions.find((x) => x.id === t.tabId) : undefined) ?? (t.sessionId ? findSession(sessions, t.sessionId) : undefined)
    if (s) activate(s.id)
    else if (t.sessionId && t.path) openSession({ id: t.sessionId, title: t.title, project: '', cwd: t.cwd, updated: t.at, started: t.at, path: t.path })
    else notice('That watcher has no thread to open yet')
  }
  const watchersHome = <div className="watchers-home" data-testid="watchers-view"><WatchersView onOpen={(p) => setPreview(p)} onOpenThread={openWatcherThread} /></div>
  const threadsList = (footer?: ReactNode, onNew?: () => void) => (
    <Sidebar activeId={activeId} onOpen={openSession} live={live} onActivate={activate} onCloseLive={closeSession} onNew={onNew} footer={footer} />
  )
  const renderView = (v: ViewId): ReactNode => {
    switch (v) {
      case 'threads': return threadsList(undefined, newSession)
      // Git: the focused thread's changes first, then the repos (status, stage, commit, push)
      case 'git': return (
        <div className="gitview">
          {active && !active.file && <div className="gitview-thread"><ChangesView session={active} diff={diff} onDiff={setDiff} onOpenInGit={(f) => void openInGit(f)} onOpenGit={() => document.querySelector('[data-testid="git-panel"]')?.scrollIntoView()} /></div>}
          <div className="gitview-top"><GitPanel onDiff={setGitDiff} focus={gitFocus} /></div>
          {gitDiff && <>
            <Divider dir="h" size={gitDiffH} setSize={setGitDiffH} save={saveGitDiffH} sign={-1} min={120} max={1200} testid="divider-git-diff" />
            <div className="gitview-diff" style={{ height: gitDiffH }}><DiffPanel spec={gitDiff} onClose={() => setGitDiff(null)} onOpenInGit={(f) => void openInGit(f)} /></div>
          </>}
        </div>
      )
      case 'files': return folder ? <FileTree root={folder} onOpenFolder={() => window.api.pickFolder().then((f) => f && setFolder(f))} selected={preview} onOpenFile={openFile} /> : <div className="pane-empty">Loading…</div>
      case 'agents': return <AgentsView sessions={sessions} live={live} onActivate={activate} />
      case 'terminal': return <TerminalView targets={termTargets} current={termTab} onPick={setTermTab} focus={termFocus} onSendToChat={(id, text) => insertIntoComposer(id, text)} />
      case 'watchers': return watchersHome
      case 'deploy': return <DeployPanel cfg={deploy.cfg} w={deploy.w} out={deploy.out} act={deploy.act} onDiagnose={diagnose} />
      case 'scripts': return <ScriptsPanel runs={scripts.runs} onOpen={(p) => setPreview(p)} />
      case 'todos': return <TodoPanel todos={todos.todos} today={todos.today} error={todos.error} reload={todos.reload} />
      case 'notes': return <NotesPanel />
      case 'dev': return <DevPanel state={dev.state} setState={dev.setState} />
      case 'pull': return <PullPanel />
    }
  }

  const renderChat = (s: Session, _pane: unknown, focused: boolean) => s.file ? <FileEditor key={s.id} path={s.file} onClosed={() => closeTabs([s.id])} /> : (
    <SessionView key={s.id} session={s} mode={mode} focused={focused} onFocus={() => setPaneState((p) => focusPane(p, panes.panes.find((x) => x.tabs.includes(s.id))?.id ?? p.focus))}
      onSend={(text, images, m) => send(s, text, images, m)} onDequeue={(id) => window.api.chatDequeue(s.id, id)} onPromote={(id) => void window.api.chatPromote(s.id, id)}
      onStop={() => window.api.chatInterrupt(s.id)} onBackground={(toolUseId) => void window.api.chatBackground(s.id, toolUseId)} onRunInBackground={() => moveToBackground(s.id)}
      onOpen={(p) => setPreview(p)} onDiff={showDiff} onLoadEarlier={() => loadEarlier(s.id)} onTerminal={() => { if (bottomOpen && bottomView === 'terminal' && termTab === s.id) setBottomOpen(false); else openTerminal(s.id) }} onChanges={() => { setDiff(null); showView('git') }}
      onSplit={arr.chat !== 'single' && panes.panes.length < 4 ? () => newBeside(panes.panes.find((x) => x.tabs.includes(s.id))?.id ?? panes.focus) : undefined}
      compactHead={arr.tabs === 'title'} />
  )
  const emptyChat = (
    <div className="welcome" data-testid="welcome">
      <HiveMark size={56} />
      <div className="w-name">{appName}</div>
      {tagline && <div className="w-tag">{tagline}</div>}
      <div className="w-acts">
        <button className="primary" onClick={newSession} data-testid="welcome-new"><Icon name="add" />New thread</button>
        <button onClick={(e) => showView('threads', e.currentTarget)} data-testid="welcome-threads"><Icon name="list-unordered" />Open a thread</button>
        <button onClick={() => setPalette(true)} data-testid="welcome-palette"><Icon name="search" />Ctrl+K</button>
      </div>
    </div>
  )
  const chat = (
    <ChatArea state={panes} sessions={sessions} layout={arr.chat} tabs={arr.tabs} render={renderChat} empty={emptyChat}
      onActivate={activate} onFocusPane={(id) => setPaneState((p) => focusPane(p, id))} onClose={closeSession}
      onTabMenu={(id, x, y) => setTabMenu({ id, x, y })} onMove={(tab, pane, index) => {
        // a background thread dragged from the strip comes back first
        if (sessions.find((s) => s.id === tab)?.background) setSessions((all) => activateSession(all, tab))
        setPaneState((p) => moveTab(activateIn(reconcile(p, visibleNow().concat(tab)), tab), tab, pane, index))
      }}
      onSplit={(tab, beside) => {
        if (!tab) return newBeside(beside)
        if (sessions.find((s) => s.id === tab)?.background) setSessions((all) => activateSession(all, tab))
        setPaneState((p) => { const base = activateIn(reconcile(p, visibleNow().concat(tab)), tab); return splitWith(base, tab, beside) ?? moveTab(base, tab, beside) })
      }}
      onNew={newSession} />
  )
  const bottom = bottomOpen && (
    <>
      {!bottomMax && <Divider dir="h" size={bottomH} setSize={setBottomH} save={saveBottomH} sign={-1} min={90} max={Math.round(innerHeight * 0.8)} testid="divider-bottom" />}
      <div className={bottomMax ? 'bottomwrap max' : 'bottomwrap'} style={bottomMax ? undefined : { height: bottomH }}>
        <BottomPanel views={arr.bottom} current={bottomView} onPick={setBottomView} onClose={() => { setBottomOpen(false); setBottomMax(false) }} onMax={() => setBottomMax((m) => !m)} max={bottomMax} render={renderView} badges={badges} />
      </div>
    </>
  )
  const centreCol = (
    <div className="centre">
      {!bottomMax && chat}
      {bottom}
    </div>
  )
  // the tool panel (Changes, Preview, Editor...): on the right, or on the left when the Default UI's sides are swapped
  const toolPanel = (
    <div className="rightwrap" style={{ width: rightW }}>
      <SideTabs views={[rv]} current={rv} onPick={setRightView} onClose={() => setRightOpen(false)} render={renderView} badges={badges} testid="right-side" />
    </div>
  )
  const rightDivider = (sign: 1 | -1) => <Divider dir="v" size={rightW} setSize={setRightW} save={saveRightW} sign={sign} min={280} max={Math.round(innerWidth * 0.7)} testid="divider-right" />
  const right = rightOpen && <>{rightDivider(-1)}{toolPanel}</>

  const watchersTools = (
    <Fold id="watchers" title="Watchers" icon={<Icon name="eye" className="mk-watch" />} count={`${wc.on}/${wc.total} on`} testid="sidebar-watchers">
      <WatcherRows compact onOpen={() => showView('watchers')} />
    </Fold>
  )

  let body: ReactNode
  if (ui === 'default') {
    const threadsPane = <div className="leftwrap" style={{ width: leftW }}>{threadsList(<>{watchersTools}<ToolList rows={toolRows} onOpen={openTool} /></>, newSession)}</div>
    const threadsDivider = (sign: 1 | -1) => <Divider dir="v" size={leftW} setSize={setLeftW} save={saveLeftW} sign={sign} min={200} max={600} testid="divider-left" />
    body = swapped ? (
      <div className="main swapped">
        {rightOpen && <>{toolPanel}{rightDivider(1)}</>}
        {centreCol}
        {leftOpen && <>{threadsDivider(-1)}{threadsPane}</>}
      </div>
    ) : (
      <div className="main">
        {leftOpen && <>{threadsPane}{threadsDivider(1)}</>}
        {centreCol}
        {right}
      </div>
    )
  } else if (ui === 'workbench') {
    const pickActivity = (v: ViewId) => { if (leftOpen && leftView === v) setLeftOpen(false); else { setLeftView(v); setLeftOpen(true) } }
    body = (
      <div className="main">
        <ActivityBar items={arr.left} current={leftView} open={leftOpen} onPick={pickActivity} badges={badges} bottom={<>
          <button className="act" title="Deploy wizard" onClick={() => setModal('deploy')} data-testid="activity-deploy"><Icon name="rocket" />{badges.deploy && <span className={`badge ${badges.deploy.cls ?? ''}`}>{badges.deploy.n}</span>}</button>
          <button className="act" title="Pull latest" onClick={(e) => openTool('pull', e.currentTarget)} data-testid="activity-pull"><Icon name="repo-pull" /></button>
          <button className="act" title="MCP servers" onClick={(e) => openTool('mcp', e.currentTarget)} data-testid="activity-mcp"><Icon name="plug" /></button>
          <button className="act" title="Settings (Ctrl+,)" onClick={() => setModal('settings')} data-testid="activity-settings"><Icon name="settings-gear" /></button>
        </>} />
        {leftOpen && (
          <>
            <div className="leftwrap wb" style={{ width: leftW }}>
              {leftView !== 'threads' && <div className="sidetitle">{VIEW[leftView].label}</div>}
              <div className="sidebody">{leftView === 'threads' ? threadsList(watchersTools, newSession) : renderView(leftView)}</div>
            </div>
            <Divider dir="v" size={leftW} setSize={setLeftW} save={saveLeftW} min={200} max={700} testid="divider-left" />
          </>
        )}
        {centreCol}
        {right}
      </div>
    )
  } else if (ui === 'strip') {
    const pickDock = (v: ViewId) => {
      if (v === 'deploy') return setModal('deploy')
      if (rightOpen && rightView === v) setRightOpen(false); else { setRightView(v); setRightOpen(true) }
    }
    body = (
      <>
        <ThreadStrip sessions={sessions} shown={new Set(panes.panes.map((p) => p.active ?? ''))} focused={activeId} onActivate={activate}
          onAll={(el) => setPop({ kind: 'threads', anchor: anchorOf(el) })} onNew={newSession} total={sessions.length} />
        <div className="main">
          {centreCol}
          {right}
          <Dock items={arr.right} current={rightOpen ? rightView : null} onPick={pickDock} badges={badges} extra={<>{pullButton}{allowButton}</>} />
        </div>
      </>
    )
  } else {
    body = (
      <div className="main focus">
        {centreCol}
        {right}
      </div>
    )
  }

  const toggles = [
    ...(arr.left.length ? [{ icon: leftOpen ? 'layout-sidebar-left' : 'layout-sidebar-left-off', on: leftOpen, title: 'Toggle side bar', onClick: () => toggleRegion('left'), testid: 'toggle-left' }] : []),
    ...(ui === 'focus' || ui === 'strip' ? [{ icon: 'list-unordered', on: pop?.kind === 'threads', title: 'Threads', onClick: () => setPop({ kind: 'threads', anchor: anchorOf(document.querySelector('[data-testid="toggle-threads"]')) }), testid: 'toggle-threads' }] : []),
    ...(ui === 'focus' ? [{ icon: pulling ? 'sync' : 'repo-pull', on: pulling, title: 'Pull latest', onClick: () => void runPull(), testid: 'toggle-pull' }] : []),
    ...(ui === 'focus' && allow?.configured ? [{ icon: allow.running ? 'sync' : 'shield', on: allowOn, title: allowTitle, onClick: () => void runAllow(), testid: 'toggle-allow' }] : []),
    { icon: bottomOpen ? 'layout-panel' : 'layout-panel-off', on: bottomOpen, title: 'Toggle panel (Ctrl+J)', onClick: () => toggleRegion('bottom'), testid: 'toggle-bottom' },
    { icon: rightOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off', on: rightOpen, title: 'Toggle right side', onClick: () => toggleRegion('right'), testid: 'toggle-right' },
  ]
  // the side panel's views, picked from the top bar (the panel shows only the picked one); the open one closes it
  const viewButtons = arr.right.map((v) => ({
    icon: VIEW[v].icon, on: rightOpen && rv === v, title: VIEW[v].label, testid: `top-view-${v}`,
    onClick: () => { if (rightOpen && rv === v) setRightOpen(false); else { setRightView(v); setRightOpen(true) } },
  }))

  const liveMenu = (rows: LiveRow[]) => (
    <div className="poplist" data-testid="live-list">
      {rows.map((r) => {
        const look = liveLook(r)
        return (
          <button key={r.id} className="pop-row two" onClick={() => { setPop(null); activate(r.id) }} data-testid={`live-${r.id}`}>
            <Icon name={look.icon} className={look.cls} />
            <span className="pop-label">{r.title}<span className="pop-sub">{r.note}</span></span>
            <span className={`st ${look.cls.replace(' spin', '')}`}>{look.word}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`app ui-${ui}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={onWindowDrop}>
      <TitleBar menus={menus} onPalette={() => setPalette(true)} onWatchers={(el) => setPop({ kind: 'watchers', anchor: anchorOf(el) })} views={viewButtons} toggles={toggles} onSettings={() => setModal('settings')} />
      {body}
      <StatusBar sessionPath={active?.path ?? null} tabId={active?.id ?? null} branch={active ? (active.worktrees?.at(-1)?.branch ?? (active.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? null) : null}
        waiting={live.waiting.length - failedCount} working={live.working.length} failed={failedCount}
        onWaiting={(el) => setPop({ kind: 'live-waiting', anchor: anchorOf(el) })} onWorking={(el) => setPop({ kind: 'live-working', anchor: anchorOf(el) })}
        onMcp={(el) => openTool('mcp', el)} onAppearance={(el) => setPop({ kind: 'appearance', anchor: anchorOf(el) })} onBrand={() => setPalette(true)} />

      {tabMenu && sessions.some((s) => s.id === tabMenu.id && !s.background) && (
        <TabMenu ids={paneTabsOf(tabMenu.id)} target={tabMenu.id} x={tabMenu.x} y={tabMenu.y} onPick={(a) => tabAction(tabMenu.id, a)} onBackground={() => moveToBackground(tabMenu.id)} onClose={() => setTabMenu(null)} />
      )}

      {pop && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} align={pop.kind === 'appearance' || pop.kind === 'watchers' || pop.kind === 'mcp' ? 'right' : 'left'}
          width={pop.kind === 'dev' ? 820 : pop.kind === 'pull' ? 560 : pop.kind === 'threads' ? 360 : pop.kind === 'appearance' ? 460 : pop.kind === 'watchers' ? 400 : 440}
          className={`pop-${pop.kind}`} testid={`popover-${pop.kind}`}>
          {pop.kind === 'pull' && <PullPanel onClose={() => setPop(null)} />}
          {pop.kind === 'dev' && <DevPanel state={dev.state} setState={dev.setState} onClose={() => setPop(null)} />}
          {pop.kind === 'mcp' && <McpMenu tabId={activeId} onClose={() => setPop(null)} />}
          {pop.kind === 'hooks' && <HooksMenu folder={folder} onClose={() => setPop(null)} />}
          {pop.kind === 'plugins' && <PluginsMenu onClose={() => setPop(null)} />}
          {pop.kind === 'threads' && <div className="pop-threads">{threadsList(undefined, () => { setPop(null); newSession() })}</div>}
          {pop.kind === 'watchers' && <WatchersPopover onOpen={() => { setPop(null); showView('watchers') }} onOpenAll={() => { setPop(null); showView('watchers') }} />}
          {pop.kind === 'appearance' && <div className="pop-appearance"><AppearancePicker /></div>}
          {pop.kind === 'live-waiting' && liveMenu(live.waiting)}
          {pop.kind === 'live-working' && liveMenu(live.working)}
        </Popover>
      )}

      {modal === 'deploy' && (
        <Modal title={<><Icon name="rocket" className="mk-deploy" /> Deploy{deploy.w.suite ? `: ${deploy.w.suite}` : ''}</>} onClose={() => setModal(null)} wide testid="deploy-modal">
          <DeployPanel cfg={deploy.cfg} w={deploy.w} out={deploy.out} act={deploy.act} onDiagnose={diagnose} />
        </Modal>
      )}
      {pullFail && (
        <Modal title="Pull latest: some repos failed" onClose={() => setPullFail(null)} testid="pull-result">
          <table className="pulltab">
            <tbody>
              {pullFail.map((r) => (
                <tr key={r.repo}><td className="pr-repo">{r.repo}</td><td className={r.result.startsWith('failed') ? 'pr-bad' : r.result.startsWith('updated') ? 'pr-ok' : r.result.startsWith('skipped') ? 'pr-warn' : 'pr-dim'}>{r.result}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {previewFull && preview && (
        <div className="pv-full" data-testid="preview-full">
          <Preview path={preview} onClose={() => setPreviewFull(false)} onSide={() => { setPreviewFull(false); openInEditor(preview) }} onEdit={(p) => { setPreviewFull(false); openInEditor(p) }} />
        </div>
      )}
      {allowFail !== null && (
        <Modal title="IP allowlist failed" onClose={() => setAllowFail(null)} testid="allow-result">
          <pre className="allowout">{allowFail}</pre>
        </Modal>
      )}
      {modal === 'settings' && <SettingsPanel onClose={() => setModal(null)} onWatchers={() => { setModal(null); showView('watchers') }} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} loadThreads={loadThreads} />}

      {dropped && <DropPrompt path={dropped} choices={dropChoices} onPick={(c) => startFromFile(c, dropped)} onCancel={() => setDropped(null)} />}
      {notices.length > 0 && (
        <div className="notices">
          {notices.map((n) => (
            <div key={n.id} className="notice">
              <span>{n.text}</span>
              <button className="ibtn" aria-label="Dismiss" onClick={() => setNotices((all) => all.filter((x) => x.id !== n.id))} data-testid="notice-dismiss"><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
