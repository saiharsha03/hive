// The per-thread advisor: an Advisor group at the bottom of the model menu (Off, Default, the models). Picking one calls
// main's chat:setAdvisor for that thread and the composer's quiet line says "advisor <model>"; Off takes the word away.
// Test mode passes no advisor to Claude, so only the window and the IPC call are checked; no Claude turn is sent.
import { expect, test } from '@playwright/test'
import { close, launch, shot } from './harness'
import { Orbit } from './hive'

test('the model menu sets a thread advisor and the message box line shows it', async () => {
  const l = await launch()
  try {
    const h = new Orbit(l.page)
    // every chat:setAdvisor call is recorded on its way to main's own handler, which still runs
    await l.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __advisorCalls: [string, string][] }
      g.__advisorCalls = []
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
      const real = handlers.get('chat:setAdvisor')!
      ipcMain.removeHandler('chat:setAdvisor')
      ipcMain.handle('chat:setAdvisor', (e, tabId: string, model: string) => { g.__advisorCalls.push([tabId, model]); return real(e, tabId, model) })
    })
    const calls = () => l.app.evaluate(() => (globalThis as unknown as { __advisorCalls: [string, string][] }).__advisorCalls)

    await h.newSession()
    await expect(h.id('advisor-word')).toHaveCount(0) // no advisor anywhere: the line stays as it was
    await h.modelPicker().click()
    const list = h.id('model-list')
    await expect(list.getByTestId('model-list-group')).toHaveText('Advisor', { timeout: 60_000 })
    await expect(list.getByTestId('model-list-advisor-off')).toBeVisible()
    await expect(list.getByTestId('model-list-advisor-default')).toBeVisible()
    const row = list.locator('[data-testid^="model-list-advisor:"]').filter({ hasText: /haiku/i }).first()
    const id = (await row.getAttribute('data-testid'))!.replace('model-list-advisor:', '')
    await row.click()

    await expect(h.id('advisor-word')).toHaveText(/^advisor .*haiku/i)
    const tab = await l.page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-id')
    await expect.poll(calls).toEqual([[tab, id]])
    // the menu ticks the pick
    await h.modelPicker().click()
    await expect(h.id('model-list').getByTestId(`model-list-advisor:${id}`)).toHaveClass(/\bon\b/)
    await shot(l.page, 'advisor-picked')
    // Off: main is told '' and the word goes
    await h.id('model-list').getByTestId('model-list-advisor-off').click()
    await expect(h.id('advisor-word')).toHaveCount(0)
    await expect.poll(calls).toEqual([[tab, id], [tab, '']])
  } finally {
    await close(l)
  }
})
