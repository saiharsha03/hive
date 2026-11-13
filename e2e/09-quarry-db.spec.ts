// Opt-in: Quarry against a real, throwaway database. Needs HIVE_QUARRY_EXE and a running Docker that already has the
// postgres:17 image (never pulled: --pull never). The spec starts its own container on a loopback port, with an
// invented "orchard" schema, and removes it at the end. Quarry runs isolated in the run's folder (as in 08). Two
// connections are made through Quarry's own interface (its bridge in the page); then Orbit's own quarry_ tool handlers
// run against them (quarry:e2eTool, no Claude turn): list, schema, rows, a write that asks first and runs only on
// "Run it", a read-only connection that refuses the write anyway, and a CSV export from the embedded page.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { close, DATA, launch, type Launched } from './harness'
import { Orbit } from './hive'

const exe = process.env.HIVE_QUARRY_EXE ?? ''
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 }).trim()
const hasImage = (() => { try { docker('image', 'inspect', 'postgres:17', '--format', '{{.Id}}'); return true } catch { return false } })()

test.skip(!exe || !existsSync(exe) || !hasImage, 'needs HIVE_QUARRY_EXE and Docker with the postgres:17 image already pulled')

const NAME = `hive-e2e-orchard-${Date.now()}`
const PASSWORD = randomBytes(12).toString('hex')
let port = 0

test.beforeAll(async () => {
  docker('run', '-d', '--rm', '--pull', 'never', '--name', NAME, '-e', 'POSTGRES_USER=orchard_app', '-e', `POSTGRES_PASSWORD=${PASSWORD}`, '-e', 'POSTGRES_DB=orchard',
    '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', 'postgres:17')
  port = Number(docker('port', NAME, '5432').split('\n')[0].split(':').pop())
  // ready over TCP (the image's first-start server listens only on its socket)
  for (let i = 0; ; i++) {
    try { docker('exec', NAME, 'psql', '-h', '127.0.0.1', '-U', 'orchard_app', '-d', 'orchard', '-c', 'select 1'); break } catch { if (i > 60) throw new Error('the throwaway database did not start'); await new Promise((r) => setTimeout(r, 1000)) }
  }
  docker('exec', NAME, 'psql', '-h', '127.0.0.1', '-U', 'orchard_app', '-d', 'orchard', '-v', 'ON_ERROR_STOP=1', '-c',
    "create schema orchard; create table orchard.pears (id int primary key, variety text not null, ripe boolean not null default false); insert into orchard.pears values (1, 'Bosc', true), (2, 'Anjou', false), (3, 'Comice', true);")
})

test.afterAll(() => { try { docker('rm', '-f', NAME) } catch { /* already gone */ } })

const inView = <T>(l: Launched, js: string) => l.app.evaluate(async ({ webContents }, code) => {
  const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('quarry://app/'))
  if (!wc) throw new Error('no Quarry view')
  return wc.executeJavaScript(code, true)
}, js) as Promise<T>

test('Quarry with a real database: the thread tools, the write card, read-only, and CSV export', async () => {
  const l = await launch({ env: { HIVE_E2E_QUARRY: '1', HIVE_QUARRY_EXE: exe } })
  try {
    const h = new Orbit(l.page)
    // a thread tab for the write question's card (nothing is sent to Claude)
    await h.newSession()
    const tab = await h.id('tab').last().getAttribute('data-id')
    expect(tab).toBeTruthy()
    // the Quarry page; its bridge makes the two connections, as its own form would
    await h.id('rail-view-quarry').click()
    await expect.poll(() => inView<string>(l, "document.querySelector('p.empty')?.textContent ?? ''").catch(() => ''), { timeout: 30_000 }).toMatch(/No connections yet/)
    const conn = (name: string, readOnly: boolean) => JSON.stringify({ input: { name, host: '127.0.0.1', port, database: 'orchard', user: 'orchard_app', sslmode: 'disable', production: false, readOnly, statementTimeoutS: 0, password: PASSWORD } })
    await inView(l, `window.quarryHost.invoke('save_connection', ${conn('Orchard demo', false)}).then(() => 1)`)
    await inView(l, `window.quarryHost.invoke('save_connection', ${conn('Orchard read only', true)}).then(() => 1)`)

    // Orbit's own tool handlers, through main (quarry:e2eTool)
    const tool = (name: string, args: object = {}) => l.page.evaluate(([t, n, a]) => window.api.quarryE2eTool(t as string, n as string, a as object), [tab, name, args] as const)
    const list = await tool('quarry_connections')
    expect(list.ok).toBe(true)
    expect(list.text).toMatch(/Orchard demo \(id [^)]+\): orchard_app@127\.0\.0\.1:\d+\/orchard/)
    expect(list.text).toMatch(/Orchard read only \(id [^)]+\):.*read only/)
    const schema = await tool('quarry_schema', { connection: 'Orchard demo', schema: 'orchard' })
    expect(schema.ok).toBe(true)
    expect(schema.text).toMatch(/"name": "pears"/)
    const rows = await tool('quarry_query', { connection: 'Orchard demo', sql: 'select id, variety, ripe from orchard.pears order by id' })
    expect(rows.ok).toBe(true)
    expect(rows.text).toMatch(/3 rows/)
    expect(rows.text).toMatch(/1\tBosc\tt\n2\tAnjou\tf\n3\tComice\tt/)

    // a write asks first: the card is in the thread's tab; "Do not run it" runs nothing
    await l.page.locator(`[data-testid="tab"][data-id="${tab}"]`).click()
    const answer = async (label: string) => {
      const card = h.id('ask-card').last()
      await expect(card).toContainText('Run this write on "Orchard demo"?', { timeout: 20_000 })
      await card.locator('label.askopt').filter({ hasText: new RegExp(`^${label}`) }).click() // an option's text runs into its description
      await card.getByTestId('ask-submit').click()
    }
    const write = { connection: 'Orchard demo', sql: "update orchard.pears set ripe = true where variety = 'Anjou'", allow_write: true }
    const skipped = tool('quarry_query', write)
    await answer('Do not run it')
    expect((await skipped).text).toMatch(/did not confirm the write; it was not run/)
    expect((await tool('quarry_query', { connection: 'Orchard demo', sql: "select ripe from orchard.pears where id = 2" })).text).toMatch(/ripe\nf$/)
    // "Run it": Quarry runs it, committed
    const ran = tool('quarry_query', write)
    await answer('Run it')
    const r = await ran
    expect(r.ok).toBe(true)
    expect(r.text).toMatch(/UPDATE 1/)
    expect((await tool('quarry_query', { connection: 'Orchard demo', sql: "select ripe from orchard.pears where id = 2" })).text).toMatch(/ripe\nt$/)
    // a read-only connection refuses the write even after "Run it"
    const ro = tool('quarry_query', { ...write, connection: 'Orchard read only', sql: "update orchard.pears set ripe = false where variety = 'Bosc'" })
    const card = h.id('ask-card').last()
    await expect(card).toContainText('Run this write on "Orchard read only"?', { timeout: 20_000 })
    await card.locator('label.askopt').filter({ hasText: /^Run it/ }).click()
    await card.getByTestId('ask-submit').click()
    const refused = await ro
    expect(refused.ok).toBe(false)
    expect(refused.text).toMatch(/Quarry refused or failed/)
    console.log(`read-only refusal: ${refused.text.split('\n')[0]}`)
    expect((await tool('quarry_query', { connection: 'Orchard demo', sql: "select ripe from orchard.pears where id = 1" })).text).toMatch(/ripe\nt$/)

    // CSV export from the embedded page: connect in Quarry's UI, run a query in its editor, press Export CSV. Quarry's
    // UI reads its list when it starts, so the view is reloaded to show the two connections made through the bridge
    await h.id('rail-view-quarry').click()
    await inView(l, 'location.reload(); 1').catch(() => {})
    await expect.poll(() => inView<string>(l, "document.body?.textContent ?? ''").catch(() => ''), { timeout: 30_000 }).toMatch(/Orchard demo/)
    await inView(l, "[...document.querySelectorAll('tr')].find((t) => t.textContent.includes('Orchard demo'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1")
    await expect.poll(() => inView<boolean>(l, "!!document.querySelector('.cm-content')"), { timeout: 30_000 }).toBe(true)
    await inView(l, "document.querySelector('.cm-content').focus(); 1")
    await l.app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('quarry://app/'))!
      wc.focus()
      await wc.insertText('select id, variety from orchard.pears order by id')
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] })
    })
    await expect.poll(() => inView<string>(l, "document.querySelector('[data-testid=rowcount]')?.textContent ?? ''"), { timeout: 30_000 }).toMatch(/3 rows/)
    await inView(l, "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export CSV').click(); 1")
    const dir = join(DATA, 'quarry-export')
    await expect.poll(() => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.csv')).length : 0), { timeout: 30_000 }).toBeGreaterThan(0)
    const csv = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.csv'))!), 'utf8')
    expect(csv).toMatch(/Bosc/)
    expect(csv).toMatch(/Comice/)
    const lines = csv.split(/\r?\n/).filter(Boolean)
    console.log(`exported CSV: ${lines.length} lines, header ${lines[0]}`)
  } finally {
    await close(l)
  }
})
