// Pin, snooze, close and archive four sidebar threads, relaunch, and find each where it belongs. The states go to the
// test data folder's hive-threads.json, never the real one.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, DATA, launch, shot, type Launched } from './harness'
import { Hive } from './hive'

test('thread pin, snooze, close and archive persist across a relaunch', async () => {
  let l: Launched = await launch()
  let h = new Hive(l.page)
  await h.open('sessions')
  await expect(h.rows().nth(3)).toBeVisible({ timeout: 60_000 })
  const ids = await h.rows().evaluateAll((rs) => rs.slice(0, 4).map((r) => r.getAttribute('data-id')!))
  const [pinned, snoozed, closed, archived] = ids

  await h.threadAction(pinned, /^Pin$/)
  await expect(h.section('pinned').locator(`[data-id="${pinned}"]`)).toBeVisible()
  await h.threadAction(snoozed, /^Snooze/)
  await h.id('thread-menu').getByRole('button', { name: 'In 3 hours' }).click()
  await h.threadAction(closed, /^Close$/)
  await h.threadAction(archived, /^Archive$/)
  await expect(h.row(archived)).toHaveCount(0)
  await shot(l.page, 'threads-organized')

  const saved = JSON.parse(readFileSync(join(DATA, 'hive-threads.json'), 'utf8'))
  expect(saved[pinned]?.pinned).toBeTruthy()
  expect(saved[snoozed]?.snoozedUntil).toBeGreaterThan(Date.now())
  expect(saved[closed]?.closedAt).toBeTruthy()
  expect(saved[archived]?.archivedAt).toBeTruthy()

  await close(l)
  l = await launch()
  h = new Hive(l.page)
  await h.open('sessions')
  await expect(h.section('pinned').locator(`[data-id="${pinned}"]`)).toBeVisible({ timeout: 60_000 })
  await h.unfold('snoozed')
  await expect(h.section('snoozed').locator(`[data-id="${snoozed}"]`)).toBeVisible()
  await h.unfold('closed')
  await expect(h.section('closed').locator(`[data-id="${closed}"]`)).toBeVisible()
  await expect(h.row(archived)).toHaveCount(0)
  await shot(l.page, 'threads-after-relaunch')
  await h.id('archive-view').click()
  await expect(h.section('archived').locator(`[data-id="${archived}"]`)).toBeVisible()
  await shot(l.page, 'threads-archived')
  await close(l)
})
