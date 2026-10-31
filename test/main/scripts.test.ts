// Real processes through the main-process runner: python --version, a streaming loop, Stop killing the tree.
// Skipped when no python is on PATH.
import { beforeAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScriptRun } from '../../src/shared/scriptsCore'
import { hasTool } from '../support/tools'

// the runner passes the command to the shell as written, so use whichever name this machine has
const PY = hasTool('python') ? 'python' : hasTool('python3') ? 'python3' : ''

describe.skipIf(!PY)('scripts runner (real python)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-scripts-'))
  const work = join(dir, 'work')
  mkdirSync(join(work, 'out', 'old'), { recursive: true })
  mkdirSync(join(work, 'out', 'new'), { recursive: true })
  writeFileSync(join(work, 'out', 'old', 'r.html'), 'old')
  writeFileSync(join(work, 'out', 'new', 'r.html'), 'new')
  utimesSync(join(work, 'out', 'old', 'r.html'), new Date(2020, 0, 1), new Date(2020, 0, 1))
  // no flush=True: PYTHONUNBUFFERED from the runner must make it stream
  writeFileSync(join(work, 'loop.py'), 'import os, time, sys\nprint("pid", os.getpid())\nfor i in range(200):\n    print("tick", i)\n    sys.stderr.write("err %d\\n" % i)\n    time.sleep(0.2)\n')
  const cfg = join(dir, 'scripts.json')
  writeFileSync(cfg, JSON.stringify([
    { name: 'Version', cwd: work, options: [{ label: 'Show', cmd: `${PY} --version` }], open: 'out/*/r.html' },
    { name: 'Loop', cwd: work, options: [{ label: 'Go', cmd: `${PY} loop.py` }] },
    { name: 'Missing', cwd: join(dir, 'nope'), options: [{ label: 'Go', cmd: `${PY} x.py` }] },
    { name: 'NoScript', cwd: work, options: [{ label: 'Go', cmd: `${PY} build_report.py` }] },
  ]))
  process.env.HIVE_SCRIPTS_FILE = cfg

  const updates: ScriptRun[][] = []
  let sc: typeof import('../../src/main/scripts')
  beforeAll(async () => {
    sc = await import('../../src/main/scripts')
    sc.initScripts('unused', (r) => updates.push(r), join(dir, 'logs'))
  })

  const latest = (name: string) => sc.scriptsState().find((r) => r.name === name)!
  const until = async (f: () => boolean, ms = 15000) => {
    const end = Date.now() + ms
    while (!f()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)) }
  }

  test('config view flags the missing folder and script', () => {
    const c = sc.scriptsConfig()
    assert.equal(c.message, '')
    assert.match(c.scripts.find((s) => s.name === 'Missing')!.missing, /Folder not found/)
    assert.match(c.scripts.find((s) => s.name === 'NoScript')!.options[0].missing, /Script not found: .*build_report\.py/)
    assert.throws(() => sc.runScript('Missing', 'Go'), /Folder not found/)
    assert.throws(() => sc.runScript('NoScript', 'Go'), /Script not found/)
    assert.throws(() => sc.runScript('Nope', 'Go'), /No script named/)
    assert.throws(() => sc.runScript('Version', 'Nope'), /no option/)
  })

  test('python --version: exit 0, output, full log, newest match opened', async () => {
    sc.runScript('Version', 'Show')
    await until(() => latest('Version').phase !== 'running')
    const r = latest('Version')
    assert.equal(r.phase, 'ok')
    assert.equal(r.code, 0)
    assert.match(r.output, /Python 3\.\d+/)
    assert.match(readFileSync(r.log, 'utf8'), /\$ python3? --version[\s\S]*Python 3\.\d+/)
    assert.equal(r.opened, join(work, 'out', 'new', 'r.html'))
    assert.match(r.note, /before this run/) // both files predate the run
  })

  test('loop: streams while running, same script refused twice, Stop kills the tree', async () => {
    sc.runScript('Loop', 'Go')
    assert.throws(() => sc.runScript('Loop', 'Go'), /already running/)
    sc.runScript('Version', 'Show') // a different script runs alongside
    await until(() => /tick 5/.test(latest('Loop').output))
    // several pushes while it runs, not one at the end (under a loaded machine they can batch, so wait for them)
    const distinct = () => new Set(updates.map((u) => u.find((r) => r.name === 'Loop')?.output ?? '').filter(Boolean)).size
    await until(() => distinct() >= 3)
    assert.match(latest('Loop').output, /err \d/) // stderr too
    const pid = Number(latest('Loop').output.match(/pid (\d+)/)![1])
    const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
    assert.ok(alive(), 'python child is running before Stop')
    sc.stopScript('Loop')
    await until(() => latest('Loop').phase !== 'running')
    const r = latest('Loop')
    assert.equal(r.phase, 'stopped')
    await until(() => !alive(), 5000)
    assert.ok(!/tick 199/.test(readFileSync(r.log, 'utf8')))
    await until(() => latest('Version').phase !== 'running')
    assert.equal(latest('Version').phase, 'ok')
    // can run again after a stop
    sc.runScript('Loop', 'Go')
    await until(() => /tick 1/.test(latest('Loop').output))
    sc.stopAllScripts()
    await until(() => latest('Loop').phase === 'stopped')
  })

  test('missing / invalid scripts.json gives a message pointing at the example', () => {
    writeFileSync(cfg, '{ broken')
    assert.match(sc.scriptsConfig().message, /not valid JSON.*scripts\.example\.json/)
    process.env.HIVE_SCRIPTS_FILE = join(dir, 'absent.json')
    sc.initScripts('unused', () => {}, join(dir, 'logs'))
    const m = sc.scriptsConfig()
    assert.match(m.message, /No scripts\.json found .*Copy scripts\.example\.json/)
    assert.deepEqual(m.scripts, [])
  })
})
