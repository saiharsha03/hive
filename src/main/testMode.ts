// Test mode (HIVE_TEST_MODE=1, set by the e2e harness): nothing Orbit does reaches the outside world (no Watch or
// Dependabot runs, no deploy.sh, no script commands, no git commit / push / pull, no hook or plugin switches), and
// Orbit's own state files live in HIVE_DATA_DIR instead of ~/.claude, so a test run never touches the real ones.
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_FOLDER } from '../shared/edition'

export const TEST_MODE = process.env.HIVE_TEST_MODE === '1'

// the folder for hive-threads.json, hive-prefs.json, hive-todos.json, hive/watch.json, ...
export const dataDir = (): string =>
  process.env.HIVE_DATA_DIR || (TEST_MODE ? join(tmpdir(), 'hive-test-data') : join(homedir(), STATE_FOLDER))

// the Claude Code projects folder Orbit lists sessions from: HIVE_PROJECTS_DIR (the e2e harness seeds fake transcripts
// there); in test mode without it a folder under the test data, never the real ~/.claude/projects
export const projectsRoot = (): string =>
  process.env.HIVE_PROJECTS_DIR || (TEST_MODE ? join(dataDir(), 'projects') : join(homedir(), '.claude', 'projects'))

// test mode keeps e2e runs cheap: every thread runs on this model at low effort, without Claude in Chrome
export const TEST_MODEL = 'haiku'

// what a blocked action says instead of running
export const blocked = (what: string): string => `test mode: ${what} is off (HIVE_TEST_MODE=1)`

// the weekly usage watchers see in test mode (no usage read from Claude): HIVE_TEST_WEEKLY_PCT, 0-100, unset = unknown
export const testWeeklyPct = (): { pct: number | null; readAt: number; error: string } => {
  const n = Number(process.env.HIVE_TEST_WEEKLY_PCT ?? '')
  return process.env.HIVE_TEST_WEEKLY_PCT && Number.isFinite(n)
    ? { pct: n, readAt: Date.now(), error: '' }
    : { pct: null, readAt: Date.now(), error: blocked('the usage read') }
}
