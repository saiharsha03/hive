// Runs before every test file: Hive's state files point into a fresh temp folder, so no test reads or
// writes the real ~/.claude files or the checkout's .env.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hive-test-'))
process.env.HIVE_TEST_STATE_DIR = dir
process.env.HIVE_SETTINGS_FILE = join(dir, 'hive-settings.json')
process.env.HIVE_ENV_FILE = join(dir, 'dot.env')
process.env.HIVE_SCRIPTS_FILE = join(dir, 'scripts.json')
process.env.HIVE_TODOS_FILE = join(dir, 'hive-todos.json')
process.env.HIVE_WATCHERS_DIR = join(dir, 'watchers')
