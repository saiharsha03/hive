// Long shell commands move to the background by themselves: a command (Bash / PowerShell, not already in the
// background) still running after `afterMs` is handed to `moveToBackground`, which is what the row's Background button
// does. Its result coming back, or the turn ending, cancels the timer. Pure apart from the timers, so it is testable.
const SHELLS = new Set(['Bash', 'PowerShell'])

export function autoBackground(moveToBackground: (toolUseId: string) => Promise<unknown>, afterMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const stop = (id: string) => { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id) } }
  return {
    // an assistant message's content: start a timer for each foreground shell command in it
    started(content: any[] | undefined) {
      if (!afterMs) return
      for (const b of content ?? []) {
        if (b?.type !== 'tool_use' || !SHELLS.has(b.name) || b.input?.run_in_background || timers.has(b.id)) continue
        timers.set(b.id, setTimeout(() => { timers.delete(b.id); void moveToBackground(b.id).catch(() => {}) }, afterMs))
      }
    },
    // a user message's content: the commands whose results came back are done
    ended(content: any) {
      if (Array.isArray(content)) for (const b of content) if (b?.type === 'tool_result') stop(b.tool_use_id)
    },
    clear() { for (const id of [...timers.keys()]) stop(id) },
    pending: () => timers.size,
  }
}
