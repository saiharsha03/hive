import { test } from 'vitest'
import assert from 'node:assert/strict'
import { canAct, formatTeamStatus, leadBrief, nameOf, nameTaken, obsoleteQueued, parseLog, personId, slug, targetsOf, teamBrief, type Team } from '../../src/shared/teamCore'

const team: Team = {
  id: 't1', name: 'billing migration', goal: 'Move the pipeline to gold', dir: 'C:\\teams\\t1', createdAt: 0,
  owner: { id: 'new-9', title: 'Planning' },
  lead: { id: 'team-lead-x', title: 'billing migration: Lead' },
  members: [
    { id: 'team-b1', name: 'Builder API', role: 'builder', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-b2', name: 'Builder Web', role: 'builder', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-r1', name: 'Rev One', role: 'reviewer', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-r2', name: 'Rev Two', role: 'reviewer', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-qa', name: 'QA', role: 'qa', cwd: 'C:\\r', joinedAt: 0 },
  ],
}
const ids = (ref: string) => targetsOf(team, ref).map((x) => x.id)

test('posts reach a name, a whole role (singular or plural), Lead, Owner or everyone', () => {
  assert.deepEqual(ids('builder api'), ['team-b1'])
  assert.deepEqual(ids('builders'), ['team-b1', 'team-b2'])
  assert.deepEqual(ids('reviewer'), ['team-r1', 'team-r2'])
  assert.deepEqual(ids('Lead'), ['team-lead-x'])
  assert.deepEqual(ids('owner'), ['new-9'])
  assert.equal(ids('all').length, 6) // lead + 5, not the owner
  assert.deepEqual(ids('nobody'), [])
  assert.equal(nameOf(team, 'new-9'), 'Owner')
  assert.ok(canAct(team, 'new-9') && canAct(team, 'team-qa') && !canAct(team, 'stranger'))
  assert.ok(nameTaken(team, 'qa') && nameTaken(team, 'Owner') && !nameTaken(team, 'Builder 3'))
  assert.equal(slug('Builder: my-api!'), 'builder-my-api')
})

test('briefs: teammate gets roster, direct-talk rules and task; a separate Lead gets the Owner and add_teammate', () => {
  const b = teamBrief(team, team.members[4], 'Click through the pipeline page')
  for (const s of ['You are "QA" (qa)', 'Owner (thread new-9)', 'Builder Web (builder; thread team-b2)', '"builders", "reviewers" reaches all of them', 'C:\\teams\\t1', 'Never push', 'Your task: Click through the pipeline page']) assert.ok(b.includes(s), s)
  const l = leadBrief(team, 'Keep it to two builders')
  for (const s of ['You are the Lead', 'mcp__orbit__add_teammate', 'team_post to "Owner"', 'From the Owner: Keep it to two builders']) assert.ok(l.includes(s), s)
})

test('status shows owner, lead, each member state and the log', () => {
  const log = parseLog(`${JSON.stringify({ at: 0, from: 'team-qa', fromName: 'QA', to: ['Builder Web'], text: 'Stage filter shows Activated twice' })}\nnot json\n`)
  assert.equal(log.length, 1)
  const st = formatTeamStatus(team, { 'team-lead-x': { state: 'working', doing: 'planning' }, 'team-qa': { state: 'idle' } }, log)
  assert.match(st, /- Owner: closed/)
  assert.match(st, /- Lead: working, planning/)
  assert.match(st, /- QA \(qa\): idle/)
  assert.match(st, /QA -> Builder Web: Stage filter shows Activated twice/)
})

test('a teammate reopened under its session id is still that teammate; the Owner\'s queued report is never obsolete', () => {
  const t: Team = { ...team, members: [{ ...team.members[0], sessionId: 'sess-b1' }, ...team.members.slice(1)] }
  assert.equal(personId(t, 'sess-b1'), 'team-b1')
  assert.equal(nameOf(t, 'sess-b1'), 'Builder API')
  assert.equal(canAct(t, 'sess-b1'), true)
  assert.equal(canAct(t, 'stranger'), false)
  const q = [{ to: 'new-9', id: 'report' }, { to: 'team-b1', id: 'old post' }, { to: 'team-lead-x', id: 'lead post' }]
  assert.deepEqual(obsoleteQueued(t, q).map((x) => x.id), ['old post', 'lead post'])
})
