// Threads talking to each other: the label on a message one thread sends another, the thread list,
// and waiting for a thread to go idle. Pure, so it can be tested without Electron or the SDK.

export type ThreadStatus = 'working' | 'waiting' | 'idle'
export type From = { id: string; title: string }

// "[From thread "Fix login" (new-123)]" on the first line, so the receiver knows another thread sent it, not the user
export const fromLabel = (f: From) => `[From thread "${f.title.replace(/\s+/g, ' ')}" (${f.id})]`
export const labelFromThread = (f: From, text: string) => `${fromLabel(f)}\n${text}`

const LABEL = /^\[From thread "([^\n]*)" \(([^()\s]+)\)\]\n?/
export function parseFromThread(text: string): { from: From; text: string } | null {
  const m = text.match(LABEL)
  return m ? { from: { title: m[1], id: m[2] }, text: text.slice(m[0].length) } : null
}

export type ThreadInfo = { sessionId: string | null; title: string; cwd: string; busy: boolean; waitingReason?: string; background: boolean }
export type ThreadRow = Omit<ThreadInfo, 'busy' | 'waitingReason'> & { id: string; status: ThreadStatus; reason?: string; self: boolean }

// working wins; waiting = the thread said it needs the user (organize_thread waiting) and nothing came in since
export const statusOf = (t: Pick<ThreadInfo, 'busy' | 'waitingReason'>): ThreadStatus => (t.busy ? 'working' : t.waitingReason ? 'waiting' : 'idle')

export function listThreads(entries: Iterable<[string, ThreadInfo]>, selfId: string): ThreadRow[] {
  const rows: ThreadRow[] = []
  for (const [id, t] of entries) {
    const status = statusOf(t)
    rows.push({ id, sessionId: t.sessionId, title: t.title, cwd: t.cwd, status, ...(status === 'waiting' ? { reason: t.waitingReason } : {}), background: t.background, self: id === selfId })
  }
  return rows
}

export function formatThreads(rows: ThreadRow[]): string {
  if (!rows.length) return 'No live threads.'
  return rows.map((r) => [
    `- "${r.title}" id=${r.id}${r.self ? ' (this thread)' : ''}`,
    `  status: ${r.status}${r.reason ? ` (${r.reason})` : ''}; ${r.background ? 'in the background' : 'open as a tab'}`,
    `  cwd: ${r.cwd}${r.sessionId ? `; session ${r.sessionId}` : ''}`,
  ].join('\n')).join('\n')
}

// a live thread by its tab id or its Claude session id
export function resolveThread<T extends { sessionId: string | null }>(ref: string, entries: Iterable<[string, T]>): string | undefined {
  for (const [id, t] of entries) if (id === ref || t.sessionId === ref) return id
  return undefined
}

// Wait until the thread has no running turn and nothing queued. Every wait has a timeout, so two threads
// waiting on each other both come back. timeoutMs <= 0 is a plain read of the current state.
export type Watch = { busy: () => boolean; onIdle: (cb: () => void) => () => void }
export type Timers = { setTimeout: (cb: () => void, ms: number) => unknown; clearTimeout: (h: any) => void }
export function waitIdle(w: Watch, timeoutMs: number, signal?: AbortSignal, timers: Timers = globalThis): Promise<'idle' | 'timeout'> {
  if (!w.busy()) return Promise.resolve('idle')
  if (timeoutMs <= 0 || signal?.aborted) return Promise.resolve('timeout')
  return new Promise((resolve) => {
    let off = () => {}
    const finish = (r: 'idle' | 'timeout') => { off(); timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(r) }
    const abort = () => finish('timeout')
    const timer = timers.setTimeout(() => finish('timeout'), timeoutMs)
    off = w.onIdle(() => finish('idle'))
    signal?.addEventListener('abort', abort)
  })
}

export function formatWait(r: { title: string; id: string; status: ThreadStatus | 'closed'; reply: string | null; timedOut: boolean }): string {
  const head = r.status === 'closed'
    ? `Thread "${r.title}" (${r.id}) is not running.`
    : r.timedOut && r.status === 'working'
      ? `Thread "${r.title}" (${r.id}) is still working.`
      : `Thread "${r.title}" (${r.id}) is ${r.status}.`
  const reply = r.reply?.trim()
  return `${head}\n${reply ? `Its last reply:\n${reply}` : 'No reply from it yet.'}`
}
