// Appearance: the theme (dark, light, high contrast) and the one layout's toggles: rail, inspector, drawer, Focus
// mode (rail and inspector hidden) and the rail on the right. Applying is live: data-theme / data-focus on <html>,
// nothing remounts the conversations. Settings -> Appearance and the command field use the same setters.
//
// Older Hive saved one of four layouts ("ui": default, workbench, strip, focus) and a theme per layout
// ("themeByUI": default, mono, colour, light, hc). Those are read once and folded in: the Focus layout becomes Focus
// mode, the other three become the one layout; Monochrome and Colourful become Dark.
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from './prefs'

import { THEMES, migrate, type Appearance, type Layout, type ThemeId, type ThemeInfo } from './layoutCore'
export { migrate, themeOf, type Appearance, type Layout, type ThemeId, type ThemeInfo } from './layoutCore'

let state: Appearance = migrate({ appearance: getPref<unknown>('appearance', undefined), ui: getPref<unknown>('ui', undefined), themeByUI: getPref<unknown>('themeByUI', undefined) })
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function apply() {
  const root = document.documentElement
  root.dataset.theme = state.theme
  root.dataset.focus = state.layout.focus ? '1' : '0'
  // the Windows min / max / close buttons follow the theme
  requestAnimationFrame(() => {
    const cs = getComputedStyle(root)
    try { window.api.setTitleBar(cs.getPropertyValue('--titlebar').trim() || '#171A1D', cs.getPropertyValue('--titlebar-symbol').trim() || '#CBD1D7') } catch { /* older main */ }
    themeListeners.forEach((f) => f())
  })
}
// things outside React that read colours (the xterm instances, Monaco) re-read them after a theme change
const themeListeners = new Set<() => void>()
export const onThemeApplied = (f: () => void) => { themeListeners.add(f); return () => { themeListeners.delete(f) } }

function set(next: Appearance) {
  state = next
  setPref('appearance', next)
  apply()
  listeners.forEach((l) => l())
}

export const getThemes = (): ThemeInfo[] => THEMES
export function setTheme(id: ThemeId) {
  if (!THEMES.some((t) => t.id === id) || id === state.theme) return
  set({ ...state, theme: id })
}
export function setLayout(patch: Partial<Layout>) {
  set({ ...state, layout: { ...state.layout, ...patch } })
}
export const toggleLayout = (k: keyof Layout) => setLayout({ [k]: !state.layout[k] })
export const getAppearance = (): Appearance => state

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => state)
}

apply()
