// The Team view: one team at a time, as an animated office (side cutaway or floor plan, see office/) beside the
// plan, the team log and what the team learned. Reads teams:view, refreshed on teams:changed and every 2 s for the
// members' live states. New team posts play in the office; click a person to talk to them in a docked chat panel.
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MemberState, TeamView as View } from '../../shared/teamCore'
import { STATE_WORD, boardOf, chatOf, knowledgeNote, markOf, nameIn, newSince, peopleOf, sortTodos, todoCount, type LogMark } from '../../shared/officeCore'
import { openOf, type Todo } from '../../shared/teamTodoCore'
import { Office, type Mode } from './office/engine'
import { Icon } from './ui'

type Row = { id: string; name: string; goal: string; createdAt: number; endedAt?: number; members: number }
const STATE_CLASS: Record<MemberState, string> = { working: 's-work', waiting: 's-wait', idle: 's-idle', closed: 's-idle' }
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const MODE_KEY = 'hive.teamOffice'
type Sent = Record<string, { at: number; text: string }[]>
type Say = (threadId: string, text: string) => boolean | Promise<boolean>

// which team to show: set from the sidebar's Teams section (or the Team window's address) before or while the view is up
let wanted: string | null = null
const pickers = new Set<(id: string) => void>()
export const pickTeam = (id: string) => { wanted = id; pickers.forEach((f) => f(id)) }

// the scene itself is plain DOM/SVG driven by office/engine; React owns only the container
function OfficeScene({ v, mode, onPick, nod }: { v: View; mode: Mode; onPick: (id: string) => void; nod: { id: string; n: number } | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const office = useRef<Office | null>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const seen = useRef<{ team: string; mark: LogMark } | null>(null)
  useEffect(() => {
    const o = new Office(ref.current!, (id) => pick.current(id))
    office.current = o
    return () => { o.destroy(); office.current = null; seen.current = null }
  }, [])
  useEffect(() => {
    const o = office.current
    if (!o) return
    const b = boardOf(v)
    o.set({ mode, people: peopleOf(v), title: b.title, count: b.count, board: b.rows, goal: v.team.goal, knowledge: knowledgeNote(v.knowledge) })
    const was = seen.current
    if (was && was.team === v.team.id) { const fresh = newSince(was.mark, v.log); if (fresh.length) o.play(fresh) } // history is never replayed
    else o.clear()
    seen.current = { team: v.team.id, mark: markOf(v.log) }
  }, [v, mode])
  useEffect(() => { if (nod) office.current?.nod(nod.id) }, [nod])
  return <div className="ofc" ref={ref} data-testid="team-office" />
}

// one to-do: a small checkbox (empty open, filled doing, ticked done, struck through dropped), the text, the state
function TodoRow({ t, owner }: { t: Todo; owner?: string }) {
  return (
    <div className={`ofc-todo ofc-t-${t.state}`} title={t.note ? `${t.id}: ${t.note}` : t.id}>
      <i className="ofc-box" data-t={t.state} /><span className="ofc-tt">{t.text}</span>
      {owner !== undefined && <span className="ofc-tow">{owner}</span>}
      <span className={`ofc-tw ofc-w-${t.state}`}>{t.state.toUpperCase()}</span>
    </div>
  )
}

// the To-dos tab: the team board, then each person's own list (read-only; the threads keep them)
function Todos({ v }: { v: View }) {
  const all = v.todos ?? []
  const board = boardOf(v)
  const major = sortTodos(all.filter((t) => t.major))
  const mine = all.filter((t) => !t.major)
  const owners = [...new Set([...peopleOf(v).map((p) => p.id), ...mine.map((t) => t.owner)])].filter((o) => mine.some((t) => t.owner === o))
  if (!all.length) return <div className="ofc-cempty">No to-dos yet. Teammates add them as they plan their work.</div>
  return (
    <div className="ofc-todos" data-testid="team-todos">
      <div className="ofc-th"><b>Team board</b>{major.length ? <span>{board.count}</span> : <span>empty</span>}</div>
      {major.map((t) => <TodoRow key={t.id} t={t} owner={nameIn(v, t.owner)} />)}
      {owners.map((o) => {
        const list = sortTodos(mine.filter((t) => t.owner === o))
        return (
          <div key={o || 'none'}>
            <div className="ofc-th"><b>{nameIn(v, o)}</b><span>{openOf(list).length} open</span></div>
            {list.map((t) => <TodoRow key={t.id} t={t} />)}
          </div>
        )
      })}
    </div>
  )
}

// talking to one teammate without leaving the office: what passed between you, and a box straight into its thread
function Chat({ v, id, sent, onSend, onOpen, onClose }: { v: View; id: string; sent: { at: number; text: string }[]; onSend: (text: string) => Promise<boolean>; onOpen: () => void; onClose: () => void }) {
  const p = peopleOf(v).find((x) => x.id === id)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const lines = chatOf(v, id, sent)
  const own = sortTodos((v.todos ?? []).filter((t) => !t.major && t.owner === id))
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [lines.length, id])
  useEffect(() => { setText(''); setNote('') }, [id])
  if (!p) return null
  const go = () => {
    const t = text.trim()
    if (!t) return
    void onSend(t).then((ok) => { if (ok) { setText(''); setNote('sent') } else setNote('thread not open') })
  }
  return (
    <div className="ofc-chat" data-testid={`team-chat-${id}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="ofc-ch">
        <span className="ofc-cn">{p.name}</span><span className="ofc-cr">{p.role}</span>
        <span className={`ofc-cs ${STATE_CLASS[p.state]}`}>{STATE_WORD[p.state]}</span>
        <button className="ibtn" onClick={onClose} title="Close (Esc)" data-testid="team-chat-close"><Icon name="close" /></button>
      </div>
      {p.doing && <div className="ofc-cd">{p.doing}</div>}
      {own.length > 0 && (
        <div className="ofc-own" data-testid={`team-chat-todos-${id}`}>
          <div className="ofc-th"><b>To-dos</b><span>{todoCount(own)} done</span></div>
          {own.map((t) => <TodoRow key={t.id} t={t} />)}
        </div>
      )}
      <div className="ofc-cl">
        {!lines.length && <div className="ofc-cempty">Nothing between you and {p.name} yet.</div>}
        {lines.map((l, i) => (
          <div key={i} className={`ofc-cm ofc-${l.kind}`}>
            <div className="ofc-chd">{l.kind === 'them' ? `${p.name} ${l.head}` : l.head}{l.at < Number.MAX_SAFE_INTEGER ? <span className="tv-t"> {time(l.at)}</span> : null}</div>
            {l.kind === 'reply' ? <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{l.text}</Markdown></div> : <div className="ofc-ctx">{l.text}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="ofc-cf">
        {v.team.endedAt || p.state === 'closed'
          ? <span className="ofc-cempty">{v.team.endedAt ? 'The team has ended.' : 'This thread is closed.'}</span>
          : <div className="tv-say"><input autoFocus value={text} placeholder={`Message ${p.name}`} onChange={(e) => { setText(e.target.value); setNote('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }} data-testid={`team-say-${id}`} />
              {note && <span className={note === 'sent' ? 'tv-note s-done' : 'tv-note s-fail'}>{note}</span>}</div>}
        <button className="link" onClick={onOpen} data-testid="team-chat-open">Open thread</button>
      </div>
    </div>
  )
}

// inWindow: shown in the pop-out Team window (no "Open in window" there)
export function TeamView({ onActivate, onMessage, inWindow }: { onActivate: (threadId: string) => void; onMessage: Say; inWindow?: boolean }) {
  const [teams, setTeams] = useState<Row[]>([])
  const [pick, setPick] = useState<string | null>(wanted)
  const [v, setV] = useState<View | null>(null)
  const [side, setSide] = useState<'plan' | 'log' | 'knowledge' | 'todos'>('log')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === 'plan' ? 'plan' : 'side'))
  const [chat, setChat] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent>({})
  const [nod, setNod] = useState<{ id: string; n: number } | null>(null)
  const pickMode = (m: Mode) => { setMode(m); localStorage.setItem(MODE_KEY, m) }
  const id = pick ?? teams.find((t) => !t.endedAt)?.id ?? teams[0]?.id ?? null

  useEffect(() => {
    const load = () => void window.api.teamsList().then(setTeams).catch(() => setTeams([]))
    load()
    return window.api.onTeamsChanged(load)
  }, [])
  useEffect(() => { pickers.add(setPick); return () => { pickers.delete(setPick) } }, [])
  useEffect(() => { setChat(null); setSent({}) }, [id])
  useEffect(() => {
    if (!id) { setV(null); return }
    let on = true
    const load = () => void window.api.teamView(id).then((x) => { if (on) setV(x) }).catch(() => {})
    load()
    const off = window.api.onTeamsChanged((changed) => { if (changed === id) load() })
    const t = setInterval(load, 2000)
    return () => { on = false; off(); clearInterval(t) }
  }, [id])

  if (!teams.length) return <div className="pane-empty" data-testid="team-empty">No teams yet. Ask a thread to start one, e.g. "make a team to finish the HelixPrevent migration".</div>
  return (
    <div className="teamview" data-testid="team-view">
      <div className="tv-head">
        <select className="tv-pick" value={id ?? ''} onChange={(e) => setPick(e.target.value)} data-testid="team-pick">
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.endedAt ? ' (ended)' : ''}</option>)}
        </select>
        {v && <span className="tv-goal" title={v.team.goal}>{v.team.goal}</span>}
        {v?.team.owner && <button className="link" onClick={() => onActivate(v.team.owner!.id)} title="The thread that started this team; the Lead reports to it">Owner: {v.team.owner.title}</button>}
        <div className="seg" title="How the office is drawn">{(['side', 'plan'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => pickMode(m)} data-testid={`team-mode-${m}`}>{m === 'side' ? 'Side' : 'Plan'}</button>)}</div>
        {v && !v.team.endedAt && <PauseButton v={v} />}
        {!inWindow && <button className="ibtn" onClick={() => void window.api.teamOpenWindow(id ?? undefined)} title="Open in its own window" data-testid="team-open-window"><Icon name="link-external" /></button>}
        {v && <span className="tv-meta">{v.team.members.length + 1} members, started {time(v.team.createdAt)}{v.team.endedAt ? `, ended ${time(v.team.endedAt)}` : ''}</span>}
      </div>
      {v && (
        <div className="tv-body">
          <div className="ofc-wrap">
            <OfficeScene v={v} mode={mode} onPick={setChat} nod={nod} />
            {chat && <Chat v={v} id={chat} sent={sent[chat] ?? []} onClose={() => setChat(null)} onOpen={() => onActivate(chat)}
              onSend={async (text) => {
                if (!(await onMessage(chat, text))) return false
                setSent((x) => ({ ...x, [chat]: [...(x[chat] ?? []), { at: Date.now(), text }] }))
                setNod((x) => ({ id: chat, n: (x?.n ?? 0) + 1 }))
                return true
              }} />}
          </div>
          <div className="tv-side">
            <div className="tv-tabs">
              {(['log', 'todos', 'plan', 'knowledge'] as const).map((k) => <button key={k} className={side === k ? 'on' : ''} onClick={() => setSide(k)} data-testid={`team-tab-${k}`}>{k === 'log' ? `Log (${v.log.length})` : k === 'todos' ? `To-dos (${openOf(v.todos ?? []).length})` : k === 'plan' ? 'Plan' : 'Learned'}</button>)}
              <span className="tv-dir" title={v.team.dir}><Icon name="folder" /></span>
            </div>
            <div className="tv-pane">
              {side === 'log' && [...v.log].reverse().map((e, i) => (
                <div key={i} className="tv-log"><span className="tv-t">{time(e.at)}</span><span className="tv-from">{e.fromName}{e.to.length ? ` to ${e.to.join(', ')}` : ''}</span><span className="tv-txt">{e.text}</span></div>
              ))}
              {side === 'todos' && <Todos v={v} />}
              {side === 'plan' && <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{v.plan}</Markdown></div>}
              {side === 'knowledge' && <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{v.knowledge}</Markdown></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// pause every running turn of the team, or wake it back up (also after Hive restarted)
function PauseButton({ v }: { v: View }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const paused = !!v.team.pausedAt
  const go = () => {
    setBusy(true)
    void (paused ? window.api.teamResume(v.team.id) : window.api.teamPause(v.team.id))
      .then((m) => setNote(m)).catch((e) => setNote(String(e?.message ?? e))).finally(() => setBusy(false))
  }
  return (
    <>
      {paused && <span className="tv-paused s-wait" data-testid="team-paused">PAUSED</span>}
      <button className="link" disabled={busy} onClick={go} title={note || (paused ? 'Wake every teammate to carry on' : 'Stop every running turn; posts are held until you resume')} data-testid="team-pause">
        {busy ? (paused ? 'Resuming…' : 'Pausing…') : paused ? 'Resume team' : 'Pause team'}
      </button>
    </>
  )
}

// the pop-out Team window's whole page: the Team view, full size. Opening a thread shows it in the main window;
// a message goes into the thread through the main window, like typing in its tab.
export function TeamWindow() {
  useEffect(() => window.api.onTeamPick(pickTeam), [])
  return (
    <div className="teamwin" data-testid="team-window">
      <TeamView inWindow onActivate={(id) => void window.api.teamActivate(id)} onMessage={(id, text) => window.api.teamSay(id, text).catch(() => false)} />
    </div>
  )
}
