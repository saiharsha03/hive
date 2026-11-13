// Watchers under test mode: the list, a watcher made through the New watcher form (in the temp data folder only), its
// switch, editing a watcher's schedule in its detail view, and proof that nothing runs on its own, not even past the
// scheduler's first tick.
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { close, DATA, launch, shot, TAG, type Launched } from './harness'
import { Orbit } from './hive'

// the weekly usage the app sees under test mode (it reads none from Claude): 55% falls in the default tiers' second row
process.env.HIVE_TEST_WEEKLY_PCT = '55'

const ROOT = join(DATA, 'hive', 'watchers')
const REAL = join(homedir(), '.claude', 'hive', 'watchers')
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
// the watcher folder the form made, found by its name
const findWatcher = (name: string): string | null => {
  if (!existsSync(ROOT)) return null
  for (const id of readdirSync(ROOT)) {
    const f = join(ROOT, id, 'watcher.json')
    if (existsSync(f) && readJson(f).name === name) return id
  }
  return null
}
const runsOf = (id: string): unknown[] => {
  const f = join(ROOT, id, 'state.json')
  return existsSync(f) ? (readJson(f).runs ?? []) : []
}

test.describe.serial('watchers', () => {
  let l: Launched
  let h: Orbit
  const name = `${TAG} watcher`
  let id = ''
  let schedId = ''
  test.beforeAll(async () => { l = await launch(); h = new Orbit(l.page) })
  test.afterAll(async () => { await close(l) })

  test('the Watchers view lists watchers and says test mode', async () => {
    await h.open('watch')
    await expect(h.id('watchers-panel')).toBeVisible()
    await expect(h.id('watchers-summary')).toContainText('test mode')
    await shot(l.page, 'watchers-list')
  })

  test('the New watcher form validates its schedule', async () => {
    await h.id('watcher-new').click()
    await h.id('watcher-name').fill(name)
    await h.id('watcher-goal').fill('Test goal: never runs; made by the e2e suite.')
    await h.id('watcher-fixed').click()
    await h.id('watchers-panel').locator('.wnew input.num').first().fill('soon')
    await expect(h.id('watcher-error')).toContainText('Interval')
    await expect(h.id('watcher-create')).toBeDisabled()
    await shot(l.page, 'watchers-bad-interval')
    await h.id('watchers-panel').locator('.wnew input.num').first().fill('1h')
    await expect(h.id('watcher-error')).toHaveCount(0)
  })

  test('the New watcher form creates one in the temp data folder, and it does not start', async () => {
    await h.id('watcher-create').click()
    await expect(h.id('watcher-row').filter({ hasText: name })).toHaveCount(1)
    id = findWatcher(name) ?? ''
    expect(id).not.toBe('')
    expect(existsSync(join(ROOT, id, 'watcher.json'))).toBe(true)
    expect(existsSync(join(REAL, id))).toBe(false) // never the real folder
    expect(readJson(join(ROOT, id, 'watcher.json')).enabled).toBe(true)
    expect(runsOf(id)).toHaveLength(0)
    await shot(l.page, 'watchers-created')
  })

  test('toggling a test watcher off and on works', async () => {
    const row = h.id('watcher-row').filter({ hasText: name })
    const toggle = row.getByTestId('watcher-toggle')
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => readJson(join(ROOT, id, 'watcher.json')).enabled).toBe(false)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(() => readJson(join(ROOT, id, 'watcher.json')).enabled).toBe(true)
    expect(runsOf(id)).toHaveLength(0)
  })

  test('a watcher schedule is edited in its detail view: tiers validate, save writes watcher.json, next run follows', async () => {
    // an adaptive test watcher written straight into the temp data folder, its last sweep 10 minutes ago
    schedId = `${TAG.toLowerCase()}-sched`
    const dir = join(ROOT, schedId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'prompt.md'), 'Test watcher: never runs.\n')
    writeFileSync(join(dir, 'watcher.json'), JSON.stringify({
      name: `${TAG} sched`, goal: 'Schedule editor test', enabled: true, schedule: { every: 'adaptive', tiers: '50:1h,60:3h,70:6h,100:1d', daily: null, weekly: null },
      cwd: '', prompt: 'prompt.md', createdBy: 'e2e', createdAt: new Date().toISOString(),
    }))
    const last = Date.now() - 10 * 60_000
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ since: last, last: { sweep: last, daily: last, weekly: last }, tabId: null, sessionId: null, promptSent: null, runs: [] }))
    await h.id('watchers-reload').click()
    await h.id('watcher-row').filter({ hasText: `${TAG} sched` }).click()
    const s = h.schedule()
    await expect(s).toBeVisible()
    await expect(h.tierRows()).toHaveCount(4)
    // the live weekly use (55%) marks the second tier, and the next run is 3 h after the last sweep
    await expect(h.currentTier()).toHaveAttribute('data-index', '1')
    await expect(h.currentTier().getByTestId('tier-usage')).toContainText('55%')
    await expect(h.id('watcher-next')).toHaveAttribute('data-next', String(last + 3 * 3_600_000))

    // a falling threshold is an error and blocks saving
    await h.tierRows().nth(1).getByTestId('tier-below').fill('40')
    await expect(s.getByTestId('schedule-error')).toContainText('rise')
    await expect(s.getByTestId('schedule-save')).toBeDisabled()
    await shot(l.page, 'watchers-schedule-error')
    // so is an interval that does not parse
    await h.tierRows().nth(1).getByTestId('tier-below').fill('60')
    await h.tierRows().nth(1).getByTestId('tier-every').fill('soon')
    await expect(s.getByTestId('schedule-error')).toContainText('interval')
    await expect(s.getByTestId('schedule-save')).toBeDisabled()

    // add and remove a row, reset to the default
    await s.getByTestId('tier-add').click()
    await expect(h.tierRows()).toHaveCount(5)
    await h.tierRows().nth(4).getByTestId('tier-remove').click()
    await s.getByTestId('tier-reset').click()
    await expect(h.tierRows().nth(1).getByTestId('tier-every')).toHaveValue('3h')

    // tier 2 every 30m, saved: watcher.json changes and the next run moves to 30 min after the last sweep
    await h.tierRows().nth(1).getByTestId('tier-every').fill('30m')
    await expect(s.getByTestId('schedule-error')).toHaveCount(0)
    await s.getByTestId('schedule-save').click()
    await expect(s.getByTestId('schedule-saved')).toContainText('Saved')
    await expect.poll(() => readJson(join(dir, 'watcher.json')).schedule.tiers).toBe('50:1h,60:30m,70:6h,100:1d')
    await expect(h.id('watcher-next')).toHaveAttribute('data-next', String(last + 30 * 60_000))
    await expect(s.getByTestId('schedule-save')).toBeDisabled() // nothing left unsaved

    // a fixed interval with a weekly report, also saved through the app
    await s.getByTestId('schedule-mode-fixed').check()
    await s.getByTestId('schedule-every').fill('2h')
    await s.getByTestId('schedule-weekly-day').selectOption('mon')
    await expect(s.getByTestId('schedule-error')).toContainText('time')
    await s.getByTestId('schedule-weekly-time').fill('08:00')
    await s.getByTestId('schedule-save').click()
    await expect.poll(() => readJson(join(dir, 'watcher.json')).schedule).toEqual({ every: '2h', daily: null, weekly: 'Mon 08:00' })
    await expect(h.id('watcher-row').filter({ hasText: `${TAG} sched` })).toContainText('every 2h, weekly Mon 08:00')
    expect(runsOf(schedId)).toHaveLength(0) // saving never starts a run in test mode
    await shot(l.page, 'watchers-schedule-saved')
  })

  test('nothing auto-runs in test mode: Run now is refused and the scheduler stays quiet', async () => {
    await h.id('watcher-row').filter({ hasText: name }).click()
    await h.id('watcher-run').click()
    await l.page.waitForTimeout(1500)
    expect(runsOf(id)).toHaveLength(0)
    // the scheduler's first tick would come 60 s after launch; wait past it
    await l.page.waitForTimeout(65_000)
    expect(runsOf(id)).toHaveLength(0)
    expect(runsOf(schedId)).toHaveLength(0)
    await expect(h.id('live-row').filter({ hasText: name })).toHaveCount(0)
    await expect(h.id('watcher-row').filter({ hasText: name })).not.toContainText('running')
    await shot(l.page, 'watchers-nothing-ran')
  })
})
