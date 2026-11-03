// Panels with no Claude turns: to-dos, terminal, files, git, scripts, Watch, Settings. Git work happens only in the
// throwaway repo; commit and push must report test mode.
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, DEMO, gitOut, launch, SCRIPT_CWD, shot, TAG, type Launched } from './harness'
import { Hive } from './hive'

test.describe('panels', () => {
  let l: Launched
  let h: Hive
  test.beforeAll(async () => { l = await launch(); h = new Hive(l.page) })
  test.afterAll(async () => { await close(l) })

  test('to-dos: "talk to Claude about this" opens a thread with the to-do filled in', async () => {
    await h.open('todos')
    const text = `${TAG} call the insurer`
    await h.id('todo-add').fill(text)
    await h.id('todo-add').press('Enter')
    const row = h.todoRows().filter({ hasText: text })
    await row.hover()
    await row.getByTestId('todo-talk').click()
    // the new thread's box has it (earlier tests can leave split panes, so there may be more than one box)
    const want = `Let's talk about this to-do: ${text}`
    await l.page.waitForFunction((w) => [...document.querySelectorAll<HTMLTextAreaElement>('[data-testid="composer"]')].some((c) => c.value === w), want)
    await h.open('todos')
    await row.hover()
    await row.getByTestId('todo-delete').click()
  })

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

  test('notes: write one, find it by search, preview, delete', async () => {
    await h.open('notes')
    await h.id('notes-new').click()
    const title = `${TAG} meeting notes`
    await h.id('notes-text').fill(`# ${title}\n\n- **ship** the notes panel`)
    const row = h.id('note-row').filter({ hasText: title })
    await expect(row).toHaveCount(1, { timeout: 10_000 }) // saved on its own, listed from the folder
    await h.id('notes-search').fill('ship notes')
    await expect(row).toHaveCount(1)
    await h.id('notes-search').fill('nothing like this')
    await expect(row).toHaveCount(0)
    await h.id('notes-search').fill('')
    await row.click()
    await h.id('notes-preview').click()
    await expect(h.id('notes-rendered').locator('strong')).toHaveText('ship')
    await shot(l.page, 'notes')
    await h.id('notes-delete').click()
    await expect(row).toHaveCount(0)
    await h.open('notes')
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
    // files open as tabs next to the threads: an image is shown; Markdown opens rendered, Code shows the source
    await file('pic.svg').click()
    await expect(h.id('tab').filter({ hasText: 'pic.svg' })).toHaveCount(1)
    await expect(h.id('editor-view').locator('aside.preview img')).toBeVisible()
    await file('readme.md').click()
    await expect(h.id('tab').filter({ hasText: 'readme.md' })).toHaveCount(1)
    await expect(h.id('editor-view').locator('.md strong')).toHaveText('markdown')
    await shot(l.page, 'file-tab-markdown')
    await h.id('editor-code').click()
    await expect(h.id('editor-host')).toBeVisible()
    await expect(h.id('editor-view').locator('.view-lines')).toContainText('A **markdown** page.')
    for (const n of ['pic.svg', 'readme.md']) await h.id('tab').filter({ hasText: n }).click({ button: 'middle' })
    await expect(h.id('tab').filter({ hasText: 'readme.md' })).toHaveCount(0)
    await h.open('files')
  })

  test('editor: a Python file opens from Files, Pyright hovers and flags the type error, Ctrl+S saves', async () => {
    await h.open('files')
    const tree = h.id('file-tree')
    if (!(await tree.locator('[data-testid="file-row"][data-name="app.py"]').isVisible())) await tree.locator('[data-testid="file-dir"][data-name="demo"]').click()
    await tree.locator('[data-testid="file-row"][data-name="app.py"]').click()
    const editor = h.id('editor-view')
    await expect(editor).toBeVisible()
    const tab = h.id('tab').filter({ hasText: 'app.py' })
    await expect(tab).toHaveCount(1)
    await expect(editor).toContainText('Pyright language server')
    // the deliberate type error gets a squiggle from Pyright
    await expect(editor.locator('.squiggly-error')).not.toHaveCount(0, { timeout: 60_000 })
    // hover on greet shows its signature
    await editor.locator('.view-lines').click()
    await l.page.keyboard.press('Control+Home')
    for (let i = 0; i < 6; i++) await l.page.keyboard.press('ArrowRight') // into "greet"
    await l.page.keyboard.press('Control+k')
    await l.page.keyboard.press('Control+i')
    await expect(l.page.locator('.monaco-hover').filter({ hasText: '(name: str) -> str' }).first()).toBeVisible({ timeout: 30_000 })
    await shot(l.page, 'editor-python')
    // type, see the unsaved dot, Ctrl+S writes the file
    await editor.locator('.view-lines').click()
    await l.page.keyboard.press('Control+End')
    await l.page.keyboard.type('\nprint(greet("e2e"))')
    await expect(tab.getByTestId('tab-dirty')).toHaveCount(1)
    // closing it with unsaved edits asks instead of closing
    await tab.click({ button: 'middle' })
    await expect(h.id('editor-unsaved')).toBeVisible()
    await h.id('editor-unsaved').getByRole('button', { name: 'Cancel' }).click()
    await editor.locator('.view-lines').click()
    await l.page.keyboard.press('Control+s')
    await expect(tab.getByTestId('tab-dirty')).toHaveCount(0)
    expect(readFileSync(join(DEMO, 'app.py'), 'utf8')).toContain('print(greet("e2e"))')
    await tab.click({ button: 'middle' })
    await expect(tab).toHaveCount(0)
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
