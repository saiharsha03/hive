import { test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { blockedCommand, isWatcherTab, PYTHON_GUARD } from '../../src/shared/readOnlyCore'

test('watcher tabs only', () => {
  assert.equal(isWatcherTab('watcher-watch-1793425306901'), true)
  assert.equal(isWatcherTab('tab-1'), false)
})

test('shell writes are refused, reads pass', () => {
  for (const c of ['gh pr list', 'gh pr view 12 --json state', 'gh api repos/o/r/pulls', 'gh api graphql -f query="{ viewer { login } }"', 'git log -5', 'git fetch', 'curl -s https://checkip.amazonaws.com/', 'Invoke-RestMethod https://x/api', 'python sweep_n8n.py'])
    assert.equal(blockedCommand(c), null, c)
  for (const c of ['gh pr create --fill', 'cd x && gh pr merge 3', 'gh issue comment 4 -b hi', 'gh api -X POST repos/o/r/issues', 'gh api repos/o/r/issues -f title=x', 'gh api graphql -f query="mutation { x }"', 'git push origin main', 'curl -X POST https://hooks.slack.com/x', 'curl -d @f.json https://x', 'Invoke-RestMethod -Method Post https://x', 'iwr https://x -Body $b'])
    assert.ok(blockedCommand(c), c)
})

test('the Python guard blocks HTTP writes before they leave, allows reads and read-only searches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-ro-'))
  writeFileSync(join(dir, 'sitecustomize.py'), PYTHON_GUARD)
  const probe = join(dir, 'probe.py')
  // a connection to a closed local port: an allowed request fails to connect, a blocked one never tries
  writeFileSync(probe, [
    'import http.client, sys',
    'def go(m, p):',
    '    c = http.client.HTTPConnection("127.0.0.1", 9, timeout=1)',
    '    try: c.request(m, p); return "sent"',
    '    except PermissionError: return "blocked"',
    '    except OSError: return "sent"',
    'print(go("GET", "/x"), go("POST", "/services/data/v60.0/sobjects/Account"), go("PATCH", "/x"), go("POST", "/rest/api/3/search/jql"))',
    'import sitecustomize as g',
    'if hasattr(g, "_allowed"):',
    '    a = lambda *x: "y" if g._allowed(*x) else "n"',
    '    print(a("POST", "acme.atlassian.net", "/rest/api/3/search/jql"), a("POST", "acme.atlassian.net", "/rest/api/3/issue"),',
    '          a("POST", "evil.example.com", "/rest/api/3/search"), a("POST", "api.gong.io", "/v2/calls/extensive"), a("POST", "hooks.slack.com", "/services/x"),',
    '          a("POST", "hooks.slack.com", "/services/alerts"), a("POST", "hooks.slack.com", "/services/alerts?x=1".split("?")[1]))',
  ].join('\n'))
  // the allowed alert channel, by fingerprint only
  const alerts = createHash('sha256').update('hooks.slack.com/services/alerts').digest('hex')
  const run = (ro: string) => execFileSync('python', [probe], { env: { ...process.env, HIVE_READONLY: ro, HIVE_READONLY_POST_SHA256: `abc, ${alerts}`, PYTHONPATH: [dir, process.env.PYTHONPATH].filter(Boolean).join(delimiter) } }).toString().trim().replace(/\r/g, '')
  // a read-only search POST passes only to its own host, never because the path merely contains it; Slack only to the allowed channel
  assert.equal(run('1'), 'sent blocked blocked blocked\ny n n y n y n')
  assert.equal(run(''), 'sent sent sent sent')
  for (const c of ['gh api -XPOST repos/o/r/issues', 'gh api -X=POST x', 'gh api -iXPOST x', 'gh api --method=PATCH x', 'gh api -fbody=x x', 'gh api --field=x x'])
    assert.ok(blockedCommand(c), c)
  assert.equal(blockedCommand('gh api -X GET repos/o/r/pulls -f per_page=5'), null)
  assert.ok(blockedCommand('"gh" pr merge 3') && blockedCommand('C:\\bin\\gh.exe issue close 1') && blockedCommand('(git push)'))
})
