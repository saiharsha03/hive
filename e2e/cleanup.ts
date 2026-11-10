// What a run leaves behind, and removing it: the run folder under the OS temp folder, and the transcripts Claude Code
// wrote for the run's threads (its projects folder, one folder per working folder, named after that folder's path
// with every non-alphanumeric turned into "-"). Pure path rules here, so they can be read and checked on their own;
// nothing is ever deleted unless its name carries the run's own "hive-e2e" tag.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const E2E_TAG = 'hive-e2e'

// Claude Code's name for a working folder's transcripts
export const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

// the part of a run folder's slug that is the run's own: "hive-e2e-<stamp>" (or "hive-e2e-adhoc"), from wherever the
// temp folder is and however Windows spells it (a short 8.3 name or the long one). null = not a run folder
export function runTag(run: string): string | null {
  const name = basename(run)
  const tag = name.startsWith(E2E_TAG) ? name : basename(dirname(run)) === E2E_TAG ? `${E2E_TAG}-${name}` : null
  return tag ? projectSlug(tag) : null
}

// the transcript folders that belong to this run: under the projects folder, named with the run's tag
export function runProjects(projectsDir: string, run: string, names: string[]): string[] {
  const tag = runTag(run)
  if (!tag) return []
  return names.filter((n) => n.includes(E2E_TAG) && (n.includes(`${tag}-`) || n.endsWith(tag))).map((n) => join(projectsDir, n))
}

export const projectsDir = (): string => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')

const remove = (dir: string): boolean => {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* locked: reported below */ }
  return !existsSync(dir)
}

// delete the run's transcripts and its folder; returns what it did, for the log
export function cleanRun(run: string): { removed: string[]; kept: string[] } {
  const removed: string[] = []
  const kept: string[] = []
  if (!runTag(run)) return { removed, kept: [run] } // never a folder that is not a run's
  const root = projectsDir()
  let names: string[] = []
  try { names = readdirSync(root) } catch { /* no projects folder */ }
  for (const dir of [...runProjects(root, run, names), run]) (remove(dir) ? removed : kept).push(dir)
  return { removed, kept }
}
