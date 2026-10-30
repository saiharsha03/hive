// The conversation: messages, one-line tool calls, things Claude showed you, and the message box
// (with pasted / dropped images).
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toolLine, SHOW, type Session } from './chat'
import { kindOf, usePreviewUrl } from './Preview'

export type Attachment = { url: string; mediaType: string; data: string }

// unsent text and images per tab, so switching tabs doesn't lose them
const drafts = new Map<string, { text: string; images: Attachment[] }>()

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      resolve({ url, mediaType: file.type, data: url.slice(url.indexOf(',') + 1) })
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function ShowCard({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const name = path.split(/[\\/]/).at(-1)
  const url = usePreviewUrl(path)
  return kindOf(path) === 'image' ? (
    <button className="shown-img" onClick={() => onOpen(path)} title={path}>
      {url ? <img src={url} alt={name} /> : <span className="sc-open">Loading image…</span>}
    </button>
  ) : (
    <button className="shown-card" onClick={() => onOpen(path)} title={path}>
      <span className="sc-kind">{kindOf(path).toUpperCase()}</span>
      <span className="sc-name">{name}</span>
      <span className="sc-open">Open in panel</span>
    </button>
  )
}

type Props = {
  session: Session
  mode: string
  onSend: (text: string, images: Attachment[]) => void
  onStop: () => void
  onOpen: (pathOrDataUrl: string) => void
}

export function SessionView({ session, mode, onSend, onStop, onOpen }: Props) {
  const [draft, setDraft] = useState(() => drafts.get(session.id)?.text ?? '')
  const [images, setImages] = useState<Attachment[]>(() => drafts.get(session.id)?.images ?? [])
  useEffect(() => { drafts.set(session.id, { text: draft, images }) }, [session.id, draft, images])
  const thread = useRef<HTMLDivElement>(null)

  // keep the newest message in view
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.items.length, session.streaming])

  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length) {
      const read = await Promise.all(imgs.map(readImage))
      setImages((cur) => [...cur, ...read])
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files]
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addFiles(files) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]) }

  const submit = () => {
    if (session.busy || (!draft.trim() && !images.length)) return
    onSend(draft.trim(), images)
    setDraft('')
    setImages([])
  }
  // Enter sends, Shift+Enter adds a new line
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const running = session.items.filter((i) => i.kind === 'tool' && i.status === 'running').at(-1)

  return (
    <main className="session" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="thread" ref={thread}>
        {!session.loaded && <div className="hint">Loading conversation…</div>}
        {session.items.map((it, i) => {
          if (it.kind === 'user') return (
            <div key={i} className="msg user">
              <div className="who">You</div>
              {it.images.length > 0 && (
                <div className="imgs">{it.images.map((src, j) => (
                  <button key={j} className="thumb" onClick={() => onOpen(src)}><img src={src} alt="" /></button>
                ))}</div>
              )}
              {it.text && <div className="body plain">{it.text}</div>}
            </div>
          )
          if (it.kind === 'assistant') return (
            <div key={i} className="msg">
              <div className="who claude">Claude</div>
              <div className="body md"><Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown></div>
            </div>
          )
          if (it.kind === 'tool') {
            if (it.name === SHOW) return null // the card above it says it all
            const { verb, what } = toolLine(it.name, it.input)
            return (
              <div key={i} className={`toolrow ${it.status}`}>
                <span className="tv">{verb}</span>
                <span className="tw">{what}</span>
                <span className="ts">{it.status === 'running' ? 'RUNNING' : it.status === 'error' ? 'FAILED' : ''}</span>
              </div>
            )
          }
          if (it.kind === 'show') return <div key={i} className="msg"><ShowCard path={it.path} onOpen={onOpen} /></div>
          if (it.kind === 'note') return <div key={i} className="note">{it.text}</div>
          return <div key={i} className="msg err">{it.text}</div>
        })}
        {session.streaming && (
          <div className="msg">
            <div className="who claude">Claude</div>
            <div className="body md"><Markdown remarkPlugins={[remarkGfm]}>{session.streaming}</Markdown></div>
          </div>
        )}
      </div>

      {session.busy && (
        <div className="working">
          <span className="verb">Working</span>
          {running?.kind === 'tool' && <span className="what">{Object.values(toolLine(running.name, running.input)).join(' ')}</span>}
          <button className="stop" onClick={onStop}>Stop</button>
        </div>
      )}

      <div className="composer">
        {images.length > 0 && (
          <div className="attach">
            {images.map((im, j) => (
              <div key={j} className="att">
                <img src={im.url} alt="" />
                <button className="x" aria-label="Remove image" onClick={() => setImages(images.filter((_, k) => k !== j))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="crow">
          <textarea
            autoFocus
            placeholder={session.busy ? 'Claude is working…' : 'Message Claude… (paste or drop images)'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          <button className="send" onClick={submit} disabled={session.busy}>Send</button>
        </div>
        <div className="cmeta">
          <span>{session.cwd}</span>
          <span className={mode === 'bypassPermissions' ? 'mode warn' : 'mode'}>{mode === 'bypassPermissions' ? 'Bypass permissions' : mode}</span>
        </div>
      </div>
    </main>
  )
}
