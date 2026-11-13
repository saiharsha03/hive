// Pull latest is one click on the status line: it runs in the background and leaves a note; the Workspace page lists
// what each repo did. Test mode refuses the real pull, so the note says so and nothing in the demo repo changes.
import { expect, test } from '@playwright/test'
import { close, launch, shot } from './harness'
import { Orbit } from './hive'

const note = (h: Orbit) => h.page.locator('.toast').filter({ hasText: 'Pull latest' })

test('Pull latest from the status line runs in the background and leaves a note', async () => {
  const l = await launch()
  try {
    const h = new Orbit(l.page)
    await h.open('sessions')
    await h.id('status-pull').click()
    await expect(note(h).first()).toContainText(/test mode/i, { timeout: 30_000 })
    await expect(h.id('popover-pull')).toHaveCount(0)
    await expect(h.id('pull-result')).toHaveCount(0)
    await shot(l.page, 'pull-default-note')
  } finally {
    await close(l)
  }
})

test('Pull latest from the Workspace page runs and says what each repo did', async () => {
  const l = await launch()
  try {
    const h = new Orbit(l.page)
    await h.id('rail-view-workspace').click()
    await h.id('ws-tab-pull').click()
    await h.id('dock-pull').click()
    await expect(h.id('page-workspace')).toContainText(/test mode/i, { timeout: 30_000 })
    await shot(l.page, 'pull-workspace')
  } finally {
    await close(l)
  }
})
