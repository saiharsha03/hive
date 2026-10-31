// Pull latest from the Tools list: the panel lists the repos under the root and "Check only" reports per repo.
// Test mode refuses the real pull, so nothing in the demo repo changes.
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, DATA, launch, shot } from './harness'
import { Hive } from './hive'

test('Pull latest lists repos and Check only reports on each', async () => {
  const l = await launch()
  const h = new Hive(l.page)
  await h.open('sessions')
  await l.page.getByText('Pull latest', { exact: true }).first().click()
  const panel = l.page.locator('.tool').filter({ hasText: 'Fetches every repo' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await shot(l.page, 'pull-open')
  await h.id('pull-button-2').click()
  await expect(panel.getByText(/already up to date|would |skipped|failed/).first()).toBeVisible({ timeout: 60_000 })
  await shot(l.page, 'pull-checked')
  await h.id('pull-button-1').click()
  await expect(panel.getByText(/test mode/i).first()).toBeVisible({ timeout: 30_000 })
  await close(l)
})

// the Thread strip & dock layout opens Pull latest as a popover from the top Tools menu
test('Pull latest from the Tools menu in the Thread strip layout', async () => {
  const prefs = join(DATA, 'hive-prefs.json')
  const before = existsSync(prefs) ? readFileSync(prefs, 'utf8') : null
  writeFileSync(prefs, JSON.stringify({ ...(before ? JSON.parse(before) : {}), ui: 'strip' }))
  const l = await launch()
  try {
    const h = new Hive(l.page)
    await h.id('menu-tools').click()
    await h.id('menu-tools-pull').click()
    const pop = h.id('popover-pull')
    await expect(pop).toBeVisible({ timeout: 20_000 })
    await h.id('pull-button-2').click()
    await expect(pop.getByText(/already up to date|would |skipped|failed/).first()).toBeVisible({ timeout: 60_000 })
    await shot(l.page, 'pull-strip-checked')
    await h.id('pull-button-1').click()
    await expect(pop.getByText(/test mode/i).first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await close(l)
    if (before === null) rmSync(prefs, { force: true }); else writeFileSync(prefs, before)
  }
})
