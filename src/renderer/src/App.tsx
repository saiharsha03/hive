import { useEffect, useState } from 'react'
import { TopBar, type Panel } from './TopBar'
import { FileTree } from './FileTree'
import { Preview } from './Preview'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { SessionView, type Attachment } from './SessionView'
import { applyEvent, type Session } from './chat'

// Files panel folder: the last one used, else the home folder, until a session or "Open folder" picks one
const savedFolder = () => {
  try { return localStorage.getItem('folder') || '' } catch { return '' }
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [folder, setFolder] = useState(savedFolder)
  const [preview, setPreview] = useState<string | null>(null)
  const [mode, setMode] = useState('')

  useEffect(() => {
    window.api.chatMode().then(setMode)
    window.api.homeDir().then((home) => setFolder((f) => f || home))
    // a reload starts with no tabs, so stop any session still running from before it
    void window.api.chatReset()
  }, [])

  // every live session's events land here; Claude's "show" opens the preview panel
  useEffect(() => window.api.onChatEvent((tabId, ev) => {
    if (ev.type === 'hive_show' && ev.path) setPreview(ev.path)
    setSessions((all) => all.map((s) => (s.id === tabId ? applyEvent(s, ev) : s)))
  }), [])
  const active = sessions.find((s) => s.id === activeId)

  // the working folder follows the active session's repo
  useEffect(() => { if (active?.cwd) setFolder(active.cwd) }, [active?.cwd])
  useEffect(() => { if (folder) try { localStorage.setItem('folder', folder) } catch { /* storage off */ } }, [folder])

  const newSession = () => {
    const id = `new-${Date.now()}`
    setSessions((all) => [...all, {
      id, title: `New session ${all.filter((s) => s.id.startsWith('new-')).length + 1}`, cwd: folder,
      items: [], streaming: '', busy: false, loaded: true,
    }])
    setActiveId(id)
  }

  // reopen a past session as a tab, with its conversation; the next message resumes it
  const openSession = (info: SessionInfo) => {
    setActiveId(info.id)
    if (sessions.some((s) => s.id === info.id)) return
    setSessions((all) => [...all, {
      id: info.id, title: info.title, path: info.path, cwd: info.cwd, sessionId: info.id,
      items: [], streaming: '', busy: false, loaded: false,
    }])
    window.api.loadHistory(info.path).then((items) =>
      setSessions((all) => all.map((s) => (s.id === info.id ? { ...s, items: [...items, ...s.items], loaded: true } : s))))
  }

  // close a tab; if it was active, move to the tab beside it
  const closeSession = (id: string) => {
    const i = sessions.findIndex((s) => s.id === id)
    const rest = sessions.filter((s) => s.id !== id)
    setSessions(rest)
    void window.api.chatClose(id)
    if (id === activeId) setActiveId(rest[Math.min(i, rest.length - 1)]?.id ?? null)
  }

  const send = (text: string, images: Attachment[]) => {
    if (!active) return
    setSessions((all) => all.map((s) => (s.id === active.id
      ? { ...s, busy: true, items: [...s.items, { kind: 'user', text, images: images.map((i) => i.url) }] }
      : s)))
    void window.api.chatSend(active.id, active.cwd || folder, active.sessionId, {
      text, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
    })
  }

  return (
    <div className="app">
      <TopBar onNew={newSession} panel={panel} onPanel={setPanel} folder={folder} />
      <StatusBar sessionPath={active?.path ?? null} />
      <div className="body-row">
        {panel === 'sessions' && <Sidebar activeId={activeId} onOpen={openSession} />}
        {panel === 'files' && folder && (
          <FileTree
            root={folder}
            onOpenFolder={() => window.api.pickFolder().then((f) => f && setFolder(f))}
            selected={preview}
            onOpenFile={setPreview}
          />
        )}
        <div className="center">
          {sessions.length > 0 && (
            <div className="tabs">
              {sessions.map((s) => (
                <div key={s.id} className={s.id === activeId ? 'tab active' : 'tab'} onClick={() => setActiveId(s.id)} title={s.title}>
                  <span>{s.title}</span>
                  <button
                    className="x"
                    aria-label="Close"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeSession(s.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {active
            ? <SessionView key={active.id} session={active} mode={mode} onSend={send} onStop={() => window.api.chatInterrupt(active.id)} onOpen={setPreview} />
            : <div className="empty">Press New or pick a session</div>}
        </div>
        {preview && <Preview path={preview} onClose={() => setPreview(null)} />}
      </div>
    </div>
  )
}
