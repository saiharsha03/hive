// Pull latest is one click in every layout: it runs in the background and leaves a note; a popup only when a repo
// failed. Test mode refuses the real pull, so the note says so and nothing in the demo repo changes.
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, DATA, launch, shot } from './harness'
import { Hive } from './hive'

const note = (h: Hive) => h.page.locator('.notice').filter({ hasText: 'Pull latest' })

test('Pull latest from the Default layout sidebar runs in the background and leaves a note', async () => {
  const l = await launch()
  try {
    const h = new Hive(l.page)
    await h.open('sessions')
    await l.page.getByText('Pull latest', { exact: true }).first().click()
    await expect(note(h).first()).toContainText(/test mode/i, { timeout: 30_000 })
    await expect(h.id('popover-pull')).toHaveCount(0)
    await expect(h.id('pull-result')).toHaveCount(0)
    await shot(l.page, 'pull-default-note')
  } finally {
    await close(l)
  }
})

test('Pull latest from the Thread strip dock runs in the background and leaves a note', async () => {
  const prefs = join(DATA, 'hive-prefs.json')
  const before = existsSync(prefs) ? readFileSync(prefs, 'utf8') : null
  writeFileSync(prefs, JSON.stringify({ ...(before ? JSON.parse(before) : {}), ui: 'strip' }))
  const l = await launch()
  try {
    const h = new Hive(l.page)
    await h.id('dock-pull').click()
    await expect(note(h).first()).toContainText(/test mode/i, { timeout: 30_000 })
    await expect(h.id('pull-result')).toHaveCount(0)
    await shot(l.page, 'pull-strip-note')
  } finally {
    await close(l)
    if (before === null) rmSync(prefs, { force: true }); else writeFileSync(prefs, before)
  }
})
