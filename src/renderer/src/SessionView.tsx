// The conversation in a pane: the header (title and pinned facts), the "since you looked" line, the transcript
// (your messages as a band with SEEN BY CLAUDE, Claude's replies, one-line tool rows with a coloured verb, inline
// diffs, question cards), the queue box, and the composer (underline input, labelled pickers, Steer / Queue / Stop).
// It reads only its own thread (useSession), so a reply streaming elsewhere does not re-render it. Scroll position,
// drafts and the "since you looked" mark are kept per thread.
import { getPref, setPref } from './prefs'
import { saveDraft, savedDrafts } from './restore'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toolLine, workingOn, SHOW, CODEX, type Session } from './chat'
import { kindOf, usePreviewUrl } from './Preview'
import { counts, FILE_TOOLS, toolHunks, type Hunk } from '../../shared/diffCore'
import type { ClipOffer } from '../../shared/clipboardCore'
import { clearOffer, textHash, useClipboardOn, useClipOffer } from './clipboardOffer'
import { CopyButton, MdBody } from './MdBody'
import { ModelEffort, ModePicker } from './ThreadStatus'
import { dismissGoal, useThreadStatus } from './statusStore'
import { SummaryRow, WarningRow } from './ChatRows'
import { useSlashMenu } from './SlashMenu'
import { useMentionMenu } from './MentionMenu'
import { mentionText } from '../../shared/mentionCore'
import { hasUltrathink, ultrathinkParts } from '../../shared/composerCore'
import { Icon, Modal, useEscape } from './ui'
import { conversationMarkdown } from '../../shared/exportCore'
import { AskCard } from './AskCard'
import { PlanCard } from './PlanCard'
import { nextMode } from '../../shared/planCore'
import { PATH_MIME } from './FileTree'
import { wakeLabel, CONTINUE_PROMPT } from '../../shared/continueCore'
import { sinceSummary, toolVerb, toolResult, errorLine, exitOnly, historyStep, promptHistory, imageTag, dropImageTag } from './conversationCore'
import { State, Btn, Pins, clock } from './kit'
import { untilText } from '../../shared/cronCore'
import { RunningBar } from './RunningBar'
import { needsNote } from './background'
import { ComingBar } from './ComingBar'
import { threadPrs } from '../../shared/prLinkCore'
import { prChecksSeen, useStore } from './store'

export type Attachment = { url: string; mediaType: string; data: string }
export type SendMode = 'steer' | 'queue' | 'interrupt'
export type PanelTab = 'changes' | 'activity' | 'rewind'
// Tab queues only while Claude works: an idle thread's queued message is an ordinary send, so there Tab just moves the focus
export const tabQueues = (e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }, busy: boolean, hasDraft: boolean) =>
  busy && hasDraft && e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey
// a steered message Claude has not taken in yet (no echo of it so far)
export const unreadSteer = (it: Item) => it.kind === 'user' && !!it.steer && !!it.uuid && !it.seen && !it.queue?.pending && !it.failed
// Ctrl+Shift+Enter with an empty box sends what waits (queued, or steered and not read) now: only while Claude works
// and something of yours waits; with a draft it stops Claude and sends the draft, as before
export const sendsWaiting = (busy: boolean, hasDraft: boolean, items: Item[]) =>
  busy && !hasDraft && items.some((it) => it.kind === 'user' && (!!it.queue?.pending || unreadSteer(it)))

const attachmentOf = (url: string): Attachment => ({ url, mediaType: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) })

// unsent text and images per thread (a saved thread's text is also kept across a restart, by session id)
const drafts = new Map<string, { text: string; images: Attachment[] }>(Object.entries(savedDrafts()).map(([id, text]) => [id, { text, images: [] }]))
// fill a thread's message box without sending (Diagnose, a to-do's Talk about)
export const prefillDraft = (id: string, text: string) => { drafts.set(id, { text, images: [] }) }
export const draftEmpty = (id: string) => { const d = drafts.get(id); return !d || (!d.text.trim() && !d.images.length) }
// where each thread was scrolled to; "bottom" keeps following new messages
const scrolls = new Map<string, { top: number; bottom: boolean }>()
// "since you looked": how many items a thread had, and when, the last time it was on screen and focused
const looked = new Map<string, { n: number; at: number }>()
// text into a thread's message box at the cursor (the terminal's Send to chat, a slash command from the palette)
const inserters = new Map<string, (text: string) => void>()
export function insertIntoComposer(id: string, text: string) {
  const f = inserters.get(id)
  if (f) { f(text); return }
  const d = drafts.get(id) ?? { text: '', images: [] }
  drafts.set(id, { ...d, text: d.text ? `${d.text}\n${text}` : text })
}
// facts pinned to a thread's header; kept by session id (or tab id before it has one)
type PinMap = Record<string, string[]>
const pinsOf = (key: string): string[] => getPref<PinMap>('pins', {})[key] ?? []
const setPins = (key: string, list: string[]) => { const all = { ...getPref<PinMap>('pins', {}) }; if (list.length) all[key] = list; else delete all[key]; setPref('pins', all) }

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { const url = String(r.result); resolve({ url, mediaType: file.type, data: url.slice(url.indexOf(',') + 1) }) }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function ShowCard({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const name = path.split(/[\\/]/).at(-1)
  const url = usePreviewUrl(path)
  return kindOf(path) === 'image' ? (
    <button className="shown-img" onClick={() => onOpen(path)} title={path} data-testid="chat-shown-image">
      {url ? <img src={url} alt={name} /> : <span className="dimt">Loading image</span>}
    </button>
  ) : (
    <button className="shown-card" onClick={() => onOpen(path)} title={path} data-testid="chat-shown-file">
      <span className="kind-word">{kindOf(path)}</span><span className="hi">{name}</span><span className="dimt">Open</span>
    </button>
  )
}

// the clipboard suggestion above the input: click to paste it, Dismiss to drop it
function ClipChip({ offer, onPaste, onDismiss }: { offer: ClipOffer; onPaste: () => void; onDismiss: () => void }) {
  const label = offer.kind === 'image' ? 'Screenshot on the clipboard' : offer.big ? `Copied text, ${offer.length.toLocaleString()} characters` : 'Copied text'
  return (
    <div className="clipline">
      {offer.kind === 'image' && <img src={offer.thumb} alt="" />}
      <span className="dimt">{label}</span>
      {offer.kind !== 'image' && !offer.big && <span className="clip-text">{offer.preview}</span>}
      <Btn kind="quiet" onClick={onPaste} testid="composer-clip-paste">Paste</Btn>
      <Btn kind="link" onClick={onDismiss} testid="composer-clip-dismiss" title="Dismiss clipboard suggestion">Dismiss</Btn>
    </div>
  )
}

// a Codex run: a tool row that opens to the task, live steps and answer
function CodexBox({ it }: { it: Extract<Item, { kind: 'codex' }> }) {
  const [open, setOpen] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [it.lines.length])
  const first = it.task.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const last = [...it.lines].reverse().find(Boolean)
  const w = it.status === 'running' ? <State word="WORKING" tone="work" /> : it.status === 'error' ? <State word="FAILED" tone="fail" /> : <State word="DONE" tone="done" />
  return (
    <div className="toolbox">
      <button className="trow" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="codex-steps">
        <span className="tv t-agent">Codex</span><span className="tp">{first}</span>
        <span className="tr">{it.status === 'running' && last && !open ? <span className="dimt">{last.slice(0, 50)} </span> : null}{w}</span>
      </button>
      {open && (
        <div className="toolout">
          <div className="log">{it.task}{it.model ? `\n\nModel: ${it.model}` : ''}{it.allowEdits ? '\nCan edit files' : '\nRead-only'}</div>
          {it.lines.length > 0 && <div className="log" ref={log}>{it.lines.join('\n')}</div>}
          {it.answer && <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{it.answer}</Markdown></div>}
        </div>
      )}
    </div>
  )
}

// an agent's file change, worked out once per tool item
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

// the first lines of a change, under its row
function InlineDiff({ hunks, label, onOpen }: { hunks: Hunk[]; label: string; onOpen: () => void }) {
  const lines = hunks.flatMap((h) => h.lines.map((l, i) => ({ l, k: `${h.a}:${h.b}:${i}` }))).slice(0, 14)
  const c = counts(hunks)
  return (
    <div className="idiff" data-testid="inline-diff">
      <div className="idiff-h"><span>{label}</span><span><span className="add-t">+{c.add}</span> <span className="del-t">-{c.del}</span> <Btn kind="quiet" onClick={onOpen}>Open the diff</Btn></span></div>
      {lines.map(({ l, k }) => {
        const kind = l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''
        return <div key={k} className={`idl ${kind}`}><i>{l.a ?? ''}</i><i>{l.b ?? ''}</i><span>{l.text}</span></div>
      })}
    </div>
  )
}

// a tool call's row: verb, what it touched, result; a click opens it to the command and output (a failed one on its
// error lines, an edit on its first lines of diff). Every row rests closed, a failed one too: its line already says
// FAILED in the fail colour, and a long command with its output opening by itself pushed the conversation away.
// Open state lives here so opening does not rebuild the transcript.
function ToolRow({ it, status, bg, cwd, onDiff, onBackground }: { it: Extract<Item, { kind: 'tool' }>; status: string; bg?: string; cwd?: string; onDiff: (spec: import('./DiffPanel').DiffSpec) => void; onBackground: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const out = useRef<HTMLDivElement>(null)
  const v = toolVerb(it.name)
  const exit = exitOnly(it.name, status, it.output)
  const file = FILE_TOOLS.includes(it.name) && it.status !== 'error' && typeof it.input?.file_path === 'string' ? it.input.file_path as string : null
  const hunks = file ? hunksOf(it) : null
  const c = hunks ? counts(hunks) : null
  const label = file ? shortPath(file, cwd) : ''
  const line = toolLine(it.name, it.input)
  // a connector's tool says its own name in the row (the first word only names the connector)
  const what = it.name.startsWith('mcp__') ? [line.verb, line.what].filter(Boolean).join(': ') : line.what
  const cmd = (it.name === 'Bash' || it.name === 'PowerShell') && typeof it.input?.command === 'string' ? it.input.command as string : ''
  const path = file ? label : typeof it.input?.file_path === 'string' ? shortPath(it.input.file_path, cwd) : cmd || what || (typeof it.input?.pattern === 'string' ? it.input.pattern : '')
  const can = it.output !== undefined || !!hunks?.length
  const spec = file && hunks ? { t: 'edit' as const, file, label, tool: it.name, hunks } : null
  useEffect(() => {
    if (!open || status !== 'error' || !out.current || !it.output) return
    const at = errorLine(it.output)
    out.current.scrollTop = Math.max(0, at - 1) * 18
  }, [open, status, it.output])
  const result = bg === 'running' ? <><span className="dimt">background </span><State word="WORKING" tone="work" /></>
    : status === 'running' ? <State word="WORKING" tone="work" />
      : exit !== null ? <State word={`exit ${exit}`} tone="idle" title="The command ended with this exit code. Its output is in the row" testid="tool-exit" />
      : status === 'error' ? <State word="FAILED" tone="fail" />
        : c ? <><span className="add-t">+{c.add}</span> <span className="del-t">-{c.del}</span></>
          : v.tone === 'agent' ? <State word="DONE" tone="done" />
            : toolResult(it)
  return (
    <div className={`toolbox${open ? ' open' : ''}`}>
      <div className={`trow${status === 'error' && exit === null ? ' failed' : ''}${can ? ' can' : ''}`} role={can ? 'button' : undefined} tabIndex={can ? 0 : undefined} aria-expanded={can ? open : undefined}
        onClick={can ? () => setOpen((o) => !o) : undefined} onKeyDown={can ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } } : undefined}
        data-testid={spec ? 'chat-diff-row' : 'tool-row'}>
        <span className={`tv t-${v.tone}`}>{v.word}</span>
        <span className="tp" title={path}>{path}</span>
        <span className="tr">
          {status === 'running' && !bg && <Btn kind="link" onClick={(e) => { e.stopPropagation(); onBackground(it.id) }} testid="tool-background" title="Move to the background (Ctrl+B for all)">Background</Btn>}
          {result}
        </span>
        {can && <span className="tchev" data-testid="tool-output-toggle" aria-hidden />}
      </div>
      {open && (
        <div className="toolout">
          {spec && hunks && <InlineDiff hunks={hunks} label={label} onOpen={() => onDiff(spec)} />}
          {(!spec || status === 'error') && <>
            <CopyButton className="toolcopy" title="Copy the command and output" onCopy={() => navigator.clipboard.writeText([cmd && `$ ${cmd}`, it.output || '(no output)'].filter(Boolean).join('\n\n'))} />
            {cmd && <div className="log tool-cmd" data-testid="tool-output-command">{cmd}</div>}
            <div className="log tool-out" ref={out} data-testid="tool-output">{it.output || '(no output)'}</div>
          </>}
        </div>
      )}
    </div>
  )
}

// A run of tool calls rests as one dim line ("6 steps: Read, Grep, 2 Edit, Write, Bash") that opens on click; a failed
// step stays in view under it
// hook: a note a hook printed after a tool call (a linter's findings), folded into the run with the call it is about
type RunStep = { key: string; word: string; failed: boolean; running: boolean; node: ReactNode; item?: Extract<Item, { kind: 'tool' }>; hook?: boolean }
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SEARCHES = new Set(['Grep', 'Glob', 'WebSearch', 'ToolSearch'])
const READS = new Set(['Read', 'WebFetch', 'LS'])
const COMMANDS = new Set(['Bash', 'PowerShell', 'BashOutput'])
const AGENTS = new Set(['Agent', 'Task'])
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
// "7 steps, 3 edits +58 -8, 1 search, 2 reads, 1 agent, running": what a run of tool calls did, in one line
function runSummary(steps: RunStep[]): ReactNode {
  const by = (set: Set<string>) => steps.filter((s) => s.item && set.has(s.item.name))
  const edits = by(EDITS)
  const lines = edits.reduce((t, s) => { const c = counts(hunksOf(s.item!)); return { add: t.add + c.add, del: t.del + c.del } }, { add: 0, del: 0 })
  const searches = by(SEARCHES).length, reads = by(READS).length, cmds = by(COMMANDS).length, agents = by(AGENTS).length
  const notes = steps.filter((s) => s.hook).length
  const codex = steps.filter((s) => !s.item && !s.hook).length
  const failed = steps.filter((s) => s.failed).length
  return <>
    <b>{n(steps.length - notes, 'step', 'steps')}</b>
    {edits.length > 0 && <span>{n(edits.length, 'edit', 'edits')}</span>}
    {(lines.add > 0 || lines.del > 0) && <><span className="add-t">+{lines.add}</span><span className="del-t">{'−'}{lines.del}</span></>}
    {searches > 0 && <span>{n(searches, 'search', 'searches')}</span>}
    {reads > 0 && <span>{n(reads, 'read', 'reads')}</span>}
    {cmds > 0 && <span>{n(cmds, 'command', 'commands')}</span>}
    {agents > 0 && <span>{n(agents, 'agent', 'agents')}</span>}
    {codex > 0 && <span>{n(codex, 'Codex run', 'Codex runs')}</span>}
    {notes > 0 && <span>{n(notes, 'hook note', 'hook notes')}</span>}
    {failed > 0 && <span className="s-fail">{failed} failed</span>}
    {steps.some((s) => s.running) && <span>running</span>}
  </>
}
function ToolRun({ steps }: { steps: RunStep[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tools">
      <button className="trun" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Hide the steps' : 'Show the steps'} data-testid="tool-run">
        {runSummary(steps)}
      </button>
      {open ? steps.map((s) => s.node) : steps.filter((s) => s.failed).map((s) => s.node)}
    </div>
  )
}

// Ctrl+F in the focused pane: Enter next, Shift+Enter previous, Esc closes
function FindBar({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [res, setRes] = useState({ active: 0, total: 0 })
  // the window's find moves the focus to the match: it comes back here so typing goes on
  const field = useRef<HTMLInputElement>(null)
  const keep = () => requestAnimationFrame(() => field.current?.focus())
  useEffect(() => { const off = window.api.onFindResult((r) => { setRes(r); keep() }); return () => { off(); void window.api.findStop() } }, [])
  const go = (forward: boolean, next: boolean) => { void window.api.findRun(text, forward, next).then(keep) }
  return (
    <div className="findbar" data-testid="findbar">
      <input ref={field} className="uline" autoFocus placeholder="Find in this conversation" value={text} data-testid="findbar-input"
        onChange={(e) => { setText(e.target.value); setRes({ active: 0, total: 0 }); void window.api.findRun(e.target.value, true, false).then(keep) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(!e.shiftKey, true) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        }} />
      <span className="dimt num" data-testid="findbar-count">{text ? `${res.active} of ${res.total}` : ''}</span>
      <Btn kind="link" onClick={() => go(false, true)} disabled={!res.total} testid="findbar-prev" title="Previous (Shift+Enter)">Previous</Btn>
      <Btn kind="link" onClick={() => go(true, true)} disabled={!res.total} testid="findbar-next" title="Next (Enter)">Next</Btn>
      <Btn kind="link" onClick={onClose} testid="findbar-close" title="Close (Esc)">Close</Btn>
    </div>
  )
}

const replyTime = (at: number): string => {
  const d = new Date(at)
  return d.toDateString() === new Date().toDateString() ? clock(d) : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock(d)}`
}
type UserItem = Extract<Item, { kind: 'user' }>
type Rewind = { it: UserItem; index: number; preview: RewindFiles | null; error?: string; working?: boolean; partial?: { missing: string[]; skipped: number } }

function RewindModal({ r, onFiles, onChat, onClose }: { r: Rewind; onFiles: () => void; onChat: () => void; onClose: () => void }) {
  const p = r.preview
  const files = p?.canRewind ? p.filesChanged ?? [] : []
  return (
    <Modal title="Rewind to this message" onClose={onClose} testid="rewind">
      <div className="rewind-body">
        <p className="dimt">The conversation goes back to just before this message, and its text returns to the message box to change and send again. The old conversation is kept in the thread list.</p>
        {!p && !r.error && <p className="dimt">Checking which files changed since.</p>}
        {p && files.length > 0 && <>
          <p>Files Claude changed since then, put back as they were: <span className="add-t">+{p.insertions ?? 0}</span> <span className="del-t">-{p.deletions ?? 0}</span></p>
          <ul className="rewind-files" data-testid="rewind-files">{files.map((f) => <li key={f}>{f}</li>)}</ul>
        </>}
        {p && p.canRewind && !files.length && <p className="dimt">No files changed since this message.</p>}
        {p && !p.canRewind && <p className="s-wait">Files cannot be put back{p.error ? `: ${p.error}` : ''}. Only the conversation can be rewound.</p>}
        {r.error && <p className="s-fail" data-testid="rewind-error">{r.error}</p>}
        {r.partial && <div data-testid="rewind-partial">
          <p className="s-wait">Not every file was put back{r.partial.skipped ? ` (${r.partial.skipped} skipped: a link or a moved folder)` : ''}. The conversation was left as it is.</p>
          {r.partial.missing.length > 0 && <><p className="dimt">Still as Claude left them:</p><ul className="rewind-files">{r.partial.missing.map((f) => <li key={f}>{f}</li>)}</ul></>}
        </div>}
        <div className="rewind-acts">
          {files.length > 0 && !r.partial && <Btn kind="primary" disabled={r.working} onClick={onFiles} testid="rewind-files-chat">Rewind files and conversation</Btn>}
          <Btn kind="plain" disabled={r.working || (!p && !r.error)} onClick={onChat} testid="rewind-chat">{r.partial ? 'Rewind conversation anyway' : 'Rewind conversation only'}</Btn>
          <Btn kind="plain" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  )
}

const WINDOW = 150
// background tool calls' tasks that ended (tool use id -> state), kept for the app's life
const bgEnded = new Map<string, import('../../shared/taskCore').Task['status']>()

export type ThreadCallbacks = {
  onSend: (text: string, images: Attachment[], mode?: SendMode) => void
  onDequeue: (queueId: string) => Promise<boolean>
  onPromote: (queueId: string) => void
  onSendNow: (id?: string) => void // a queued message's id, an unread steered one's uuid, or everything waiting
  onStop: () => void
  onBackground: (toolUseId?: string) => void
  onRunInBackground: () => void
  onOpen: (pathOrDataUrl: string) => void
  onDiff: (spec: import('./DiffPanel').DiffSpec) => void
  onTerminal: () => void
  onPanel: (tab: PanelTab) => void // Changes, Activity, Rewind: open the detail panel on that tab, or close it
  onSplit?: () => void
  onLoadEarlier: () => void
  onRewound: (index: number) => void
  onStatusView: () => void // /status and /usage typed in the box open the Status and usage page
  onScheduled: () => void // the Scheduled page, from the header's coming-up list
}
type Props = ThreadCallbacks & { session: Session; mode: string; focused: boolean; banner?: ReactNode; panel?: PanelTab | null }
// the header buttons that open the detail panel; in a narrow pane they rest as icons (conversation.css)
const PANEL_ACTS: { tab: PanelTab; label: string; icon: string; title: string }[] = [
  { tab: 'changes', label: 'Changes', icon: 'diff', title: 'Changed files, beside the conversation' },
  { tab: 'activity', label: 'Activity', icon: 'pulse', title: 'What runs for this thread: subagents, shells, workflows' },
  { tab: 'rewind', label: 'Rewind', icon: 'history', title: 'Go back to an earlier message' },
]

// the conversation, built only when it changes: typing in the box re-renders the view on every key
const Transcript = memo(function Transcript({ session, limit, setLimit, st, startRewind }: {
  session: Session; limit: number; setLimit: (f: (n: number) => number) => void
  st: { loadEarlier: () => void; open: (p: string) => void; diff: ThreadCallbacks['onDiff']; background: (id: string) => void; sendNow: (id: string) => void }
  startRewind: (it: UserItem, i: number) => void
}) {
  const tasks = useThreadStatus(session.id).tasks
  const bgOf = useMemo(() => {
    for (const t of tasks) if (t.toolUseId && t.backgrounded && t.status !== 'running') bgEnded.set(t.toolUseId, t.status)
    const now = new Map(tasks.filter((t) => t.toolUseId && t.backgrounded).map((t) => [t.toolUseId!, t.status]))
    return new Map([...bgEnded, ...now])
  }, [tasks])
  // the repo of the last pull request this thread opened: a bare #123 in a reply links to it
  const repo = useMemo(() => threadPrs(session.items).at(-1)?.repo, [session.items])
  const base = session.history?.count ?? 0
  const used = new Set<string>()
  const keyOf = (it: Item, i: number): string => {
    const k = it.kind === 'user' && it.uuid ? `u:${it.uuid}` : it.kind === 'tool' ? `t:${it.id}` : it.kind === 'codex' ? `c:${it.id}` : `${it.kind}:${i - base}`
    const key = used.has(k) ? `${k}:${i - base}` : k
    used.add(key)
    return key
  }
  // runs of tool rows share one block; queued messages wait in the queue box, not here
  const out: ReactNode[] = []
  let tools: RunStep[] = []
  const flush = () => {
    if (!tools.length) return
    out.push(tools.length === 1 ? <div key={`tools:${tools[0].key}`} className="tools">{tools[0].node}</div> : <ToolRun key={`run:${tools[0].key}`} steps={tools} />)
    tools = []
  }
  session.items.forEach((it, i) => {
    if (i < session.items.length - limit) return
    const key = keyOf(it, i)
    if (it.kind === 'tool' && it.name !== SHOW && it.name !== CODEX && it.name !== 'AskUserQuestion' && it.name !== 'ExitPlanMode') {
      const bg = bgOf.get(it.id)
      const status = bg === 'running' ? 'running' : bg === 'failed' ? 'error' : it.status
      tools.push({ key, item: it, word: toolVerb(it.name).word, failed: status === 'error' && exitOnly(it.name, status, it.output) === null, running: status === 'running', node:<ToolRow key={key} it={it} status={status} bg={bg} cwd={session.cwd} onDiff={st.diff} onBackground={st.background} /> })
      return
    }
    // a note a hook printed after a tool call goes with that call, inside the run (open it to read); a hook that blocks
    // a call (PreToolUse) stays in view
    if (it.kind === 'warning' && it.event === 'PostToolUse' && tools.length) { tools.push({ key, word: 'hook', failed: false, running: false, hook: true, node: <WarningRow key={key} event={it.event} text={it.text} /> }); return }
    if (it.kind === 'codex') { tools.push({ key, word: 'Codex', failed: it.status === 'error', running: it.status === 'running', node: <CodexBox key={key} it={it} /> }); return }
    flush()
    if (it.kind === 'user') {
      if (it.queue?.pending) return
      out.push(
        <div key={key} className={`msg you${it.steer ? ' steer' : ''}`} title={it.steer && it.during ? `Steered while Claude was on: ${it.during}` : undefined} data-testid="msg-user">
          {/* seen: Claude took the message in (at once for a normal send, at its next step for a steered one) */}
          {it.images.length > 0 && <div className="imgs">{it.images.map((src, j) => <button key={j} className="thumb" onClick={() => st.open(src)} data-testid="chat-image"><img src={src} alt="" /></button>)}</div>}
          {it.text && <div className="body">{it.text}</div>}
          {it.seen ? <span className="seen" title="Claude has read this message" data-testid="msg-seen">Seen by Claude{it.seenAt ? ` ${clock(it.seenAt)}` : ''}</span>
            : it.steer && it.uuid && session.busy && <span className="seen" title="Claude reads it at its next step, when the running tool call ends" data-testid="msg-unseen">Not read yet{unreadSteer(it) && <Btn kind="link" onClick={() => st.sendNow(it.uuid!)} testid="msg-send-now" title="Stops the tool call Claude is in the middle of, so it reads this message now">Send now</Btn>}</span>}
          {it.failed && <span className="seen s-fail" title={it.failed} data-testid="msg-failed">Not sent: {it.failed}</span>}
          {it.uuid && session.sessionId && !session.busy && !it.steer && (
            <button className="rewindb" onClick={() => startRewind(it, i)} title="Go back to before this message: put back the files Claude changed since, and edit the message" data-testid="msg-rewind">Rewind</button>
          )}
        </div>,
      )
      return
    }
    // the time Claude wrote it, small under the reply (a day and the time once it is not today)
    if (it.kind === 'assistant') { out.push(<div key={key} className="msg cl" data-testid="msg-assistant"><MdBody text={it.text} repo={repo} />{it.at ? <span className="msg-at" title={new Date(it.at).toLocaleString()} data-testid="msg-time">{replyTime(it.at)}</span> : null}</div>); return }
    if (it.kind === 'tool' && it.name === 'AskUserQuestion') { out.push(<div key={key} className="qwrap"><AskCard tabId={session.id} id={it.id} input={it.input} open={!!session.asks?.includes(it.id)} result={it.output} /></div>); return }
    if (it.kind === 'tool' && it.name === 'ExitPlanMode') { out.push(<div key={key} className="qwrap"><PlanCard tabId={session.id} id={it.id} input={it.input} open={!!session.asks?.includes(it.id)} status={it.status} repo={repo} /></div>); return }
    if (it.kind === 'show') { out.push(<div key={key} className="msg"><ShowCard path={it.path} onOpen={st.open} /></div>); return }
    if (it.kind === 'note') { out.push(<div key={key} className="note">{it.text}</div>); return }
    if (it.kind === 'summary') { out.push(<SummaryRow key={key} text={it.text} />); return }
    if (it.kind === 'warning') { out.push(<WarningRow key={key} event={it.event} text={it.text} />); return }
    if (it.kind === 'thread') {
      if (it.queue?.pending) return
      out.push(
        <div key={key} className="msg you from" data-testid="msg-thread">
          <div className="msg-note">From thread {it.fromTitle}{it.steer ? ', steered while Claude worked' : ''}</div>
          <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown></div>
        </div>,
      )
      return
    }
    if (it.kind === 'agent') { out.push(<div key={key} className="msg cl from"><div className="msg-note">{it.from}</div><MdBody text={it.text} repo={repo} /></div>); return }
    if (it.kind === 'error') { out.push(<div key={key} className="msg err" data-testid="msg-error"><span>Failed: {it.text}</span></div>) }
  })
  flush()
  return (
    <>
      {!session.loaded && <div className="note">Loading the conversation</div>}
      {session.loaded && !session.items.length && !session.streaming && <div className="note">New thread in {session.cwd || 'the workspace'}. Type below; drop or paste images.</div>}
      {(session.items.length > limit || session.history?.more) && (
        <button className="earlier" data-testid="chat-earlier" onClick={() => { if (session.items.length > limit) setLimit((n) => n + WINDOW); else st.loadEarlier() }}>
          {session.items.length > limit ? `Show ${Math.min(WINDOW, session.items.length - limit)} earlier` : 'Load the earlier conversation'}
        </button>
      )}
      {out}
    </>
  )
}, (a, b) => a.session.items === b.session.items && a.session.loaded === b.session.loaded && a.session.busy === b.session.busy && a.session.asks === b.session.asks
  && a.session.history === b.session.history && a.session.sessionId === b.session.sessionId && a.session.cwd === b.session.cwd && !!a.session.streaming === !!b.session.streaming
  && a.limit === b.limit && a.st === b.st && a.startRewind === b.startRewind)

export function SessionView(p: Props) {
  const { session, mode, focused, banner } = p
  const [limit, setLimit] = useState(WINDOW)
  const latest = useRef(p)
  latest.current = p
  const st = useMemo(() => ({
    loadEarlier: () => latest.current.onLoadEarlier(),
    open: (x: string) => latest.current.onOpen(x),
    diff: (x: import('./DiffPanel').DiffSpec) => latest.current.onDiff(x),
    background: (id: string) => latest.current.onBackground(id),
    sendNow: (id: string) => latest.current.onSendNow(id),
  }), [])
  const status = useThreadStatus(session.id)
  // after a usage limit: when this thread continues by itself
  const [wakeAt, setWakeAt] = useState<number | null>(null)
  // its two actions, for the line under the header and the header's coming-up list (kept stable: that list is memoised)
  const wakeActs = useMemo(() => {
    const cancel = () => { const s = latest.current.session; return window.api.chatCancelContinue(s.sessionId ?? s.id).then(() => setWakeAt(null)) }
    return { cancel, resume: () => cancel().then(() => latest.current.onSend(CONTINUE_PROMPT, [])), scheduled: () => latest.current.onScheduled() }
  }, [])
  useEffect(() => {
    let on = true
    window.api.chatContinueAt(session.sessionId ?? session.id).then((at) => { if (on) setWakeAt(at) }).catch(() => {})
    return () => { on = false }
  }, [session.id, session.sessionId, session.continueRev])
  const restored = useRef(!!drafts.get(session.id)?.text?.trim())
  const [draft, setDraft] = useState(() => drafts.get(session.id)?.text ?? '')
  const [images, setImages] = useState<Attachment[]>(() => drafts.get(session.id)?.images ?? [])
  useEffect(() => {
    drafts.set(session.id, { text: draft, images })
    if (session.sessionId) saveDraft(session.sessionId, draft)
    if (!draft.trim()) restored.current = false
  }, [session.id, session.sessionId, draft, images])
  const thread = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const slash = useSlashMenu(session.id, draft, setDraft)
  const mention = useMentionMenu(session.cwd ?? '', draft, caret, box, setDraft)
  const ultra = hasUltrathink(draft)
  const mirror = useRef<HTMLDivElement>(null)

  // "since you looked": what happened since this thread was last on screen and focused
  const [since] = useState(() => looked.get(session.id) ?? null)
  const itemsRef = useRef(session.items)
  itemsRef.current = session.items
  useEffect(() => {
    if (!focused) return
    const mark = () => { looked.set(session.id, { n: itemsRef.current.length, at: Date.now() }) }
    mark()
    return mark
  }, [focused, session.id])
  const sinceLine = since ? sinceSummary(session.items, since.n, session.busy, workingOn(session.items)) : ''

  // Export: the conversation as Markdown, to the clipboard or a file (earlier history loaded first)
  const exportAs = useCallback(async (to: 'copy' | 'save') => {
    let items = session.items
    if (session.path && session.history?.more) items = await window.api.loadHistory(session.path).then((h) => [...h, ...session.items.slice(session.history!.count)]).catch(() => items)
    const md = conversationMarkdown(session.title, items, (n, i) => { const t = toolLine(n, i); return `${n}: ${t.what || t.verb}` }, items === session.items && !!session.history?.more)
    if (to === 'copy') await navigator.clipboard.writeText(md)
    else await window.api.saveMarkdown(session.title, md)
  }, [session.items, session.path, session.history, session.title])
  useEffect(() => {
    const f = (e: Event) => { if ((e as CustomEvent).detail === session.id) void exportAs('save') }
    window.addEventListener('hive:export', f)
    return () => window.removeEventListener('hive:export', f)
  }, [session.id, exportAs])
  const [menu, setMenu] = useState(false)
  useEscape(() => setMenu(false), menu)

  // /btw answers, above the queue box until dismissed (never part of the conversation)
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
  const onScroll = () => { const el = thread.current; if (el) scrolls.set(session.id, { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 }) }

  // keys of the focused pane: Ctrl+Down to the end, Ctrl+F find, Ctrl+B background what runs
  const [finding, setFinding] = useState(false)
  useEffect(() => {
    if (!focused) { setFinding(false); return }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || (document.activeElement as HTMLElement | null)?.closest('.xterm, .monaco-editor')) return
      const k = e.key.toLowerCase()
      if (!e.shiftKey && e.key === 'ArrowDown') { const el = thread.current; if (!el) return; e.preventDefault(); el.scrollTop = el.scrollHeight; scrolls.set(session.id, { top: el.scrollTop, bottom: true }) }
      else if (!e.shiftKey && k === 'f') { e.preventDefault(); setFinding(true) }
      else if (!e.shiftKey && k === 'b' && latest.current.session.busy) { e.preventDefault(); latest.current.onBackground() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, session.id])
  // the focused pane takes the keyboard when it becomes focused
  useEffect(() => { if (focused) box.current?.focus({ preventScroll: true }) }, [focused])

  const imageCount = useRef(0) // pictures attached so far, known at once (the state lags by a render)
  imageCount.current = images.length
  const removeImage = (j: number) => { setImages(images.filter((_, k) => k !== j)); setDraft((d) => dropImageTag(d, j + 1)) }
  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length) {
      const read = await Promise.all(imgs.map(readImage))
      const first = imageCount.current + 1
      imageCount.current += read.length
      setImages((cur) => [...cur, ...read])
      // each picture is named in the text at the cursor, so the message can say which one it means
      insertText(read.map((_im, i) => `${imageTag(first + i)} `).join(''))
    }
    // Claude reads other files by path, so the path in the text is enough
    const paths = files.filter((f) => !f.type.startsWith('image/')).map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    insertText(paths.map(mentionText).join(''))
  }
  const insertText = (text: string) => {
    const el = box.current
    if (!el) { setDraft((d) => d + text); return }
    el.focus()
    if (!document.execCommand('insertText', false, text)) { const [a, b] = [el.selectionStart, el.selectionEnd]; setDraft((d) => d.slice(0, a) + text + d.slice(b)) }
  }
  const onPaste = (e: ClipboardEvent) => {
    if (clip) dismissClip()
    const files = [...e.clipboardData.files]
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addFiles(files) }
  }
  const onDrop = (e: DragEvent) => {
    // a row from the Files tree: its path goes in at the cursor, the way a file dropped from Explorer does
    const dragged = e.dataTransfer.getData(PATH_MIME)
    if (dragged) { e.preventDefault(); e.stopPropagation(); insertText(mentionText(dragged)); return }
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault(); e.stopPropagation(); void addFiles([...e.dataTransfer.files])
  }

  // the clipboard suggestion: only in the focused pane, and not when the box already holds exactly that text
  const clipOn = useClipboardOn()
  const clip = useClipOffer()
  const [sameAsBox, setSameAsBox] = useState(false)
  useEffect(() => {
    if (clip?.kind !== 'text' || draft.length !== clip.length) { setSameAsBox(false); return }
    let alive = true
    void textHash(draft).then((h) => { if (alive) setSameAsBox(h === clip.id) })
    return () => { alive = false }
  }, [clip, draft])
  const shownClip = focused && clipOn && clip && !sameAsBox ? clip : null
  const hist = useRef({ at: -1, own: '' }) // where Up / Down stand in this thread's earlier prompts
  const dismissClip = () => { if (clip) void window.api.clipboardDismiss(clip.id); clearOffer() }
  // Copied text short enough to show is offered inside an empty box, as its placeholder: Tab puts it in. A screenshot
  // or a long text cannot be shown that way, so those keep the line above the box.
  const clipHint = shownClip && shownClip.kind === 'text' && !shownClip.big && !draft && !images.length ? shownClip : null
  const clipChip = shownClip && (shownClip.kind === 'image' || shownClip.big) ? shownClip : null
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
    insertText(got.text)
  }

  // the queue: messages waiting for this turn to end; Edit takes one back into the box, Edit all takes every one
  const queued = session.items.filter((it): it is UserItem => it.kind === 'user' && !!it.queue?.pending)
  const queuedThreads = session.items.filter((it) => it.kind === 'thread' && it.queue?.pending) as Extract<Item, { kind: 'thread' }>[]
  const editQueued = useCallback(async (it: UserItem) => {
    if (!it.queue || !(await latest.current.onDequeue(it.queue.id))) return
    setDraft((d) => (d.trim() ? `${d}\n${it.text}` : it.text))
    setImages((cur) => [...cur, ...it.images.map(attachmentOf)])
  }, [])
  const editAll = async () => { for (const it of queued) await editQueued(it) }

  // Rewind: a dry run first, so the confirm can list the files that would be put back
  const [rewind, setRewind] = useState<Rewind | null>(null)
  const startRewind = useCallback((it: UserItem, index: number) => {
    if (!it.uuid || !session.sessionId) return
    setRewind({ it, index, preview: null })
    window.api.chatRewindPreview(session.id, session.cwd ?? '', session.sessionId, it.uuid)
      .then((preview) => setRewind((cur) => (cur?.it === it ? { ...cur, preview } : cur)))
      .catch((e) => setRewind((cur) => (cur?.it === it ? { ...cur, preview: { canRewind: false, error: String(e?.message ?? e) } } : cur)))
  }, [session.id, session.cwd, session.sessionId])
  // Rewind asked for from the right-hand panel: the same confirm as the button on the message
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent).detail as { tab?: string; uuid?: string } | undefined
      if (d?.tab !== session.id) return
      const i = session.items.findIndex((it) => it.kind === 'user' && it.uuid === d.uuid)
      const it = session.items[i]
      if (it?.kind === 'user') startRewind(it, i)
    }
    window.addEventListener('hive:rewind', f)
    return () => window.removeEventListener('hive:rewind', f)
  }, [session.id, session.items, startRewind])
  const doRewind = async (files: boolean) => {
    const r = rewind
    if (!r?.it.uuid || !session.sessionId) return
    setRewind({ ...r, working: true, error: undefined })
    try {
      const listed = files && r.preview?.canRewind ? r.preview.filesChanged ?? [] : null
      const done = await window.api.chatRewindApply(session.id, session.cwd ?? '', session.sessionId, r.it.uuid, listed)
      if (done.partial) { setRewind({ ...r, working: false, partial: done.partial }); return }
      if (!done.ok) { setRewind({ ...r, working: false, error: done.error ?? 'The conversation could not be rewound.' }); return }
      p.onRewound(r.index)
      setDraft(r.it.text)
      setImages(r.it.images.map(attachmentOf))
      setRewind(null)
      box.current?.focus()
    } catch (e: any) {
      setRewind({ ...r, working: false, error: String(e?.message ?? e) })
    }
  }

  const submit = (m: SendMode = 'steer') => {
    if (!draft.trim() && !images.length) return
    const btw = draft.trim().match(/^\/btw\s+([\s\S]+)/)
    if (btw) { askBtw(btw[1]); setDraft(''); return }
    // /status, /usage, /cost and /stats print a screen in the terminal: here they open the Status and usage page
    if (/^\/(status|usage|cost|stats)$/.test(draft.trim()) && !images.length) { p.onStatusView(); setDraft(''); return }
    p.onSend(draft.trim(), images, m)
    setDraft('')
    setImages([])
    scrolls.set(session.id, { top: 0, bottom: true })
  }
  // Enter steers (or sends), Tab queues while Claude works, Ctrl+Enter sends and moves the thread to the background,
  // Ctrl+Shift+Enter stops Claude and sends this at once (an empty box: what already waits goes now), Shift+Enter a
  // new line, Esc stops the turn (the queue holds)
  const flushes = sendsWaiting(session.busy, !!draft.trim() || images.length > 0, session.items)
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.onKey(e)) return
    if (mention.onKey(e)) return
    // Up / Down: earlier prompts of this thread, starting from an empty box; what was being typed comes back at the end
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const past = promptHistory(session.items)
      const to = historyStep(e.key, hist.current.at, past.length, !draft)
      if (to !== null) {
        e.preventDefault()
        if (hist.current.at < 0) hist.current.own = draft
        hist.current.at = to
        setDraft(to < 0 ? hist.current.own : past[to])
        return
      }
    } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') hist.current.at = -1 // edited or sent: it is the box's own text now
    if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) { e.preventDefault(); if (flushes) p.onSendNow(); else submit('interrupt'); return }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); if (draft.trim() || images.length) submit(); p.onRunInBackground(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); submit('steer'); return }
    // Shift+Tab: the next permission mode, as in the terminal (Manual, Accept edits, Plan); the mode pill shows it
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); void window.api.chatSetMode(session.id, nextMode(shownMode)).catch(() => {}); return }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && clipHint) { e.preventDefault(); void pasteClip(); return }
    if (tabQueues(e, session.busy, !!draft.trim() || images.length > 0)) { e.preventDefault(); submit('queue'); return }
    if (e.key === 'Escape' && session.busy) { e.preventDefault(); p.onStop() }
  }

  // text from elsewhere (terminal, palette) into the box at the cursor, not sent
  useEffect(() => {
    const insert = (text: string) => {
      const el = box.current
      if (!el) { setDraft((d) => d + text); return }
      const before = el.value.slice(0, el.selectionStart)
      insertText(before && !before.endsWith('\n') && !text.startsWith('/') ? `\n${text}` : text)
    }
    inserters.set(session.id, insert)
    return () => { if (inserters.get(session.id) === insert) inserters.delete(session.id) }
  }, [session.id])

  // pinned facts: yours, the goal, and the worktree
  const pinKey = session.sessionId ?? session.id
  const [pins, setPinsState] = useState<string[]>(() => pinsOf(pinKey))
  useEffect(() => { setPinsState(pinsOf(pinKey)) }, [pinKey])
  const [pinning, setPinning] = useState<string | null>(null)
  const savePins = (list: string[]) => { setPinsState(list); setPins(pinKey, list) }
  const nowTick = status.goal?.status === 'active' ? Date.now() : 0
  const goal = status.goal
  const shownMode = session.mode ?? (session.background ? 'auto' : mode)
  const wt = session.worktrees?.at(-1)
  const folder = wt ? `${wt.repo} on ${wt.branch}` : (session.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  // the pull requests this thread opened: the latest on the header, the rest in its tooltip
  const prs = useMemo(() => threadPrs(session.items), [session.items])
  const pr = prs.at(-1)
  // its checks as the Changes panel last read them (only when that panel is about this same PR)
  const seen = useStore(prChecksSeen, (all) => all[session.id])
  const ci = seen && pr && seen.num === pr.num ? seen : null
  const running =session.items.filter((i) => i.kind === 'tool' && i.status === 'running').at(-1)
  const runningTasks = status.tasks.filter((t) => t.status === 'running').length
  const stopGoal = async () => { if (session.busy) { p.onStop(); p.onSend('/goal clear', [], 'queue') } else p.onSend('/goal clear', []) }
  const pinRows: [string, ReactNode][] = [
    ...pins.map((x, i): [string, ReactNode] => ['Pinned', <span key={i}>{x} <button className="pin-x" aria-label="Unpin" onClick={() => savePins(pins.filter((_, j) => j !== i))}>×</button></span>]),
  ]

  return (
    <main className={focused ? 'session focused' : 'session'} data-testid={`chat-${session.id}`}>
      <header className="phead">
        {/* what is coming up for the thread sits on the title's line, at the right */}
        <div className="phead-h">
          <h1 title={session.title}>{session.title}</h1>
          <span className="phead-r">
            {goal && (
              <span className={`goal-chip${goal.status === 'met' ? ' met' : ''}`} title={`Goal: ${goal.condition}`} data-testid="goal-chip">
                <b>Goal</b><span className="goal-t">{goal.condition}</span>
                <span className="goal-s">{goal.status === 'met' ? 'met' : untilText(nowTick - goal.setAt).replace(/ 0s$/, '')}</span>
                {goal.status === 'active'
                  ? <button className="pin-x" onClick={() => void stopGoal()} data-testid="goal-stop">Stop</button>
                  : <button className="pin-x" onClick={() => dismissGoal(session.id)} data-testid="goal-dismiss">Dismiss</button>}
              </span>
            )}
            <ComingBar tabId={session.id} sessionId={session.sessionId} onResume={wakeActs.resume} onCancelContinue={wakeActs.cancel} onScheduled={wakeActs.scheduled} />
          </span>
        </div>
        <div className="phead-t">
          <div className="phead-l">
            {folder && <div className="phead-sub" title={session.cwd} data-testid="folder-picker">{wt ? <>{wt.repo} on <b>{wt.branch}</b></> : folder}</div>}
            {pr && (
              <a className="phead-pr" href={pr.url} target="_blank" rel="noreferrer" data-testid="thread-pr"
                title={[`${pr.repo} #${pr.num}`, ...prs.slice(0, -1).reverse().map((x, i) => `${i ? '' : 'Earlier: '}${x.repo} #${x.num}`)].join('\n')}>PR #{pr.num}</a>
            )}
            {pr && ci && ci.state !== 'none' && <span className={`phead-ci ci-${ci.state}`} title={`Checks: ${ci.text} (as last read in Changes)`} data-testid="thread-pr-checks">{ci.state}</span>}
          </div>
          <span className="phead-acts">
            {PANEL_ACTS.map((a) => (
              <button key={a.tab} type="button" className="btn pact fold" aria-pressed={p.panel === a.tab} aria-label={a.label} onClick={() => p.onPanel(a.tab)} title={a.title} data-testid={`chat-${a.tab}`}>
                <Icon name={a.icon} /><span>{a.label}</span>{a.tab === 'activity' && runningTasks > 0 && <b className="num" data-testid="chat-activity-count">{runningTasks}</b>}
              </button>
            ))}
            <button type="button" className="btn pact fold2" aria-label="Terminal" onClick={p.onTerminal} title="This thread's terminal (Ctrl+`)" data-testid="terminal-toggle"><Icon name="terminal" /><span>Terminal</span></button>
            <button type="button" className="btn pact" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Pin, split, export, find, background" data-testid="chat-export">More</button>
            {menu && (
              <div className="phead-menu" role="menu" data-testid="export-menu">
                <Btn kind="link" onClick={() => { setMenu(false); setPinning('') }} testid="pin-add" title="Pin a fact to this thread's header">Pin a fact</Btn>
                {p.onSplit && <Btn kind="link" onClick={() => { setMenu(false); p.onSplit?.() }} testid="chat-split" title="A new thread beside this one (Ctrl+\)">Split</Btn>}
                <Btn kind="link" onClick={() => { setMenu(false); void exportAs('copy') }} testid="export-copy">Copy as Markdown</Btn>
                <Btn kind="link" onClick={() => { setMenu(false); void exportAs('save') }} testid="export-save">Save as Markdown</Btn>
                <Btn kind="link" onClick={() => { setMenu(false); setFinding(true) }}>Find (Ctrl+F)</Btn>
                <Btn kind="link" onClick={() => { setMenu(false); p.onRunInBackground() }} testid="chat-run-background">Move to the background</Btn>
              </div>
            )}
          </span>
        </div>
        <Pins pins={pinRows.slice(0, 3)} />
        {pinning !== null && (
          <input className="uline pin-in" autoFocus value={pinning} placeholder="A fact to keep in view, Enter pins it" onChange={(e) => setPinning(e.target.value)}
            onBlur={() => setPinning(null)} onKeyDown={(e) => { if (e.key === 'Enter' && pinning.trim()) { savePins([...pins, pinning.trim()]); setPinning(null) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPinning(null) } }} data-testid="pin-input" />
        )}
      </header>
      {sinceLine && <div className="since" data-testid="since-line"><b>Since you looked at {clock(since!.at)}</b>{sinceLine}</div>}
      {wakeAt && (
        <div className="hold-line" data-testid="auto-continue">Paused: usage limit reached. Continues by itself at {wakeLabel(wakeAt, Date.now())}.
          <Btn kind="quiet" onClick={() => void wakeActs.resume()} testid="auto-continue-now">Resume now</Btn>
          <Btn kind="link" className="x" onClick={() => void wakeActs.cancel()} testid="auto-continue-cancel">Cancel</Btn>
        </div>
      )}
      {session.endedRun && !session.busy && (
        <div className="hold-line" data-testid="ended-run">This watcher run has ended and its thread is closed. Sending a message reopens it, read-only: Claude reads the whole conversation again, which counts against your usage.</div>
      )}
      {finding && <FindBar onClose={() => { setFinding(false); box.current?.focus({ preventScroll: true }) }} />}
      <div className="thread conv" ref={thread} onScroll={onScroll}>
        <Transcript session={session} limit={limit} setLimit={setLimit} st={st} startRewind={startRewind} />
        {session.streaming && <div className="msg cl streaming"><MdBody text={session.streaming} copy={false} /></div>}
      </div>

      {session.busy && (
        <div className="working" data-testid="working">
          <span className="sweep" aria-hidden />
          <span className="what">{session.compacting ? 'Freeing up context; this can take a few minutes' : running?.kind === 'tool' ? workingOn(session.items) ?? 'Working' : 'Thinking'}</span>
          <Btn kind="link" onClick={() => p.onBackground()} testid="chat-background-tasks" title="Move what runs to the background (Ctrl+B)">Background tasks</Btn>
        </div>
      )}
      {needsNote(session) && <div className="needs-note" role="status" data-testid="needs-note"><b>Waiting for you</b><span>{needsNote(session)}</span></div>}
      <RunningBar tabId={session.id} items={session.items} busy={session.busy} onSend={p.onSend} />
      {btws.map((b, i) => (
        <div key={i} className="btw" data-testid="btw-answer">
          <div className="btw-q"><span className="kind-word">btw</span> {b.q}<Btn kind="link" onClick={() => setBtws((all) => all.filter((_, j) => j !== i))} testid="btw-dismiss">Dismiss</Btn></div>
          {b.a === null ? <div className="dimt">Thinking</div> : <div className="btw-a"><MdBody text={b.a} copy={false} /></div>}
        </div>
      ))}
      {banner}
      {(queued.length > 0 || queuedThreads.length > 0) && (
        <div className="queue" data-testid="queue-box">
          <div className="qh"><span>Queued, {queued.length + queuedThreads.length}</span><span>Sent in order after this turn{queued.length > 1 && <> <Btn kind="link" onClick={() => void editAll()} testid="queued-edit-all">Edit all</Btn></>}</span></div>
          {queued.map((q, i) => (
            <div key={q.queue!.id} className="qi" data-testid="queued-row">
              <span className="qn">{i + 1}</span>
              <span className="qt" title={q.text}>{q.text || '(image)'}{q.interrupt ? <span className="dimt">, interrupting Claude, sends next</span> : null}</span>
              <span className="qa">
                <Btn kind="link" onClick={() => p.onSendNow(q.queue!.id)} disabled={!session.busy} testid="queued-send-now" title="Stops the tool call Claude is in the middle of and sends this next, ahead of the other queued messages">Send now</Btn>
                <Btn kind="link" onClick={() => p.onPromote(q.queue!.id)} testid="queued-next-step" title="Delivered at Claude's next step, when the running tool call ends; nothing is stopped">At next step</Btn>
                <Btn kind="link" onClick={() => void editQueued(q)} testid="queued-edit">Edit</Btn>
                <Btn kind="link" onClick={() => void p.onDequeue(q.queue!.id)} testid="queued-remove">Remove</Btn>
              </span>
            </div>
          ))}
          {queuedThreads.map((q, i) => (
            <div key={q.queue!.id} className="qi"><span className="qn">{queued.length + i + 1}</span><span className="qt">From {q.fromTitle}: {q.text}</span><span /></div>
          ))}
        </div>
      )}
      {rewind && <RewindModal r={rewind} onFiles={() => void doRewind(true)} onChat={() => void doRewind(false)} onClose={() => setRewind(null)} />}
      <div className="composer" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(PATH_MIME)) e.preventDefault() }} onDrop={onDrop}>
        {slash.menu}
        {mention.menu}
        {(clipChip || images.length > 0) && (
          <div className="atts">
            {images.map((im, j) => (
              <div key={j} className="att" title={`${imageTag(j + 1)} in your message`}><img src={im.url} alt={`Image ${j + 1}`} /><span className="att-n" data-testid={`composer-image-n-${j}`}>Image {j + 1}</span><button className="att-x" aria-label={`Remove image ${j + 1}`} onClick={() => removeImage(j)} data-testid={`composer-remove-image-${j}`}>×</button></div>
            ))}
            {clipChip && <ClipChip offer={clipChip} onPaste={() => void pasteClip()} onDismiss={dismissClip} />}
          </div>
        )}
        <div className="cbox">
        <div className="cin">
          {ultra && <div className="cmirror" ref={mirror} aria-hidden data-testid="ultra-mirror">{ultrathinkParts(draft).map((x, j) => (x.hit ? <mark key={j}>{x.text}</mark> : x.text))}{'\n'}</div>}
          <textarea
            ref={box} rows={1} className={ultra ? 'ultra' : undefined} aria-label="Message Claude"
            onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop }}
            placeholder={clipHint ? clipHint.preview : session.busy ? 'Steer Claude' : session.asks?.length ? 'Answer above, or reply here' : 'Reply to Claude'}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart) }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKey} onPaste={onPaste}
            data-testid="composer"
          />
          <span className="cin-keys">
            {restored.current && draft.trim() && <span data-testid="draft-kept">Draft kept</span>}
            <span><span className="keys">Enter</span> {session.busy ? 'steer' : 'send'}</span>
            {clipHint && <span data-testid="keys-clip"><span className="keys">Tab</span> paste what you copied <Btn kind="link" onClick={dismissClip} testid="composer-clip-dismiss" title="Hide this suggestion">Hide</Btn></span>}
            {session.busy && !clipHint && <span><span className="keys">Tab</span> queue</span>}
            {flushes && <span title="Stops the tool call Claude is in the middle of; what waits goes in at once, in order" data-testid="keys-send-waiting"><span className="keys">Ctrl+Shift+Enter</span> send waiting now</span>}
          </span>
        </div>
        <div className="crow">
          <ModelEffort tabId={session.id} ultra={ultra} />
          <ModePicker tabId={session.id} mode={shownMode} error={session.modeError} />
          {ultra && <span className="pick ultra" data-testid="ultra-note">ultrathink: max effort for this turn</span>}
          <Btn kind="link" onClick={() => fileInput.current?.click()} testid="composer-attach" title="Attach files or images">Attach</Btn>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = '' }} data-testid="composer-file" />
          <span className="cbtns">
            {session.busy && <>
              <Btn kind="link" onClick={() => submit('queue')} testid="send-queue" title="Held until Claude finishes, then starts a new turn (Tab)">Queue</Btn>
              <Btn kind="link" onClick={() => submit('interrupt')} testid="send-interrupt" title="Stops what Claude is doing and sends this at once (Ctrl+Shift+Enter)">Interrupt</Btn>
              <Btn kind="link" onClick={p.onStop} testid="chat-stop" title="Stop this turn; the queue holds (Esc)">Stop</Btn>
            </>}
            <Btn kind="primary" className={draft.trim() || images.length ? '' : 'idle'} onClick={() => submit('steer')} testid="send" title={session.busy ? 'Delivered at Claude\'s next step, inside the running turn (Enter)' : 'Send (Enter)'}>{session.busy ? 'Steer' : 'Send'}</Btn>
          </span>
        </div>
        </div>
      </div>
    </main>
  )
}
