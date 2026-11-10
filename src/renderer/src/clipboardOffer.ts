// The clipboard suggestion currently on offer (one for the whole app, shown above the active tab's message box)
// and the on/off switch, kept with the other UI preferences.
import { useSyncExternalStore } from 'react'
import type { ClipOffer } from '../../shared/clipboardCore'
import { getPref, setPref } from './prefs'

const KEY = 'clipboardSuggest'
const listeners = new Set<() => void>()
let offer: ClipOffer | null = null
let on = getPref(KEY, true)

const emit = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

window.api.onClipboardOffer((o) => { offer = o; emit() })
void window.api.clipboardEnabled(on)

export const useClipOffer = () => useSyncExternalStore(subscribe, () => offer)
export const useClipboardOn = () => useSyncExternalStore(subscribe, () => on)

export function setClipboardOn(v: boolean) {
  on = v
  setPref(KEY, v)
  if (!v) offer = null
  emit()
  void window.api.clipboardEnabled(v)
}

// the chip is gone once clicked or dismissed; main has dropped the item by then
export function clearOffer() { offer = null; emit() }

// same hash main uses for text, so the page can tell the offer is already what the box holds
export async function textHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `t:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
