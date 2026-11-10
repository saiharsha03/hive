import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRole, roleFile, roleId, tail } from '../../src/shared/roleCore'

const dir = mkdtempSync(join(tmpdir(), 'hive-roles-'))
process.env.HIVE_ROLES_DIR = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('role ids, role file round trip, memory tail', () => {
  assert.deepEqual(['Builders', 'builder', 'Senior Builder!', 'QA'].map(roleId), ['builder', 'builder', 'senior-builder', 'qa'])
  const r = { id: 'qa', name: 'QA', summary: 'Uses the product.', instructions: 'Click.\n\nReport.' }
  assert.deepEqual(parseRole('qa', roleFile(r)), r)
  const long = ['# head', ...Array.from({ length: 70 }, (_, i) => `- l${i}`)].join('\n')
  const t = tail(long, 60).split('\n')
  assert.deepEqual([t[0], t[1], t.length], ['(10 earlier lines in the file)', '- l10', 61])
})

test('roles folder: defaults seeded, new role created, memories grow and reach the brief', async () => {
  const roles = await import('../../src/main/roles')
  const ids = roles.listRoles().map((r) => r.id)
  assert.equal(ids[0], 'lead')
  for (const id of ['builder', 'reviewer', 'validator', 'qa', 'researcher']) assert.ok(ids.includes(id), id)
  assert.equal(roles.ensureRole('Data Engineers').id, 'data-engineer')
  roles.remember('role', 'builders', 'api tests run in Docker: make test-docker', 'Builder API')
  roles.remember('shared', 'qa', 'Never use the emulator', 'QA')
  assert.match(readFileSync(roles.roleMemoryPath('builder'), 'utf8'), /- api tests run in Docker: make test-docker \(Builder API, /)
  const b = roles.briefForRole('Builder')
  assert.match(b, /Your role, Builder: Writes the code/)
  assert.match(b, /What earlier Builders learned[\s\S]*make test-docker/)
  assert.match(b, /What every role learned[\s\S]*Never use the emulator/)
})

test('the Lead defines a new role; it stays in the library and keeps its memory', async () => {
  const roles = await import('../../src/main/roles')
  roles.remember('role', 'Migration Planner', 'Order: schema, backfill, swap reads', 'Lead')
  roles.defineRole('Migration Planner', 'Orders the steps of a data migration.', 'Write the step order and the rollback for each step.')
  const r = roles.listRoles().find((x) => x.id === 'migration-planner')!
  assert.equal(r.summary, 'Orders the steps of a data migration.')
  assert.match(roles.briefForRole('migration planner'), /Write the step order[\s\S]*Order: schema, backfill, swap reads/)
})

test('a brief carries the newest memory entries within the budget; the file keeps them all', async () => {
  const roles = await import('../../src/main/roles')
  for (let i = 0; i < 400; i++) roles.remember('role', 'Researcher', `lesson number ${i} with some words to take up room`, 'R', Date.UTC(2026, 0, 1))
  const file = roles.roleMemoryPath('researcher')
  assert.equal(readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- lesson')).length, 400) // nothing cut on disk
  const cut = roles.newestWithin(readFileSync(file, 'utf8'), 1024, file)
  assert.ok(Buffer.byteLength(cut) < 1024 + 200)
  assert.match(cut, /^\(\d+ older entries not shown; the whole memory is in .*memory\.md\)/)
  assert.match(cut, /lesson number 399 /)
  assert.doesNotMatch(cut, /lesson number 0 /)
  const b = roles.briefForRole('researcher', 6 * 1024)
  assert.match(b, /lesson number 399 /)
  assert.doesNotMatch(b, /lesson number 10 /)
  assert.equal(roles.newestWithin('# head\n- a (x, 2026-01-01)\n', 1024, file), '- a (x, 2026-01-01)') // all fits: no note
})
