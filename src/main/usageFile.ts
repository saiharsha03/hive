// ~/.claude/usage/latest.json: the plan-limit snapshot a usage-guard hook reads. The terminal's usage-file plugin writes
// it, but Hive turns that plugin off in its own sessions, so with no terminal open the hook would go quiet; Hive writes
// the same file, in the same shape, from every real usage reading status.ts keeps (never a placeholder, never in test
// mode, at most once a minute). It only feeds the hook: nothing in Hive reads it back.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realLimits } from '../shared/usageCore'
import { writeFileSafe } from './safeWrite'
import { TEST_MODE } from './testMode'

export type UsageSnapshot = { writtenAt: string; rateLimits: { kind: 'five_hour' | 'seven_day'; percentUsed: number; resetsAt: string }[] }

// one entry per plan window with a reading and a reset time; null when there is none (then nothing is written)
export function usageSnapshot(limits: any, now: number): UsageSnapshot | null {
  if (!realLimits(limits)) return null
  const rateLimits: UsageSnapshot['rateLimits'] = []
  for (const kind of ['five_hour', 'seven_day'] as const) {
    const w = limits?.[kind]
    const r = w?.resets_at
    // the reset comes as ISO text, or as epoch seconds from some answers
    const reset = typeof r === 'string' ? Date.parse(r) : typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : NaN
    if (typeof w?.utilization !== 'number' || !Number.isFinite(w.utilization) || !Number.isFinite(reset)) continue
    rateLimits.push({ kind, percentUsed: Math.round(Math.min(100, Math.max(0, w.utilization))), resetsAt: new Date(reset).toISOString() })
  }
  return rateLimits.length ? { writtenAt: new Date(now).toISOString(), rateLimits } : null
}

const MIN_GAP_MS = 60_000
let lastWrite = 0
export const usageFilePath = () => process.env.HIVE_USAGE_FILE || join(homedir(), '.claude', 'usage', 'latest.json')

// write the snapshot for this reading; false when it was skipped (test mode, too soon, no usable window)
export function writeUsageFile(limits: any, now = Date.now(), opts: { test?: boolean } = {}): boolean {
  if (opts.test ?? TEST_MODE) return false
  if (now - lastWrite < MIN_GAP_MS) return false
  const snap = usageSnapshot(limits, now)
  if (!snap) return false
  if (!writeFileSafe(usageFilePath(), JSON.stringify(snap))) return false
  lastWrite = now
  return true
}
