// Runs before every test file: Orbit's state files point into a fresh temp folder, so no test reads or
// writes the real ~/.claude files or the checkout's .env. The OS temp folder is pointed there too, so every folder a
// test makes with mkdtemp (repos, state folders, logs) lands inside it, and the whole lot is deleted when the file is
// done: test runs used to leave thousands of hive-* folders behind.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'hive-test-'))
const tmp = join(dir, 'tmp')
mkdirSync(tmp)
// os.tmpdir() reads these on every call (TEMP / TMP on Windows, TMPDIR elsewhere); child processes inherit them
process.env.TEMP = tmp
process.env.TMP = tmp
process.env.TMPDIR = tmp

process.env.HIVE_TEST_STATE_DIR = dir
process.env.HIVE_SETTINGS_FILE = join(dir, 'hive-settings.json')
process.env.HIVE_ENV_FILE = join(dir, 'dot.env')
process.env.HIVE_SCRIPTS_FILE = join(dir, 'scripts.json')
process.env.HIVE_TODOS_FILE = join(dir, 'hive-todos.json')
process.env.HIVE_WATCHERS_DIR = join(dir, 'watchers')
// everything else Orbit keeps (dataDir() in src/main/testMode.ts) would otherwise default to the real ~/.claude
process.env.HIVE_DATA_DIR ||= join(dir, 'data')

afterAll(() => {
  // Windows can hold a lock on a just-closed process's folder for a moment: retry, then leave it to the OS cleaner
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* still locked */ }
})
