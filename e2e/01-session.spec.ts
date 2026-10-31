// Real Claude turns, kept few and cheap: Haiku, one-word replies. Every session runs in the throwaway workspace.
import { expect, test } from '@playwright/test'
import { close, launch, shot, TAG, type Launched } from './harness'
import { Hive } from './hive'

test.describe.serial('session', () => {
  let l: Launched
  let h: Hive
  test.beforeAll(async () => { l = await launch(); h = new Hive(l.page) })
  test.afterAll(async () => { await close(l) })

  test('the app launches', async () => {
    await expect(h.id('top-new')).toBeVisible()
    expect(await l.app.evaluate(({ app }) => app.getPath('userData'))).toContain('hive-e2e')
    await shot(l.page, 'session-launch')
  })

  test('a new session gets a reply (Haiku picked before the first message)', async () => {
    await h.newSession()
    await h.pickHaiku(false) // cheap from the first turn
    const reply = await h.sendAndWait(`${TAG}: reply with the word ok and nothing else`)
    expect(reply.toLowerCase()).toContain('ok')
    await shot(l.page, 'session-reply')
  })

  test('the model picker switches to Haiku and the top bar updates', async () => {
    await expect(h.topModel()).toContainText(/haiku/i) // the session started on the pick
    await h.pickHaiku() // and a pick on the live session updates the top bar
    await shot(l.page, 'session-haiku')
  })

  test('the model picked before the first message shows in the picker and top bar right away', async () => {
    // the page keeps the pick, so it shows before the session runs
    await h.newSession()
    await h.pickHaiku(true)
  })

  test('the effort picker works and the ultrathink highlight appears', async () => {
    await h.pickEffort('low')
    await expect(h.topModel()).toContainText('low')
    await h.type('please ultrathink about nothing')
    await expect(h.id('ultra-mirror').locator('mark')).toHaveText(/ultrathink/i)
    await expect(h.id('ultra-note')).toBeVisible()
    await expect(h.composer()).toHaveClass(/ultra/)
    await shot(l.page, 'session-ultrathink')
    await h.type('')
    await expect(h.id('ultra-note')).toHaveCount(0)
  })

  test('/context and /model return text', async () => {
    for (const cmd of ['/context', '/model']) {
      const before = await h.replies().count()
      await h.send(cmd)
      await expect.poll(() => h.replies().count(), { timeout: 90_000 }).toBeGreaterThan(before)
      await h.waitIdle()
      expect((await h.lastReply()).length).toBeGreaterThan(0)
    }
    await shot(l.page, 'session-slash-commands')
  })

  test('the / menu filters', async () => {
    await h.type('/')
    await expect(h.id('slash-item').first()).toBeVisible({ timeout: 30_000 })
    const all = await h.id('slash-item').count()
    await h.type('/conte')
    await expect(h.id('slash-item').filter({ hasText: '/context' }).first()).toBeVisible()
    expect(await h.id('slash-item').count()).toBeLessThan(all)
    await shot(l.page, 'session-slash-menu')
    await h.composer().press('Escape')
    await h.type('')
  })

  test('clean copy writes HTML plus text', async () => {
    // capture the clipboard write instead of touching the real clipboard
    await l.page.evaluate(() => {
      const w = window as unknown as { __copied: Record<string, string> }
      navigator.clipboard.write = async (items: ClipboardItem[]) => {
        const out: Record<string, string> = {}
        for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text()
        w.__copied = out
      }
    })
    const last = h.replies().last()
    await last.hover()
    await last.getByTestId('copy-msgcopy').click()
    const got = await l.page.waitForFunction(() => (window as unknown as { __copied?: Record<string, string> }).__copied).then((x) => x.jsonValue())
    expect(got['text/html']).toMatch(/<\w+/)
    expect(got['text/plain'].length).toBeGreaterThan(0)
  })

  test('steer and queue work', async () => {
    await h.send('Use the Bash tool to run exactly this command: sleep 20. After it finishes, reply with the word done.')
    await expect(h.working()).toBeVisible({ timeout: 60_000 })
    // default mode while busy: steer
    await h.sendMode('steer').click()
    await h.send('steer note: also add the word banana to your reply')
    await expect(h.userMsgs().filter({ hasText: 'steered while Claude worked' })).toHaveCount(1)
    await h.sendMode('queue').click()
    await h.send('queued note: reply with the word later')
    await expect(h.userMsgs().filter({ hasText: 'queued, sends when Claude finishes' })).toHaveCount(1)
    await shot(l.page, 'session-steer-queue')
    // the queued message goes in once the first turn ends, then that turn ends too
    await expect(h.userMsgs().filter({ hasText: 'queued, sends when Claude finishes' })).toHaveCount(0, { timeout: 180_000 })
    await h.waitIdle(180_000)
    await h.sendMode('steer').click().catch(() => {}) // back to the default for later runs (only shown while busy)
  })

  test('the MCP servers menu lists servers', async () => {
    await h.open('mcp')
    await expect(h.id('mcp-server').first()).toBeVisible({ timeout: 60_000 })
    await expect(h.id('mcp-server').filter({ hasText: 'hive' })).toHaveCount(1)
    await shot(l.page, 'session-mcp')
    await l.page.keyboard.press('Escape')
  })

  test('start_thread from a session creates a background thread', async () => {
    const title = `${TAG}-bg`
    await h.sendAndWait(`Call the start_thread tool of the hive MCP server with title "${title}" and prompt "Reply with the word ok and nothing else." Then reply with the word started.`)
    await h.open('sessions')
    await expect(h.sidebar().locator('[data-testid="live-row"]').filter({ hasText: title })).toHaveCount(1, { timeout: 60_000 })
    await shot(l.page, 'session-start-thread')
    await h.open('sessions')
  })
})
