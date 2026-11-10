// What survives a restart (an update needs one): unsent draft text per saved thread and the saved threads open as tabs.
// Kept in hive-restore.json by session id; a never-sent new thread has none, so its tab and draft are not kept.
export type OpenTabs = { ids: string[]; focused: string | null }
type Tab = { id: string; sessionId?: string; background: boolean; tool?: string; file?: string }

// the saved threads on screen, in tab order (panes left to right): not background, tool, file or watcher tabs
export function tabsToSave(sessions: Tab[], order: string[], active: string | null): OpenTabs {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const ids: string[] = []
  let focused: string | null = null
  for (const id of order) {
    const s = byId.get(id)
    if (!s?.sessionId || s.background || s.tool || s.file || s.id.startsWith('watcher-') || ids.includes(s.sessionId)) continue
    ids.push(s.sessionId)
    if (id === active) focused = s.sessionId
  }
  return { ids, focused }
}

// the saved tabs still in the thread list (a deleted or watcher-run thread is skipped), in order, and the one to focus
// (the last one when the focused tab is gone)
export function tabsToRestore<T extends { id: string; watcherRun?: boolean }>(saved: OpenTabs, list: T[]): { open: T[]; focus: string | null } {
  const byId = new Map(list.filter((x) => !x.watcherRun).map((x) => [x.id, x]))
  const open = [...new Set(saved.ids)].map((id) => byId.get(id)).filter((x): x is T => !!x)
  const focus = open.some((x) => x.id === saved.focused) ? saved.focused : (open.at(-1)?.id ?? null)
  return { open, focus }
}

// one draft's new text: an empty or blank one is dropped
export function withDraft(drafts: Record<string, string>, id: string, text: string): Record<string, string> {
  if (!text.trim()) {
    if (!(id in drafts)) return drafts
    const { [id]: _gone, ...rest } = drafts
    return rest
  }
  return drafts[id] === text ? drafts : { ...drafts, [id]: text }
}

// drafts of threads no longer in the list are dropped, so the file does not grow forever
export function keepKnown(drafts: Record<string, string>, known: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(drafts).filter(([id]) => known.has(id)))
}
