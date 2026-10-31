// Pull latest from the Tools list: the panel lists the repos under the root and "Check only" reports per repo.
// Test mode refuses the real pull, so nothing in the demo repo changes.
import { expect, test } from '@playwright/test'
import { close, launch, shot } from './harness'
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
