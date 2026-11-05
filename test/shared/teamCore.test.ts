import { test } from 'vitest'
import assert from 'node:assert/strict'
import { findMember, formatTeamStatus, parseLog, slug, teamBrief, type Team } from '../../src/shared/teamCore'

const team: Team = {
  id: 't1', name: 'HelixPrevent migration', goal: 'Move the pipeline to gold', dir: 'C:\\teams\\t1', createdAt: 0,
  lead: { id: 'new-1', title: 'Gold plan' },
  members: [
    { id: 'team-builder-api-ab12', name: 'Builder API', role: 'builder', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-qa-cd34', name: 'QA', role: 'qa', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-rev-1', name: 'Rev One', role: 'reviewer', cwd: 'C:\\r', joinedAt: 0 },
    { id: 'team-rev-2', name: 'Rev Two', role: 'reviewer', cwd: 'C:\\r', joinedAt: 0 },
  ],
}

test('teammates are found by name, unique role, id or "lead"; a shared role is ambiguous', () => {
  assert.equal(findMember(team, 'builder api')?.id, 'team-builder-api-ab12')
  assert.equal(findMember(team, 'builder')?.id, 'team-builder-api-ab12')
  assert.equal(findMember(team, 'team-qa-cd34')?.name, 'QA')
  assert.equal(findMember(team, 'Lead')?.id, 'new-1')
  assert.equal(findMember(team, 'reviewer'), null)
  assert.equal(findMember(team, 'nobody'), null)
  assert.equal(slug('Builder: helix-api!'), 'builder-helix-api')
})

test('brief names the teammate, roster, folder, rules and task; status shows states and the log', () => {
  const b = teamBrief(team, team.members[1], 'Click through the pipeline page')
  for (const s of ['You are "QA" (qa)', 'Builder API (builder; thread team-builder-api-ab12)', 'C:\\teams\\t1', 'Never push', 'Your task: Click through the pipeline page']) assert.ok(b.includes(s), s)
  const log = parseLog(`${JSON.stringify({ at: 0, from: 'team-qa-cd34', fromName: 'QA', to: ['Builder API'], text: 'Stage filter shows Activated twice' })}\nnot json\n`)
  assert.equal(log.length, 1)
  const st = formatTeamStatus(team, { 'new-1': { state: 'working', doing: 'planning' }, 'team-qa-cd34': { state: 'idle' } }, log)
  assert.match(st, /- Lead: working, planning/)
  assert.match(st, /- QA \(qa\): idle/)
  assert.match(st, /- Builder API \(builder\): closed/)
  assert.match(st, /QA -> Builder API: Stage filter shows Activated twice/)
})
