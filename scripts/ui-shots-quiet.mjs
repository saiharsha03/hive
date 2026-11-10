// The quiet desk's proof, run by ui-shots.mjs with QUIET=<folder> after the main view is set up: every theme of the
// main window, the main view with nothing needing you (answered from the rail), each page, the account switcher, the
// editor beside its thread and a narrow window. Nothing reaches Claude: ui-shots.mjs answers every chat call.
const THEMES = [['Quiet', 'quiet'], ['Graphite', 'graphite'], ['Classic', 'classic'], ['Midnight', 'midnight'], ['Forest', 'forest'], ['Slate', 'slate'], ['Mocha', 'mocha'], ['Light', 'light'], ['Paper', 'paper'], ['High contrast', 'high-contrast']]

export default async function quiet({ app, page, q, tid }) {
  const run = async (label) => { await page.keyboard.press('Control+KeyK'); await page.keyboard.type(label); await page.waitForTimeout(250); await page.keyboard.press('Enter'); await page.waitForTimeout(350) }
  const tab = (id) => page.locator(`[data-testid="tab"][data-id="${id}"]`)

  // every theme, on the main window as it is (two panes, things needing you)
  for (const [label, name] of THEMES) { await run(`Theme: ${label}`); await q(`theme-${name}`) }
  await run('Theme: Quiet')

  // the account switcher over the main view
  await tid('account-button').click()
  await q('accounts')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // answer from the rail: the deploy thread's first option goes through the question card's own call
  const needs = page.locator('[data-testid="section-waiting"]')
  for (let i = 0; i < 8 && await needs.count(); i++) {
    const answer = needs.locator('[data-testid="needs-answer-0"]').first()
    const dismiss = needs.locator('[data-testid="needs-dismiss"]').first()
    const open = needs.locator('button.plain').first()
    if (await answer.count()) await answer.click()
    else if (await dismiss.count()) await dismiss.click()
    else if (await open.count()) await open.click()
    await page.waitForTimeout(300)
  }
  await tab('t-ship').click().catch(() => {})
  await tab('t-invoice').click().catch(() => {})
  await page.waitForTimeout(300)
  await q('main-clear')

  // each page, one pane
  await tab('t-ship').dragTo(tab('t-invoice')).catch(() => {})
  await page.waitForTimeout(300)
  for (const v of ['running', 'scheduled', 'deploys', 'status', 'watchers', 'workspace', 'settings']) {
    await tid(`rail-view-${v}`).click()
    await page.waitForTimeout(800)
    if (v === 'deploys') { const s = tid('deploy-suite').first(); if (await s.isVisible().catch(() => false)) { await s.click(); await page.waitForTimeout(1000) } }
    await q(`page-${v}`)
  }
  // Settings: Appearance (themes and fonts) and the section with quiet hours
  await tid('settings-nav-appearance').click().catch(() => {})
  await page.waitForTimeout(500)
  await q('page-settings-appearance')
  for (const nav of await page.locator('[data-testid^="settings-nav-"]').all()) {
    const t = (await nav.textContent()) ?? ''
    if (/notif|quiet/i.test(t)) { await nav.click(); await page.waitForTimeout(500); await q('page-settings-quiet'); break }
  }
  await tid('settings-nav-general').click().catch(() => {})
  await page.waitForTimeout(400)
  await q('page-settings-general')

  // the editor beside its thread, Files in the inspector
  await tab('t-invoice').click()
  await tid('insp-files').click(); await tid('files-thread').click({ timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(600)
  await page.getByText('billing', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.getByText('invoice.py', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  const ft = page.locator('[data-testid="tab"][data-id$="invoice.py"]').first()
  const pb = await page.locator('[data-testid="chat-pane"]').first().boundingBox()
  if (pb) await ft.dragTo(page.locator('[data-testid="chat-pane"]').first(), { targetPosition: { x: pb.width - 40, y: pb.height / 2 } }).catch(() => {})
  await page.waitForTimeout(400)
  await tab('t-invoice').click()
  await page.locator('[data-testid="tab"][data-id$="invoice.py"]').first().click()
  await page.waitForTimeout(2500)
  await q('editor')
  await run('Theme: Light')
  await page.waitForTimeout(800)
  await q('editor-light')
  await run('Theme: Quiet')
  await tid('insp-activity').click()

  // the palette
  await tab('t-invoice').click()
  await page.keyboard.press('Control+KeyK')
  await page.keyboard.type('theme')
  await page.waitForTimeout(400)
  await q('palette')
  await page.keyboard.press('Escape')

  // a narrow window
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(980, 720))
  await page.waitForTimeout(700)
  await q('narrow')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await page.waitForTimeout(400)
}
