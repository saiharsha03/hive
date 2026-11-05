// The Team view: one team at a time, as an office (a desk per member with its state and latest post) beside the
// plan, the team log and what the team learned. Reads teams:view, refreshed on teams:changed and every 2 s for the
// members' live states. Click a desk to open that thread.
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LogEntry, MemberState, TeamView as View } from '../../shared/teamCore'
import { Icon } from './ui'

type Row = { id: string; name: string; goal: string; createdAt: number; endedAt?: number; members: number }
const STATE_CLASS: Record<MemberState, string> = { working: 's-work', waiting: 's-wait', idle: 's-idle', closed: 's-idle' }
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export type Desk = { id: string; name: string; role: string; state: MemberState; doing?: string; said?: LogEntry }

export function desksOf(v: View): Desk[] {
  const last = (id: string) => [...v.log].reverse().find((e) => e.from === id)
  return [
    { id: v.team.lead.id, name: 'Lead', role: 'lead', state: v.states[v.team.lead.id]?.state ?? 'closed', doing: v.states[v.team.lead.id]?.doing, said: last(v.team.lead.id) },
    ...v.team.members.map((m) => ({ id: m.id, name: m.name, role: m.role, state: v.states[m.id]?.state ?? 'closed', doing: v.states[m.id]?.doing, said: last(m.id) })),
  ]
}

// a message from you straight to one teammate's thread (it arrives like any message you type in that thread)
function Say({ id, name, onMessage }: { id: string; name: string; onMessage: (threadId: string, text: string) => boolean }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const go = () => {
    const t = text.trim()
    if (!t) return
    if (onMessage(id, t)) { setText(''); setNote('sent') } else setNote('thread not open')
  }
  return (
    <div className="tv-say">
      <input value={text} placeholder={`Message ${name}`} onChange={(e) => { setText(e.target.value); setNote('') }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } }} data-testid={`team-say-${id}`} />
      {note && <span className={note === 'sent' ? 'tv-note s-done' : 'tv-note s-fail'}>{note}</span>}
    </div>
  )
}

// the office itself; the animated scene replaces this
function Office({ v, onOpen, onMessage }: { v: View; onOpen: (id: string) => void; onMessage: (threadId: string, text: string) => boolean }) {
  return (
    <div className="tv-office" data-testid="team-office">
      {desksOf(v).map((d) => (
        <div key={d.id} className="tv-desk" data-testid={`team-desk-${d.id}`}>
          <button className="tv-dh" onClick={() => onOpen(d.id)} title="Open this thread"><span className="tv-name">{d.name}</span><span className="tv-role">{d.role}</span><span className={`tv-state ${STATE_CLASS[d.state]}`}>{d.state.toUpperCase()}</span></button>
          {d.doing && <div className="tv-doing">{d.doing}</div>}
          {d.said && <div className="tv-said">"{d.said.text}"{d.said.to.length ? <span className="tv-to"> to {d.said.to.join(', ')}</span> : null}</div>}
          {d.state !== 'closed' && !v.team.endedAt && <Say id={d.id} name={d.name} onMessage={onMessage} />}
        </div>
      ))}
    </div>
  )
}

export function TeamView({ onActivate, onMessage }: { onActivate: (threadId: string) => void; onMessage: (threadId: string, text: string) => boolean }) {
  const [teams, setTeams] = useState<Row[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [v, setV] = useState<View | null>(null)
  const [side, setSide] = useState<'plan' | 'log' | 'knowledge'>('log')
  const id = pick ?? teams.find((t) => !t.endedAt)?.id ?? teams[0]?.id ?? null

  useEffect(() => {
    const load = () => void window.api.teamsList().then(setTeams).catch(() => setTeams([]))
    load()
    return window.api.onTeamsChanged(load)
  }, [])
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
        {v && <span className="tv-meta">{v.team.members.length + 1} members, started {time(v.team.createdAt)}{v.team.endedAt ? `, ended ${time(v.team.endedAt)}` : ''}</span>}
      </div>
      {v && (
        <div className="tv-body">
          <Office v={v} onOpen={onActivate} onMessage={onMessage} />
          <div className="tv-side">
            <div className="tv-tabs">
              {(['log', 'plan', 'knowledge'] as const).map((k) => <button key={k} className={side === k ? 'on' : ''} onClick={() => setSide(k)} data-testid={`team-tab-${k}`}>{k === 'log' ? `Log (${v.log.length})` : k === 'plan' ? 'Plan' : 'Learned'}</button>)}
              <span className="tv-dir" title={v.team.dir}><Icon name="folder" /></span>
            </div>
            <div className="tv-pane">
              {side === 'log' && [...v.log].reverse().map((e, i) => (
                <div key={i} className="tv-log"><span className="tv-t">{time(e.at)}</span><span className="tv-from">{e.fromName}{e.to.length ? ` to ${e.to.join(', ')}` : ''}</span><span className="tv-txt">{e.text}</span></div>
              ))}
              {side === 'plan' && <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{v.plan}</Markdown></div>}
              {side === 'knowledge' && <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{v.knowledge}</Markdown></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
