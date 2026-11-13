// Appearance: the theme (one of ten token sets, themesCore.ts) and the one layout's toggles: rail, inspector, drawer, Focus
// mode (rail and inspector hidden) and the rail on the right. Applying is live: data-theme / data-focus on <html>,
// nothing remounts the conversations. Settings -> Appearance and the command field use the same setters.
//
// Older Orbit saved one of four layouts ("ui": default, workbench, strip, focus) and a theme per layout
// ("themeByUI": default, mono, colour, light, hc). Those are read once and folded in: the Focus layout becomes Focus
// mode, the other three become the one layout; Monochrome and Colourful become Dark.
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from './prefs'

import { DEFAULT_FONTS, THEMES, codeFontStack, migrate, nextTheme, uiFontStack, type Appearance, type Fonts, type Layout, type ThemeId, type ThemeInfo } from './layoutCore'
import { THEME_TOKENS, themeCss } from './themesCore'
export { migrate, themeOf, UI_FONTS, CODE_FONTS, type Appearance, type Fonts, type Layout, type ThemeId, type ThemeInfo } from './layoutCore'
export { swatchOf, isLightTheme } from './themesCore'

// the ten token sets, written once as a stylesheet; switching is only the data-theme attribute
const sheet = document.createElement('style')
sheet.id = 'hive-themes'
sheet.textContent = themeCss()
document.head.prepend(sheet)

let state: Appearance = migrate({ appearance: getPref<unknown>('appearance', undefined), ui: getPref<unknown>('ui', undefined), themeByUI: getPref<unknown>('themeByUI', undefined) })
// once: the fonts become the code editor's own (Segoe UI and Consolas); a later choice in Settings is kept
if (!getPref<boolean>('fonts.editor', false)) { state = { ...state, fonts: DEFAULT_FONTS }; setPref('appearance', state); setPref('fonts.editor', true) }
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function apply() {
  const root = document.documentElement
  root.dataset.theme = state.theme
  root.dataset.focus = state.layout.focus ? '1' : '0'
  // the two type tokens; everything else reads them
  root.style.setProperty('--sans', uiFontStack(state.fonts.ui))
  root.style.setProperty('--mono', codeFontStack(state.fonts.code))
  // the Windows min / max / close buttons follow the theme
  const t = THEME_TOKENS[state.theme]
  try { window.api.setTitleBar(t.titlebar, t['titlebar-symbol']) } catch { /* older main */ }
  requestAnimationFrame(() => themeListeners.forEach((f) => f()))
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
/** the next theme in the list (Ctrl+Alt+T; Shift goes back) */
export const cycleTheme = (step = 1) => { const id = nextTheme(state.theme, step); setTheme(id); return THEMES.find((t) => t.id === id)! }
export function setLayout(patch: Partial<Layout>) {
  set({ ...state, layout: { ...state.layout, ...patch } })
}
export const setFonts = (patch: Partial<Fonts>) => set({ ...state, fonts: { ...state.fonts, ...patch } })
export const toggleLayout = (k: keyof Layout) => setLayout({ [k]: !state.layout[k] })
export const getAppearance = (): Appearance => state

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => state)
}

apply()
