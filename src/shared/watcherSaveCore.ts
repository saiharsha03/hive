// Every watcher run is its own thread, closed when the run ends: what the next run needs must be on disk by then.
// The Stop hook asks once (never twice, so a run with truly nothing to keep cannot loop) when it saved nothing.

// saved: a file in the memory folder (notes or the db), the findings file or a report changed since the run started;
// nextWake: a self-scheduled watcher has a pending row in its schedule table
export function saveReminder(a: { saved: boolean; selfScheduled: boolean; nextWake: boolean }): string | null {
  const missing = [
    ...(a.saved ? [] : ['save what the next run needs (what you checked, what changed, what to look at next) to your memory folder or SQLite db']),
    ...(a.selfScheduled && !a.nextWake ? ['schedule your next wake-up in your schedule table'] : []),
  ]
  if (!missing.length) return null
  return `Before this run ends: ${missing.join(', and ')}. This thread is closed when the run ends and the next run starts ` +
    'a fresh one that knows only what is on disk and your final reply. Then end with a short summary of this run (what you checked, what changed, what is next); if there is truly nothing to keep, say so in that summary.'
}
