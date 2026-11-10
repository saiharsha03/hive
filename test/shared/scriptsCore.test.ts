import { test } from 'vitest'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  elapsed, findMatches, globSegments, logStem, parseScriptsConfig, pickNewest, scriptFile, viewScript, type Entry,
} from '../../src/shared/scriptsCore'

const good = [
  { name: 'Weekly', cwd: 'C:\\w', options: [{ label: 'With AI', cmd: 'python main.py' }, { label: 'Without AI', cmd: 'python main.py --skip-opus' }], open: 'reports/**/*.html' },
  { name: 'Monthly', cwd: 'C:/m', options: [{ label: 'All', cmd: 'python main.py 1' }] },
]

test('parser accepts a valid file', () => {
  const r = parseScriptsConfig(JSON.stringify(good))
  assert.deepEqual(r.problems, [])
  assert.equal(r.scripts.length, 2)
  assert.equal(r.scripts[0].open, 'reports/**/*.html')
  assert.equal(r.scripts[1].open, undefined)
  assert.deepEqual(r.scripts[0].options[1], { label: 'Without AI', cmd: 'python main.py --skip-opus' })
})

test('parser: bad JSON and non-array are whole-file problems', () => {
  const a = parseScriptsConfig('{ nope')
  assert.equal(a.scripts.length, 0)
  assert.match(a.problems[0], /not valid JSON/)
  assert.match(parseScriptsConfig('{"name":"x"}').problems[0], /JSON array/)
  assert.deepEqual(parseScriptsConfig('[]'), { scripts: [], problems: [] })
})

test('parser skips bad entries and keeps the good ones', () => {
  const r = parseScriptsConfig(JSON.stringify([
    good[0],
    'str',
    { cwd: 'C:\\x', options: [{ label: 'a', cmd: 'b' }] }, // no name
    { name: 'weekly', cwd: 'C:\\y', options: [{ label: 'a', cmd: 'b' }] }, // duplicate (case-insensitive)
    { name: 'Rel', cwd: 'relative\\dir', options: [{ label: 'a', cmd: 'b' }] },
    { name: 'NoOpts', cwd: 'C:\\x', options: [] },
    { name: 'BadOpt', cwd: 'C:\\x', options: [{ label: 'a' }] },
    { name: 'DupOpt', cwd: 'C:\\x', options: [{ label: 'a', cmd: 'b' }, { label: 'a', cmd: 'c' }] },
    { name: 'AbsOpen', cwd: 'C:\\x', options: [{ label: 'a', cmd: 'b' }], open: 'C:\\x\\*.pdf' },
    { name: 'DotDot', cwd: 'C:\\x', options: [{ label: 'a', cmd: 'b' }], open: '../*.pdf' },
    { name: 'NumOpen', cwd: 'C:\\x', options: [{ label: 'a', cmd: 'b' }], open: 5 },
    good[1],
  ]))
  assert.deepEqual(r.scripts.map((s) => s.name), ['Weekly', 'Monthly'])
  assert.equal(r.problems.length, 10)
  assert.ok(r.problems.some((p) => /listed twice/.test(p) && /weekly/.test(p)))
  assert.ok(r.problems.some((p) => /"Rel": cwd must be an absolute/.test(p)))
  assert.ok(r.problems.some((p) => /"DotDot": open must be a glob/.test(p)))
})

test('globSegments rejects absolute, empty and parent paths', () => {
  assert.deepEqual(globSegments('* - Reports - Merged by Affiliate\\*.pdf'), ['* - Reports - Merged by Affiliate', '*.pdf'])
  for (const g of ['', '/a/*.pdf', 'C:\\a\\*.pdf', 'a/../b', './a']) assert.equal(globSegments(g), null, g)
})

// fake tree: path -> entries
const tree: Record<string, Entry[]> = {
  [join('R')]: [
    { name: 'April - 2026 - Reports - Merged by Affiliate', dir: true, mtime: 0 },
    { name: 'August - 2026 - Reports - Merged by Affiliate', dir: true, mtime: 0 },
    { name: 'August - 2026 - Reports - Individual Company', dir: true, mtime: 0 },
    { name: 'main.py', dir: false, mtime: 999 },
    { name: 'reports', dir: true, mtime: 0 },
  ],
  [join('R', 'April - 2026 - Reports - Merged by Affiliate')]: [{ name: 'A.pdf', dir: false, mtime: 100 }, { name: 'notes.txt', dir: false, mtime: 900 }],
  [join('R', 'August - 2026 - Reports - Merged by Affiliate')]: [{ name: 'B.PDF', dir: false, mtime: 300 }, { name: 'C.pdf', dir: false, mtime: 200 }],
  [join('R', 'August - 2026 - Reports - Individual Company')]: [{ name: 'Z.pdf', dir: false, mtime: 800 }],
  [join('R', 'reports')]: [{ name: '2026-06-07', dir: true, mtime: 0 }, { name: '2026-06-14', dir: true, mtime: 0 }],
  [join('R', 'reports', '2026-06-07')]: [{ name: 'Weekly Report - 2026-06-07 to 2026-06-13.html', dir: false, mtime: 500 }, { name: 'index.html', dir: false, mtime: 501 }],
  [join('R', 'reports', '2026-06-14')]: [{ name: 'Weekly Report - 2026-06-14 to 2026-06-20.html', dir: false, mtime: 600 }, { name: 'index.html', dir: false, mtime: 601 }, { name: 'deep', dir: true, mtime: 0 }],
  [join('R', 'reports', '2026-06-14', 'deep')]: [{ name: 'x.html', dir: false, mtime: 700 }],
}
const list = (d: string) => { const e = tree[d]; if (!e) throw new Error(`ENOENT ${d}`); return e }
const names = (g: string) => findMatches('R', g, list).map((f) => f.path).sort()

test('finder: wildcard folder + file, case-insensitive, skips non-matching folders', () => {
  assert.deepEqual(names('* - Reports - Merged by Affiliate/*.pdf'), [
    join('R', 'April - 2026 - Reports - Merged by Affiliate', 'A.pdf'),
    join('R', 'August - 2026 - Reports - Merged by Affiliate', 'B.PDF'),
    join('R', 'August - 2026 - Reports - Merged by Affiliate', 'C.pdf'),
  ])
})

test('finder: ** spans zero or more folders; bare ** means every file', () => {
  assert.deepEqual(names('reports/**/x.html'), [join('R', 'reports', '2026-06-14', 'deep', 'x.html')])
  assert.equal(names('reports/**/*.html').length, 5)
  assert.deepEqual(names('**/main.py'), [join('R', 'main.py')])
  assert.equal(names('reports/**').length, 5)
  assert.deepEqual(names('reports/*/Weekly Report - *.html'), [
    join('R', 'reports', '2026-06-07', 'Weekly Report - 2026-06-07 to 2026-06-13.html'),
    join('R', 'reports', '2026-06-14', 'Weekly Report - 2026-06-14 to 2026-06-20.html'),
  ])
})

test('finder: ? matches one char; regex characters in names are literal; missing root is empty', () => {
  assert.deepEqual(names('reports/2026-06-1?/index.html'), [join('R', 'reports', '2026-06-14', 'index.html')])
  assert.deepEqual(names('ma(n).py'), [])
  assert.deepEqual(findMatches('nope', '*.pdf', list), [])
  assert.deepEqual(findMatches('R', '../x', list), [])
  assert.deepEqual(names('reports'), []) // a folder is never a match
})

test('pickNewest: latest mtime wins, ties go to the later name, empty is null', () => {
  assert.equal(pickNewest(findMatches('R', '* - Reports - Merged by Affiliate/*.pdf', list))!.path, join('R', 'August - 2026 - Reports - Merged by Affiliate', 'B.PDF'))
  assert.equal(pickNewest(findMatches('R', 'reports/*/Weekly Report - *.html', list))!.mtime, 600)
  assert.equal(pickNewest([]), null)
  assert.equal(pickNewest([{ path: 'a', mtime: 5 }, { path: 'b', mtime: 5 }])!.path, 'b')
})

test('scriptFile and viewScript report missing folder / script', () => {
  assert.equal(scriptFile('python main.py 1 --companies=1,2'), 'main.py')
  assert.equal(scriptFile('"C:\\Py\\python.exe" "my script.py"'), 'my script.py')
  assert.equal(scriptFile('python --version'), null)
  assert.equal(scriptFile('npm run build'), null)
  const def = { name: 'CS', cwd: 'C:\\cs', options: [{ label: 'Build', cmd: 'python build.py' }, { label: 'V', cmd: 'python --version' }] }
  const none = viewScript(def, () => false)
  assert.match(none.missing, /Folder not found: C:\\cs/)
  assert.equal(none.options[0].missing, '') // the folder message covers it
  const noScript = viewScript(def, (p) => p === 'C:\\cs')
  assert.equal(noScript.missing, '')
  assert.match(noScript.options[0].missing, /Script not found: C:\\cs[\\/]build\.py/)
  assert.equal(noScript.options[1].missing, '')
  const ok = viewScript(def, () => true)
  assert.deepEqual([ok.missing, ok.options[0].missing], ['', ''])
})

test('elapsed and logStem', () => {
  assert.equal(elapsed(4_900), '4s')
  assert.equal(elapsed(65_000), '1m 05s')
  assert.equal(elapsed(3_725_000), '1h 02m')
  assert.match(logStem('Weekly Analysis!', new Date(2026, 9, 30, 8, 5, 3).getTime()), /^weekly-analysis-20261030-080503$/)
  assert.match(logStem('***', 0), /^script-/)
})
