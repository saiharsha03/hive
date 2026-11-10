// Messages the user queued while Claude works. They wait here (not in the SDK) so they can still be
// removed, edited or sent now; the next one is handed over only when the running turn ends.
// Pure, so it can be tested without Electron.
export type Phase = 'sent' | 'steered' | 'removed'
export type Priority = 'next' | 'later'

// a turn the SDK stopped while its prompt hooks still ran (an interrupt landed then): its message never reached Claude
export const promptNeverChecked = (r: { subtype?: string; errors?: string[] }): boolean =>
  r.subtype === 'error_during_execution' && (r.errors ?? []).some((e) => e.startsWith('prompt_check:'))

export function turnQueue<T>(deliver: (msg: T, priority: Priority | undefined, id: string) => void, notify: (id: string, phase: Phase) => void) {
  // free: the user's own message, which a paused team's hold does not stop (team posts wait for the resume)
  const waiting: { id: string; msg: T; free: boolean }[] = []
  let busy = false
  let held = false // a paused team: queued messages wait until it resumes
  const next = () => {
    const i = held ? waiting.findIndex((w) => w.free) : 0
    if (i < 0 || !waiting.length) return
    const [n] = waiting.splice(i, 1)
    busy = true
    deliver(n.msg, 'later', n.id)
    notify(n.id, 'sent')
  }
  const take = (id: string) => {
    const i = waiting.findIndex((w) => w.id === id)
    return i < 0 ? null : waiting.splice(i, 1)[0]
  }
  return {
    // a turn is running (or about to): the user sent a message, or Claude started on its own
    markBusy: () => { busy = true },
    // a turn is running or about to (queued messages wait behind it)
    isBusy: () => busy,
    // Claude is idle: the message goes straight in; otherwise it waits for the turn's result
    // first: ahead of the messages already waiting (an interrupt)
    // free: typed by the user, so a hold (a paused team) does not keep it waiting; held: anything else waits even when idle
    submit(id: string, msg: T, first = false, free = false) {
      if (!busy && (held ? free : !waiting.length)) { busy = true; deliver(msg, undefined, id); notify(id, 'sent'); return }
      if (first) waiting.unshift({ id, msg, free })
      else waiting.push({ id, msg, free })
    },
    // false when it was already delivered
    remove(id: string): boolean {
      if (!take(id)) return false
      notify(id, 'removed')
      return true
    },
    // "Send now": a queued message becomes a steer into the running turn (or starts one if Claude went idle)
    promote(id: string): boolean {
      const n = take(id)
      if (!n) return false
      const running = busy
      busy = true
      deliver(n.msg, running ? 'next' : undefined, n.id)
      notify(id, 'steered')
      return true
    },
    // the turn's result arrived, success, error or interrupt alike: start the next queued message (held: the next of
    // the user's own, if any)
    turnEnded() {
      busy = false
      next()
    },
    // hold: nothing queued goes in after the running turn; release: the next one goes in now when Claude is idle
    hold(on: boolean) {
      held = on
      if (!on && !busy) next()
    },
    isHeld: () => held,
    clear: () => { waiting.length = 0 },
    // everything still waiting, taken out (the process ended with messages queued: they go back to the window)
    drain: (): { id: string; msg: T }[] => waiting.splice(0).map(({ id, msg }) => ({ id, msg })),
    has: (id: string) => waiting.some((w) => w.id === id),
    size: () => waiting.length,
  }
}

// One tab's sends, in the order they were made: a send that has to wait for something first (an "ultrathink" message
// waits for its effort to be raised) holds back the sends after it, instead of letting them overtake it. A send with
// nothing to wait for and nothing ahead of it runs at once.
export function inOrder() {
  const chains = new Map<string, Promise<void>>()
  return {
    // onError: a send that fails after waiting (the caller's own call has returned by then, so it must be told)
    run(key: string, f: () => void, first?: Promise<unknown> | null, onError: (e: unknown) => void = (e) => console.error('send failed:', e)): void {
      const prev = chains.get(key)
      if (!prev && !first) { f(); return }
      const p: Promise<void> = (prev ?? Promise.resolve())
        .then(() => first ?? undefined)
        .catch(() => {})
        .then(() => { try { f() } catch (e) { onError(e) } })
        .finally(() => { if (chains.get(key) === p) chains.delete(key) })
      chains.set(key, p)
    },
    pending: (key: string) => chains.has(key),
  }
}
