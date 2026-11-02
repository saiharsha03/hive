// Page helpers: every selector the specs use lives here, behind data-testid where the app has one, so a UI
// redesign only has to keep the test ids (or change this file).
import { expect, type Locator, type Page } from '@playwright/test'

export class Hive {
  constructor(readonly page: Page) {}

  id = (t: string): Locator => this.page.getByTestId(t)

  // ---- top bar ----
  brand = () => this.id('brand')
  topModel = () => this.id('top-model')
  // panels live in regions now (Default UI): the threads list is the left side bar, tools open from the Tools menu
  // into the bottom panel, the right side, a popover or a modal. Calling open() again for the same panel is harmless.
  async open(panel: 'sessions' | 'files' | 'deploy' | 'git' | 'scripts' | 'watch' | 'mcp' | 'todos' | 'notes' | 'settings'): Promise<void> {
    if (panel === 'sessions') {
      if (!(await this.sidebar().isVisible())) await this.id('toggle-left').click()
      return
    }
    if (panel === 'settings') {
      if (!(await this.id('settings').isVisible())) await this.id('titlebar-settings').click()
      return
    }
    const view = panel === 'watch' ? 'watchers' : panel
    const shown: Record<string, string> = { files: 'file-tree', deploy: 'deploy-panel', git: 'git-panel', scripts: 'scripts-panel', watchers: 'watchers-panel', mcp: 'mcp-menu', todos: 'todos-panel', notes: 'notes-panel' }
    if (await this.id(shown[view]).first().isVisible()) return
    // views with a top-bar button open from it; the rest from the Tools menu
    if (['files', 'git', 'todos', 'notes', 'scripts', 'deploy'].includes(view)) { await this.id(`top-view-${view}`).click(); return }
    await this.id('menu-tools').click()
    await this.id(`menu-tools-${view}`).click()
  }

  // ---- sessions ----
  async newSession(): Promise<void> {
    const before = await this.id('tab').count()
    await this.id('top-new').click()
    await expect(this.id('tab')).toHaveCount(before + 1)
    await expect(this.composer()).toBeVisible()
  }
  composer = () => this.id('composer')
  userMsgs = () => this.id('msg-user')
  replies = () => this.id('msg-assistant')
  errors = () => this.id('msg-error')
  working = () => this.id('working')
  async type(text: string): Promise<void> {
    await this.composer().fill(text)
  }
  async send(text: string): Promise<void> {
    await this.composer().fill(text)
    await this.composer().press('Enter')
  }
  // wait until the turn ends (the Working bar goes away) and return the newest reply's text
  async waitIdle(timeout = 150_000): Promise<void> {
    await expect(this.working()).toHaveCount(0, { timeout })
  }
  async lastReply(): Promise<string> {
    return (await this.replies().last().innerText()).trim()
  }
  // the reply count after the next turn: at least one more reply than before, and the thread idle again
  async sendAndWait(text: string, timeout = 150_000): Promise<string> {
    const before = await this.replies().count()
    await this.send(text)
    await expect(this.replies()).toHaveCount(before + 1, { timeout }).catch(async () => {
      // a turn can end with more than one reply, or with an error row; report what is on screen
      const errs = await this.errors().allInnerTexts()
      if (errs.length) throw new Error(`turn failed: ${errs.join(' | ')}`)
      expect(await this.replies().count()).toBeGreaterThan(before)
    })
    await this.waitIdle(timeout)
    return this.lastReply()
  }
  modelPicker = () => this.id('model-picker')
  effortPicker = () => this.id('effort-picker')
  // the model picker is a popover list: pick its Haiku entry (whatever the SDK lists for Haiku). The pick shows in
  // the picker and the status bar at once, also before the first message.
  async pickHaiku(_live = true): Promise<void> {
    await this.modelPicker().click()
    const haiku = this.id('model-list').locator('.pop-row').filter({ hasText: /haiku/i }).first()
    await expect(haiku).toBeVisible({ timeout: 60_000 })
    await haiku.click()
    await expect(this.modelPicker()).toContainText(/haiku/i)
    await expect(this.topModel()).toContainText(/haiku/i)
  }
  async pickEffort(level: string): Promise<void> {
    await this.effortPicker().click()
    await this.id(`effort-list-${level}`).click()
  }
  sendMode = (m: 'steer' | 'queue' | 'interrupt') => this.id(`send-mode-${m}`)

  // ---- sidebar threads ----
  sidebar = () => this.id('sidebar')
  rows = () => this.id('thread-row')
  row = (sessionId: string) => this.sidebar().locator(`[data-testid="thread-row"][data-id="${sessionId}"]`)
  section = (key: string) => this.id(`section-${key}`)
  async threadAction(sessionId: string, label: RegExp): Promise<void> {
    const r = this.row(sessionId)
    await r.scrollIntoViewIfNeeded()
    await r.hover()
    await r.getByTestId('thread-actions').click()
    const menu = this.id('thread-menu')
    await menu.getByRole('button', { name: label }).first().click()
  }
  async unfold(key: string): Promise<void> {
    const fold = this.section(key).getByTestId('section-fold')
    if (!(await this.section(key).getByTestId('thread-row').count())) await fold.click()
  }

  // ---- watchers: the selected watcher's schedule editor ----
  schedule = () => this.id('schedule-section')
  tierRows = () => this.schedule().getByTestId('tier-row')
  currentTier = () => this.schedule().locator('[data-testid="tier-row"][data-current="1"]')

  // ---- to-dos ----
  todoRows = () => this.id('todo-row')

  // ---- terminal ----
  terminal = () => this.id('terminal')
  async terminalText(): Promise<string> {
    return this.terminal().locator('.xterm-rows').innerText()
  }

  // ---- git panel ----
  gitFile = (path: string) => this.id('git-panel').locator(`[data-testid="git-file"][data-path="${path}"]`)
}
