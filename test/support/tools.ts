// Helpers for the integration tests that drive real tools: skip cleanly when a tool is not installed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function hasTool(cmd: string, args: string[] = ['--version']): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

export const hasGit = hasTool('git')

// git with a fixed identity and no signing, so results match on any machine
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
  }).trim()
}

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  // the long form: CI's Windows temp folder is an 8.3 short name (RUNNER~1), and git always prints the long one
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `hive-${prefix}-`)))
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows can hold a lock on a just-closed process's folder; the OS temp cleaner gets it later
      }
    },
  }
}
