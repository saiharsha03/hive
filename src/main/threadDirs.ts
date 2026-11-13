// /add-dir: the folders a thread may work in beside its own, for the rest of the app's session. Each new process of
// the thread starts with them (chat.ts passes additionalDirectories); a running one is told at once (claudeConfig.ts).
const dirs = new Map<string, string[]>()

export const threadDirs = (tabId: string): string[] => dirs.get(tabId) ?? []
export function addThreadDir(tabId: string, dir: string): string[] {
  const cur = threadDirs(tabId)
  const next = cur.some((d) => d.toLowerCase() === dir.toLowerCase()) ? cur : [...cur, dir]
  dirs.set(tabId, next)
  return next
}
// the SDK option for a thread's process: nothing when it has no added folder
export const dirsOption = (tabId: string): { additionalDirectories?: string[] } => {
  const d = threadDirs(tabId)
  return d.length ? { additionalDirectories: d } : {}
}
