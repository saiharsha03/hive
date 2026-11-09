// What a restart brings back (restoreCore): read once at start, written behind the live state, at most once a second.
import { keepKnown, withDraft, type OpenTabs } from '../../shared/restoreCore'

type Saved = { drafts: Record<string, string>; tabs: OpenTabs }
let saved: Saved = (() => {
  try {
    const v = window.api.uiLoad('restore') as Partial<Saved>
    return { drafts: v.drafts ?? {}, tabs: v.tabs ?? { ids: [], focused: null } }
  } catch { return { drafts: {}, tabs: { ids: [], focused: null } } }
})()

let timer: ReturnType<typeof setTimeout> | null = null
const flush = () => {
  if (timer) clearTimeout(timer)
  timer = null
  try { window.api.uiSave('restore', saved) } catch { /* in-memory only */ }
}
// a quit (an update's restart) must not lose the last second of typing
window.addEventListener('beforeunload', () => { if (timer) flush() })
const write = (next: Saved) => {
  if (next.drafts === saved.drafts && next.tabs === saved.tabs) return
  saved = next
  if (!timer) timer = setTimeout(flush, 1000)
}

export const savedDrafts = () => saved.drafts
export const saveDraft = (sessionId: string, text: string) => write({ ...saved, drafts: withDraft(saved.drafts, sessionId, text) })
export const savedTabs = () => saved.tabs
export const saveTabs = (tabs: OpenTabs) => {
  if (JSON.stringify(tabs) !== JSON.stringify(saved.tabs)) write({ ...saved, tabs })
}
// drafts of threads that are gone (deleted transcripts) are dropped once the thread list is known
export const pruneDrafts = (known: Set<string>) => {
  const drafts = keepKnown(saved.drafts, known)
  if (Object.keys(drafts).length !== Object.keys(saved.drafts).length) write({ ...saved, drafts })
}
