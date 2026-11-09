// Test mode (HIVE_TEST_MODE=1, set by the e2e harness): nothing Hive does reaches the outside world (no Watch or
// Dependabot runs, no deploy.sh, no script commands, no git commit / push / pull, no hook or plugin switches), and
// Hive's own state files live in HIVE_DATA_DIR instead of ~/.claude, so a test run never touches the real ones.
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEST_MODE = process.env.HIVE_TEST_MODE === '1'

// the folder for hive-threads.json, hive-prefs.json, hive-todos.json, hive/watch.json, ...
export const dataDir = (): string =>
  process.env.HIVE_DATA_DIR || (TEST_MODE ? join(tmpdir(), 'hive-test-data') : join(homedir(), '.claude'))

// what a blocked action says instead of running
export const blocked = (what: string): string => `test mode: ${what} is off (HIVE_TEST_MODE=1)`

// the weekly usage watchers see in test mode (no usage read from Claude): HIVE_TEST_WEEKLY_PCT, 0-100, unset = unknown
export const testWeeklyPct = (): { pct: number | null; readAt: number; error: string } => {
  const n = Number(process.env.HIVE_TEST_WEEKLY_PCT ?? '')
  return process.env.HIVE_TEST_WEEKLY_PCT && Number.isFinite(n)
    ? { pct: n, readAt: Date.now(), error: '' }
    : { pct: null, readAt: Date.now(), error: blocked('the usage read') }
}
