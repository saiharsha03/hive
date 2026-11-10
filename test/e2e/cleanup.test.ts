// The e2e run's clean-up deletes folders under the Claude projects folder: it must only ever take its own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanRun, projectSlug, runProjects, runTag } from '../../e2e/cleanup'

const STAMP = '2026-11-09T23-59-12-916Z'

describe('which folders belong to a run', () => {
  it('names a transcript folder the way Claude Code does', () => {
    expect(projectSlug('C:\\Users\\me\\AppData\\Local\\Temp\\hive-e2e\\x\\repos')).toBe('C--Users-me-AppData-Local-Temp-hive-e2e-x-repos')
  })

  it('takes the run tag from the run folder, wherever the temp folder is', () => {
    expect(runTag(join('C:', 'Users', 'me', 'AppData', 'Local', 'Temp', 'hive-e2e', STAMP))).toBe(`hive-e2e-${STAMP}`)
    expect(runTag(join('C:', 'Users', 'RUNNER~1', 'Temp', 'hive-e2e', STAMP))).toBe(`hive-e2e-${STAMP}`)
    expect(runTag(join('/tmp', 'hive-e2e-adhoc'))).toBe('hive-e2e-adhoc')
    expect(runTag(join('C:', 'work', 'my-run'))).toBeNull() // not a run folder: nothing is ever cleaned for it
    expect(runTag(join('C:', 'Users', 'me'))).toBeNull()
  })

  it('picks only this run among the projects', () => {
    const names = [
      `C--Users-me-AppData-Local-Temp-hive-e2e-${STAMP}-repos`,
      `C--Users-me-AppData-Local-Temp-hive-e2e-${STAMP}-repos-demo`,
      'C--Users-me-AppData-Local-Temp-hive-e2e-2026-10-31T04-54-28-029Z-repos', // another run
      'C--Users-me-Desktop-Prevent-Repos-Hive', // real work
      'C--Users-me-Desktop-hive-e2e-notes', // a real folder that happens to carry the words
    ]
    const run = join('C:', 'Users', 'me', 'AppData', 'Local', 'Temp', 'hive-e2e', STAMP)
    expect(runProjects('P', run, names)).toEqual([join('P', names[0]), join('P', names[1])])
    expect(runProjects('P', join('C:', 'work', 'my-run'), names)).toEqual([])
  })
})

describe('cleanRun', () => {
  let base = ''
  const saved = process.env.CLAUDE_CONFIG_DIR
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'hive-cleanup-'))
    process.env.CLAUDE_CONFIG_DIR = join(base, 'claude')
  })
  afterEach(() => { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved })

  const project = (name: string) => {
    const dir = join(base, 'claude', 'projects', name)
    mkdirSync(join(dir, 'memory'), { recursive: true })
    writeFileSync(join(dir, 'a.jsonl'), '{}\n')
    return dir
  }

  it('removes the run folder and its transcripts, and nothing else', () => {
    const run = join(base, 'hive-e2e', STAMP)
    mkdirSync(join(run, 'repos', 'demo'), { recursive: true })
    const mine = project(projectSlug(join(run, 'repos')))
    const other = project(projectSlug(join(base, 'hive-e2e', '2026-10-31T04-54-28-029Z', 'repos')))
    const real = project('C--Users-me-Desktop-Prevent-Repos-Hive')
    const r = cleanRun(run)
    expect(r.kept).toEqual([])
    expect(r.removed).toEqual([mine, run])
    expect(existsSync(run)).toBe(false)
    expect(existsSync(mine)).toBe(false)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(real)).toBe(true)
  })

  it('refuses a folder that is not a run folder', () => {
    const notRun = join(base, 'work')
    mkdirSync(notRun, { recursive: true })
    const real = project('C--Users-me-Desktop-Prevent-Repos-Hive')
    expect(cleanRun(notRun)).toEqual({ removed: [], kept: [notRun] })
    expect(existsSync(notRun)).toBe(true)
    expect(existsSync(real)).toBe(true)
  })

  it('is fine when there is no projects folder', () => {
    const run = join(base, 'hive-e2e-adhoc')
    mkdirSync(run, { recursive: true })
    expect(cleanRun(run)).toEqual({ removed: [run], kept: [] })
  })
})
