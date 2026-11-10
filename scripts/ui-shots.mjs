/* global window, document, MutationObserver */
// Screenshots of the built window with seeded content, for looking at the UI. Nothing is sent to Claude: the app
// runs in test mode (HIVE_TEST_MODE=1, its own temp data folder), every chat call main would make is answered by a
// stand-in installed through Playwright, and threads, tasks, watchers, wake-ups and usage come from the seed below.
// Invented names only.
//
//   npm run build && node scripts/ui-shots.mjs [out folder]
//
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, 'out', 'ui-shots'))
const RUN = join(tmpdir(), `hive-ui-shots-${Date.now().toString(36)}`)
const DATA = join(RUN, 'data')
const REPOS = join(RUN, 'repos')
const API = join(REPOS, 'ledger-api')
mkdirSync(OUT, { recursive: true })
mkdirSync(DATA, { recursive: true })

// ---- a small repo to show in Files, Changes and the editor ----
const git = (...a) => execFileSync('git', a, { cwd: API, stdio: 'pipe' })
mkdirSync(join(API, 'billing'), { recursive: true })
mkdirSync(join(API, 'migrations'), { recursive: true })
mkdirSync(join(API, 'tests', 'billing'), { recursive: true })
mkdirSync(join(API, 'reports'), { recursive: true })
const invoiceV1 = `from django.db import transaction
from .models import Invoice
from .numbering import next_invoice_number


def create_invoice_for_payment(payment):
    with transaction.atomic():
        return Invoice.objects.create(
            payment=payment,
            number=next_invoice_number(payment.account),
            total=payment.amount_cents / 100,
        )


def void_invoice(invoice: Invoice, reason: str) -> None:
    invoice.status = "void"
    invoice.void_reason = reason
    invoice.save(update_fields=["status", "void_reason"])
`
writeFileSync(join(API, 'billing', 'invoice.py'), invoiceV1)
writeFileSync(join(API, 'billing', 'models.py'), 'from django.db import models\n\n\nclass Invoice(models.Model):\n    number = models.CharField(max_length=32)\n')
writeFileSync(join(API, 'billing', 'numbering.py'), 'def next_invoice_number(account):\n    return account.invoices.count() + 1\n')
writeFileSync(join(API, 'billing', 'legacy_numbers.py'), '# old numbering, replaced\n')
writeFileSync(join(API, 'billing', 'webhooks.py'), 'def on_payment_succeeded(event):\n    pass\n')
writeFileSync(join(API, 'migrations', '0141_invoice_status.py'), '# migration\n')
writeFileSync(join(API, 'pyproject.toml'), '[project]\nname = "ledger-api"\n')
writeFileSync(join(API, 'README.md'), '# ledger-api\n')
writeFileSync(join(API, '.gitignore'), '.venv\n__pycache__\n')
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'shots@example.invalid'); git('config', 'user.name', 'Shots'); git('config', 'commit.gpgsign', 'false')
git('add', '.'); git('commit', '-q', '-m', 'Ledger API')
git('checkout', '-q', '-b', 'fix/invoice-retry')
writeFileSync(join(API, 'billing', 'invoice.py'), `from django.db import IntegrityError, transaction
from .models import Invoice
from .numbering import next_invoice_number


def create_invoice_for_payment(payment, retry_key: str) -> Invoice:
    # A retried webhook re-enters here with the same key: return the invoice it made
    existing = Invoice.objects.filter(payment=payment, retry_key=retry_key).first()
    if existing:
        return existing
    try:
        with transaction.atomic():
            return Invoice.objects.create(
                payment=payment,
                retry_key=retry_key,
                number=next_invoice_number(payment.account),
                total=payment.amount_cents / 100,
            )
    except IntegrityError:
        return Invoice.objects.get(payment=payment, retry_key=retry_key)


def void_invoice(invoice: Invoice, reason: str) -> None:
    invoice.status = "void"
    invoice.void_reason = reason
    invoice.save(update_fields=["status", "void_reason"])
`)
writeFileSync(join(API, 'billing', 'models.py'), 'from django.db import models\n\n\nclass Invoice(models.Model):\n    number = models.CharField(max_length=32)\n    retry_key = models.CharField(max_length=64)\n')
writeFileSync(join(API, 'migrations', '0142_invoice_retry_key.py'), '# adds retry_key and a unique constraint\n')
writeFileSync(join(API, 'tests', 'billing', 'test_retry.py'), 'def test_second_retry_returns_same_invoice():\n    pass\n')
rmSync(join(API, 'billing', 'legacy_numbers.py'))
git('add', 'migrations/0142_invoice_retry_key.py')
writeFileSync(join(RUN, 'workspace.env'), `HIVE_REPOS_ROOT=${REPOS}\n`)
writeFileSync(join(RUN, 'scripts.json'), JSON.stringify([
  { name: 'Weekly report', cwd: RUN, options: [{ label: 'Full run', cmd: 'echo ran' }] },
  { name: 'Refresh fixtures', cwd: RUN, options: [{ label: 'All', cmd: 'echo ran' }] },
], null, 2))
writeFileSync(join(DATA, 'hive-settings.json'), JSON.stringify({ version: 1, env: {}, scripts: null, general: { shell: '', model: 'haiku', effort: 'low', ui: '', theme: '', appName: 'Hive', appTagline: 'One desk, many agents', chrome: false, desktopNotify: false } }, null, 2))

// ---- times ----
const NOW = Date.now()
const M = 60_000, H = 3_600_000
const iso = (t) => new Date(t).toISOString()
const local = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00` }

// ---- saved threads (the rail's Recent) ----
const S = (id, title, project, ago) => ({ id, title, project, cwd: join(REPOS, project), updated: NOW - ago, started: NOW - ago - 2 * H, path: join(RUN, 't', `${id}.jsonl`) })
const saved = [
  S('s-invoice', 'Fix duplicate invoice numbers on retry', 'ledger-api', 4 * M),
  S('s-ship', 'Ship ledger-web 4.18 to prod', 'ledger-web', 6 * M),
  S('s-lead', 'Move report exports onto the job queue', 'ledger-api', 38 * M),
  S('s-sync', 'Offline sync spike for fieldbook', 'fieldbook', 12 * M),
  S('s-dependabot', 'Review 6 Dependabot PRs on ledger-web', 'ledger-web', 1 * H),
  S('s-rename', 'Rename tenants to workspaces in settings', 'ledger-web', 26 * H),
  S('s-payout', 'Payout reconciliation', 'ledger-api', 2 * H),
  S('s-node', 'Bump node to 22 in CI images', 'infra', 3 * H),
  S('s-refund', 'Refund webhook retries back off', 'ledger-api', 3 * 24 * H),
  S('s-copy', 'Onboarding checklist copy pass', 'ledger-web', 4 * 24 * H),
  S('s-index', 'Search index rebuild after the schema change', 'ledger-api', 9 * 24 * H),
  S('s-sweep', 'Nightly error sweep', 'ledger-api', 41 * M),
  S('s-android', 'Android app drops drafts on relock', 'fieldbook', 22 * M),
].sort((a, b) => b.updated - a.updated)
const history = {
  [join(RUN, 't', 's-rename.jsonl')]: [
    { kind: 'user', text: 'Rename "tenant" to "workspace" in the settings screens and the API docs, keep the API field names.', images: [] },
    { kind: 'assistant', text: 'Done. The settings screens and the docs say **workspace** now; the API keeps `tenant_id` so no client breaks. Merged as #812.' },
  ],
}

// ---- what main answers in place of the real handlers ----
const fixtures = {
  'sessions:list': saved,
  'search:status': { indexed: saved.length, total: saved.length, done: true },
  'search:query': { indexing: null, results: [] },
  'status:get': {
    account: 'orin@work.example', plan: 'Max 20x',
    five: { pct: 62, resetsAt: iso(NOW + 1.8 * H) }, seven: { pct: 41, resetsAt: iso(NOW + 3 * 24 * H) },
    usage: [
      { key: 'five_hour', label: 'Current session (5 hours)', pct: 62, resetsAt: iso(NOW + 1.8 * H) },
      { key: 'seven_day', label: 'Current week (all models)', pct: 41, resetsAt: iso(NOW + 3 * 24 * H) },
      { key: 'seven_day_opus', label: 'Current week (Fable)', pct: 28, resetsAt: iso(NOW + 3 * 24 * H) },
    ],
    usageAt: NOW, connectors: { connected: 3, total: 5, needsAuth: 1, failed: 1 }, engine: { installed: true, version: '2.4.12' },
  },
  'engine:latest': '2.4.12',
  'chat:context': { total: 112480, max: 1000000 },
  'chat:mode': 'auto',
  'chat:models': [{ value: 'claude-fable-5-2', displayName: 'Fable 5.2', description: '' }, { value: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: '' }, { value: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: '' }],
  'chat:commands': [
    ['status', 'Show account, model, context and connections'], ['usage', 'Show plan limits'], ['model', 'Switch the model'], ['clear', 'Start a fresh conversation'],
    ['compact', 'Summarise the conversation to free context'], ['context', 'Show what fills the context'], ['mcp', 'Show MCP servers'], ['memory', 'Edit memory files'],
    ['goal', 'Keep working until a condition holds'], ['loop', 'Run a prompt on an interval'], ['review', 'Review the pending changes'], ['login', 'Sign in'],
  ].map(([name, description]) => ({ name, description, builtin: true })).concat([{ name: 'release-notes', description: 'Draft release notes from merged PRs' }, { name: 'triage', description: 'Sort new issues by area' }]),
  'chat:mcp': [
    { name: 'hive', status: 'connected', source: 'built in', tools: 24 }, { name: 'git-host', status: 'connected', source: 'user', tools: 31 },
    { name: 'postgres-ro', status: 'connected', source: 'project', tools: 4 }, { name: 'issue-tracker', status: 'needs-auth', source: 'user', tools: null },
    { name: 'error-feed', status: 'failed', source: 'user', error: 'connection refused', tools: null },
  ],
  'chat:continueAt': null,
  'worktree:links': [],
  'watchers:list': {
    root: join(RUN, 'watchers'), problems: [], testMode: true,
    watchers: [
      { id: 'sweep', name: 'Nightly error sweep', goal: 'Find new 5xx patterns in the error feed', enabled: true, status: 'waiting', waitingReason: 'Finding: 502s on /v2/payouts since 01:10', message: '', lastRun: NOW - 41 * M, nextRun: NOW + 4.5 * H, schedule: { every: 'adaptive' }, tier: null, findings: 1, tabId: 'watcher-sweep', sessionId: 's-sweep', sessionIds: ['s-sweep'], dir: join(RUN, 'watchers', 'sweep'), prompt: 'prompt.md' },
      { id: 'payout', name: 'Payout reconciliation', goal: 'Compare payouts with the bank file', enabled: true, status: 'idle', waitingReason: '', message: '', lastRun: NOW - 2 * H, nextRun: NOW + 3.2 * H, schedule: { every: 'self' }, tier: null, findings: 0, tabId: null, sessionId: 's-payout', sessionIds: ['s-payout'], dir: join(RUN, 'watchers', 'payout'), prompt: 'prompt.md' },
      { id: 'flaky', name: 'Flaky test watch', goal: 'Spot tests that fail and pass on retry', enabled: false, status: 'idle', waitingReason: '', message: '', lastRun: NOW - 3 * 24 * H, nextRun: null, schedule: { every: '2h' }, tier: null, findings: 0, tabId: null, sessionId: null, sessionIds: [], dir: join(RUN, 'watchers', 'flaky'), prompt: 'prompt.md' },
    ],
  },
  'teams:roster': [{ id: 'team1', name: 'Report exports team', people: [
    { id: 't-lead', name: 'Lead', role: 'lead', sessionId: 's-lead' }, { id: 't-b1', name: 'Builder 1', role: 'builder' },
    { id: 't-b2', name: 'Builder 2', role: 'builder' }, { id: 't-rev', name: 'Reviewer', role: 'reviewer' }] }],
  'teams:list': [{ id: 'team1', name: 'Report exports team', goal: 'Move report exports onto the job queue', createdAt: NOW - 2 * H, members: 4 }],
  'mobile:status': { configured: true, paired: true, connected: true, error: '' },
  'allow:status': { configured: true, ip: '203.0.113.24', lastIp: '198.51.100.7', at: iso(NOW - 26 * H), changed: true, running: false, error: '' },
  'update:state': null,
  'dev:state': { configured: true, message: '', docker: { phase: 'ready', message: '' }, stacks: [{ id: 'ledger', label: 'Ledger stack', services: ['api', 'web', 'worker'] }], services: [
    { name: 'api', label: 'ledger-api', repo: 'ledger-api', kind: 'process', port: 8081, open: true, state: 'running', external: false, note: '', owner: 'you' },
    { name: 'web', label: 'ledger-web', repo: 'ledger-web', kind: 'process', port: 5173, open: true, state: 'running', external: false, note: '', owner: 'you' },
    { name: 'worker', label: 'export worker', repo: 'ledger-api', kind: 'process', port: null, open: false, state: 'stopped', external: false, note: '', owner: '' }] },
  'dev:logs': '21:02:11 GET /v2/invoices 200 18ms\n21:02:12 POST /v2/payments/retry 200 41ms\n21:02:15 GET /health 200 2ms\n',
  'deploy:config': { config: { org: 'example-org', region: 'us-east-1', script: 'deploy.sh', diffsScript: 'diffs.sh', suites: [
    { id: 'ledger-web', label: 'ledger-web', api: [], web: ['ledger-web'] }, { id: 'ledger-api', label: 'ledger-api', api: ['ledger-api'], web: [] }, { id: 'fieldbook', label: 'fieldbook', api: [], web: [] }],
  apiRepo: 'ledger-api', cluster: 'ledger-{env}', services: ['api'], serviceName: '{cluster}-{service}', webRepo: 'ledger-web', bucket: '', distribution: '' }, message: '' },
  'deploy:watchers': [],
  'deploy:diffs': { diffs: [{ repo: 'ledger-web', mainSha: 'a91f3c2', stagingSha: 'a91f3c2', prodSha: '3be7d10', toStaging: [], migrations: false, toProd: [
    ['a91f3c2', 'Release 4.18.0', 'release-bot'], ['7c0e1d4', 'Workspaces: rename tenant copy in settings', 'orin'], ['55b2a90', 'Fix CSV export header order', 'orin'],
    ['e13f0b7', 'Bump vite to 6.3.2', 'dependabot'], ['0d9a6c1', 'Invoice list: keep filters on back', 'orin'], ['b8e4f22', 'Lazy-load the reports page', 'orin'],
    ['4f1a2b3', 'Settings: plan page copy', 'mara'], ['9a0c7e1', 'Charts: tabular figures', 'mara'],
  ].map(([sha, title, author]) => ({ sha, title, author })) }], changelog: '## 4.18.0\n- Workspaces rename\n- CSV export fix', output: 'ledger-web: 8 commits to prod', root: REPOS },
  'deploy:status': [],
  'handoff:at': 400000,
  'todos:list': [
    { id: 'td1', text: 'Ask the bank for the new payout file format', status: 'todo', done: false, due: local(NOW + 24 * H).slice(0, 10), createdAt: NOW - 3 * H, source: 'user' },
    { id: 'td2', text: 'Review the refund retry PR once tests pass', status: 'todo', done: false, createdAt: NOW - H, source: 'claude' },
    { id: 'td3', text: 'Talk through the export queue limits with the team', status: 'talk', done: false, createdAt: NOW - 26 * H, source: 'user' },
    { id: 'td4', text: 'Rotate the staging deploy key', status: 'done', done: true, createdAt: NOW - 50 * H, doneAt: NOW - 20 * H, source: 'user' },
  ],
  'notes:list': [
    { id: 'n1', title: 'Release checklist', updated: NOW - 2 * H, text: ['# Release checklist', '', '- Staging landed check', '- Freeze window', '- Changelog'].join(String.fromCharCode(10)) },
    { id: 'n2', title: 'Payout file fields', updated: NOW - 30 * H, text: ['# Payout file fields', '', 'Amount, currency, reference, value date.'].join(String.fromCharCode(10)) },
  ],
  // Settings without the weekly usage reading (that reads the Claude login): the run's own keys only
  'settings:get': {
    file: join(DATA, 'hive-settings.json'), envFile: join(RUN, 'workspace.env'), scriptsFile: join(RUN, 'scripts.json'),
    env: { HIVE_REPOS_ROOT: REPOS, HIVE_DEPLOY_SUITES: 'ledger-web,ledger-api,fieldbook', HIVE_DEPENDABOT_REPOS: 'example-org/ledger-web', HIVE_DEPENDABOT_MAX_REVIEWS: '3', HIVE_WATCH_REPORTS: join(RUN, 'reports') },
    sections: { HIVE_REPOS_ROOT: 'dev', HIVE_DEPLOY_SUITES: 'deploy', HIVE_DEPENDABOT_REPOS: 'dependabot', HIVE_DEPENDABOT_MAX_REVIEWS: 'dependabot', HIVE_WATCH_REPORTS: 'watch' },
    scripts: null, secrets: [], problems: [], weekly: { pct: 41, error: '' },
    general: { shell: '', model: '', effort: '', ui: '', theme: '', appName: 'Hive', appTagline: 'One desk, many agents', chrome: true, desktopNotify: true, bgModel: '', bgEffort: '', teamModel: '', teamEffort: '', idleCloseMinutes: 30, teamMemoryKb: 6 },
  },
  'settings:validate': [],
}

// the adapter's answers for calls main does not have yet (api/next.ts reads window.__hiveSeed in test mode)
const seed = {
  wakeupsList: {
    wakeups: [
      { id: 1, sessionId: 's-ship', title: 'Ship ledger-web 4.18 to prod', wakeAt: local(NOW + 33 * M), prompt: 'Promote to prod when the freeze ends', everyMinutes: null, firedAt: null },
      { id: 2, sessionId: 's-ship', title: 'Ship ledger-web 4.18 to prod', wakeAt: local(NOW + 63 * M), prompt: 'Check the prod landed check and the 5xx rate', everyMinutes: null, firedAt: null },
      { id: 3, sessionId: 's-dependabot', title: 'Review 6 Dependabot PRs on ledger-web', wakeAt: local(NOW + 2 * 24 * H), prompt: 'Re-check the 2 PRs that need a look', everyMinutes: null, firedAt: null },
    ],
    continues: [{ key: 's-android', tabId: 't-android', title: 'Android app drops drafts on relock', at: NOW + 1.8 * H + M }],
  },
  accountsList: [
    { id: 'work', label: 'Work', email: 'orin@work.example', plan: 'Max 20x', kind: 'subscription', inUse: true, threads: 7, limits: [{ key: 'five_hour', label: '5-hour', pct: 62, resetsAt: null }, { key: 'seven_day', label: '7-day', pct: 41, resetsAt: null }] },
    { id: 'personal', label: 'Personal', email: 'orin@home.example', plan: 'Pro', kind: 'subscription', inUse: false, threads: 1, limits: [{ key: 'five_hour', label: '5-hour', pct: 8, resetsAt: null }, { key: 'seven_day', label: '7-day', pct: 19, resetsAt: null }] },
    { id: 'bot', label: 'Build bot', email: 'API key, build-ci', plan: 'Console, pay as you go', kind: 'console', inUse: false, threads: 0, spend: '$14.20 this month' },
  ],
  quietHoursGet: { on: true, from: '22:00', to: '07:30', ringFailures: true, ringDeploys: true },
  allowKnown: [{ ip: '203.0.113.24', at: null, label: 'now, not allowed yet' }, { ip: '198.51.100.7', at: NOW - 26 * H, label: 'home' }, { ip: '192.0.2.40', at: NOW - 9 * 24 * H, label: 'office' }],
  chatStatusView: { fallback: {
    live: true, account: { email: 'orin@work.example', organization: 'Work', plan: 'Max 20x', tokenSource: 'subscription', apiProvider: 'firstParty' },
    engine: { installed: true, version: '2.4.12' }, model: 'claude-fable-5-2', effort: 'high', permissionMode: 'auto', sessionId: 's-invoice', cwd: API, transcript: null,
    memoryDir: null, context: { total: 112480, max: 1000000 }, cache: { lastReplyAt: NOW - M, ttlMs: 3_600_000 }, compactions: 0,
    mcp: fixtures['chat:mcp'], limits: fixtures['status:get'].usage, limitsAt: NOW, tokens: { input: 1_920_000, output: 38_400, cacheRead: 1_710_000, cacheWrite: 90_000, requests: 210, complete: true },
    outputStyle: 'Proactive', memoryFiles: ['CLAUDE.md', 'memory/billing.md', 'memory/deploys.md'], hooks: { active: 9, failing: 0 },
    contextParts: { system: 21000, tools: 10000, memory: 18000, messages: 63480 }, autoCompactAt: 800000,
  } },
}

// ---- the live threads: started the way main starts a thread, then the events their turns would send ----
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input })
const text = (t) => ({ type: 'text', text: t })
const assistant = (...content) => ({ type: 'assistant', message: { model: 'claude-fable-5-2', content } })
const result = (id, out, opts = {}) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: !!opts.error }] }, ...(opts.patch ? { tool_use_result: { structuredPatch: opts.patch } } : {}) })
const task = (subtype, id, extra) => ({ type: 'system', subtype, task_id: id, ...extra })
const patchOf = (lines) => [{ oldStart: 1, oldLines: lines.filter((l) => !l.startsWith('+')).length, newStart: 1, newLines: lines.filter((l) => !l.startsWith('-')).length, lines }]
const P = (f) => join(API, f)

const threads = [
  { tabId: 't-invoice', title: 'Fix duplicate invoice numbers on retry', cwd: API, sessionId: 's-invoice', foreground: true,
    prompt: "Invoices created on a retried payment get a second number. Find where the number is assigned, make it idempotent on the payment's retry key, and add a test that retries twice." },
  { tabId: 't-ship', title: 'Ship ledger-web 4.18 to prod', cwd: join(REPOS, 'ledger-web'), sessionId: 's-ship', foreground: true, prompt: 'Ship ledger-web 4.18 to prod once staging has landed.' },
  { tabId: 'watcher-sweep', title: 'Nightly error sweep', cwd: API, sessionId: 's-sweep', prompt: 'Sweep the error feed for new 5xx patterns.' },
  { tabId: 't-lead', title: 'Move report exports onto the job queue', cwd: API, sessionId: 's-lead', prompt: 'Lead the team: move report exports onto the job queue.' },
  { tabId: 't-b1', title: 'Builder 1: move PDF exports', cwd: API, prompt: 'Move the PDF exports.' },
  { tabId: 't-b2', title: 'Builder 2: port the CSV writer', cwd: API, prompt: 'Port the CSV writer to the job queue.' },
  { tabId: 't-sync', title: 'Offline sync spike for fieldbook', cwd: join(REPOS, 'fieldbook'), sessionId: 's-sync', prompt: 'Spike: offline sync for fieldbook drafts.' },
  { tabId: 't-node', title: 'Bump node to 22 in CI images', cwd: join(REPOS, 'infra'), sessionId: 's-node2', prompt: 'Bump node to 22 in the CI images.' },
]

const events = [
  // the invoice thread: what it read and changed, a subagent and a shell running, a loop scheduled
  ['t-invoice', { type: 'hive_session', sessionId: 's-invoice', path: join(RUN, 't', 's-invoice.jsonl') }],
  ['t-invoice', { type: 'system', subtype: 'init', model: 'claude-fable-5-2', permissionMode: 'auto' }],
  ['t-invoice', { type: 'hive_worktree', repo: 'ledger-api', path: API, branch: 'fix/invoice-retry' }],
  ['t-invoice', { type: 'hive_effort', level: 'high' }],
  ['t-invoice', assistant(text('The number comes from `next_invoice_number()` in `billing/numbering.py`. It is called from three places, but only `create_invoice_for_payment` runs again on a retry: the webhook handler re-enters it with the same `retry_key`. I\'ll store the key on the invoice and return the existing invoice when it is already there.'),
    tool('r1', 'Read', { file_path: P('billing/numbering.py') }), tool('g1', 'Grep', { pattern: 'next_invoice_number(' }), tool('a1', 'Agent', { description: 'Explore: map every caller of the numbering helper' }))],
  ['t-invoice', result('r1', Array.from({ length: 212 }, (_, i) => `${i + 1}  line`).join('\n'))],
  ['t-invoice', result('g1', 'billing/invoice.py:3\nbilling/invoice.py:11\nbilling/webhooks.py:2\nreports/pdf.py:40\nreports/csv.py:12\ntests/billing/test_numbers.py:5\ntests/billing/test_retry.py:9')],
  ['t-invoice', result('a1', 'Found 7 callers in 4 files')],
  ['t-invoice', task('task_started', 'k-explore', { task_type: 'local_agent', description: 'Explore: map every caller', subagent_type: 'Explore' })],
  ['t-invoice', task('task_notification', 'k-explore', { status: 'completed', summary: 'Found 7 callers in 4 files, 1m 12s' })],
  ['t-invoice', assistant(tool('e1', 'Edit', { file_path: P('billing/invoice.py'), old_string: 'a', new_string: 'b' }), tool('e2', 'Edit', { file_path: P('billing/models.py'), old_string: 'a', new_string: 'b' }), tool('w1', 'Write', { file_path: P('migrations/0142_invoice_retry_key.py'), content: 'x' }))],
  ['t-invoice', result('e1', 'ok', { patch: patchOf([' from django.db import transaction', '-from django.db import transaction', '+from django.db import IntegrityError, transaction', ' from .models import Invoice', '-def create_invoice_for_payment(payment):', '+def create_invoice_for_payment(payment, retry_key: str) -> Invoice:', '+    existing = Invoice.objects.filter(payment=payment, retry_key=retry_key).first()', '+    if existing:', '+        return existing']) })],
  ['t-invoice', result('e2', 'ok', { patch: patchOf(['     number = models.CharField(max_length=32)', '+    retry_key = models.CharField(max_length=64)']) })],
  ['t-invoice', result('w1', 'ok', { patch: patchOf(Array.from({ length: 18 }, (_, i) => `+# migration line ${i + 1}`)) })],
  ['t-invoice', assistant(tool('b1', 'Bash', { command: 'pytest tests/billing -x -q', description: 'Run the billing tests' }))],
  ['t-invoice', task('task_started', 'k-review', { task_type: 'local_agent', description: 'Reviewer: check the retry path', subagent_type: 'reviewer' })],
  ['t-invoice', task('task_progress', 'k-review', { summary: 'Reading billing/webhooks.py, line 140' })],
  ['t-invoice', task('task_started', 'k-pytest', { task_type: 'local_bash', description: 'pytest tests/billing -x -q' })],
  ['t-invoice', task('task_progress', 'k-pytest', { summary: 'test_second_retry_returns_same_invoice PASSED' })],
  ['t-invoice', { type: 'hive_stop', crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: 'check CI on fix/invoice-retry' }], effort: 'high' }],

  // the deploy thread: staging landed, a question about prod
  ['t-ship', { type: 'hive_session', sessionId: 's-ship', path: join(RUN, 't', 's-ship.jsonl') }],
  ['t-ship', { type: 'system', subtype: 'init', model: 'claude-fable-5-2', permissionMode: 'auto' }],
  ['t-ship', assistant(text('Staging is on 4.18.0 (`a91f3c2`) and the landed check passed: every CloudFront edge serves the new build. 14 commits will ship to prod, none touch payments or auth. Prod is in the change freeze until 14:00.'),
    tool('sb1', 'Bash', { command: './deploy.sh ledger-web staging', description: 'Deploy to staging' }), tool('sr1', 'Read', { file_path: join(REPOS, 'ledger-web', 'CHANGELOG.md') }))],
  ['t-ship', result('sb1', 'Building ledger-web at a91f3c2\nLanded: 24 of 24 edges serve build 7f1e\nexit code 0')],
  ['t-ship', result('sr1', '4.18.0 section\n- Workspaces rename\n- CSV export fix')],
  ['t-ship', task('task_started', 'k-mon', { task_type: 'monitor', description: 'Tail staging logs for 5xx' })],
  ['t-ship', task('task_progress', 'k-mon', { summary: '0 errors in the last 5 minutes' })],
  ['t-ship', task('task_started', 'k-build', { task_type: 'local_bash', description: 'npm run build' })],
  ['t-ship', task('task_notification', 'k-build', { status: 'completed', summary: 'exit 0, 38.2 s, dist 2.1 MB' })],
  ['t-ship', assistant(tool('q1', 'AskUserQuestion', { questions: [{ question: 'Promote ledger-web 4.18 to prod?', header: 'Deploy', multiSelect: false, options: [
    { label: 'Promote now', description: 'The freeze is advisory for web.' }, { label: 'Wait for the freeze, then promote at 14:00 by itself', description: '' }, { label: 'Show me the 14 commits first', description: '' }] }] }))],
  ['t-ship', { type: 'hive_ask', id: 'q1' }],
  ['t-ship', { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Goal set: prod serves 4.18 and the landed check passes' }] } }],
  ['t-ship', { type: 'result', subtype: 'success' }],

  // the watcher found something
  ['watcher-sweep', { type: 'hive_session', sessionId: 's-sweep', path: join(RUN, 't', 's-sweep.jsonl') }],
  ['watcher-sweep', assistant(text('New pattern: 502s on `/v2/payouts` since 01:10, all from one upstream.'))],
  ['watcher-sweep', { type: 'result', subtype: 'success' }],

  // the team: the lead plans, two builders work, one failed, Codex writes a migration
  ['t-lead', { type: 'system', subtype: 'init', model: 'claude-fable-5-2', permissionMode: 'auto' }],
  ['t-lead', assistant(tool('lt1', 'mcp__hive__message_thread', { thread: 'Builder 2', text: 'Port the CSV writer next' }))],
  ['t-lead', task('task_started', 'k-b2', { task_type: 'local_agent', description: 'Builder 2: port the CSV writer to the job queue', subagent_type: 'builder' })],
  ['t-lead', task('task_progress', 'k-b2', { summary: 'Edit reports/csv_writer.py +44 -19' })],
  ['t-lead', task('task_started', 'k-b1', { task_type: 'local_agent', description: 'Builder 1: move PDF exports', subagent_type: 'builder' })],
  ['t-lead', task('task_updated', 'k-b1', { patch: { status: 'failed', error: 'Edit refused: reports/pdf.py changed on disk', end_time: NOW - 4 * M } })],
  ['t-lead', { type: 'hive_codex', phase: 'start', id: 'cx1', task: 'Write the export_jobs migration', model: 'gpt-5-codex', allowEdits: true }],
  ['t-lead', { type: 'hive_codex', phase: 'line', id: 'cx1', line: 'Running makemigrations --check' }],
  ['t-b1', { type: 'result', is_error: true, subtype: 'error', errors: ['Edit refused: reports/pdf.py changed on disk'] }],
  ['t-b2', assistant(tool('b2e', 'Edit', { file_path: P('reports/csv_writer.py'), old_string: 'a', new_string: 'b' }))],

  // the fieldbook spike reads; the CI bump failed
  ['t-sync', assistant(tool('sy1', 'Read', { file_path: join(REPOS, 'fieldbook', 'sync', 'OutboxQueue.kt') }))],
  ['t-sync', task('task_started', 'k-gradle', { task_type: 'local_bash', description: 'gradle :app:testDebugUnitTest' })],
  ['t-sync', task('task_progress', 'k-gradle', { summary: '> Task :app:compileDebugKotlin' })],
  ['t-node', assistant(tool('n1', 'Bash', { command: 'docker build -t ci-node22 .', description: 'Build the CI image' }))],
  ['t-node', { type: 'result', is_error: true, subtype: 'error', errors: ['docker build failed at step 7 of 12'] }],
]

// ---- run ----
const require = createRequire(import.meta.url)
const executablePath = require(join(ROOT, 'node_modules', 'electron'))
const env = { ...process.env, HIVE_TEST_MODE: '1', HIVE_DATA_DIR: DATA, HIVE_ENV_FILE: join(RUN, 'workspace.env'), HIVE_SCRIPTS_FILE: join(RUN, 'scripts.json') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ executablePath, args: [ROOT], cwd: ROOT, env, timeout: 60_000 })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message, e.stack?.split(String.fromCharCode(10)).slice(0, 4).join(' | ')))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)) })

// every chat call is answered here; nothing reaches Claude. A sent message is marked seen a moment later.
await app.evaluate(({ ipcMain, BrowserWindow }, { fixtures, history }) => {
  const set = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn) }
  for (const [ch, v] of Object.entries(fixtures)) set(ch, () => v)
  set('watchers:detail', (_e, id) => {
    const w = fixtures['watchers:list'].watchers.find((x) => x.id === id)
    if (!w) return null
    const ago = (m) => new Date(Date.now() - m * 60_000).toISOString()
    return { ...w,
      findingsList: id === 'sweep' ? [{ at: ago(41), title: '502s on /v2/payouts since 01:10', why: 'All from one upstream; 3.1% of payout calls since the 01:10 deploy', kind: 'error-rate' }] : [],
      reports: [{ path: w.dir + '/reports/latest.md', name: 'latest.md', mtime: Date.now() - 41 * 60_000 }],
      runs: [{ id: 'r1', tabId: w.tabId ?? 'watcher-x', kind: 'sweep', startedAt: Date.now() - 45 * 60_000, endedAt: Date.now() - 41 * 60_000, sessionId: w.sessionId ?? undefined, summary: 'One new pattern', path: null, cwd: '' }] }
  })
  set('history:recent', (_e, p) => ({ items: history[p] ?? [], more: false }))
  set('history:load', (_e, p) => history[p] ?? [])
  set('chat:send', (e, tabId, _cwd, _resume, msg) => { if (msg.mode !== 'queue') setTimeout(() => e.sender.send('chat:event', tabId, { type: 'hive_seen', uuid: msg.uuid }), 600) })
  for (const ch of ['chat:interrupt', 'chat:close', 'chat:reset', 'chat:setBackground', 'chat:background', 'chat:setModel', 'chat:setEffort', 'chat:cancelContinue', 'scripts:run', 'scripts:stop', 'dev:start', 'dev:stop', 'dev:stack', 'pull:run', 'allow:run', 'deploy:run', 'engine:update', 'account:switch', 'teams:pause', 'teams:resume']) set(ch, () => undefined)
  for (const ch of ['chat:dequeue', 'chat:promote', 'chat:answer', 'chat:stopTask']) set(ch, () => true)
  set('chat:rewindPreview', () => ({ canRewind: true, filesChanged: [], insertions: 0, deletions: 0 }))
  const w = BrowserWindow.getAllWindows()[0]
  w.setContentSize(1440, 900)
  w.center()
}, { fixtures, history })
const send = (list) => app.evaluate(({ BrowserWindow }, list) => { const w = BrowserWindow.getAllWindows()[0]; for (const [ch, ...a] of list) w.webContents.send(ch, ...a) }, list)
await page.addInitScript((s) => { window.__hiveSeed = s }, seed)
await page.reload()
await page.getByTestId('brand').waitFor({ timeout: 30_000 })
// the real clipboard stays out of the pictures
await page.evaluate(() => window.api.clipboardEnabled(false))
await send([['clipboard:offer', null]])
await page.waitForTimeout(800)

// threads appear the way main starts them, foreground ones in the panes
await send(threads.map((t) => ['hive:thread', { ...t, path: undefined }]))
await page.waitForTimeout(300)
await send(events.map(([tab, ev]) => ['chat:event', tab, ev]))
await page.waitForTimeout(500)
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('shot', name) }
const tid = (t) => page.getByTestId(t)

// panes: the invoice thread on the left, the deploy thread beside it
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await page.locator('[data-testid="tab"][data-id="t-ship"]').dragTo(page.locator('[data-testid="chat-pane"]').first(), { targetPosition: { x: 520, y: 400 } }).catch(() => {})
await page.waitForTimeout(300)
if ((await page.getByTestId('chat-pane').count()) < 2) {
  // drag did not split: Space on the rail row opens it beside
  await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
  await page.locator('[data-testid="live-row"][data-id="t-ship"]').focus()
  await page.keyboard.press('Space')
}
await page.locator('[data-testid="chat-t-invoice"]').click({ position: { x: 200, y: 20 } })
// the deploy thread waits for you (it is beside, not focused); the watcher and the failed ones too
await send([
  ['chat:event', 't-ship', { type: 'hive_organize', action: 'waiting', reason: 'Asks: promote now or after the freeze?' }],
  ['chat:event', 'watcher-sweep', { type: 'hive_organize', action: 'waiting', reason: 'Finding: 502s on /v2/payouts since 01:10' }],
])
// two messages queued behind the running turn, and one steered in that Claude has seen
const box = page.locator('[data-testid="chat-t-invoice"] [data-testid="composer"]')
await box.fill('Also cover the refund path, it probably has the same bug')
await box.press('Tab')
await box.fill('When tests pass, open a draft PR against main and hand it to a Reviewer')
await box.press('Tab')
await box.fill('Use a unique constraint on (payment, retry_key), not a lookup, so two workers can\'t race.')
await box.press('Enter')
await page.waitForTimeout(900)
await send([['chat:event', 't-invoice', assistant(text('Good call. A lookup leaves a window between the read and the insert. The migration now adds `UniqueConstraint(fields=["payment", "retry_key"])`, and the create path catches `IntegrityError` and returns the row that won.'))]])
await box.fill('')
// a fact pinned to the thread's header
await page.locator('[data-testid="chat-t-invoice"] .phead').hover()
await page.locator('[data-testid="chat-t-invoice"] [data-testid="pin-add"]').click()
await page.locator('[data-testid="chat-t-invoice"] [data-testid="pin-input"]').fill('Unique constraint on (payment, retry_key)')
await page.keyboard.press('Enter')
await page.mouse.move(700, 880)
if (await tid('drawer').isVisible().catch(() => false)) await tid('drawer-close').click()
await shot('A-main')

// a streaming reply changes its own pane only: count DOM changes in the other regions while 60 chunks arrive
await tid('insp-files').click()
await page.waitForTimeout(800)
await page.evaluate(() => {
  const w = window
  w.__mut = {}
  for (const [k, sel] of [['rail', '.rail'], ['tabrow', '.tabrow'], ['otherPane', '[data-testid="chat-t-ship"]'], ['inspector', '.insp'], ['statusLine', '.sline'], ['ownPane', '[data-testid="chat-t-invoice"] .thread']]) {
    const el = document.querySelector(sel)
    w.__mut[k] = el ? 0 : -1
    if (el) new MutationObserver((l) => { w.__mut[k] += l.length }).observe(el, { subtree: true, childList: true, characterData: true, attributes: true })
  }
})
for (let i = 0; i < 60; i++) await send([['chat:event', 't-invoice', { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `word${i} ` } } }]])
await page.waitForTimeout(600)
console.log('STREAM CHECK (DOM changes per region while 60 reply chunks streamed into one thread):', JSON.stringify(await page.evaluate(() => window.__mut)))
await send([['chat:event', 't-invoice', assistant(text('Streamed reply, settled.'))]])
await tid('insp-activity').click()

// the accounts switcher over the main view
await tid('account-button').click()
await shot('A-accounts')
await page.keyboard.press('Escape')

// pages open as tabs; for the page pictures the deploy thread goes back into the first pane, so one pane is left
await page.locator('[data-testid="tab"][data-id="t-ship"]').dragTo(page.locator('[data-testid="tab"][data-id="t-invoice"]')).catch(() => {})
await page.waitForTimeout(300)
// pages
for (const [key, name] of [['Control+Shift+KeyR', 'A-running'], ['Control+Shift+KeyS', 'A-wake'], ['Control+Shift+KeyU', 'A-status']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(700)
  await shot(name)
}
await page.keyboard.press('Control+Shift+KeyD')
await page.waitForTimeout(500)
const suite = page.getByTestId('deploy-suite').first()
if (await suite.isVisible().catch(() => false)) { await suite.click(); await page.waitForTimeout(1200) }
await shot('A-deploy')
for (const v of ['watchers', 'workspace', 'settings']) {
  await tid(`rail-view-${v}`).click()
  await page.waitForTimeout(700)
  await shot(`A-${v}`)
}

// every Workspace tab and the Teams tab
await tid('rail-view-workspace').click()
for (const t of ['stacks', 'scripts', 'git', 'todos', 'notes', 'dependabot']) {
  await tid(`ws-tab-${t}`).click()
  await page.waitForTimeout(900)
  await shot(`X-workspace-${t}`)
}
await tid('ws-tab-pull').click()
await tid('rail-view-watchers').click()
await tid('wt-tab-teams').click().catch(() => {})
await page.waitForTimeout(800)
await shot('X-teams')
await tid('wt-tab-watchers').click().catch(() => {})

// the inspector's Changes and Status for the invoice thread; a thread's menu in the rail; Allow my IP
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await tid('insp-changes').click()
await page.waitForTimeout(1200)
await shot('X-insp-changes')
await tid('insp-status').click()
await page.waitForTimeout(600)
await shot('X-insp-status')
await page.locator('[data-testid="thread-row"]').first().click({ button: 'right' })
await page.waitForTimeout(300)
await shot('X-thread-menu')
await page.keyboard.press('Escape')
await tid('status-allow').click()
await page.waitForTimeout(500)
await shot('X-allow-ip')
await page.keyboard.press('Escape')

// the editor beside the thread, Files in the inspector
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await tid('insp-files').click()
await page.waitForTimeout(600)
await page.getByText('billing', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(400)
await page.getByText('invoice.py', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1500)
// the file beside its thread: drag its tab onto the right edge of the pane
const fileTab = page.locator('[data-testid="tab"][data-id$="invoice.py"]').first()
const paneBox = await page.locator('[data-testid="chat-pane"]').first().boundingBox()
if (paneBox) await fileTab.dragTo(page.locator('[data-testid="chat-pane"]').first(), { targetPosition: { x: paneBox.width - 40, y: paneBox.height / 2 } }).catch(() => {})
await page.waitForTimeout(400)
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await page.locator('[data-testid="tab"][data-id$="invoice.py"]').first().click()
await page.waitForTimeout(2000)
await shot('A-editor')

// the command field with Claude commands
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await page.keyboard.press('Control+KeyK')
await page.keyboard.type('/')
await shot('A-palette')
await page.keyboard.press('Escape')

// themes, Focus mode, a narrow window
await tid('insp-activity').click()
for (const [theme, name] of [['light', 'A-light'], ['hc', 'A-hc']]) {
  await page.keyboard.press('Control+KeyK')
  await page.keyboard.type(`Theme: ${theme === 'hc' ? 'High' : 'Light'}`)
  await page.keyboard.press('Enter')
  await shot(name)
}
await page.keyboard.press('Control+KeyK'); await page.keyboard.type('Theme: Dark'); await page.keyboard.press('Enter')
await page.keyboard.press('Control+Shift+KeyF')
await shot('A-focus')
await page.keyboard.press('Control+Shift+KeyF')
await page.keyboard.press('Control+Backquote')
await page.waitForTimeout(1500)
await shot('A-drawer')
await page.keyboard.press('Control+Backquote')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(980, 720))
await page.waitForTimeout(600)
await shot('A-narrow')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
await page.waitForTimeout(500)

// the conversation's details: a failed row opens on its error, an edit row on its diff, the / menu, Find
await page.locator('[data-testid="tab"][data-id="t-invoice"]').click()
await send([
  ['chat:event', 't-invoice', assistant(tool('bx', 'Bash', { command: 'npm run lint', description: 'Lint the billing app' }))],
  ['chat:event', 't-invoice', result('bx', ['> lint', '> eslint billing', '', 'billing/invoice.py', '  12:5  error  Unexpected any  no-explicit-any', '', '1 problem (1 error, 0 warnings)'].join(String.fromCharCode(10)), { error: true })],
])
await page.waitForTimeout(500)
await page.locator('[data-testid="chat-t-invoice"] [data-testid="chat-diff-row"]').first().click()
await page.waitForTimeout(400)
await page.locator('[data-testid="chat-t-invoice"] .thread').evaluate((el) => { el.scrollTop = el.scrollHeight })
await shot('X-tool-rows')
const box2 = page.locator('[data-testid="chat-t-invoice"] [data-testid="composer"]')
await box2.fill('/')
await page.waitForTimeout(700)
await shot('X-slash-menu')
await box2.fill('')
await box2.click()
await page.keyboard.press('Control+KeyF')
await page.keyboard.type('retry_key', { delay: 60 })
await page.waitForTimeout(500)
await shot('X-find')
await page.keyboard.press('Escape')

// four panes: two more threads opened beside from the rail (Space)
for (const id of ['t-sync', 't-node']) {
  await page.locator(`[data-testid="live-row"][data-id="${id}"]`).focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
}
await page.locator('[data-testid="live-row"][data-id="t-ship"]').focus().catch(() => {})
await page.keyboard.press('Space')
await page.waitForTimeout(600)
await shot('X-four-panes')

await app.close()
console.log('done', OUT)
