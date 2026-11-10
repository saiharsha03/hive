// Opt-in: the Quarry page in the running app, against a real Quarry (HIVE_QUARRY_EXE names its exe; skipped otherwise).
// The run allows Quarry in test mode for this launch only (HIVE_E2E_QUARRY=1); its Quarry keeps its data in the run's
// own folder, so it starts empty. No database connection is opened or created, and no thread is sent to Claude.
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { close, launch } from './harness'
import { Hive } from './hive'
import { quarryTheme } from '../src/renderer/src/pages/quarryCore'

const exe = process.env.HIVE_QUARRY_EXE ?? ''
// where the screenshot goes: HIVE_E2E_QUARRY_SHOT, else the run's own results folder
const SHOT = process.env.HIVE_E2E_QUARRY_SHOT || 'e2e-results/page-quarry.png'

test.skip(!exe || !existsSync(exe), 'set HIVE_QUARRY_EXE to a Quarry exe to run this')

test('the Quarry page draws Quarry, calls it through the bridge, takes Hive\'s theme and stays on Quarry', async () => {
  const l = await launch({ env: { HIVE_E2E_QUARRY: '1', HIVE_QUARRY_EXE: exe } })
  try {
    const h = new Hive(l.page)
    await expect(h.id('rail-view-quarry')).toBeVisible({ timeout: 30_000 })
    await h.id('rail-view-quarry').click()
    await expect(h.id('quarry-view')).toBeAttached()
    // the view's own page, reached through main (a <webview> is a WebContents of its own)
    const inView = <T>(js: string) => l.app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('quarry://app/'))
      if (!wc) throw new Error('no Quarry view')
      return wc.executeJavaScript(code, true)
    }, js) as Promise<T>
    const url = () => inView<string>('location.href')
    // Quarry's UI has drawn its empty state (a fresh Quarry has no connections)
    await expect.poll(() => inView<string>("document.querySelector('p.empty')?.textContent ?? ''").catch(() => ''), { timeout: 30_000 }).toMatch(/No connections yet/)
    // a call through window.quarryHost -> quarry:invoke -> quarry serve, and back: the connections list, empty
    expect(await inView<unknown>("window.quarryHost.invoke('list_connections', {})")).toEqual([])
    // Hive's theme, passed on the bridge, is the one Quarry shows
    const hiveTheme = await l.page.evaluate(() => document.documentElement.dataset.theme ?? '')
    const want = quarryTheme(hiveTheme)
    expect(want).not.toBe('graphite') // Quarry's own default: a match below is Hive's theme winning, not a coincidence
    expect(await inView<string>("document.documentElement.getAttribute('data-theme')")).toBe(want)
    // it never leaves Quarry: another origin and a new window are both refused
    await inView<void>("location.href = 'file:///'; void 0").catch(() => {})
    await new Promise((r) => setTimeout(r, 800))
    expect(await url()).toMatch(/^quarry:\/\/app\//)
    expect(await inView<boolean>("window.open('file:///') === null")).toBe(true)
    mkdirSync(dirname(SHOT), { recursive: true })
    await l.page.screenshot({ path: SHOT })
  } finally {
    await close(l)
  }
})
