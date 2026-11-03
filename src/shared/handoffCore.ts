// Handoff: a thread grown big (every reply re-reads all of it) or just compacted is offered a fresh thread. On yes,
// the agent writes a handoff file, and a new thread in the same folder starts by reading it.

export const HANDOFF_AT_DEFAULT = 200_000
// offered again after Not now only once the thread has grown this much more (or compacted again)
export const HANDOFF_AGAIN = 100_000

// HIVE_HANDOFF_AT: tokens of context; empty or not a number = the default, 0 or less = never offered on size
export function handoffAt(v?: string): number {
  const raw = (v ?? '').trim()
  const n = Number(raw)
  if (raw === '' || !Number.isFinite(n)) return HANDOFF_AT_DEFAULT
  return n > 0 ? n : 0
}

// dismissed = the context size and compaction count when the user said Not now
export type Offer = { total: number; compactions: number; dismissed?: { total: number; compactions: number } }
export function shouldOffer(o: Offer, at: number): boolean {
  const d = o.dismissed
  const compacted = o.compactions > (d?.compactions ?? 0)
  const big = at > 0 && o.total >= at && (!d || o.total >= d.total + HANDOFF_AGAIN)
  return compacted || big
}

// what the big thread is asked to do
export function handoffRequest(file: string): string {
  return [
    '[Hive handoff] This thread has grown large, so the user is moving to a fresh thread. Before it starts:',
    '1. Save anything worth keeping across sessions to your memory (update existing memory files, do not duplicate).',
    `2. Write a handoff for the next thread to ${file} (create the folder if needed). Make it self-contained:`,
    '   the goal; what is done (with commit shas, file paths, PR or ticket links); decisions made and why; the current state',
    '   (branch, uncommitted work, running services, background tasks); open questions waiting on the user; and the exact next steps.',
    '   Point to files and memory instead of pasting their contents. Never write tokens or keys into it.',
    '3. Reply with one short line saying the handoff is written. Do not start any new work.',
  ].join('\n')
}

// the fresh thread's first message
export function handoffStart(fromTitle: string, file: string): string {
  return `You're continuing work from the thread "${fromTitle}", which grew too large. Read the handoff at ${file} first, ` +
    'then any memory files it points to, and carry on with its next steps. Keep replies short and lead with the answer.'
}

// a file name from the thread's tab id and the time
export const handoffName = (tabId: string, now: number) => `${tabId.replace(/[^\w-]+/g, '_').slice(0, 60)}-${now}.md`
