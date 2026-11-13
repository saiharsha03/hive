// Orbit was called Hive. On the first start, each place Hive kept its own data is copied (never moved) to Orbit's
// place for it, so threads, to-dos, notes, watchers, wake-ups, settings, the phone pairing and the page's own storage
// carry over. A place is copied only when Orbit's does not exist yet and Hive's does. carryOver.ts does the copying.
import { join } from 'node:path'

export type CarryKind = 'state' | 'userData'
export type CarryOver = { kind: CarryKind; from: string; to: string }

/**
 * Hive's places and Orbit's: the state folder in the home folder (~/.hive -> ~/.orbit, which also holds the phone
 * pairing and its keys, hive-mobile.json) and Electron's own storage (%APPDATA%\Hive -> %APPDATA%\Orbit: the page's
 * storage, window state). Nothing when the two would be the same place.
 */
export function carryOvers(p: { home: string; appData: string; product: string; stateFolder: string }): CarryOver[] {
  const all: CarryOver[] = [
    { kind: 'state', from: join(p.home, '.hive'), to: join(p.home, p.stateFolder) },
    { kind: 'userData', from: join(p.appData, 'Hive'), to: join(p.appData, p.product) },
  ]
  return all.filter((c) => c.from.toLowerCase() !== c.to.toLowerCase())
}

// Electron's own storage: the instance lock and the caches Chromium rebuilds by itself, plus the app's search index
// and its sessions list cache (both rebuilt from the transcripts in ~/.claude/projects) and the old search models
const USER_DATA_SKIP = new Set([
  'lockfile', 'singletonlock', 'singletonsocket', 'singletoncookie',
  'cache', 'code cache', 'gpucache', 'dawncache', 'dawngraphitecache', 'dawnwebgpucache', 'grshadercache', 'shadercache',
  'blob_storage', 'crashpad', 'search', 'models', 'sessions-cache.json',
])
// the state folder: the read-only guard Orbit writes again at every start
const STATE_SKIP = new Set(['hive/readonly-python'])

/**
 * Whether a file or folder (its path under the place, with / or \) is left behind: lock files (LevelDB's LOCK, any
 * *.lock), half-written files (*.tmp, *.hive-tmp) and, per place, the caches above.
 */
export function skipOnCarry(kind: CarryKind, rel: string): boolean {
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  if (!parts.length) return false
  const name = parts[parts.length - 1].toLowerCase()
  if (name === 'lock' || name.endsWith('.lock') || name.endsWith('.tmp') || name.endsWith('.hive-tmp')) return true
  if (kind === 'userData') return USER_DATA_SKIP.has(parts[0].toLowerCase())
  return STATE_SKIP.has(parts.slice(0, 2).join('/').toLowerCase())
}
