// The one settings store, ~/.claude/hive-settings.json (HIVE_SETTINGS_FILE overrides, for tests). Atomic writes like
// uiStore. Seeded on first run from the .env and scripts.json; afterwards it wins and they are only fallbacks.
import { existsSync, readFileSync } from 'node:fs'
import { dataDir, TEST_MODE, TEST_MODEL } from './testMode'
import { writeFileSafe } from './safeWrite'
import { join } from 'node:path'
import { DEFAULT_IDLE_CLOSE_MINUTES, DEFAULT_TEAM_MEMORY_KB, normalizeSettings, seedSettings, type Effort, type Settings } from '../shared/settingsCore'

export const SETTINGS_FILE = process.env.HIVE_SETTINGS_FILE || join(dataDir(), 'hive-settings.json')

let current: Settings | null = null

// the saved settings, seeding them first when there are none yet; a broken file is left alone and the seed used
export function loadSettings(dotEnv: Record<string, string>, scriptsFile: string): Settings {
  const had = existsSync(SETTINGS_FILE)
  if (had) {
    try {
      const s = normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')))
      if (s) return (current = s)
    } catch { /* use a fresh seed, without overwriting the broken file */ }
  }
  let text: string | null = null
  try { text = readFileSync(scriptsFile, 'utf8') } catch { /* no scripts.json */ }
  current = seedSettings(dotEnv, text)
  if (!had) saveSettings(current)
  return current
}

export function saveSettings(s: Settings): void {
  writeFileSafe(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n')
  current = s
}

// for the consumers that read on use (terminal shell, new threads)
export const currentSettings = (): Settings | null => current

// Settings > General, as query options for a new thread of this class: the background model and effort for watcher
// runs, Dependabot reviews and /btw, the team ones for teammates; an empty one falls back to the main default
export type ThreadKind = 'main' | 'team' | 'background'
// Test mode (the e2e harness): every thread on TEST_MODEL at low effort and without Chrome, whatever the settings say
export function threadDefaults(kind: ThreadKind = 'main', test = TEST_MODE): { model?: string; effort?: Effort; extraArgs?: Record<string, string | null> } {
  if (test) return { model: TEST_MODEL, effort: 'low' }
  const g = current?.general
  const model = (kind === 'background' && g?.bgModel) || (kind === 'team' && g?.teamModel) || g?.model
  const effort = (kind === 'background' && g?.bgEffort) || (kind === 'team' && g?.teamEffort) || g?.effort
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(g?.chrome ? { extraArgs: { chrome: null } } : {}) }
}

// Settings > General as Claude Code settings for a new thread (the flag-settings layer, liveStatus.sessionOptions):
// the advisor model ('' = none) and the Workflows switch ('' = Claude Code's own default). Test mode adds no advisor
// (it costs usage) and leaves Workflows to the default, unless the run names its own: HIVE_TEST_ADVISOR (a model) and
// HIVE_TEST_WORKFLOWS (on / off), read in test mode only (the e2e that reads the settings back from the live process)
export function sessionFlags(test = TEST_MODE, env: Record<string, string | undefined> = process.env): { advisorModel?: string; enableWorkflows?: boolean } {
  if (test) {
    const advisor = (env.HIVE_TEST_ADVISOR ?? '').trim()
    const workflows = env.HIVE_TEST_WORKFLOWS
    return {
      ...(advisor ? { advisorModel: advisor } : {}),
      ...(workflows === 'on' || workflows === 'off' ? { enableWorkflows: workflows === 'on' } : {}),
    }
  }
  const g = current?.general
  return {
    ...(g?.advisorModel ? { advisorModel: g.advisorModel } : {}),
    ...(g?.workflows ? { enableWorkflows: g.workflows === 'on' } : {}),
  }
}

// an idle thread's process closes after this long (Settings > General, minutes); 0 = never. Test mode only:
// HIVE_TEST_IDLE_CLOSE_MS gives the limit in milliseconds (the e2e that closes an idle thread and resumes it)
export function idleCloseMs(test = TEST_MODE, env: Record<string, string | undefined> = process.env): number {
  const ms = test ? Number(env.HIVE_TEST_IDLE_CLOSE_MS ?? '') : NaN
  if (Number.isFinite(ms) && ms > 0) return ms
  return (current?.general.idleCloseMinutes ?? DEFAULT_IDLE_CLOSE_MINUTES) * 60_000
}
// how often idle threads are looked for: every minute, or as often as the test limit above when a run sets one
export function idleSweepMs(test = TEST_MODE, env: Record<string, string | undefined> = process.env): number {
  const ms = test ? Number(env.HIVE_TEST_IDLE_CLOSE_MS ?? '') : NaN
  return Number.isFinite(ms) && ms > 0 ? Math.max(250, Math.min(60_000, Math.round(ms / 4))) : 60_000
}
// how much of each role memory file goes into a teammate's brief (the newest entries)
export const teamMemoryBytes = (): number => (current?.general.teamMemoryKb ?? DEFAULT_TEAM_MEMORY_KB) * 1024
