// Rewind a turn: where the conversation resumes once one of your messages is taken back. That is the chain entry
// just before the message (its parentUuid), so the fork keeps everything up to the previous turn's last entry.
// at null = the message opened the conversation, so the thread starts fresh.
export function forkPoint(transcript: string, uuid: string): { found: boolean; at: string | null } {
  for (const line of transcript.split('\n')) {
    if (!line.startsWith('{') || !line.includes(uuid)) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'user' && e.uuid === uuid) return { found: true, at: e.parentUuid ?? null }
  }
  return { found: false, at: null }
}

// why a thread cannot be rewound right now (null = it can): restoring files under a running turn or under background
// work would write over what they are doing, and closing the process would kill that work
export function rewindBlock(t: { busy: boolean; runningTasks: string[]; codexRuns: number; rewinding: boolean }): string | null {
  if (t.rewinding) return 'A rewind of this thread is already in progress.'
  if (t.busy) return 'Claude is working: stop the turn first.'
  if (t.runningTasks.length) return `Background work of this thread is still running (${t.runningTasks.join(', ')}): wait for it or stop it first.`
  if (t.codexRuns) return 'A Codex run of this thread is still going: wait for it or stop it first.'
  return null
}

// a real file rewind put back less than the dry run listed: the files left as they are, and the link-safety refusals.
// The real rewind's answer usually carries only skippedLinks (no file list, seen on the CLI 2026-11-05); a list, when
// there is one, is compared with the dry run's
export function partialRestore(expected: string[], r: { filesChanged?: string[]; skippedLinks?: number }): { missing: string[]; skipped: number } | null {
  const done = r.filesChanged ? new Set(r.filesChanged) : null
  const missing = done ? expected.filter((f) => !done.has(f)) : []
  const skipped = r.skippedLinks ?? 0
  return missing.length || skipped ? { missing, skipped } : null
}
