/* global window, document, getComputedStyle */
// Orbit 2.0 feature tour: launches ONE test instance (HIVE_TEST_MODE=1, its own temp data folder, a temp HOME with a
// minimal .claude), answers every chat / gh / tracker / phone call with a stand-in, walks through the 2.0 features and
// writes numbered screenshots plus index.html. Nothing reaches Claude, GitHub, Jira or the phone relay; the throwaway
// repo has a fake upstream ref and is never pushed. Same launch and stand-in pattern as scripts/ui-shots.mjs.
//
//   npx electron-vite build && node scripts/tour-2.0.mjs [out folder]
//
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, '..', '_sandbox', 'orbit-tour'))
const RUN = join(tmpdir(), `orbit-tour-${Date.now().toString(36)}`)
const DATA = join(RUN, 'data')
const HOME = join(RUN, 'home')
const REPOS = join(RUN, 'repos')
const API = join(REPOS, 'ledger-api')
if (existsSync(OUT)) for (const f of ['index.html']) rmSync(join(OUT, f), { force: true })
mkdirSync(OUT, { recursive: true })
for (const d of [DATA, HOME, API, join(RUN, 'projects')]) mkdirSync(d, { recursive: true })

// ---- a throwaway repo: one commit on main, a branch one commit ahead of its (fake, never pushed) upstream, edits ----
const git = (...a) => execFileSync('git', a, { cwd: API, stdio: 'pipe' }).toString().trim()
mkdirSync(join(API, 'billing'), { recursive: true })
writeFileSync(join(API, 'billing', 'invoice.py'), 'def create_invoice(payment):\n    return payment.amount\n\n\ndef void_invoice(invoice):\n    invoice.status = "void"\n')
writeFileSync(join(API, 'README.md'), '# ledger-api\n\nA demo repo for the Orbit tour.\n')
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'tour@example.invalid'); git('config', 'user.name', 'Tour'); git('config', 'commit.gpgsign', 'false')
git('add', '.'); git('commit', '-q', '-m', 'Ledger API')
git('checkout', '-q', '-b', 'fix/invoice-retry')
const base = git('rev-parse', 'HEAD')
// the upstream is a ref only: origin points at a folder that does not exist, nothing is ever pushed
git('remote', 'add', 'origin', join(RUN, 'no-remote.git'))
git('update-ref', 'refs/remotes/origin/main', base)
git('update-ref', 'refs/remotes/origin/fix/invoice-retry', base)
git('config', 'branch.fix/invoice-retry.remote', 'origin'); git('config', 'branch.fix/invoice-retry.merge', 'refs/heads/fix/invoice-retry')
writeFileSync(join(API, 'billing', 'invoice.py'), 'def create_invoice(payment, retry_key):\n    existing = find(payment, retry_key)\n    if existing:\n        return existing\n    return payment.amount\n\n\ndef void_invoice(invoice):\n    invoice.status = "void"\n')
git('commit', '-q', '-am', 'Idempotent invoice on retry')
writeFileSync(join(API, 'billing', 'invoice.py'), 'def create_invoice(payment, retry_key):\n    existing = find(payment, retry_key)\n    if existing:\n        return existing\n    return payment.amount\n\n\ndef void_invoice(invoice, reason):\n    invoice.status = "void"\n    invoice.reason = reason\n')
writeFileSync(join(API, 'billing', 'retry.py'), 'RETRY_HEADER = "Idempotency-Key"\n')
// project-level Claude config the command panels read
mkdirSync(join(API, '.claude', 'agents'), { recursive: true })
writeFileSync(join(API, '.claude', 'agents', 'builder.md'), '---\nname: builder\ndescription: Builds features\n---\nBuild it.\n')
writeFileSync(join(API, 'CLAUDE.md'), '# ledger-api rules\n')
// a minimal ~/.claude in the temp HOME: the panels never see the real one
mkdirSync(join(HOME, '.claude', 'agents'), { recursive: true })
writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'], deny: ['Read(./secrets/**)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo tour-hook' }] }] } }, null, 2))
writeFileSync(join(HOME, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews diffs\n---\nReview it.\n')
writeFileSync(join(HOME, '.claude', 'CLAUDE.md'), '# tour user memory\n')
writeFileSync(join(RUN, 'workspace.env'), `HIVE_REPOS_ROOT=${REPOS}\n`)
writeFileSync(join(RUN, 'scripts.json'), '[]')
writeFileSync(join(DATA, 'hive-settings.json'), JSON.stringify({ version: 1, env: {}, scripts: null, general: { shell: '', model: 'haiku', effort: 'low', ui: '', theme: '', appName: 'Orbit', appTagline: 'One desk, many agents', chrome: false, desktopNotify: false } }, null, 2))

const NOW = Date.now(), M = 60_000, H = 3_600_000
const iso = (t) => new Date(t).toISOString()
const local = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00` }
const S = (id, title, ago) => ({ id, title, project: 'ledger-api', cwd: API, updated: NOW - ago, started: NOW - ago - H, path: join(RUN, 't', `${id}.jsonl`) })
const saved = [S('s-old1', 'Refund webhook retries back off', 3 * H), S('s-old2', 'Search index rebuild', 26 * H), S('s-old3', 'Payout reconciliation', 50 * H)]
const PR_URL = 'https://github.com/acme/ledger-api/pull/34'
const HEAD = 'a'.repeat(40)
const mergeInfo = {
  pr: { number: 34, url: PR_URL, title: 'Idempotent invoice on retry', state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    checks: { state: 'failing', passed: 3, failed: 1, pending: 0, total: 4 }, checksText: '3 of 4 passed, 1 failed', failing: ['lint'] },
  repo: 'acme/ledger-api', defaultBranch: 'main', method: 'squash', block: 'Its checks are failing (3 of 4 passed, 1 failed).', autoBlock: null,
}
const card = (key, summary, status, column, type, priority, ago) => ({ key, summary, type, priority, project: 'LED', projectName: 'Ledger', status, column, updated: NOW - ago, url: `https://jira.example.invalid/browse/${key}`, description: 'Tour card.' })
const fixtures = {
  'sessions:list': saved,
  'search:status': { indexed: 3, total: 3, done: true },
  'search:query': { indexing: null, results: [] },
  'status:get': { account: 'tour@example.invalid', plan: 'Max 20x', five: { pct: 62, resetsAt: iso(NOW + 1.8 * H) }, seven: { pct: 41, resetsAt: iso(NOW + 3 * 24 * H) },
    usage: [{ key: 'five_hour', label: 'Current session (5 hours)', pct: 62, resetsAt: iso(NOW + 1.8 * H) }, { key: 'seven_day', label: 'Current week (all models)', pct: 41, resetsAt: iso(NOW + 3 * 24 * H) }],
    usageAt: NOW, connectors: { connected: 1, total: 1, needsAuth: 0, failed: 0 }, engine: { installed: true, version: '2.4.12' } },
  'engine:latest': '2.4.12',
  'chat:context': { total: 112480, max: 1000000 },
  'chat:mode': 'default',
  'chat:models': [{ value: 'claude-fable-5-2', displayName: 'Fable 5.2', description: '' }, { value: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: '' }, { value: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: '' }],
  'chat:commands': ['status', 'mcp', 'agents', 'permissions', 'hooks', 'memory', 'resume', 'branch', 'add-dir', 'compact'].map((name) => ({ name, description: name, builtin: true })),
  'chat:mcp': [],
  'chat:continueAt': null,
  'worktree:links': [],
  'watchers:list': { root: join(RUN, 'watchers'), problems: [], testMode: true, watchers: [] },
  'teams:roster': [], 'teams:list': [],
  'mobile:status': { configured: true, paired: true, connected: true, error: '' },
  'allow:status': { configured: false },
  'update:state': null,
  'todos:list': [], 'notes:list': [],
  'handoff:at': 400000,
  'cc:mcp': { live: false, rows: [
    { name: 'git-host', status: 'connected', scope: 'user', file: join(HOME, '.claude.json'), transport: 'stdio', target: 'git-host-mcp', envNames: [], headerNames: [], tools: 31 },
    { name: 'postgres-ro', status: 'failed', scope: 'project', file: join(API, '.mcp.json'), transport: 'stdio', target: 'pg-mcp', envNames: [], headerNames: [], error: 'connection refused', tools: null }] },
  'git:prMergeInfo': mergeInfo,
  'git:prChecks': { number: 34, url: PR_URL, state: 'OPEN', isDraft: false, title: 'Idempotent invoice on retry', checks: mergeInfo.pr.checks },
  'tracker:board': { state: 'ok', at: NOW, more: false, cards: [
    card('LED-101', 'Old invoices backlog', 'Backlog', 'todo', 'Task', 'Low', 9 * H), card('LED-102', 'Retry key on invoices', 'To Do', 'todo', 'Story', 'High', 3 * H),
    card('LED-103', 'Payout export queue', 'In Progress', 'progress', 'Story', 'Medium', 2 * H), card('LED-104', 'Refund webhook 500s', 'Blocked', 'progress', 'Bug', 'Critical', 5 * H),
    card('LED-105', 'Settings rename', 'In Review', 'review', 'Task', 'Medium', H), card('LED-106', 'CSV header order', 'In Prod - Feature flag not yet enabled', 'progress', 'Bug', 'Low', 30 * H)] },
}
const seed = {
  wakeupsList: { wakeups: [{ id: 1, sessionId: 's-main', title: 'Fix duplicate invoice numbers', wakeAt: local(NOW + 33 * M), prompt: 'Check CI on PR #34', everyMinutes: null, firedAt: null }], continues: [] },
  accountsList: [], quietHoursGet: { on: false, from: '22:00', to: '07:30' },
}

// ---- events the stand-in Claude "sends" ----
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input })
const text = (t) => ({ type: 'text', text: t })
const assistant = (...content) => ({ type: 'assistant', message: { model: 'claude-fable-5-2', content } })
const result = (id, out, opts = {}) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: !!opts.error }] }, ...(opts.patch ? { tool_use_result: { structuredPatch: opts.patch } } : {}) })
const task = (subtype, id, extra) => ({ type: 'system', subtype, task_id: id, ...extra })
const threads = [
  { tabId: 't-main', title: 'Fix duplicate invoice numbers', cwd: API, sessionId: 's-main', foreground: true, prompt: 'Make invoice creation idempotent on the retry key and open a PR.' },
  { tabId: 't-plan', title: 'Plan the export queue', cwd: API, sessionId: 's-plan', foreground: true, prompt: 'Plan moving report exports onto the job queue.' },
  { tabId: 't-wait', title: 'Ship ledger-web 4.18', cwd: API, sessionId: 's-wait', foreground: true, prompt: 'Ship 4.18 once staging has landed.' },
  { tabId: 't-run', title: 'Run the billing suite', cwd: API, sessionId: 's-run', foreground: true, prompt: 'Run the billing tests and watch the logs.' },
  { tabId: 't-fail', title: 'Bump node in CI', cwd: API, sessionId: 's-fail', foreground: false, prompt: 'Bump node to 22 in the CI images.' },
]
const ev = [
  ['t-main', { type: 'hive_session', sessionId: 's-main', path: join(RUN, 't', 's-main.jsonl') }],
  ['t-main', { type: 'system', subtype: 'init', model: 'claude-fable-5-2', permissionMode: 'default' }],
  ['t-main', { type: 'hive_worktree', repo: 'ledger-api', path: API, branch: 'fix/invoice-retry' }],
  ['t-main', { type: 'assistant', message: { model: 'claude-fable-5-2', content: [{ type: 'thinking', thinking: 'The retry path re-enters create_invoice with the same key, so the lookup must come first.' }, text('Plan: store the retry key and return the existing invoice.')] } }],
  ['t-main', assistant(tool('e1', 'Edit', { file_path: join(API, 'billing', 'invoice.py'), old_string: 'a', new_string: 'b' }))],
  ['t-main', result('e1', 'ok', { patch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 5, lines: ['-def create_invoice(payment):', '+def create_invoice(payment, retry_key):', '+    existing = find(payment, retry_key)', '+    if existing:', '+        return existing', '     return payment.amount'] }] })],
  ['t-main', assistant(tool('pr1', 'Bash', { command: 'gh pr create --fill --base main', description: 'Open the pull request' }))],
  ['t-main', result('pr1', `Creating pull request for fix/invoice-retry into main in acme/ledger-api\n\n${PR_URL}\n`)],
  ['t-main', assistant(text(`Opened the PR: ${PR_URL}. It follows acme/ledger-api #12, which added the retry header.`))],
  ['t-main', { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Goal set: CI is green on the invoice PR' }] } }],
  ['t-main', { type: 'hive_stop', crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: 'check CI on fix/invoice-retry' }], effort: 'high' }],
  ['t-main', { type: 'result', subtype: 'success' }],

  ['t-plan', { type: 'hive_session', sessionId: 's-plan', path: join(RUN, 't', 's-plan.jsonl') }],
  ['t-plan', { type: 'system', subtype: 'init', model: 'claude-fable-5-2', permissionMode: 'plan' }],
  ['t-plan', assistant(tool('plan1', 'ExitPlanMode', { plan: '## Plan\n\n1. Add an `export_jobs` table\n2. Move PDF and CSV writers onto the worker\n3. Poll from the UI' }))],
  ['t-plan', { type: 'hive_ask', id: 'plan1' }],

  ['t-wait', { type: 'hive_session', sessionId: 's-wait', path: join(RUN, 't', 's-wait.jsonl') }],
  ['t-wait', assistant(text('Staging serves 4.18. Prod is in the change freeze until 14:00.'))],
  ['t-wait', { type: 'result', subtype: 'success' }],

  ['t-run', { type: 'hive_session', sessionId: 's-run', path: join(RUN, 't', 's-run.jsonl') }],
  ['t-run', assistant(tool('b1', 'Bash', { command: 'pytest tests/billing -q', description: 'Run the billing tests' }))],
  ['t-run', task('task_started', 'k-review', { task_type: 'local_agent', description: 'Reviewer: check the retry path', subagent_type: 'reviewer' })],
  ['t-run', task('task_progress', 'k-review', { summary: 'Reading billing/webhooks.py' })],
  ['t-run', task('task_started', 'k-pytest', { task_type: 'local_bash', description: 'pytest tests/billing -q' })],
  ['t-run', task('task_progress', 'k-pytest', { summary: 'test_retry PASSED' })],
  ['t-run', task('task_started', 'k-mon', { task_type: 'monitor', description: 'Tail staging logs for 5xx' })],
  ['t-run', task('task_progress', 'k-mon', { summary: '0 errors in 5 minutes' })],

  ['t-fail', { type: 'hive_session', sessionId: 's-fail', path: join(RUN, 't', 's-fail.jsonl') }],
  ['t-fail', assistant(tool('n1', 'Bash', { command: 'docker build -t ci-node22 .', description: 'Build the CI image' }))],
  ['t-fail', { type: 'result', is_error: true, subtype: 'error', errors: ['docker build failed at step 7 of 12'] }],
]

// ---- launch: test mode, temp data, temp HOME; inherited HIVE_* keys dropped so no relay / repos of the real setup leak in ----
const require = createRequire(import.meta.url)
const executablePath = require(join(ROOT, 'node_modules', 'electron'))
const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('HIVE_') && !k.startsWith('ORBIT_')) env[k] = v
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CONFIG_DIR
Object.assign(env, { HIVE_TEST_MODE: '1', HIVE_TEST_OFFSCREEN: process.env.HIVE_TEST_OFFSCREEN ?? '1', HIVE_DATA_DIR: DATA, HIVE_ENV_FILE: join(RUN, 'workspace.env'), HIVE_SCRIPTS_FILE: join(RUN, 'scripts.json'), HIVE_PROJECTS_DIR: join(RUN, 'projects'), USERPROFILE: HOME, HOME })
const app = await electron.launch({ executablePath, args: [ROOT], cwd: ROOT, env, timeout: 60_000 })
const pid = app.process().pid
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const pageErrors = []
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('PAGE ERROR', e.message) })

await app.evaluate(({ ipcMain, BrowserWindow }, { fixtures, API }) => {
  const set = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn) }
  for (const [ch, v] of Object.entries(fixtures)) set(ch, () => v)
  globalThis.__tourSent = []
  set('history:recent', () => ({ items: [], more: false }))
  set('history:load', () => [])
  set('chat:send', (e, tabId, _cwd, _resume, msg) => { globalThis.__tourSent.push({ tabId, text: msg?.text }); if (msg.mode !== 'queue') setTimeout(() => e.sender.send('chat:event', tabId, { type: 'hive_seen', uuid: msg.uuid }), 300) })
  set('chat:setMode', (e, tabId, mode) => { setTimeout(() => e.sender.send('chat:event', tabId, { type: 'hive_mode', mode }), 50); return true })
  set('chat:setFast', () => true)
  set('cc:fork', (_e, cwd, _sid, title) => ({ sessionId: 'fork-0001-tour', path: cwd + '/fork-0001-tour.jsonl', title: `${title || 'Thread'} (fork)` }))
  set('cc:mcpDo', () => undefined)
  set('dialog:folder', () => API)
  for (const ch of ['chat:interrupt', 'chat:close', 'chat:reset', 'chat:setBackground', 'chat:background', 'chat:setModel', 'chat:setEffort', 'chat:cancelContinue', 'git:prMerge', 'git:prAutoMerge', 'git:push', 'pull:run', 'deploy:run', 'mobile:pair', 'mobile:unpair', 'mobile:test', 'engine:update', 'account:switch']) set(ch, () => ({ ok: false, reason: 'tour stand-in' }))
  for (const ch of ['chat:dequeue', 'chat:promote', 'chat:answer', 'chat:stopTask']) set(ch, () => true)
  const w = BrowserWindow.getAllWindows()[0]
  w.setContentSize(1180, 740); w.center()
}, { fixtures, API })
const send = (list) => app.evaluate(({ BrowserWindow }, list) => { const w = BrowserWindow.getAllWindows()[0]; for (const [ch, ...a] of list) w.webContents.send(ch, ...a) }, list)
await page.addInitScript((s) => { window.__hiveSeed = s }, seed)
await page.reload()
await page.getByTestId('brand').waitFor({ timeout: 30_000 })
await page.evaluate(() => window.api.clipboardEnabled(false))
await send([['clipboard:offer', null]])
await page.waitForTimeout(800)
await send(threads.map((t) => ['hive:thread', t]))
await page.waitForTimeout(400)
await send(ev.map(([tab, e]) => ['chat:event', tab, e]))
await page.waitForTimeout(800)

// ---- helpers ----
const tid = (t) => page.getByTestId(t)
const pane = (id) => page.locator(`[data-testid="chat-${id}"]`)
const tab = (id) => page.locator(`[data-testid="tab"][data-id="${id}"]`)
const must = (cond, msg) => { if (!cond) throw new Error(msg) }
const visible = (loc, ms = 5000) => loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)
let shotN = 0
const results = []
const goThreads = async () => { await page.keyboard.press('Escape').catch(() => {}); await tid('abar-threads').click(); await page.waitForTimeout(200) }
const open = async (id) => { await tab(id).click(); await page.waitForTimeout(400) }
async function feature(n, name, assertion, fn) {
  const shots = []
  const snap = async (label) => { await page.waitForTimeout(350); const f = `${String(++shotN).padStart(2, '0')}-f${n}-${label}.png`; await page.screenshot({ path: join(OUT, f) }); shots.push(f) }
  let status = 'PASS', reason
  try {
    const r = await fn(snap)
    if (r?.status) status = r.status
    reason = r?.reason ?? ''
  } catch (e) {
    status = 'FAIL'; reason = String(e?.message ?? e).split('\n')[0].slice(0, 300)
    await snap('fail').catch(() => {})
  }
  results.push({ n, name, status, assertion, reason, shots })
  console.log(`${status.padEnd(7)} ${n}. ${name}${reason ? ` - ${reason}` : ''}`)
  // leave nothing open for the next feature
  for (let i = 0; i < 2; i++) await page.keyboard.press('Escape').catch(() => {})
}

// 1. Shell
await feature(1, 'Shell: icon rail, limits, title-bar mark, state colours', 'abar-threads/scheduled/files/todo/notes/more visible; More menu lists sections; rail-limits has 2 gauges; brand holds an svg and reads Orbit; the failed background thread rail row says Failed; a waiting tab top line is the --signal colour', async (snap) => {
  await open('t-main')
  for (const v of ['threads', 'scheduled', 'files', 'todo', 'notes', 'more']) must(await visible(tid(`abar-${v}`)), `rail button abar-${v} missing`)
  must(await tid('abar-threads').innerText().then((t) => /Threads/.test(t)), 'Threads label missing')
  must((await tid('rail-limits').locator('[data-testid^="rail-limit-"]').count()) === 2, 'expected 2 limit gauges on the rail')
  must((await tid('brand').locator('svg').count()) > 0 && /Orbit/.test(await tid('brand').innerText()), 'Orbit mark or name missing in the title bar')
  const failRow = page.locator('[data-testid="live-row"][data-id="t-fail"]')
  must(await visible(failRow), 'failed background thread has no rail row')
  must(/fail/.test(await failRow.getAttribute('class')) || (await failRow.locator('.sw-fail').count()) > 0, 'failed rail row is not marked failed')
  must(/Failed/.test(await failRow.innerText()), 'failed rail row does not say Failed')
  // t-wait waits for you while t-main is on screen: its tab's top line takes the signal colour
  await send([['chat:event', 't-wait', { type: 'hive_organize', action: 'waiting', reason: 'Asks: promote now or after the freeze?' }]])
  must(await visible(tab('t-wait').locator('.sw-wait')), 'waiting tab has no wait word')
  const c = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="tab"][data-id="t-wait"]')
    const probe = document.createElement('i'); probe.style.color = 'var(--signal)'; document.body.appendChild(probe)
    const fail = getComputedStyle(probe).color; probe.remove()
    const on = document.querySelector('[data-testid="tab"][data-id="t-main"]')
    return { top: t && getComputedStyle(t).borderTopColor, fail, plain: on && getComputedStyle(on).borderTopColor }
  })
  must(c.top === c.fail, `waiting tab top line ${c.top} is not the signal colour ${c.fail}`)
  await snap('rail')
  await tid('abar-more').click()
  must(await visible(tid('abar-board')), 'More menu has no Board row')
  await snap('more-menu')
  await page.keyboard.press('Escape')
  return { reason: `waiting tab line ${c.top} (plain tab ${c.plain}); failed row says Failed` }
})

// 2. Thread header
await feature(2, 'Thread header: title, PR chip, goal / loop / wake-up, coloured panel buttons', 'h1 = title; thread-pr reads "PR #34" with href = the gh pr create URL; goal-chip on the header and its coming-bar reads "1 loop" and "1 wake-up"; chat-changes and chat-activity icons have different colours', async (snap) => {
  await open('t-main')
  const p = pane('t-main')
  must((await p.locator('h1').innerText()).includes('Fix duplicate invoice numbers'), 'title missing')
  const pr = p.getByTestId('thread-pr')
  must((await pr.innerText()).trim() === 'PR #34', `PR chip reads "${await pr.innerText().catch(() => '')}"`)
  must((await pr.getAttribute('href')) === PR_URL, 'PR chip href wrong')
  must(await visible(p.getByTestId('goal-chip')), 'goal chip missing')
  must(await visible(p.getByTestId('coming-bar')), 'wake-up (coming) bar missing')
  const cols = await p.evaluate((el) => ['chat-changes', 'chat-activity', 'chat-rewind'].map((t) => { const i = el.querySelector(`[data-testid="${t}"] .codicon`); return i ? getComputedStyle(i).color : null }))
  must(cols.every(Boolean) && new Set(cols).size === 3, `panel button colours not distinct: ${cols.join(' / ')}`)
  await snap('header')
  const gl = await p.getByTestId('coming-bar').innerText()
  must(/1 loop/.test(gl) && /1 wake-up/.test(gl), `header lines read: ${gl.replace(/\s+/g, ' ')}`)
  must(/CI is green/.test(await p.getByTestId('goal-chip').innerText()), 'goal chip text')
  await p.getByTestId('chat-activity').click(); await page.waitForTimeout(600)
  await snap('activity')
  if (await visible(tid('insp-close'), 500)) await tid('insp-close').click()
  return { reason: `${gl.replace(/\s+/g, ' ')}; panel icon colours ${cols.join(' / ')}` }
})

// 3. PR links
await feature(3, 'PR links in a reply', 'msg-assistant has <a href="https://github.com/acme/ledger-api/issues/12"> for "acme/ledger-api #12" and <a href=PR_URL> for the URL', async (snap) => {
  await open('t-main')
  const p = pane('t-main')
  const a12 = p.locator('a[href="https://github.com/acme/ledger-api/issues/12"]')
  const a34 = p.locator(`.msg a[href="${PR_URL}"], [data-testid="msg-assistant"] a[href="${PR_URL}"]`)
  must(await visible(a12), 'owner/repo #12 is not a link')
  must(await visible(a34), 'PR URL is not a link')
  await a12.first().scrollIntoViewIfNeeded()
  await a12.first().hover()
  await snap('links')
  return { reason: `#12 text "${await a12.first().innerText()}"` }
})

// 4. Changes panel
await feature(4, 'Changes panel: files, Ship confirm, PR checks, Merge guard, PR menu', 'changes-view lists billing/invoice.py and retry.py; Ship opens changes-ship-modal ("1 commit ahead") and Cancel closes it; changes-pr-checks = failing with "3 of 4 passed, 1 failed"; changes-pr-merge disabled with the block reason as title; ⋮ menu has Auto-fix, Merge when ready, Auto-archive', async (snap) => {
  await open('t-main')
  await pane('t-main').getByTestId('chat-changes').click()
  const v = tid('changes-view')
  must(await visible(v), 'Changes view did not open')
  must(await visible(page.locator('[data-testid="changes-file-billing/invoice.py"]'), 8000), 'invoice.py not listed')
  must(await visible(page.locator('[data-testid="changes-file-billing/retry.py"]')), 'retry.py not listed')
  must(await visible(tid('changes-pr'), 8000), 'PR chip missing')
  const chip = await tid('changes-pr').innerText()
  must(/failing/.test(chip) && /3 of 4 passed, 1 failed/.test(chip), `PR chip reads: ${chip.replace(/\s+/g, ' ')}`)
  const merge = tid('changes-pr-merge')
  must(await merge.isDisabled(), 'Merge is enabled although checks fail')
  must((await merge.getAttribute('title')) === mergeInfo.block, `Merge title: ${await merge.getAttribute('title')}`)
  must(await visible(tid('changes-pr-block')), 'merge block line missing')
  const hdr = pane('t-main').getByTestId('thread-pr-checks')
  const hdrState = (await visible(hdr, 2000)) ? await hdr.innerText() : '(none)'
  await snap('changes')
  await tid('changes-ship').click()
  must(await visible(tid('changes-ship-modal')), 'Ship confirm did not open')
  const body = await tid('changes-ship-modal').innerText()
  must(/1 commit ahead/.test(body), `ship modal says: ${body.replace(/\s+/g, ' ').slice(0, 160)}`)
  await snap('ship-confirm')
  await tid('changes-ship-cancel').click()
  must(!(await visible(tid('changes-ship-modal'), 800)), 'Ship confirm did not close on Cancel')
  await tid('changes-pr-menu').click()
  for (const t of ['changes-pr-autofix', 'changes-pr-automerge-toggle', 'changes-pr-autoarchive']) must(await visible(tid(t)), `${t} missing from the PR menu`)
  must(/Merge when ready/.test(await tid('changes-pr-automerge-toggle').innerText()), 'Merge when ready label')
  await snap('pr-menu')
  await page.keyboard.press('Escape')
  return { reason: `header checks chip: ${hdrState}` }
})

// 11. Diff comments (the Changes panel is open)
await feature(11, 'Diff line comments', 'clicking a changed file shows diff-table; hovering a line shows diff-comment-add; a typed comment shows diff-comment and the bar reads "Send 1 comment to Claude" (not sent)', async (snap) => {
  if (!(await visible(tid('changes-view'), 1000))) { await open('t-main'); await pane('t-main').getByTestId('chat-changes').click() }
  await page.locator('[data-testid="changes-file-billing/invoice.py"]').click()
  const table = tid('diff-table')
  must(await visible(table, 8000), 'diff table did not show')
  const rows = table.first().locator('tr')
  let added = false
  for (let i = 0, n = Math.min(await rows.count(), 12); i < n && !added; i++) {
    await rows.nth(i).hover()
    const plus = rows.nth(i).getByTestId('diff-comment-add')
    if (await plus.isVisible().catch(() => false)) { await snap('hover'); await plus.click(); added = true }
  }
  must(added, 'no line showed a comment button on hover')
  await tid('diff-comment-input').fill('Name the key argument idempotency_key')
  await tid('diff-comment-input').press('Enter')
  must(await visible(tid('diff-comment')), 'comment not added')
  const bar = await tid('diff-comments-bar').innerText()
  must(/Send 1 comment to Claude/.test(bar), `bar reads: ${bar}`)
  await snap('comment')
  await tid('diff-comments-clear').click().catch(() => {})
})
if (await visible(tid('insp-close'), 500)) await tid('insp-close').click().catch(() => {})

// 5. Plan approval
await feature(5, 'Plan approval card', 'plan-card shows the plan and 3 plan-option rows (auto-accept edits, manually approve, keep planning); picking "No, keep planning" shows plan-feedback', async (snap) => {
  await open('t-plan')
  const c = pane('t-plan').getByTestId('plan-card')
  must(await visible(c), 'plan card missing')
  must(/export_jobs/.test(await c.innerText()), 'plan text missing')
  const opts = c.getByTestId('plan-option')
  must((await opts.count()) === 3, `expected 3 options, saw ${await opts.count()}`)
  const labels = await opts.allInnerTexts()
  must(/auto-accept edits/.test(labels[0]) && /manually approve/.test(labels[1]) && /keep planning/.test(labels[2]), `labels: ${labels.join(' | ')}`)
  await snap('plan')
  await opts.nth(2).click()
  must(await visible(c.getByTestId('plan-feedback')), 'feedback box did not open')
  await c.getByTestId('plan-feedback').fill('Add a retention limit for old export files')
  await snap('keep-planning')
})

// 6. Shift+Tab mode cycle
await feature(6, 'Shift+Tab cycles the permission mode', 'mode-picker reads "manual" by default, then "accept edits", "plan", "manual" after each Shift+Tab in the box', async (snap) => {
  await open('t-main')
  const p = pane('t-main')
  const pill = p.getByTestId('mode-picker')
  const read = async () => (await pill.innerText()).replace(/^Mode\s*/i, '').trim().toLowerCase()
  const seen = [await read()]
  must(seen[0] === 'manual', `default mode reads "${seen[0]}"`)
  await p.getByTestId('composer').click()
  for (const want of ['accept edits', 'plan', 'manual']) {
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(300)
    seen.push(await read())
    if (want === 'plan') await snap('plan-mode')
    must(seen.at(-1) === want, `after Shift+Tab expected "${want}", saw "${seen.at(-1)}"`)
  }
  return { reason: seen.join(' -> ') }
})

// 7. Composer keys
await feature(7, 'Composer: history search, stash, model list, Up arrow, image tags, clipboard placeholder', 'Ctrl+R shows history-search rows of earlier prompts; Ctrl+S empties the box (keys-stashed) and restores it; Alt+P opens model-list; Up on an empty box brings the last prompt; an attached PNG adds composer-image-n-0 and "[Image 1]" in the text; a text clipboard offer becomes the placeholder with keys-clip', async (snap) => {
  await open('t-main')
  const p = pane('t-main')
  const box = p.getByTestId('composer')
  for (const t of ['Also cover the refund path', 'Then open the PR against main']) { await box.fill(t); await box.press('Enter'); await page.waitForTimeout(500) }
  const notes = []
  // Ctrl+R
  await box.click(); await page.keyboard.press('Control+KeyR')
  must(await visible(p.getByTestId('history-search')), 'Ctrl+R did not open history search')
  await page.keyboard.type('refund')
  must((await p.getByTestId('history-search-row').count()) >= 1, 'history search found no earlier prompt')
  await snap('history-search')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  // Ctrl+S
  await box.fill('half-written thought'); await box.press('Control+KeyS'); await page.waitForTimeout(200)
  must((await box.inputValue()) === '' && await visible(p.getByTestId('keys-stashed')), 'Ctrl+S did not stash')
  await snap('stashed')
  await box.press('Control+KeyS'); await page.waitForTimeout(200)
  must((await box.inputValue()) === 'half-written thought', `Ctrl+S restore gave "${await box.inputValue()}"`)
  await box.fill('')
  // Alt+P
  await box.press('Alt+KeyP'); await page.waitForTimeout(400)
  must(await visible(page.locator('[data-testid^="model-list"]')), 'Alt+P did not open the model list')
  await snap('model-list')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  if (await visible(p.getByTestId('model-collapse'), 300)) await p.getByTestId('model-collapse').click()
  // Up arrow
  await box.click(); await box.fill(''); await box.press('ArrowUp'); await page.waitForTimeout(150)
  const up1 = await box.inputValue()
  await box.press('ArrowUp'); await page.waitForTimeout(150)
  const up2 = await box.inputValue()
  must(up1 === 'Then open the PR against main' && up2 === 'Also cover the refund path', `Up gave "${up1}" then "${up2}"`)
  notes.push('up ok')
  await box.fill('')
  // image tag
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await p.getByTestId('composer-file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png })
  must(await visible(p.getByTestId('composer-image-n-0')), 'image chip missing')
  const withTag = await box.inputValue()
  must(/\[Image 1\]/.test(withTag), `box text after attach: "${withTag}"`)
  await snap('image-tag')
  await p.getByTestId('composer-remove-image-0').click(); await box.fill('')
  // clipboard placeholder
  await send([['clipboard:offer', { id: 't:tour', kind: 'text', preview: 'SELECT * FROM invoices', big: false, length: 22 }]])
  await page.waitForTimeout(400)
  const ph = await box.getAttribute('placeholder')
  must(ph === 'SELECT * FROM invoices' && await visible(p.getByTestId('keys-clip')), `placeholder "${ph}"`)
  await snap('clipboard')
  await send([['clipboard:offer', null]])
  return { reason: `image text "${withTag.trim()}"` }
})

// 8. Thinking rows
await feature(8, 'Thinking rows', 'thinking-row shows a collapsed "▸ Thinking: ..." toggle (aria-expanded=false); clicking it expands the body', async (snap) => {
  await open('t-main')
  const row = pane('t-main').getByTestId('thinking-row').first()
  await row.scrollIntoViewIfNeeded()
  const t = row.getByTestId('thinking-toggle')
  must((await t.getAttribute('aria-expanded')) === 'false' && /Thinking/.test(await t.innerText()), 'not collapsed')
  await snap('collapsed')
  await t.click()
  must((await t.getAttribute('aria-expanded')) === 'true' && /lookup must come first/.test(await row.innerText()), 'did not expand')
  await snap('expanded')
})

// 9. Context meter / Compact / fast
await send([['chat:event', 't-main', { type: 'result', subtype: 'success' }]])
await page.waitForTimeout(300)
await feature(9, 'Status line context meter, Compact, fast mode', 'status-context reads "Context 112.5k of 1M"-style text with a meter; status-compact visible; fast-toggle sits in the same row as model-summary and mode-picker', async (snap) => {
  await open('t-main')
  const ctx = tid('status-context')
  must(await visible(ctx, 12000), 'context meter missing')
  const t = await ctx.innerText()
  must(/Context/.test(t) && /112/.test(t), `context reads ${t}`)
  must(await visible(tid('status-compact')), 'Compact button missing')
  const p = pane('t-main')
  const fast = p.getByTestId('fast-toggle')
  must(await visible(fast), 'fast toggle missing')
  must(await p.locator('.crow [data-testid="fast-toggle"]').count() === 1 && await p.locator('.crow [data-testid="model-summary"], .crow [data-testid="model-picker"]').count() >= 1, 'fast toggle not next to model/effort')
  await snap('status-line')
  return { reason: `context "${t.replace(/\s+/g, ' ')}", fast "${await fast.innerText()}"` }
})

// 10. Command panels
await feature(10, 'Command panels (/mcp /agents /permissions /hooks /memory /resume /branch /add-dir)', 'each typed command opens its modal (cc-<kind>) with rows from the temp HOME and the temp repo (cc-mcp-row, cc-agent-row, cc-rule, cc-hook-row, cc-memory-row, cc-resume-row); /branch opens a "(fork)" tab; /add-dir opens its panel and a temp folder typed there is listed in cc-dir-row', async (snap) => {
  const ok = [], bad = []
  const run = async (cmd, modal, row) => {
    await open('t-wait')
    const box = pane('t-wait').getByTestId('composer')
    await box.fill(cmd); await page.waitForTimeout(150); await box.press('Enter')
    if (!(await visible(tid(modal), 1500))) { await box.press('Enter').catch(() => {}) }
    if (!(await visible(tid(modal), 4000))) { bad.push(`${cmd}: no modal`); return }
    if (row && !(await visible(tid(modal).getByTestId(row), 6000))) { bad.push(`${cmd}: no ${row}`); await snap(cmd.slice(1).split(' ')[0]); await page.keyboard.press('Escape'); return }
    const home = await tid(modal).innerText()
    if (/\\\.claude/.test(home) && !home.includes(HOME) && home.includes('C:\\Users')) bad.push(`${cmd}: shows a real home path`)
    ok.push(cmd.split(' ')[0])
    await snap(cmd.slice(1).split(' ')[0])
    await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  }
  await run('/mcp', 'cc-mcp', 'cc-mcp-row')
  await run('/agents', 'cc-agents', 'cc-agent-row')
  await run('/permissions', 'cc-permissions', 'cc-rule')
  await run('/hooks', 'cc-hooks', 'cc-hook-row')
  await run('/memory', 'cc-memory', 'cc-memory-row')
  await run('/resume', 'cc-resume', 'cc-resume-row')
  await run('/add-dir', 'cc-add-dir', null)
  // a folder typed in the panel (the temp projects folder) is listed
  await open('t-wait')
  await pane('t-wait').getByTestId('composer').fill('/add-dir'); await pane('t-wait').getByTestId('composer').press('Enter')
  if (await visible(tid('cc-add-dir'), 3000)) {
    await tid('cc-dir-input').fill(join(RUN, 'projects')); await tid('cc-dir-input').press('Enter')
    if (await visible(tid('cc-dir-row'), 5000)) { ok.push('/add-dir <folder>'); await snap('add-dir-listed') } else bad.push('/add-dir: folder not listed')
    await page.keyboard.press('Escape')
  } else bad.push('/add-dir: no modal on second open')
  // /branch: a copy of the thread opens as a tab (cc:fork answered by the stand-in)
  await open('t-wait')
  await pane('t-wait').getByTestId('composer').fill('/branch'); await pane('t-wait').getByTestId('composer').press('Enter')
  if (await visible(page.locator('[data-testid="tab"]').filter({ hasText: '(fork)' }), 2000)) ok.push('/branch')
  else { await pane('t-wait').getByTestId('composer').press('Enter').catch(() => {}); if (await visible(page.locator('[data-testid="tab"]').filter({ hasText: '(fork)' }), 3000)) ok.push('/branch'); else bad.push('/branch: no fork tab') }
  await snap('branch')
  const fork = page.locator('[data-testid="tab"]').filter({ hasText: '(fork)' })
  if (await fork.count()) await fork.first().locator('[data-testid^="tab-close-"]').click().catch(() => {})
  must(!bad.length, bad.join('; '))
  return { reason: `opened: ${ok.join(' ')}` }
})

// 14. Waiting reason
await feature(14, 'Waiting reason line', 'after a stand-in organize_thread waiting event the thread shows needs-note "Waiting for you" + the reason', async (snap) => {
  await open('t-wait')
  const reason = 'Asks: promote now or after the freeze?'
  await send([['chat:event', 't-wait', { type: 'hive_organize', action: 'waiting', reason }]])
  const n = pane('t-wait').getByTestId('needs-note')
  must(await visible(n), 'needs note missing')
  const t = await n.innerText()
  must(/Waiting for you/.test(t) && t.includes(reason), `note reads ${t}`)
  await snap('waiting')
})

// 15. Escape on a shown file
await feature(15, 'Escape closes a file a thread showed', 'a stand-in show_to_user (hive_show) opens README.md as the focused tab; Escape on it closes the tab and t-main is the selected tab again', async (snap) => {
  await open('t-main')
  const readme = join(API, 'README.md')
  await send([['chat:event', 't-main', assistant(tool('sh1', 'mcp__orbit__show_to_user', { path: readme }))], ['chat:event', 't-main', { type: 'hive_show', path: readme }]])
  const ft = page.locator('[data-testid="tab"][data-id$="README.md"]')
  must(await visible(ft, 6000), 'README tab did not open')
  must((await ft.first().getAttribute('aria-selected')) === 'true', 'README tab not focused')
  await page.waitForTimeout(1200)
  await snap('shown')
  await ft.first().focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  if (await ft.count()) {
    // the editor may have taken the focus: try once from the page body
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    must(!(await ft.count()), 'README tab still open after Escape')
  }
  const sel = await page.locator('[data-testid="tab"][aria-selected="true"]').first().getAttribute('data-id')
  must(sel === 't-main', `selected tab after Escape: ${sel}`)
  await snap('back')
})

// 16. Board
await feature(16, 'Jira board (stubbed tracker)', 'page-board shows board-columns with 6 stage columns (backlog first, prod last) whose heads are coloured by stage class bd-s-*', async (snap) => {
  await tid('abar-more').click(); await tid('abar-board').click()
  must(await visible(tid('board-columns'), 6000), 'board columns missing')
  const cols = await page.locator('[data-testid^="board-col-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid'), cls: e.className, c: getComputedStyle(e.querySelector('.bd-col-head') ?? e).borderTopColor + '|' + getComputedStyle(e.querySelector('.bd-col-head') ?? e).color })))
  must(cols.length === 6, `columns: ${cols.length}`)
  must(cols[0].cls.includes('bd-s-backlog') && cols.at(-1).cls.includes('bd-s-prod'), `order: ${cols.map((c) => c.cls).join(', ')}`)
  must(new Set(cols.map((c) => c.c)).size >= 3, `column heads share colours: ${[...new Set(cols.map((c) => c.c))].join(' ; ')}`)
  must((await tid('board-card').count()) === 6, 'expected 6 cards')
  await snap('board')
  await goThreads()
  return { reason: cols.map((c) => c.cls.replace('bd-col bd-s-', '')).join(' > ') }
})

// 17. Phone status
await feature(17, 'Phone status on the status line', 'status-phone reads "Phone connected", then "Phone offline", then "Phone not paired" as stand-in mobile:status events arrive', async (snap) => {
  await open('t-main')
  const ph = tid('status-phone')
  const seen = []
  for (const [s, want, label] of [[{ configured: true, paired: true, connected: true }, 'Phone connected', 'connected'], [{ configured: true, paired: true, connected: false }, 'Phone offline', 'offline'], [{ configured: true, paired: false, connected: false }, 'Phone not paired', 'not-paired']]) {
    await send([['mobile:status', s]]); await page.waitForTimeout(300)
    must(await visible(ph), 'phone status missing')
    const t = (await ph.innerText()).trim(); seen.push(t)
    must(t === want, `expected ${want}, saw ${t}`)
    await ph.scrollIntoViewIfNeeded(); await snap(label)
  }
  await send([['mobile:status', { configured: true, paired: true, connected: true }]])
  return { reason: seen.join(' / ') }
})

// 18. Running bar
await feature(18, 'Running bar groups', 'running-bar on t-run opens to running-group-subagents, running-group-shells and running-group-monitors with one row each', async (snap) => {
  await open('t-run')
  const p = pane('t-run')
  must(await visible(p.getByTestId('running-bar')), 'running bar missing')
  if (!(await visible(p.getByTestId('running-group-subagents'), 800))) await p.getByTestId('running-bar').click()
  for (const g of ['subagents', 'shells', 'monitors']) must(await visible(p.getByTestId(`running-group-${g}`)), `group ${g} missing`)
  const texts = await p.locator('[data-testid^="running-group-"]').allInnerTexts()
  await snap('running')
  return { reason: texts.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ') }
})

// 12. Worktree toggle
await feature(12, 'Worktree toggle on a new thread', 'a new thread (Ctrl+N) pointed at the throwaway repo via the folder button (dialog stubbed) shows worktree-toggle; clicking it sets aria-pressed=true and reads "Worktree on" (nothing created)', async (snap) => {
  await tid('tab-new').click(); await page.waitForTimeout(500)
  const sel = await page.locator('[data-testid="tab"][aria-selected="true"]').first().getAttribute('data-id')
  const p = pane(sel)
  must(await visible(p.getByTestId('new-thread-folder')), 'folder button missing on the new thread')
  await p.getByTestId('new-thread-folder').click(); await page.waitForTimeout(600)
  const w = p.getByTestId('worktree-toggle')
  must(await visible(w), 'worktree toggle missing')
  must((await w.getAttribute('aria-pressed')) === 'false', 'toggle should start off')
  await snap('off')
  await w.click()
  must((await w.getAttribute('aria-pressed')) === 'true' && /Worktree on/.test(await w.innerText()), 'toggle did not turn on')
  await snap('on')
  await w.click()
  await p.getByTestId('composer').fill('')
  await page.locator(`[data-testid="tab-close-${sel}"]`).click().catch(() => {})
})

// 13. Agent threads
await feature(13, 'Agent threads (Settings > Agents, Ctrl+K, Stop)', 'Settings > Agents: add "hello" = cmd /c echo hello & pause, Save; Ctrl+K "New agent thread: hello" opens agent-ask, OK starts a tab with agent-state; the rail shows section-agents; Stop moves the state word off running', async (snap) => {
  await tid('abar-settings').click()
  await tid('settings-nav-agents').click()
  await tid('settings-agent-add').click()
  const row = tid('settings-agent').last()
  await row.getByLabel('Name').fill('hello')
  await row.getByLabel('Command').fill('cmd')
  await row.getByLabel('Arguments').fill('/c echo hello & pause')
  await snap('settings')
  await tid('settings-save').click()
  await page.waitForTimeout(1200)
  must(await tid('settings-save').isDisabled(), 'settings did not save')
  await page.keyboard.press('Escape'); await goThreads()
  await open('t-main')
  await page.keyboard.press('Control+KeyK'); await page.waitForTimeout(200)
  await page.keyboard.type('New agent thread: hello'); await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  must(await visible(tid('agent-ask')), 'agent dialog did not open')
  await snap('ask')
  await tid('agent-ask-ok').click()
  const at = page.locator('[data-testid="tab"][data-id^="agent:"]')
  must(await visible(at, 5000), 'agent tab missing')
  must(await visible(at.getByTestId('agent-state')), 'agent tab has no state word')
  await page.waitForTimeout(2500)
  const w1 = await at.getByTestId('agent-state').innerText()
  must(await visible(tid('section-agents')), 'Agents group missing from the rail')
  const term = await page.locator('.xterm-rows').first().innerText().catch(() => '')
  await snap('running')
  await tid('agent-stop').click(); await page.waitForTimeout(1500)
  const w2 = await at.getByTestId('agent-state').innerText()
  await snap('stopped')
  must(w2 !== w1 || !/running/i.test(w2), `state stayed "${w2}" after Stop`)
  const id = await at.first().getAttribute('data-id')
  await page.locator(`[data-testid="tab-close-${id}"]`).click().catch(() => {})
  return { reason: `state ${w1} -> ${w2}; terminal shows hello: ${/hello/.test(term)}` }
})

// ---- report ----
results.sort((a, b) => a.n - b.n)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tone = { PASS: '#1f7a3a', FAIL: '#b42318', BLOCKED: '#9a6700' }
const html = `<!doctype html><meta charset="utf-8"><title>Orbit 2.0 tour</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;color:#222}h2{margin-top:40px}
.st{font-weight:700;padding:2px 8px;border-radius:4px;color:#fff}img{max-width:100%;border:1px solid #ccc;margin:8px 0}code{background:#f3f3f3;padding:1px 4px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}</style>
<h1>Orbit 2.0.1 feature tour</h1>
<p>Run ${esc(new Date().toISOString())}, test mode, temp data and HOME (${esc(RUN)}), every Claude / gh / tracker / phone call answered by a stand-in. Page errors: ${pageErrors.length}.</p>
<table><tr><th>#</th><th>Feature</th><th>Result</th><th>Note</th></tr>${results.map((r) => `<tr><td>${r.n}</td><td><a href="#f${r.n}">${esc(r.name)}</a></td><td><span class="st" style="background:${tone[r.status]}">${r.status}</span></td><td>${esc(r.reason)}</td></tr>`).join('')}</table>
${results.map((r) => `<h2 id="f${r.n}">${r.n}. ${esc(r.name)} <span class="st" style="background:${tone[r.status]}">${r.status}</span></h2>
<p><b>Assertion:</b> ${esc(r.assertion)}</p>${r.reason ? `<p><b>Note:</b> ${esc(r.reason)}</p>` : ''}
${r.shots.map((s) => `<div><code>${esc(s)}</code><br><img src="${esc(s)}" loading="lazy"></div>`).join('')}`).join('\n')}
`
writeFileSync(join(OUT, 'index.html'), html)
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), pageErrors, results }, null, 2))
console.log('\nSUMMARY')
for (const r of results) console.log(`${r.n}\t${r.status}\t${r.name}\t${r.reason}`)
// close only the instance this script launched
const done = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 15_000))])
if (!done && pid) { try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'pipe' }) } catch { /* gone */ } }
console.log('report', join(OUT, 'index.html'))
process.exit(0)
