// Quarry is never started in test mode (it would reach the user's real databases), so the feature stays invisible:
// no Quarry link in the rail, and the Settings row says how to name the exe. Needs no Quarry install.
import { expect, test } from '@playwright/test'
import { close, launch } from './harness'
import { Hive } from './hive'

test('without a usable Quarry there is no Quarry page link; Settings has the path row', async () => {
  const l = await launch()
  try {
    const h = new Hive(l.page)
    await expect(h.id('rail-view-workspace')).toBeVisible()
    await expect(h.id('rail-view-quarry')).toHaveCount(0)
    const st = await l.page.evaluate(() => window.api.quarryStatus())
    expect(st.available).toBe(false)
    await h.id('rail-view-settings').click()
    await h.id('settings-nav-general').click()
    await expect(l.page.getByTestId('settings-quarry').first()).toBeAttached({ timeout: 30_000 })
  } finally {
    await close(l)
  }
})
