// Real Claude turns, kept few and cheap: Haiku at low effort (the run's settings, so background threads too), one-word
// replies. Every session runs in the throwaway workspace; global-teardown.ts deletes their transcripts afterwards.
import { expect, test } from '@playwright/test'
import { close, launch, shot, TAG, TEST_GENERAL, type Launched } from './harness'
import { Orbit } from './hive'

test.describe.serial('session', () => {
  let l: Launched
  let h: Orbit
  test.beforeAll(async () => { l = await launch(); h = new Orbit(l.page) })
  test.afterAll(async () => { await close(l) })

  test('the app launches', async () => {
    await expect(h.id('top-new')).toBeVisible()
    expect(await l.app.evaluate(({ app }) => app.getPath('userData'))).toContain('hive-e2e')
    // the run's settings were in place before the app started: every thread defaults to Haiku at low effort
    const general = await l.page.evaluate(async () => (await (window as any).api.settingsGet()).general)
    expect(general).toMatchObject({ model: TEST_GENERAL.model, effort: TEST_GENERAL.effort, chrome: false })
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
    await expect(h.effortPicker()).toContainText('low')
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
    const got = await l.page.waitForFunction(() => (window as unknown as { __copied?: Record<string, string> }).__copied).then((x) => x.jsonValue()) ?? {}
    expect(got['text/html']).toMatch(/<\w+/)
    expect(got['text/plain'].length).toBeGreaterThan(0)
    // the Copy button sits beside the text, never on it (it covered the end of the first line)
    const overlaps = await last.evaluate((m) => {
      const b = m.querySelector('.msgcopy')!.getBoundingClientRect()
      const walk = document.createTreeWalker(m.querySelector('.body')!, NodeFilter.SHOW_TEXT)
      const r = document.createRange()
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        r.selectNodeContents(n)
        for (const t of r.getClientRects()) if (t.left < b.right && t.right > b.left && t.top < b.bottom && t.bottom > b.top) return true
      }
      return false
    })
    expect(overlaps).toBe(false)
  })

  test('a permission request shows its Allow / Deny card in the thread, and Allow runs the call', async () => {
    const before = (await h.id('mode-picker').innerText()).replace(/^\s*mode\s*/i, '').replace(/, switch failed$/, '').trim()
    await h.id('mode-picker').click()
    await h.id('mode-list').locator('.pop-row').filter({ hasText: 'Manual' }).first().click()
    await expect(h.id('mode-picker')).toContainText(/manual/i)
    // a command that writes (a read-only one such as echo runs without asking, even in Manual)
    await h.send(`${TAG}: use the Bash tool to run exactly: touch orbit-perm-check.txt. Then reply with the word done`)
    const card = h.id('ask-card').filter({ hasText: /Allow Bash/ })
    await expect(card).toBeVisible({ timeout: 120_000 })
    await shot(l.page, 'session-permission-card')
    await card.getByTestId('ask-option').filter({ hasText: /^1\s*Allow\s*Run it this once/ }).click()
    await card.getByTestId('ask-submit').click()
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    await h.waitIdle()
    expect((await h.lastReply()).toLowerCase()).toContain('done')
    // back to the mode the thread had, as the tests after this one expect
    await h.id('mode-picker').click()
    await h.id('mode-list').locator('.pop-row').filter({ hasText: new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click()
    await expect(h.id('mode-picker')).toContainText(new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  })

  test('steer and queue work', async () => {
    await h.send('Use the Bash tool to run exactly this command: sleep 20. After it finishes, reply with the word done.')
    await expect(h.working()).toBeVisible({ timeout: 60_000 })
    // Enter steers the running turn; Claude marks it seen at its next step
    await h.sendAs('steer', 'steer note: also add the word banana to your reply')
    await expect(h.userMsgs().filter({ hasText: 'steer note' }).getByTestId('msg-seen')).toHaveCount(1, { timeout: 120_000 })
    // Tab queues it for after the turn: it waits in the queue box, numbered
    await h.sendAs('queue', 'queued note: reply with the word later')
    await expect(h.queueBox()).toContainText('queued note')
    await shot(l.page, 'session-steer-queue')
    // the queued message goes in once the first turn ends, then that turn ends too
    await expect(h.queueBox()).toHaveCount(0, { timeout: 180_000 })
    await expect(h.userMsgs().filter({ hasText: 'queued note' })).toHaveCount(1)
    await h.waitIdle(180_000)
  })

  test('interrupt stops the running turn and sends at once', async () => {
    await h.send('Use the Bash tool to run exactly this command: sleep 90. After it finishes, reply with the word done.')
    await expect(h.working()).toBeVisible({ timeout: 60_000 })
    await expect(h.id('chat-stop')).toBeVisible()
    const t0 = Date.now()
    await h.sendAs('interrupt', 'interrupt note: forget the sleep and reply with only the word pivot')
    await expect(h.queueBox()).toContainText('interrupting Claude, sends next')
    // handed over as soon as the stopped turn ends, long before the 90 s sleep would have
    await expect(h.queueBox()).toHaveCount(0, { timeout: 60_000 })
    await h.waitIdle(120_000)
    expect(Date.now() - t0).toBeLessThan(85_000)
    await expect(h.replies().last()).toContainText(/pivot/i)
  })

  test('the Status and usage page lists the MCP servers', async () => {
    await h.open('mcp')
    await expect(h.id('mcp-server').first()).toBeVisible({ timeout: 60_000 })
    await expect(h.id('mcp-server').filter({ hasText: 'orbit' })).toHaveCount(1)
    await shot(l.page, 'session-mcp')
    // the page is a tab now (it was a popover that Esc closed): close its tab, so the thread is back in the pane
    await h.id('tab-close-tool:status').click()
    await expect(h.id('page-status')).toHaveCount(0)
    await expect(h.composer()).toBeVisible()
  })

  // (the sidebar list hides sessions under the temp folder, where test threads run, so only the tab is checked)
  test('rename_thread names the thread: its tab shows the new title', async () => {
    const title = `${TAG} renamed thread`
    await h.sendAndWait(`Call the rename_thread tool of the hive MCP server with title "${title}". Then reply with the word ok.`)
    await expect(h.id('tab').filter({ hasText: title })).toHaveCount(1, { timeout: 30_000 })
    await shot(l.page, 'session-renamed')
  })

  test('/btw answers above the message box and stays out of the conversation', async () => {
    const before = await h.userMsgs().count()
    await h.composer().fill('/btw what did we just do?')
    await h.composer().press('Enter')
    await expect(h.id('btw-answer')).toContainText('what did we just do?')
    await expect(h.id('btw-answer')).toContainText(/test mode/i) // test mode never asks Claude
    expect(await h.userMsgs().count()).toBe(before)
    await h.id('btw-dismiss').click()
    await expect(h.id('btw-answer')).toHaveCount(0)
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
