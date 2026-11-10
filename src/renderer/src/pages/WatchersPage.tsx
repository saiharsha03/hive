// Watchers and teams: the scheduled background threads (WatchersView), the teams of threads working on one job
// (a table of them, then TeamView for the picked one) and the role library teams draw from.
import { useEffect, useState } from 'react'
import { Btn, Empty, PageHead, Section, State, age, type Tone } from '../kit'
import { WatchersView, pickWatcher, type OpenThread } from '../WatchersView'
import { TeamView, onTeamPicked, pickTeam, wantedTeam } from '../TeamView'
import { activate, notice, openSession, send, setPreview } from '../actions'
import { findSession } from '../background'
import { getSessions } from '../store'
import { keepVisible } from '../threads'
import { DEFAULT_ROLES, parseRole, tail, type Role } from '../../../shared/roleCore'
import './workspace.css'

export const WATCHERS_TABS = [['watchers', 'Watchers'], ['teams', 'Teams'], ['roles', 'Roles']] as const
export type WatchersTab = (typeof WATCHERS_TABS)[number][0]
const isTab = (t: unknown): t is WatchersTab => WATCHERS_TABS.some(([id]) => id === t)

// which tab to show: set from the palette or a link elsewhere, before or while the page is up
let wantedTab: WatchersTab | null = null
const pickers = new Set<(t: WatchersTab) => void>()
export const pickWatchersTab = (tab: WatchersTab) => { wantedTab = tab; pickers.forEach((f) => f(tab)) }
// a watcher or a team by id: the right tab, then the one row
export const openWatcherOnPage = (id: string) => { pickWatchersTab('watchers'); pickWatcher(id) }
export const openTeamOnPage = (id: string) => { pickWatchersTab('teams'); pickTeam(id) }

function openWatcherThread(t: OpenThread) {
  if (t.sessionId) keepVisible(t.sessionId)
  const sessions = getSessions()
  const s = (t.tabId ? sessions.find((x) => x.id === t.tabId) : undefined) ?? (t.sessionId ? findSession(sessions, t.sessionId) : undefined)
  if (s) activate(s.id)
  else if (t.sessionId && t.path) openSession({ id: t.sessionId, title: t.title, project: '', cwd: t.cwd, updated: t.at, started: t.at, path: t.path, watcherRun: true })
  else notice('That watcher has no thread to open yet')
}

// ---- Teams ----
type Row = { id: string; name: string; goal: string; createdAt: number; endedAt?: number; members: number }
const teamState = (r: Row, paused: boolean): { word: string; tone: Tone } =>
  r.endedAt ? { word: 'ended', tone: 'idle' } : paused ? { word: 'paused', tone: 'hold' } : { word: 'active', tone: 'work' }

function TeamsTab() {
  const [teams, setTeams] = useState<Row[] | null>(null)
  const [paused, setPaused] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(wantedTeam())
  useEffect(() => {
    const load = () => {
      void window.api.teamsList().then(setTeams).catch(() => setTeams([]))
      void window.api.teamRoster().then((r) => setPaused(new Set(r.filter((x) => x.pausedAt && !x.endedAt).map((x) => x.id)))).catch(() => {})
    }
    load()
    const off = window.api.onTeamsChanged(load)
    const off2 = onTeamPicked(setSel)
    return () => { off(); off2() }
  }, [])

  if (sel) {
    return (
      <div data-testid="teams-detail">
        <div className="wt-teams-head"><Btn kind="link" onClick={() => setSel(null)} testid="teams-back">All teams</Btn></div>
        <TeamView bare onActivate={activate}
          onMessage={(id, text) => { if (!getSessions().some((s) => s.id === id)) return false; send(id, text, []); return true }} />
      </div>
    )
  }
  const table = (rows: Row[]) => (
    <table className="dt">
      <thead><tr><th>State</th><th>Team</th><th className="num">Members</th><th>Goal</th><th className="num">Started</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => {
          const st = teamState(r, paused.has(r.id))
          const open = () => { pickTeam(r.id); setSel(r.id) }
          return (
            <tr key={r.id} className="wt-pick" tabIndex={0} data-testid="team-table-row" data-id={r.id} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}>
              <td><State word={st.word} tone={st.tone} /></td>
              <td className="strong">{r.name}</td>
              <td className="num">{r.members + 1}</td>
              <td>{r.goal}</td>
              <td className="num">{age(r.createdAt)}</td>
              <td className="acts"><Btn kind="link" onClick={(e) => { e.stopPropagation(); open() }}>Open</Btn></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
  if (!teams) return <Empty>Reading teams</Empty>
  const running = teams.filter((t) => !t.endedAt)
  const past = teams.filter((t) => t.endedAt)
  if (!teams.length) return <div data-testid="team-empty"><Empty>No teams yet. Ask a thread to start one, for example "make a team to finish the billing migration".</Empty></div>
  return (
    <>
      <Section title="Running" note={`${running.length}`}>{running.length ? table(running) : <Empty>No team is running.</Empty>}</Section>
      <Section title="Past" note={`${past.length}`}>{past.length ? table(past) : <Empty>No team has ended yet.</Empty>}</Section>
    </>
  )
}

// ---- Roles: ~/.claude/hive/roles/<id>/role.md and memory.md ----
type RoleRow = Role & { memory: string }
function RolesTab() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [shared, setShared] = useState('')
  const [dir, setDir] = useState('')
  const [fromDisk, setFromDisk] = useState(true)
  useEffect(() => {
    let on = true
    void (async () => {
      const home = await window.api.homeDir().catch(() => '')
      const sep = home.includes('\\') ? '\\' : '/'
      const root = `${home}${sep}.claude${sep}hive${sep}roles`
      const read = (p: string) => window.api.readText(p).catch(() => '')
      try {
        const entries = (await window.api.listDir(root)).filter((e) => e.dir)
        const rows = await Promise.all(entries.map(async (e) => {
          const text = await read(`${e.path}${sep}role.md`)
          return text ? { ...parseRole(e.name, text), memory: await read(`${e.path}${sep}memory.md`) } : null
        }))
        const found = rows.filter((r): r is RoleRow => !!r).sort((a, b) => (a.id === 'lead' ? -1 : b.id === 'lead' ? 1 : a.id.localeCompare(b.id)))
        if (!on) return
        setDir(root); setShared(await read(`${root}${sep}shared-memory.md`))
        if (found.length) setRoles(found)
        else { setFromDisk(false); setRoles(DEFAULT_ROLES.map((r) => ({ ...r, memory: '' }))) }
      } catch {
        if (on) { setFromDisk(false); setDir(root); setRoles(DEFAULT_ROLES.map((r) => ({ ...r, memory: '' }))) }
      }
    })()
    return () => { on = false }
  }, [])
  if (!roles) return <Empty>Reading roles</Empty>
  const memory = (t: string) => tail(t, 8)
  return (
    <>
      <Section title="Role library" note={fromDisk ? `${roles.length} roles, kept in ${dir}` : 'The default roles; the files are written the first time a team starts'} testid="roles-list">
        {dir && <div className="drow"><Btn kind="link" onClick={() => void window.api.openExternal(dir)} testid="roles-folder">Open the roles folder</Btn></div>}
        {roles.map((r) => (
          <div key={r.id} className="wt-role" data-testid="role-row" data-id={r.id}>
            <div className="wt-role-h"><span className="wt-role-n">{r.name}</span><span className="dnote">{r.summary}</span></div>
            {r.instructions && <p className="wt-role-i">{r.instructions}</p>}
            {memory(r.memory) && <pre className="wt-role-m">{memory(r.memory)}</pre>}
          </div>
        ))}
      </Section>
      {memory(shared) && <Section title="Learned by every role"><pre className="wt-role-m">{memory(shared)}</pre></Section>}
    </>
  )
}

export function WatchersPage() {
  const [tab, setTab] = useState<WatchersTab>(() => { const t = wantedTab; return isTab(t) ? t : 'watchers' })
  useEffect(() => {
    wantedTab = null
    const pick = (t: WatchersTab) => { wantedTab = null; setTab(t) }
    pickers.add(pick)
    return () => { pickers.delete(pick) }
  }, [])
  return (
    <div className="page wt-page" data-testid="page-watchers">
      <PageHead title="Watchers and teams" desc="Scheduled background threads, and teams of threads working on one job" />
      <div className="page-tabs" role="tablist">
        {WATCHERS_TABS.map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`wt-tab-${id}`}>{text}</button>
        ))}
      </div>
      <div className="wt-body">
        {tab === 'watchers' && <div data-testid="watchers-view"><WatchersView onOpen={setPreview} onOpenThread={openWatcherThread} /></div>}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'roles' && <RolesTab />}
      </div>
    </div>
  )
}
