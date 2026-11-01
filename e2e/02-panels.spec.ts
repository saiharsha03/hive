// Panels with no Claude turns: to-dos, terminal, files, git, scripts, Watch, Settings. Git work happens only in the
// throwaway repo; commit and push must report test mode.
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { close, DEMO, gitOut, launch, SCRIPT_CWD, shot, TAG, type Launched } from './harness'
import { Hive } from './hive'

test.describe('panels', () => {
  let l: Launched
  let h: Hive
  test.beforeAll(async () => { l = await launch(); h = new Hive(l.page) })
  test.afterAll(async () => { await close(l) })

  test('to-dos: add, tick, delete and undo', async () => {
    await h.open('todos')
    const text = `${TAG} buy milk`
    await h.id('todo-add').fill(text)
    await h.id('todo-add').press('Enter')
    const row = h.todoRows().filter({ hasText: text })
    await expect(row).toHaveCount(1)
    await shot(l.page, 'todos-added')
    await row.getByTestId('todo-done').click()
    // done items fold away; open the Done group to see it ticked
    await expect(row).toHaveCount(0)
    await h.id('todo-done-fold').click()
    await expect(row).toHaveClass(/done/)
    await row.hover()
    await row.getByTestId('todo-delete').click()
    await expect(row).toHaveCount(0)
    await h.id('todo-undo').click()
    await expect(row).toHaveCount(1)
    await shot(l.page, 'todos-undo')
    await h.open('todos')
  })

  test('the terminal drawer runs echo hi', async () => {
    await h.newSession()
    await h.id('terminal-toggle').click()
    await expect(h.terminal()).toBeVisible()
    await expect(h.terminal().locator('.xterm-rows')).toBeVisible({ timeout: 30_000 })
    await l.page.waitForTimeout(1500) // let the shell print its prompt
    await h.terminal().locator('.xterm').click()
    await l.page.keyboard.type('echo hi')
    await l.page.keyboard.press('Enter')
    await expect.poll(() => h.terminalText(), { timeout: 30_000 }).toMatch(/^\s*hi\s*$/m)
    await shot(l.page, 'terminal')
    await h.id('terminal-toggle').click()
  })

  test('file tree git colours show on a throwaway repo', async () => {
    await h.open('files')
    const tree = h.id('file-tree')
    await tree.locator('[data-testid="file-dir"][data-name="demo"]').click()
    const file = (n: string) => tree.locator(`[data-testid="file-row"][data-name="${n}"]`)
    await expect(file('tracked.txt')).toHaveClass(/g-modified/)
    await expect(file('untracked.txt')).toHaveClass(/g-(untracked|added)/)
    await shot(l.page, 'files-git-colours')
    // a file opens in a full-window preview: Esc closes it, "Side panel" docks it instead
    await file('tracked.txt').click()
    const full = h.id('preview-full')
    await expect(full).toBeVisible()
    const box = await full.boundingBox()
    const view = l.page.viewportSize() ?? await l.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box!.width).toBeGreaterThan(view.width - 4)
    expect(box!.height).toBeGreaterThan(view.height - 4)
    await shot(l.page, 'preview-full')
    await l.page.keyboard.press('Escape')
    await expect(full).toHaveCount(0)
    await file('tracked.txt').click()
    await h.id('preview-side').click()
    await expect(full).toHaveCount(0)
    await expect(l.page.locator('aside.preview')).toBeVisible()
    await h.open('files')
  })

  test('git panel: stage and split diff work; commit and push are blocked in test mode', async () => {
    const commits = () => gitOut(DEMO, 'rev-list', '--count', 'HEAD').trim()
    const before = commits()
    await h.open('git')
    await h.id('git-panel').locator('[data-testid="git-repo"][data-name="demo"]').click()
    await expect(h.gitFile('second.txt')).toBeVisible()
    await h.id('git-group-unstaged').locator('[data-testid="git-file"][data-path="second.txt"]').getByTestId('git-stage').click()
    await expect(h.id('git-group-staged').locator('[data-testid="git-file"][data-path="second.txt"]')).toBeVisible()
    expect(gitOut(DEMO, 'diff', '--cached', '--name-only').trim()).toBe('second.txt')
    await h.id('git-group-staged').getByTestId('git-path').first().click()
    await expect(h.id('diff-panel')).toBeVisible()
    await h.id('diff-panel').getByTestId('diff-mode-split').click()
    await expect(h.id('diff-table')).toHaveClass(/split/)
    await shot(l.page, 'git-split-diff')
    await h.id('git-message').fill('e2e commit that must not happen')
    await h.id('git-commit').click()
    await expect(h.id('git-output')).toContainText('test mode')
    expect(commits()).toBe(before)
    await h.id('git-push').click()
    await expect(h.id('git-output')).toContainText('test mode')
    await shot(l.page, 'git-commit-blocked')
    await h.open('git')
  })

  test('scripts: the list shows and a run produces echo output', async () => {
    await h.open('scripts')
    const card = h.id('script-card').filter({ hasText: 'Weekly report' })
    await expect(card).toBeVisible()
    await card.getByTestId('script-run').click()
    await expect(card.getByTestId('script-state')).toHaveText('ok')
    await card.getByTestId('script-output-toggle').click()
    await expect(card.getByTestId('script-output')).toContainText('test mode')
    await expect(card.getByTestId('script-output')).toContainText('echo ran > marker.txt')
    expect(existsSync(join(SCRIPT_CWD, 'marker.txt'))).toBe(false)
    await shot(l.page, 'scripts-echo')
    await h.open('scripts')
  })

  // the Watchers view has its own spec (05-watchers); the tier table left Settings when watchers replaced Watch
  test.fixme('settings: an adaptive tier table editor rejects falling thresholds (no tier editor on main yet)', async () => {})

  test('settings: a saved app name applies live (window title and top bar)', async () => {
    await h.open('settings')
    await expect(h.id('settings')).toBeVisible()
    const name = `Hive ${TAG}`
    await h.id('settings-nav-general').click()
    await h.id('settings-app-name').fill(name)
    await h.id('settings-save').click()
    await expect(h.id('settings-notes')).toBeVisible()
    await expect.poll(() => l.page.title()).toBe(name)
    await expect(h.brand()).toContainText(name)
    await shot(l.page, 'settings-app-name')
    // put it back, so later screenshots read normally
    await h.id('settings-app-name').fill('Hive')
    await h.id('settings-save').click()
    await expect.poll(() => l.page.title()).toBe('Hive')
    l.page.once('dialog', (d) => void d.accept())
    await h.id('settings').getByRole('button', { name: 'Close' }).first().click()
    await expect(h.id('settings')).toHaveCount(0)
  })

  test('settings: Appearance UI and theme pickers apply live and each UI keeps its theme', async () => {
    await h.open('settings')
    await h.id('settings-nav-appearance').click()
    await h.id('appearance-theme-light').click()
    await expect(l.page.locator('html')).toHaveAttribute('data-theme', 'light')
    await h.id('appearance-ui-focus').click()
    await expect(l.page.locator('html')).toHaveAttribute('data-ui', 'focus')
    await expect(l.page.locator('html')).toHaveAttribute('data-theme', 'default')
    await h.id('appearance-ui-default').click()
    await expect(l.page.locator('html')).toHaveAttribute('data-theme', 'light')
    await shot(l.page, 'settings-appearance')
    await h.id('appearance-theme-default').click()
    l.page.once('dialog', (d) => void d.accept())
    await h.id('settings').getByRole('button', { name: 'Close' }).first().click()
  })
})
