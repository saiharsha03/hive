// a live thread's process: when an ended team's thread closes, when an idle one may, its settings class, shared memory
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { busyWith, idleToClose, messageParts, retireStep, sharedMemoryDir, threadClass, type Activity } from '../../src/main/threadCore'

const quiet: Activity = { busy: false, queued: 0, unseen: 0, tasks: [], stopTasks: 0, codex: 0, crons: 0, wake: false, goal: false, asks: 0, rewind: false }

test('an ended team thread waits for its work, then closes; still running at the deadline it stays open, marked waiting', () => {
  assert.deepEqual(retireStep(quiet, 0, 600_000), { act: 'close' })
  const shell = { ...quiet, tasks: ['npm run dev'] } // a background shell counts too
  assert.deepEqual(retireStep(shell, 60_000, 600_000), { act: 'wait' })
  const late = retireStep(shell, 600_000, 600_000)
  assert.equal(late.act, 'keep')
  assert.match((late as { why: string }).why, /npm run dev running, so it was left open/)
  assert.equal(retireStep({ ...quiet, codex: 1 }, 700_000, 600_000).act, 'keep')
})

test('an idle process closes only after the limit, with nothing running or waiting; 0 = never', () => {
  const hour = 3_600_000
  assert.equal(idleToClose(quiet, hour, 30 * 60_000), true)
  assert.equal(idleToClose(quiet, 10 * 60_000, 30 * 60_000), false)
  assert.equal(idleToClose(quiet, hour, 0), false)
  for (const k of ['busy', 'goal', 'wake', 'rewind'] as const) assert.equal(idleToClose({ ...quiet, [k]: true }, hour, 60_000), false, k)
  for (const k of ['queued', 'unseen', 'stopTasks', 'codex', 'crons', 'asks'] as const) assert.equal(idleToClose({ ...quiet, [k]: 1 }, hour, 60_000), false, k)
  assert.equal(idleToClose({ ...quiet, tasks: ['agent'] }, hour, 60_000), false)
  assert.deepEqual(busyWith({ ...quiet, queued: 2, crons: 1, asks: 1 }), ['2 queued messages', '1 scheduled loop', 'an open question'])
})

test('settings class: watcher runs and Dependabot reviews are background, teammates and a team Lead are team', () => {
  assert.equal(threadClass('new-1', false), 'main')
  assert.equal(threadClass('thread-ab12', false), 'main') // start_thread: the user's main defaults
  assert.equal(threadClass('watcher-deploy-1', false), 'background')
  assert.equal(threadClass('abc-session', true), 'background') // a watcher's session resumed under another tab id
  assert.equal(threadClass('dependabot-o-r-12-1', false), 'background')
  assert.equal(threadClass('team-builder-1a2b', false), 'team')
  assert.equal(threadClass('team-lead-billing-1a2b', false), 'team')
})

test('threads under the workspace root share its auto-memory folder; the root itself and other folders keep their own', () => {
  const claude = 'C:\\Users\\me\\.claude'
  const root = 'C:\\ws'
  const want = 'C:\\Users\\me\\.claude\\projects\\C--ws\\memory'.replace(/\\/g, '/')
  const at = (cwd: string, extra: string[] = []) => sharedMemoryDir(cwd, root, extra, claude, true)?.replace(/\\/g, '/') ?? null
  assert.equal(at('C:\\ws\\app'), want)
  assert.equal(at('c:\\WS\\app\\src'), want)
  assert.equal(at('C:\\ws\\.hive-worktrees\\app\\feat-x'), want)
  assert.equal(at('C:\\ws'), null)
  assert.equal(at('C:\\ws\\'), null)
  assert.equal(at('C:\\wsother\\app'), null)
  assert.equal(at('D:\\elsewhere'), null)
  assert.equal(at('D:\\trees\\app\\main', ['D:\\trees']), want) // a worktrees folder outside the root
  assert.equal(sharedMemoryDir('C:\\ws\\app', '', [], claude, true), null) // no root configured
  assert.equal(sharedMemoryDir('/home/me/ws/app', '/home/me/ws', [], '/home/me/.claude', false)?.replace(/\\/g, '/'), '/home/me/.claude/projects/-home-me-ws/memory')
})

test('a message as it went in, for the message box', () => {
  assert.deepEqual(messageParts('plain'), { text: 'plain', images: [] })
  assert.deepEqual(messageParts([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'look' }]),
    { text: 'look', images: [{ mediaType: 'image/png', data: 'AAA' }] })
  assert.deepEqual(messageParts(undefined), { text: '', images: [] })
})
