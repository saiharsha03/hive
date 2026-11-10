// Pure logic for the tab bar's right-click menu.
// The tab context menu's close actions. Returns the tab ids to close and which tab becomes active afterwards:
// the current one if it stays, else the right-clicked tab if it stays, else the nearest survivor, else none.
export type TabCloseAction = 'close' | 'others' | 'right' | 'left' | 'all'
export function tabsToClose(ids: string[], target: string, action: TabCloseAction): string[] {
  const i = ids.indexOf(target)
  if (i < 0) return []
  switch (action) {
    case 'close': return [target]
    case 'others': return ids.filter((id) => id !== target)
    case 'right': return ids.slice(i + 1)
    case 'left': return ids.slice(0, i)
    case 'all': return [...ids]
  }
}

export function nextActive(ids: string[], closing: string[], active: string | null, target: string): string | null {
  const gone = new Set(closing)
  const rest = ids.filter((id) => !gone.has(id))
  if (active && rest.includes(active)) return active
  if (rest.includes(target)) return target
  // nearest survivor to where the active (else target) tab was
  const from = ids.indexOf(active ?? target)
  if (!rest.length) return null
  if (from < 0) return rest[0]
  return [...ids.slice(from + 1), ...ids.slice(0, from).reverse()].find((id) => !gone.has(id)) ?? null
}
