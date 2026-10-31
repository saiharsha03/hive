// Where a watcher's reports go: a named folder under the reports root, or the watcher's own reports/.
import { describe, expect, test } from 'vitest'
import { folderName, foldersOf, reportsRootOf } from '../../src/shared/watchersCore'

describe('watcher reports folder', () => {
  test('reports go to <root>/<watcher name>, a relative setting is under the repos root, "-" keeps the watcher folder', () => {
    expect(reportsRootOf('', 'C:/repos')).toBe('C:/repos/Watch reports')
    expect(reportsRootOf('out/r', 'C:/repos')).toBe('C:/repos/out/r')
    expect(reportsRootOf('D:/elsewhere', 'C:/repos')).toBe('D:/elsewhere')
    expect(reportsRootOf('-', 'C:/repos')).toBe('')
    expect(foldersOf('watch', 'C:/w/watch', 'C:/repos/Watch reports', 'Watch').reports).toBe('C:/repos/Watch reports/Watch')
    expect(foldersOf('watch', 'C:/w/watch').reports).toBe('C:/w/watch/reports')
    expect(folderName('PRs: a/b?', 'x')).toBe('PRs  a b')
    expect(folderName('...', 'x')).toBe('x')
  })
})
