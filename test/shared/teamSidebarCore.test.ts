import { test } from 'vitest'
import assert from 'node:assert/strict'
import { groupTeams, isAppPage, pastTeamPeople, rosterOf, teamThreadIds, teamWindowOf, teamWindowSearch } from '../../src/shared/teamSidebarCore'
import type { Team } from '../../src/shared/teamCore'

const team = (over: Partial<Team> = {}): Team => ({
  id: 't1', name: 'Migration', goal: 'g', dir: '/d', createdAt: 1,
  owner: { id: 'owner-tab', title: 'Owner', sessionId: 'owner-s' },
  lead: { id: 'team-lead-mig-0a1b', title: 'Lead', sessionId: 'lead-s' },
  members: [
    { id: 'team-builder-1111', name: 'Builder', role: 'builder', cwd: '/c', joinedAt: 2, sessionId: 'b-s' },
    { id: 'team-reviewer-2222', name: 'Reviewer', role: 'reviewer', cwd: '/c', joinedAt: 3 },
  ],
  ...over,
})

// what the sidebar does with the rosters main sends: only the running teams
const runningRosters = (teams: Team[]) => teams.filter((t) => !t.endedAt).map(rosterOf)

test('running teams only; the Owner is not a member; ids and session ids are hidden from the normal lists', () => {
  const rs = runningRosters([team(), team({ id: 't2', endedAt: 5 })])
  assert.deepEqual(rs.map((r) => r.id), ['t1'])
  assert.deepEqual(rs[0].people.map((p) => p.name), ['Lead', 'Builder', 'Reviewer'])
  const ids = teamThreadIds(rs)
  for (const id of ['team-lead-mig-0a1b', 'lead-s', 'team-builder-1111', 'b-s', 'team-reviewer-2222']) assert.ok(ids.has(id), id)
  assert.ok(!ids.has('owner-tab') && !ids.has('owner-s'))
})

test('groupTeams: live rows by tab or session id, saved rows otherwise, counts and the state word', () => {
  const [r] = runningRosters([team()])
  const live = [
    { id: 'team-builder-1111', state: 'working' as const },
    { id: 'lead-s', sessionId: 'lead-s', state: 'waiting' as const }, // the Lead reopened under its session id
    { id: 'other', state: 'working' as const },
  ]
  const [g] = groupTeams([r], live, [{ id: 'b-s' }, { id: 'unrelated' }])
  assert.deepEqual(g.rows.map((x) => (x.kind === 'live' ? `live:${x.row.id}` : `saved:${x.s.id}`)), ['live:lead-s', 'live:team-builder-1111'])
  assert.equal(g.working, 1)
  assert.equal(g.total, 3)
  assert.equal(g.word, 'WORKING')

  const [idle] = groupTeams([r], [], [{ id: 'lead-s' }, { id: 'b-s' }])
  assert.deepEqual(idle.rows.map((x) => x.kind), ['saved', 'saved'])
  assert.equal(idle.word, 'IDLE')

  const [paused] = groupTeams(runningRosters([team({ pausedAt: 9 })]), live, [])
  assert.equal(paused.word, 'PAUSED')
})

test('Team window address: written and read back; the normal page is not the Team window', () => {
  assert.equal(teamWindowSearch(), 'view=team')
  assert.deepEqual(teamWindowOf(`?${teamWindowSearch('2026-11-05-a b')}`), { team: '2026-11-05-a b' })
  assert.deepEqual(teamWindowOf('?view=team'), { team: null })
  assert.equal(teamWindowOf(''), null)
  assert.equal(teamWindowOf('?view=threads&team=x'), null)
})

test('isAppPage: the same page with a query or hash is accepted, anything else is not', () => {
  const file = 'file:///C:/Hive/out/renderer/index.html'
  assert.ok(isAppPage(file, file, false))
  assert.ok(isAppPage(`${file}?view=team&team=t1`, file, false))
  assert.ok(isAppPage(`${file}#x`, file, false))
  assert.ok(!isAppPage('file:///C:/Hive/out/renderer/other.html?view=team', file, false))
  assert.ok(!isAppPage('https://evil.example/index.html', file, false))
  const dev = 'http://localhost:5173'
  assert.ok(isAppPage('http://localhost:5173/?view=team&team=t1', dev, true))
  assert.ok(!isAppPage('http://localhost:5173@evil.example/', dev, true))
  assert.ok(!isAppPage('not a url', dev, true))
})

test('role icons by keyword', async () => {
  const { roleIcon } = await import('../../src/shared/teamSidebarCore')
  assert.deepEqual(['lead', 'Senior builder', 'reviewer', 'validator', 'QA', 'researcher', 'Docs writer', 'data engineer', 'mascot'].map(roleIcon),
    ['star-full', 'tools', 'eye', 'beaker', 'checklist', 'search', 'book', 'tools', 'person'])
})

test('pastTeamPeople: an ended team marks its people by tab and session id; a running one marks none', () => {
  const m = pastTeamPeople([rosterOf(team()), rosterOf(team({ id: 't2', endedAt: 5 }))].filter((r) => r.id === 't2'))
  assert.equal(m.get('team-builder-1111')?.role, 'builder')
  assert.equal(m.get('b-s')?.name, 'Builder')
  assert.equal(pastTeamPeople([rosterOf(team())]).size, 0)
})
