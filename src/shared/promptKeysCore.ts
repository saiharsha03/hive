// Pure parts of the message box's terminal keys: Ctrl+R history search, Ctrl+S stash, Tab's choice between the copied
// text and Claude Code's suggested next prompt, and Alt+P. No React, no window, so they are tested on their own.

// Ctrl+R: the earlier prompts (newest first) that hold the search text, case not minded; an empty search lists them all
export function historyMatches(past: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  return q ? past.filter((p) => p.toLowerCase().includes(q)) : past
}

// Ctrl+S: with something in the box it goes aside and the box empties; with an empty box what was put aside comes back
export type Stash<I> = { text: string; images: I[] }
export function stashStep<I>(box: Stash<I>, stashed: Stash<I> | null): { box: Stash<I>; stashed: Stash<I> | null } | null {
  if (box.text.trim() || box.images.length) return { box: { text: '', images: [] }, stashed: box }
  if (stashed) return { box: stashed, stashed: null }
  return null // empty box, nothing stashed: the key does nothing
}

// Tab in the message box: the copied-text hint wins while it shows; else Claude Code's suggested next prompt, when there
// is one and the box is empty
export function tabTakes(clipHint: boolean, suggestion: string | null | undefined, boxEmpty: boolean): 'clip' | 'suggestion' | null {
  if (clipHint) return 'clip'
  if (suggestion?.trim() && boxEmpty) return 'suggestion'
  return null
}

// Alt+P switches the model, as in the terminal (Alt+T and Alt+O are thinking and fast mode)
export const isModelKey = (e: { key: string; code?: string; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean }) =>
  e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')
