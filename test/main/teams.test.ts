import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hive-teams-'))
process.env.HIVE_TEAMS_DIR = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('team folder: create, members, log, knowledge, end; read back from disk', async () => {
  const t = await import('../../src/main/teams')
  const changes: string[] = []
  t.onTeamChange((id) => changes.push(id))
  const team = t.createTeam('HelixPrevent migration', 'Move the pipeline to gold', { lead: { id: 'new-1', title: 'Gold plan' } }, Date.UTC(2026, 10, 5))
  assert.equal(team.id, '2026-11-05-helixprevent-migration')
  assert.equal(t.createTeam('HelixPrevent migration', 'again', { lead: { id: 'new-2', title: 'x' }, owner: { id: 'new-1', title: 'Gold plan' } }, Date.UTC(2026, 10, 5)).id, '2026-11-05-helixprevent-migration-2')
  t.addMember(team, { id: 'team-qa-1', name: 'QA', role: 'qa', cwd: dir, joinedAt: 1 })
  t.appendLog(team, { at: 2, from: 'team-qa-1', fromName: 'QA', to: ['Lead'], text: 'done' })
  t.addKnowledge(team, 'QA', 'staging db is helix_ci_local\nnot prod')
  assert.match(readFileSync(join(team.dir, 'knowledge.md'), 'utf8'), /- staging db is helix_ci_local not prod \(QA, /)
  assert.match(t.readTeamFile(team, 'plan.md'), /\| Part \| Owner \| State \| Notes \|/)
  assert.equal(t.teamOf('team-qa-1')?.id, team.id)
  assert.equal(t.teamOf('new-1')?.id, team.id)
  assert.deepEqual(t.ownedTeams('new-1').map((x) => x.id), ['2026-11-05-helixprevent-migration-2'])
  t.resetTeamsCache()
  const back = t.getTeam(team.id)!
  assert.deepEqual([back.members[0].name, t.readLog(back)[0].text], ['QA', 'done'])
  t.endTeam(back)
  assert.equal(t.teamOf('team-qa-1'), undefined)
  assert.ok(changes.includes(team.id))
})
