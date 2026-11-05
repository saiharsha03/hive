// Teams in the threads sidebar and the pop-out Team window. Pure parts: the roster of a running team (Lead first,
// then the members; the Owner is not one), which live and saved rows belong to a team, the team's state word, and the
// Team window's page address (?view=team&team=<id>) and the check that it is still the app's own page.
import type { Team } from './teamCore'

export type RosterPerson = { id: string; name: string; role: string; sessionId?: string }
export type Roster = { id: string; name: string; pausedAt?: number; people: RosterPerson[] }

export const rosterOf = (t: Team): Roster => ({
  id: t.id, name: t.name, ...(t.pausedAt ? { pausedAt: t.pausedAt } : {}),
  people: [
    { id: t.lead.id, name: 'Lead', role: 'lead', ...(t.lead.sessionId ? { sessionId: t.lead.sessionId } : {}) },
    ...t.members.map((m) => ({ id: m.id, name: m.name, role: m.role, ...(m.sessionId ? { sessionId: m.sessionId } : {}) })),
  ],
})

// the running teams only: an ended team's threads go back to the normal lists
export const runningRosters = (teams: Team[]): Roster[] => teams.filter((t) => !t.endedAt).map(rosterOf)

// every tab id and session id of a running team's people, to keep them out of Waiting / Working and the saved lists
export const teamThreadIds = (rosters: Roster[]): Set<string> =>
  new Set(rosters.flatMap((r) => r.people.flatMap((p) => (p.sessionId ? [p.id, p.sessionId] : [p.id]))))

type LiveLike = { id: string; sessionId?: string; state: 'working' | 'waiting' }
type SavedLike = { id: string }
export type TeamRow<L, S> = ({ kind: 'live'; row: L } | { kind: 'saved'; s: S }) & { person: RosterPerson }
export type TeamWord = 'PAUSED' | 'WORKING' | 'IDLE'
export type TeamGroup<L, S> = { roster: Roster; rows: TeamRow<L, S>[]; working: number; total: number; word: TeamWord }

// each team with its people as rows (a live row where the thread runs, else its saved thread, else nothing), how many
// are working, and its state word
export function groupTeams<L extends LiveLike, S extends SavedLike>(rosters: Roster[], live: L[], saved: S[]): TeamGroup<L, S>[] {
  return rosters.map((roster) => {
    const rows: TeamRow<L, S>[] = []
    let working = 0
    for (const p of roster.people) {
      const l = live.find((r) => r.id === p.id || (!!p.sessionId && r.sessionId === p.sessionId))
      if (l) { rows.push({ kind: 'live', row: l, person: p }); if (l.state === 'working') working++; continue }
      const s = saved.find((x) => x.id === p.id || x.id === p.sessionId)
      if (s) rows.push({ kind: 'saved', s, person: p })
    }
    const word: TeamWord = roster.pausedAt ? 'PAUSED' : working ? 'WORKING' : 'IDLE'
    return { roster, rows, working, total: roster.people.length, word }
  })
}

// a team member's mark in the sidebar: an icon for the role (by keyword, so "Senior builder" is a builder)
export function roleIcon(role: string): string {
  const r = role.toLowerCase()
  if (/lead|owner/.test(r)) return 'star-full'
  if (/review/.test(r)) return 'eye'
  if (/valid|test/.test(r)) return 'beaker'
  if (/(^|[^a-z])qa([^a-z]|$)|quality/.test(r)) return 'checklist'
  if (/research/.test(r)) return 'search'
  if (/doc|writ/.test(r)) return 'book'
  if (/build|dev|engineer|code/.test(r)) return 'tools'
  return 'person'
}

// the Team window's page: the app page with ?view=team (and &team=<id> to open on one team)
export const teamWindowSearch = (teamId?: string | null) => `view=team${teamId ? `&team=${encodeURIComponent(teamId)}` : ''}`

// null: the normal app page; otherwise the Team window, with the team to show first (or null for the default)
export function teamWindowOf(search: string): { team: string | null } | null {
  const p = new URLSearchParams(search)
  if (p.get('view') !== 'team') return null
  return { team: p.get('team') || null }
}

// is `url` the app's own page? Parsed origins (dev server) or the exact file (built app), never string prefixes
// ("http://localhost:5173@evil.example"); a query or hash (the Team window) is the same page
export function isAppPage(url: string, appHref: string, dev: boolean): boolean {
  try {
    const u = new URL(url)
    const a = new URL(appHref)
    if (dev) return u.origin === a.origin
    return u.protocol === 'file:' && `${u.origin}${u.pathname}` === `${a.origin}${a.pathname}`
  } catch {
    return false
  }
}
