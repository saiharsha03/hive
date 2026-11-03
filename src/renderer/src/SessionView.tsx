// The conversation: header (title, worktree, goal and loop), messages, one-line tool calls with small coloured marks,
// things Claude showed you, background work, and the message box (pasted / dropped images, the clipboard chip,
// model and effort pickers, steer / queue). Scroll position is kept per thread, so switching UI or thread keeps it.
import { getPref, setPref } from './prefs'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toolLine, SHOW, CODEX, type Session } from './chat'
import { kindOf, usePreviewUrl } from './Preview'
import type { DiffSpec } from './DiffPanel'
import { counts, FILE_TOOLS, toolHunks, type Hunk } from '../../shared/diffCore'
import { modeLabel } from '../../shared/modeCore'
import type { ClipOffer } from '../../shared/clipboardCore'
import { clearOffer, textHash, useClipboardOn, useClipOffer } from './clipboardOffer'
import { MdBody } from './MdBody'
import { GoalLoop, ModelEffort, TaskList } from './ThreadStatus'
import { useThreadStatus } from './statusStore'
import { SummaryRow, WarningRow } from './ChatRows'
import { useSlashMenu } from './SlashMenu'
import { hasUltrathink, ultrathinkParts } from '../../shared/composerCore'
import { Icon } from './ui'

export type Attachment = { url: string; mediaType: string; data: string }

type SendMode = 'steer' | 'queue' | 'interrupt'
const MODES: SendMode[] = ['steer', 'queue', 'interrupt']
const MODE_KEY = 'sendMode'
const loadMode = (): SendMode => { const m = getPref<string>(MODE_KEY, 'steer'); return MODES.includes(m as SendMode) ? (m as SendMode) : 'steer' }
const other = (m: SendMode): SendMode => (m === 'steer' ? 'queue' : 'steer')
const MODE_LABEL: Record<SendMode, string> = { steer: 'Steer', queue: 'Queue', interrupt: 'Interrupt' }
const MODE_HINT: Record<SendMode, string> = {
  steer: "Delivered at Claude's next step, inside the running turn",
  queue: 'Held until Claude finishes, then starts a new turn',
  interrupt: 'Stops what Claude is doing now and sends this as the next turn (Ctrl+Enter)',
}
const attachmentOf = (url: string): Attachment => ({ url, mediaType: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) })

// unsent text and images per thread, so switching threads or UI doesn't lose them
const drafts = new Map<string, { text: string; images: Attachment[] }>()
// fill a thread's message box without sending (e.g. the Deploy wizard's Diagnose)
export const prefillDraft = (id: string, text: string) => { drafts.set(id, { text, images: [] }) }
// nothing typed or attached yet
export const draftEmpty = (id: string) => { const d = drafts.get(id); return !d || (!d.text.trim() && !d.images.length) }
// where each thread was scrolled to; "bottom" keeps following new messages
const scrolls = new Map<string, { top: number; bottom: boolean }>()
// text into a thread's message box at the cursor (the terminal's Send to chat); a box not on screen gets it in its draft
const inserters = new Map<string, (text: string) => void>()
export function insertIntoComposer(id: string, text: string) {
  const f = inserters.get(id)
  if (f) { f(text); return }
  const d = drafts.get(id) ?? { text: '', images: [] }
  drafts.set(id, { ...d, text: d.text ? `${d.text}\n${text}` : text })
}

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
    <button className="shown-img" onClick={() => onOpen(path)} title={path} data-testid="chat-shown-image">
      {url ? <img src={url} alt={name} /> : <span className="sc-open">Loading image…</span>}
    </button>
  ) : (
    <button className="shown-card" onClick={() => onOpen(path)} title={path} data-testid="chat-shown-file">
      <Icon name="preview" className="mk-preview" />
      <span className="sc-kind">{kindOf(path).toUpperCase()}</span>
      <span className="sc-name">{name}</span>
      <span className="sc-open">Open in preview</span>
    </button>
  )
}

// The clipboard suggestion in the message box: click to paste it as a normal paste would, x to dismiss
function ClipChip({ offer, onPaste, onDismiss }: { offer: ClipOffer; onPaste: () => void; onDismiss: () => void }) {
  const label = offer.kind === 'image' ? 'Screenshot on the clipboard' : offer.big ? `Copied text (${offer.length.toLocaleString()} chars)` : 'Copied text'
  return (
    <div className="clip">
      {offer.kind === 'image' && <img src={offer.thumb} alt="" />}
      <button className="cc-main" onClick={onPaste} title="From the clipboard" data-testid="composer-clip-paste">
        <Icon name="clippy" />
        <span className="cc-label">{label}</span>
        {offer.kind !== 'image' && !offer.big && <span className="cc-text">{offer.preview}</span>}
        <span className="cc-act">Paste</span>
      </button>
      <button className="ibtn" aria-label="Dismiss clipboard suggestion" onClick={onDismiss} data-testid="composer-clip-dismiss"><Icon name="close" /></button>
    </div>
  )
}

// A Codex subagent run: task, live activity while it works, its answer when done
function CodexBox({ it }: { it: Extract<Item, { kind: 'codex' }> }) {
  const [open, setOpen] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [it.lines.length])
  // one row like a Claude subagent's: who, the task's first line, its state; the task, live steps and answer fold open
  const first = it.task.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const last = [...it.lines].reverse().find(Boolean)
  return (
    <div className={`codexbox ${it.status}${open ? ' open' : ''}`}>
      <button className={`toolrow cx-row ${it.status}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="codex-steps" title={open ? 'Hide the details' : 'Show the task, steps and answer'}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        <Icon name="hubot" className="mk-agents" />
        <span className="tv mk-agents">Codex</span>
        <span className="tw">{first}</span>
        <span className="ts">
          {it.status === 'running' && last && !open && <span className="cx-last">{last.slice(0, 80)}</span>}
          <span className="cx-meta">{it.allowEdits ? 'can edit' : 'read-only'}</span>
          {it.status === 'running' ? <span className="s-work">running</span> : it.status === 'error' ? <span className="s-fail">FAILED</span> : <span className="s-idle">done</span>}
        </span>
      </button>
      {open && (
        <div className="cx-body">
          <div className="cx-task">{it.task}{it.model ? `\n\nModel: ${it.model}` : ''}</div>
          {it.lines.length > 0 && <div className="cx-log" ref={log}>{it.lines.map((l, j) => <div key={j} className={l.startsWith('$') ? 'cmd' : ''}>{l}</div>)}</div>}
          {it.answer && <div className="body md cx-answer"><Markdown remarkPlugins={[remarkGfm]}>{it.answer}</Markdown></div>}
        </div>
      )}
    </div>
  )
}

// an agent's file change as one row: "+12 −3 src/foo.ts"; clicking it opens the split diff in the side view.
// Hunks are worked out once per tool item (the view re-renders on every streamed token).
const hunkCache = new WeakMap<object, Hunk[]>()
export function hunksOf(it: Extract<Item, { kind: 'tool' }>): Hunk[] {
  let h = hunkCache.get(it)
  if (!h) { h = toolHunks(it.name, it.input, it.patch); hunkCache.set(it, h) }
  return h
}
export const shortPath = (file: string, cwd?: string) => {
  const f = file.replace(/\\/g, '/')
  const c = (cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  return c && f.toLowerCase().startsWith(`${c.toLowerCase()}/`) ? f.slice(c.length + 1) : f
}

// the small coloured mark before a tool call
function toolMark(name: string): [string, string] {
  if (name === 'Read') return ['eye', 'tm-read']
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') return ['edit', 'tm-edit']
  if (name === 'Bash' || name === 'PowerShell') return ['terminal', 'tm-bash']
  if (name === 'Grep' || name === 'Glob') return ['search', 'tm-search']
  if (name === 'Agent' || name === 'Task' || name === 'Workflow') return ['type-hierarchy', 'tm-agent']
  if (name === 'WebFetch' || name === 'WebSearch') return ['globe', 'tm-web']
  if (name === 'TodoWrite') return ['checklist', 'tm-other']
  if (name.startsWith('mcp__hive__')) return ['symbol-event', 'tm-agent']
  if (name.startsWith('mcp__')) return ['plug', 'tm-other']
  return ['tools', 'tm-other']
}

type Props = {
  session: Session
  banner?: import('react').ReactNode // shown above the message box (the handoff offer)
  mode: string
  focused: boolean
  onFocus: () => void
  onSend: (text: string, images: Attachment[], mode?: SendMode) => void
  onDequeue: (queueId: string) => Promise<boolean>
  onPromote: (queueId: string) => void
  onStop: () => void
  onBackground: (toolUseId?: string) => void
  onRunInBackground: () => void
  onOpen: (pathOrDataUrl: string) => void
  onDiff: (spec: DiffSpec) => void
  onTerminal: () => void
  onChanges: () => void
  onSplit?: () => void
  onLoadEarlier?: () => void // a reopened thread's conversation before its recent end
  compactHead?: boolean
}

const WINDOW = 150

// when a message was sent or written: the time today, the date too for older ones; the full date on hover
function When({ at }: { at: number }) {
  const d = new Date(at)
  const today = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return <span className="when" title={d.toLocaleString()}>{today ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`}</span>
}

// background tool calls' tasks that ended (tool use id -> state), kept for the app's life
const bgEnded = new Map<string, import('../../shared/taskCore').Task['status']>()

export function SessionView({ session, mode, focused, onFocus, onSend, onDequeue, onPromote, onStop, onBackground, onRunInBackground, onOpen, onDiff, onTerminal, onChanges, onSplit, onLoadEarlier, compactHead, banner }: Props) {
  // only the newest items are drawn at first, so a long thread opens at once; Show earlier adds more
  const [limit, setLimit] = useState(WINDOW)
  const [draft, setDraft] = useState(() => drafts.get(session.id)?.text ?? '')
  const [images, setImages] = useState<Attachment[]>(() => drafts.get(session.id)?.images ?? [])
  useEffect(() => { drafts.set(session.id, { text: draft, images }) }, [session.id, draft, images])
  const thread = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [sendMode, setSendMode] = useState<SendMode>(loadMode)
  const [boxFocus, setBoxFocus] = useState(false)
  const slash = useSlashMenu(session.id, draft, setDraft)
  const ultra = hasUltrathink(draft)
  const mirror = useRef<HTMLDivElement>(null)
  const pickMode = (m: SendMode) => { setSendMode(m); setPref(MODE_KEY, m) }
  // /btw answers, shown above the message box until dismissed (never part of the conversation)
  const [btws, setBtws] = useState<{ q: string; a: string | null }[]>([])
  const askBtw = (question: string) => {
    setBtws((b) => [...b, { q: question, a: null }])
    void window.api.askBtw(session.cwd ?? '', session.sessionId ?? null, question)
      .catch((e) => `Could not answer: ${String(e?.message ?? e)}`)
      .then((a) => setBtws((b) => b.map((x) => (x.q === question && x.a === null ? { ...x, a } : x))))
  }

  // scroll: back where this thread was, then keep the newest message in view while it was at the bottom
  useLayoutEffect(() => {
    const el = thread.current
    if (!el) return
    const s = scrolls.get(session.id)
    el.scrollTop = !s || s.bottom ? el.scrollHeight : s.top
  }, [session.id])
  useEffect(() => {
    const el = thread.current
    const s = scrolls.get(session.id)
    if (el && (!s || s.bottom)) el.scrollTop = el.scrollHeight
  }, [session.items.length, session.streaming])
  const onScroll = () => {
    const el = thread.current
    if (el) scrolls.set(session.id, { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 })
  }

  // the focused chat takes the keyboard when it becomes focused
  useEffect(() => { if (focused) box.current?.focus({ preventScroll: true }) }, [focused])

  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length) {
      const read = await Promise.all(imgs.map(readImage))
      setImages((cur) => [...cur, ...read])
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    if (clip) dismissClip() // pasted by hand: the suggestion is used up
    const files = [...e.clipboardData.files]
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addFiles(files) }
  }
  // a drop on the message box attaches images; anywhere else the app offers to start work on the file
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault(); e.stopPropagation(); void addFiles([...e.dataTransfer.files])
  }

  // clipboard suggestion: only in the focused chat; hidden when off, or when the text is already exactly what the box holds
  const clipOn = useClipboardOn()
  const clip = useClipOffer()
  const [sameAsBox, setSameAsBox] = useState(false)
  useEffect(() => {
    if (clip?.kind !== 'text' || draft.length !== clip.length) { setSameAsBox(false); return }
    let live = true
    void textHash(draft).then((h) => { if (live) setSameAsBox(h === clip.id) })
    return () => { live = false }
  }, [clip, draft])
  const shownClip = focused && clipOn && clip && !sameAsBox ? clip : null
  const dismissClip = () => { if (clip) void window.api.clipboardDismiss(clip.id); clearOffer() }
  // the same paths as Ctrl+V: an image goes through addFiles, text goes in at the cursor
  const pasteClip = async () => {
    if (!clip) return
    clearOffer()
    const got = await window.api.clipboardTake(clip.id)
    if (!got) return
    if (got.kind === 'image') {
      const bytes = Uint8Array.from(atob(got.dataUrl.slice(got.dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
      await addFiles([new File([bytes], 'clipboard.png', { type: 'image/png' })])
      box.current?.focus()
      return
    }
    const el = box.current
    if (!el) { setDraft((d) => d + got.text); return }
    el.focus() // brings back the cursor / selection the textarea had before the click
    if (!document.execCommand('insertText', false, got.text)) {
      const [a, b] = [el.selectionStart, el.selectionEnd]
      setDraft((d) => d.slice(0, a) + got.text + d.slice(b))
    }
  }

  // take a queued message back into the message box to change it (only if it has not gone in yet)
  const editQueued = useCallback(async (it: Extract<Item, { kind: 'user' }>) => {
    if (!it.queue || !(await onDequeue(it.queue.id))) return
    setDraft((d) => (d.trim() ? `${d}\n${it.text}` : it.text))
    setImages((cur) => [...cur, ...it.images.map(attachmentOf)])
  }, [onDequeue])

  const submit = (m: SendMode = sendMode) => {
    if (!draft.trim() && !images.length) return
    const btw = draft.trim().match(/^\/btw\s+([\s\S]+)/)
    if (btw) { askBtw(btw[1]); setDraft(''); return }
    onSend(draft.trim(), images, m)
    setDraft('')
    setImages([])
    scrolls.set(session.id, { top: 0, bottom: true })
  }
  // Enter sends (or steers while Claude works), Shift+Enter adds a new line, Esc stops Claude
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.onKey(e)) return // the "/" menu has the keys while it is open
    // Ctrl+Shift+Enter sends, then moves this thread to the background
    if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) {
      e.preventDefault()
      if (draft.trim() || images.length || session.busy) { submit(); onRunInBackground() }
      return
    }
    // Ctrl+Enter interrupts Claude and sends; Alt+Enter sends this one message the other way (steer / queue)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e.ctrlKey ? 'interrupt' : e.altKey ? other(sendMode) : sendMode) }
    if (e.key === 'Escape' && session.busy) { e.preventDefault(); onStop() }
  }

  // Ctrl+B in the focused chat: background whatever is running (like the terminal)
  useEffect(() => {
    if (!focused) return
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'b' && session.busy) { e.preventDefault(); onBackground() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [focused, session.busy, onBackground])

  // terminal output (Send to chat) into the message box at the cursor, not sent
  useEffect(() => {
    const insert = (text: string) => {
      const el = box.current
      if (!el) { setDraft((d) => d + text); return }
      el.focus()
      const before = el.value.slice(0, el.selectionStart)
      const t = before && !before.endsWith('\n') ? `\n${text}` : text
      if (!document.execCommand('insertText', false, t)) {
        const [a, b] = [el.selectionStart, el.selectionEnd]
        setDraft((d) => d.slice(0, a) + t + d.slice(b))
      }
    }
    inserters.set(session.id, insert)
    return () => { if (inserters.get(session.id) === insert) inserters.delete(session.id) }
  }, [session.id])

  // the conversation, built only when it changes: typing in the box re-renders this view on every key,
  // and re-parsing every message's Markdown made typing lag in long threads
  // a tool call that went to the background (an Agent with run_in_background) returns at once; its row follows the task
  const tasks = useThreadStatus(session.id).tasks
  // (an ended one's state is remembered, so "Clear finished" in the task list does not turn a failed row back to done)
  const bgOf = useMemo(() => {
    for (const t of tasks) if (t.toolUseId && t.backgrounded && t.status !== 'running') bgEnded.set(t.toolUseId, t.status)
    const now = new Map(tasks.filter((t) => t.toolUseId && t.backgrounded).map((t) => [t.toolUseId!, t.status]))
    return new Map([...bgEnded, ...now])
  }, [tasks])
  const transcript = useMemo(() => (
      <>
        {!session.loaded && <div className="hint">Loading conversation…</div>}
        {session.loaded && !session.items.length && !session.streaming && <div className="chat-empty">New thread in {session.cwd || 'the workspace'}. Type below; drop or paste images.</div>}
        {(session.items.length > limit || session.history?.more) && (
          <button className="dlink earlier" data-testid="chat-earlier" onClick={() => { if (session.items.length > limit) setLimit((n) => n + WINDOW); else onLoadEarlier?.() }}>
            {session.items.length > limit ? `Show ${Math.min(WINDOW, session.items.length - limit)} earlier` : 'Load the earlier conversation'}
          </button>
        )}
        {session.items.map((it, i) => {
          if (i < session.items.length - limit) return null
          if (it.kind === 'user') return (
            <div key={i} className={`msg user${it.queue?.pending ? ' queued' : ''}`} data-testid="msg-user">
              <div className="who you">You{it.at ? <When at={it.at} /> : null}
                {it.steer && <span className="steer">steered while Claude worked{it.during ? ` (${it.during})` : ''}</span>}
                {it.queue?.pending && (
                  <span className="steer">{it.interrupt ? 'interrupting Claude, sends next' : 'queued, sends when Claude finishes'}
                    <button className="link" onClick={() => onPromote(it.queue!.id)} data-testid="queued-send-now">send now</button>
                    <button className="link" onClick={() => void editQueued(it)} data-testid="queued-edit">edit</button>
                    <button className="link" onClick={() => void onDequeue(it.queue!.id)} data-testid="queued-remove">remove</button>
                  </span>
                )}
                {it.queue && !it.queue.pending && !it.steer && <span className="steer">queued</span>}
              </div>
              {it.images.length > 0 && (
                <div className="imgs">{it.images.map((src, j) => (
                  <button key={j} className="thumb" onClick={() => onOpen(src)} data-testid="chat-image"><img src={src} alt="" /></button>
                ))}</div>
              )}
              {it.text && <div className="body plain">{it.text}</div>}
            </div>
          )
          if (it.kind === 'assistant') return (
            <div key={i} className="msg" data-testid="msg-assistant">
              <div className="who claude"><Icon name="sparkle" className="mk-claude" />Claude{it.at ? <When at={it.at} /> : null}</div>
              <MdBody text={it.text} />
            </div>
          )
          if (it.kind === 'tool') {
            if (it.name === SHOW || it.name === CODEX) return null // the card / Codex box says it all
            const { verb, what } = toolLine(it.name, it.input)
            const file = FILE_TOOLS.includes(it.name) && it.status !== 'error' && typeof it.input?.file_path === 'string' ? it.input.file_path as string : null
            const hunks = file ? hunksOf(it) : null
            const c = hunks ? counts(hunks) : null
            const label = file ? shortPath(file, session.cwd) : ''
            const [icon, tm] = toolMark(it.name)
            const bg = bgOf.get(it.id) // its background task: running until that ends, not "done" when the call returned
            const status = bg === 'running' ? 'running' : bg === 'failed' ? 'error' : it.status
            return (
              <div key={i} className={`toolrow ${status}`}>
                <Icon name={icon} className={tm} />
                <span className={`tv ${tm}`}>{verb}</span>
                {file && hunks && c
                  ? <button className="tw tdiff" title={`${file}: open the diff`} onClick={() => onDiff({ t: 'edit', file, label, tool: it.name, hunks })} data-testid="chat-diff-row">
                    {label} <span className="dv-add">+{c.add}</span> <span className="dv-del">−{c.del}</span>
                  </button>
                  : <span className="tw">{what}</span>}
                <span className="ts">
                  {it.status === 'running' && !bg && <button className="bg" onClick={() => onBackground(it.id)} title="Move to the background (Ctrl+B for all)" data-testid="tool-background">Background</button>}
                  {bg === 'running' ? <span className="s-work">running in the background</span> : status === 'running' ? <span className="s-work">running</span> : status === 'error' ? <span className="s-fail">FAILED</span> : bg === 'stopped' ? <span className="s-idle">stopped</span> : <span className="s-idle">done</span>}
                </span>
              </div>
            )
          }
          if (it.kind === 'show') return <div key={i} className="msg"><ShowCard path={it.path} onOpen={onOpen} /></div>
          if (it.kind === 'note') return <div key={i} className="note">{it.text}</div>
          if (it.kind === 'summary') return <SummaryRow key={i} text={it.text} />
          if (it.kind === 'warning') return <WarningRow key={i} event={it.event} text={it.text} />
          if (it.kind === 'codex') return <div key={i} className="msg"><CodexBox it={it} /></div>
          if (it.kind === 'thread') return (
            <div key={i} className={`msg threadbox${it.queue?.pending ? ' queued' : ''}`}>
              <div className="who thread"><Icon name="comment-discussion" />From thread {it.fromTitle} <span className="steer">({it.fromId})</span>
                {it.steer && <span className="steer">steered while Claude worked</span>}
                {it.queue?.pending && <span className="steer">queued, sends when Claude finishes</span>}
              </div>
              <div className="body md"><Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown></div>
            </div>
          )
          if (it.kind === 'agent') return (
            <div key={i} className="msg agentbox">
              <div className="who agent"><Icon name="hubot" />{it.from}</div>
              <MdBody text={it.text} />
            </div>
          )
          return <div key={i} className="msg err" data-testid="msg-error"><Icon name="error" className="s-fail" /> {it.text}</div>
        })}
      </>
  ), [session.loaded, session.items, session.streaming, session.cwd, session.history?.more, limit, onLoadEarlier, onPromote, onDequeue, onOpen, onDiff, onBackground, editQueued, bgOf])

  // the live session's own mode once it reports one; before that, the mode it will start in
  const shownMode = session.mode ?? (session.background ? 'auto' : mode)
  const running = session.items.filter((i) => i.kind === 'tool' && i.status === 'running').at(-1)
  const wt = session.worktrees?.at(-1)
  const folder = (session.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''

  return (
    <main className={focused ? 'session focused' : 'session'} onMouseDown={onFocus} onFocusCapture={onFocus} data-testid={`chat-${session.id}`}>
      <div className={compactHead ? 'chead compact' : 'chead'}>
        <div className="row1">
          {!compactHead && <h1 title={session.title}>{session.title}</h1>}
          {wt
            ? <span className="br" title={wt.path}><Icon name="git-branch" />{wt.branch}<span className="br-sub">{wt.repo} worktree</span></span>
            : folder && <span className="br" title={session.cwd}><Icon name="folder" />{folder}</span>}
          <span className="acts">
            <button onClick={onTerminal} title="This thread's terminal, in the bottom panel (Ctrl+`)" data-testid="terminal-toggle"><Icon name="terminal" />Terminal</button>
            <button onClick={onChanges} title="Changed files and the split diff" data-testid="chat-changes"><Icon name="diff" />Changes</button>
            {onSplit && <button onClick={onSplit} title="Open beside (split, up to four chats)" data-testid="chat-split"><Icon name="split-horizontal" />Split</button>}
          </span>
        </div>
        <GoalLoop tabId={session.id} busy={session.busy} onSend={onSend} onInterrupt={async () => { await onStop() }} />
      </div>

      <div className="thread" ref={thread} onScroll={onScroll}>
        {transcript}
        {session.streaming && (
          <div className="msg">
            <div className="who claude"><Icon name="sparkle" className="mk-claude" />Claude</div>
            <MdBody text={session.streaming} copy={false} />
          </div>
        )}
      </div>

      <TaskList tabId={session.id} items={session.items} />

      {btws.map((b, i) => (
        <div key={i} className="btw" data-testid="btw-answer">
          <div className="btw-q"><span className="btw-tag">btw</span>{b.q}<button className="x" aria-label="Dismiss" onClick={() => setBtws((all) => all.filter((_, j) => j !== i))} data-testid="btw-dismiss">×</button></div>
          {b.a === null ? <div className="btw-a dnote">Thinking…</div> : <div className="btw-a"><MdBody text={b.a} copy={false} /></div>}
        </div>
      ))}

      {session.busy && (
        <div className="working" data-testid="working">
          <Icon name="loading" className="spin s-work" />
          <span className="verb s-work">{session.compacting ? 'Compacting the conversation' : 'Working'}</span>
          {session.compacting && <span className="what">to free up context; this can take a few minutes</span>}
          {!session.compacting && running?.kind === 'tool' && <span className="what">{Object.values(toolLine(running.name, running.input)).join(' ')}</span>}
          <span className="r">
            <button onClick={onRunInBackground} title="Hide this thread and keep Claude running (Ctrl+Shift+B)" data-testid="chat-run-background">Run in background</button>
            <button onClick={() => onBackground()} data-testid="chat-background-tasks">Background tasks (Ctrl+B)</button>
            <button className="stop" onClick={onStop} data-testid="chat-stop">Stop (Esc)</button>
          </span>
        </div>
      )}

      {banner}
      <div className="composer" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={onDrop}>
        {slash.menu}
        <div className={boxFocus ? 'box focus' : 'box'}>
          {(shownClip || images.length > 0) && (
            <div className="atts">
              {images.map((im, j) => (
                <div key={j} className="att">
                  <img src={im.url} alt="" />
                  <button className="x" aria-label="Remove image" onClick={() => setImages(images.filter((_, k) => k !== j))} data-testid={`composer-remove-image-${j}`}><Icon name="close" /></button>
                </div>
              ))}
              {shownClip && <ClipChip offer={shownClip} onPaste={() => void pasteClip()} onDismiss={dismissClip} />}
            </div>
          )}
          <div className="cbox">
            {/* "ultrathink" marked behind the transparent text */}
            {ultra && <div className="cmirror" ref={mirror} aria-hidden data-testid="ultra-mirror">{ultrathinkParts(draft).map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : p.text))}{'\n'}</div>}
            <textarea
              ref={box}
              className={ultra ? 'ultra' : undefined}
              onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop }}
              placeholder={session.busy ? `Claude is working. Enter to ${sendMode}, Alt+Enter to ${other(sendMode)}, Ctrl+Enter to interrupt and send, Esc to stop` : 'Message Claude, paste or drop images, / for commands'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onPaste={onPaste}
              onFocus={() => setBoxFocus(true)}
              onBlur={() => setBoxFocus(false)}
              data-testid="composer"
            />
          </div>
          <div className="bar">
            <button className="ibtn" title="Attach images" onClick={() => fileInput.current?.click()} data-testid="composer-attach"><Icon name="add" /></button>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = '' }} data-testid="composer-file" />
            <ModelEffort tabId={session.id} ultra={ultra} />
            {ultra && <span className="thinknote" data-testid="ultra-note"><Icon name="flame" />ultrathink: max effort for this turn</span>}
            <span className="sp" />
            {session.busy && (
              <div className="seg" role="group" aria-label="Send mode while Claude works">
                {MODES.map((m) => (
                  <button key={m} className={sendMode === m ? 'on' : ''} aria-pressed={sendMode === m} onClick={() => pickMode(m)} data-testid={`send-mode-${m}`} title={MODE_HINT[m]}>
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            )}
            <button className="sendb" onClick={() => submit()} data-testid="send"><Icon name="send" />{session.busy ? MODE_LABEL[sendMode] : 'Send'}</button>
          </div>
        </div>
        <div className="cmeta">
          {wt ? <span className="wt" title={wt.path}><Icon name="git-branch" />{wt.repo} worktree on {wt.branch}</span>
            : <span title={session.cwd}><Icon name="folder" />{session.cwd}</span>}
          {(session.worktrees ?? []).slice(0, -1).map((w) => <span key={w.path} className="wt" title={w.path}>{w.repo} on {w.branch}</span>)}
          <span className={shownMode === 'bypassPermissions' ? 'mode warn' : 'mode'} title={session.modeError ?? undefined}>
            <Icon name="shield" />Permissions: <b>{modeLabel(shownMode)}</b>{session.modeError ? ' (switch failed)' : ''}
          </span>
        </div>
      </div>
    </main>
  )
}
