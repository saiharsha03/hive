// UI state that must not depend on how Orbit was started (dev server vs built app have different browser storage):
// thread pins / snoozes / closes, small UI preferences and what a restart restores, kept as JSON files under ~/.claude.
import { readFileSync } from 'node:fs'
import { writeFileSafe } from './safeWrite'
import { dataDir } from './testMode'
import { join } from 'node:path'

const FILES: Record<string, string> = {
  threads: join(dataDir(), 'hive-threads.json'),
  prefs: join(dataDir(), 'hive-prefs.json'),
  restore: join(dataDir(), 'hive-restore.json'), // drafts + open tabs, written often, so not in prefs
}

export function uiLoad(name: string): Record<string, unknown> {
  const f = FILES[name]
  if (!f) return {}
  try {
    const v = JSON.parse(readFileSync(f, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

// through writeFileSafe: a locked file (antivirus, a second Orbit) must not crash the app
export function uiSave(name: string, value: unknown): void {
  const f = FILES[name]
  if (!f || !value || typeof value !== 'object' || Array.isArray(value)) return
  writeFileSafe(f, JSON.stringify(value))
}
