// A watcher's session is known by a fixed mark at the start of its first message, whatever the app or the watcher
// is called; transcripts written before the mark (the "[<app> watcher run: <name>]" header alone) are still known.
import { afterEach, describe, expect, it } from 'vitest'
import { setAppName } from '../../src/shared/appName'
import { PRODUCT } from '../../src/shared/edition'
import { WATCHER_MARK, headerName, isWatcherStart, isWatcherTranscript } from '../../src/shared/readOnlyCore'
import { emptyState, foldersOf, nameProblem, wakeMessage, watcherHeader } from '../../src/shared/watchersCore'

const header = (name: string) => watcherHeader({
  name, kind: 'sweep', now: new Date(2026, 10, 9, 10, 0), lastRun: null, s: emptyState(), f: foldersOf('w', 'C:/w/w'), promptFile: 'prompt.md', prompt: 'Look around.', fresh: true,
})
const wake = (name: string) => wakeMessage({ name, now: new Date(2026, 10, 9, 10, 0), due: [], table: 't', fallbackHours: 6, promptFile: 'prompt.md', prompt: null })
const transcript = (first: string) => [JSON.stringify({ type: 'queue-operation' }), JSON.stringify({ type: 'user', message: { role: 'user', content: first } })].join('\n')

afterEach(() => setAppName(undefined))

describe('the watcher mark', () => {
  it('starts every run header and wake-up', () => {
    expect(header('Deploy health').split('\n')[0]).toBe(`${WATCHER_MARK} [${PRODUCT} watcher run: Deploy health]`)
    expect(wake('Selfie').startsWith(`${WATCHER_MARK} [${PRODUCT} wake-up: Selfie] Now: `)).toBe(true)
  })

  it('is recognised whatever the app is called, brackets included', () => {
    for (const app of ['Orbit', 'MyHive', 'Orbit [work]', 'a]b', 'x'.repeat(40)]) {
      setAppName(app)
      expect(isWatcherTranscript(transcript(header('Watch'))), app).toBe(true)
      expect(isWatcherTranscript(transcript(wake('Watch'))), app).toBe(true)
    }
  })

  it('is recognised whatever the watcher is called', () => {
    for (const name of ['PRs [open]', 'two\nlines', 'x]', 'plain']) expect(isWatcherTranscript(transcript(header(name))), name).toBe(true)
  })

  it('keeps the header on one line and its brackets balanced', () => {
    setAppName('Orbit [work]')
    expect(header('PRs [open]\nand more').split('\n')[0]).toBe(`${WATCHER_MARK} [Orbit (work) watcher run: PRs (open) and more]`)
    expect(headerName('  a [b]\r\n c ')).toBe('a (b) c')
  })

  it('still knows a transcript written before the mark', () => {
    expect(isWatcherStart('[Orbit watcher run: Watch]\nRun kind: sweep')).toBe(true)
    expect(isWatcherStart('[MyHive wake-up: Selfie] Now: Monday')).toBe(true)
    expect(isWatcherTranscript(transcript('[Orbit watcher run: Watch]\nRun kind: sweep'))).toBe(true)
  })

  it('counts only at the very start of the first message', () => {
    expect(isWatcherStart(`please explain ${WATCHER_MARK}`)).toBe(false)
    expect(isWatcherStart('fix the [Orbit watcher run: x] header')).toBe(false)
    expect(isWatcherTranscript(transcript('hi') + '\n' + JSON.stringify({ type: 'user', message: { content: header('Watch') } }))).toBe(false)
  })
})

describe('a watcher name', () => {
  it('is refused with brackets, a line break, nothing in it, or more than 80 characters', () => {
    expect(nameProblem('Deploy health')).toBeNull()
    expect(nameProblem('PRs (open): a/b?')).toBeNull()
    expect(nameProblem('  ')).toMatch(/needs a name/)
    for (const bad of ['PRs [open]', 'x]', 'two\nlines']) expect(nameProblem(bad), bad).toMatch(/cannot contain/)
    expect(nameProblem('x'.repeat(81))).toMatch(/80/)
  })
})
