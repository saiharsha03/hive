// Paths for the main process. Windows can spell one folder two ways (an 8.3 short name such as
// C:\Users\RUNNER~1\... versus the long name git prints), so paths are turned into their real long form where they
// come in (the configured root, a file the agent names) and compared that way.
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Loaded } from './devConfig'
import { samePath } from '../shared/devCore'

// the real long form of p; for a path that does not exist yet, of its nearest existing parent plus the rest
export function realDir(p: string): string {
  if (!p) return p
  if (existsSync(p)) { try { return realpathSync.native(p) } catch { return p } }
  const up = dirname(p)
  return up === p ? p : join(realDir(up), basename(p))
}

export const sameDir = (a: string, b: string): boolean => samePath(a, b) || samePath(realDir(a), realDir(b))

// the loaded settings with the repos root and worktrees folder in their long form
export function withRealRoots(l: Loaded): Loaded {
  if (!l.config) return l
  return { ...l, config: { ...l.config, root: realDir(l.config.root), worktreesDir: realDir(l.config.worktreesDir) } }
}
