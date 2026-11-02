// Messages the user queued while Claude works. They wait here (not in the SDK) so they can still be
// removed, edited or sent now; the next one is handed over only when the running turn ends.
// Pure, so it can be tested without Electron.
export type Phase = 'sent' | 'steered' | 'removed'
export type Priority = 'next' | 'later'

export function turnQueue<T>(deliver: (msg: T, priority?: Priority) => void, notify: (id: string, phase: Phase) => void) {
  const waiting: { id: string; msg: T }[] = []
  let busy = false
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
    submit(id: string, msg: T, first = false) {
      if (!busy && !waiting.length) { busy = true; deliver(msg); notify(id, 'sent'); return }
      if (first) waiting.unshift({ id, msg })
      else waiting.push({ id, msg })
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
      deliver(n.msg, running ? 'next' : undefined)
      notify(id, 'steered')
      return true
    },
    // the turn's result arrived, success, error or interrupt alike: start the next queued message
    turnEnded() {
      busy = false
      const n = waiting.shift()
      if (!n) return
      busy = true
      deliver(n.msg, 'later')
      notify(n.id, 'sent')
    },
    clear: () => { waiting.length = 0 },
    size: () => waiting.length,
    busy: () => busy,
  }
}
