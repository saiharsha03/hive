// The theme and the one layout's toggles, and how older saved preferences fold into them. Pure, so it is tested.
// Older Hive saved one of four layouts ("ui": default, workbench, strip, focus) and a theme per layout ("themeByUI":
// default, mono, colour, light, hc): the Focus layout becomes Focus mode, the rest the one layout; Monochrome and
// Colourful become Dark.

import { THEME_IDS, type ThemeId } from './themesCore'
export { THEMES, type ThemeId, type ThemeInfo } from './themesCore'

export type Layout = { rail: boolean; inspector: boolean; drawer: boolean; focus: boolean; railRight: boolean }

// the two type tokens: --sans for the UI and --mono for code, terminal and tool rows
export type UiFont = 'inter' | 'segoe' | 'plex' | 'geist' | 'system'
export type CodeFont = 'cascadia' | 'consolas' | 'plex-mono' | 'system'
export const UI_FONTS: { id: UiFont; label: string; stack: string }[] = [
  { id: 'inter', label: 'Inter', stack: "'Inter Variable', 'Segoe UI', sans-serif" },
  { id: 'segoe', label: 'Segoe UI Variable', stack: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', sans-serif" },
  { id: 'plex', label: 'IBM Plex Sans', stack: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
  { id: 'geist', label: 'Geist', stack: "'Geist Variable', 'Segoe UI', sans-serif" },
  { id: 'system', label: 'System', stack: "system-ui, 'Segoe UI', sans-serif" },
]
export const CODE_FONTS: { id: CodeFont; label: string; stack: string }[] = [
  { id: 'cascadia', label: 'Cascadia Mono', stack: "'Cascadia Mono', Consolas, monospace" },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Cascadia Mono', monospace" },
  { id: 'plex-mono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', Consolas, monospace" },
  { id: 'system', label: 'System monospace', stack: "ui-monospace, Consolas, monospace" },
]
export type Fonts = { ui: UiFont; code: CodeFont }
export const DEFAULT_FONTS: Fonts = { ui: 'inter', code: 'cascadia' }
const fontsOf = (v: unknown): Fonts => {
  const f = (v && typeof v === 'object' ? v : {}) as Partial<Fonts>
  return { ui: UI_FONTS.some((x) => x.id === f.ui) ? f.ui! : DEFAULT_FONTS.ui, code: CODE_FONTS.some((x) => x.id === f.code) ? f.code! : DEFAULT_FONTS.code }
}
export const uiFontStack = (id: UiFont) => (UI_FONTS.find((x) => x.id === id) ?? UI_FONTS[0]).stack
export const codeFontStack = (id: CodeFont) => (CODE_FONTS.find((x) => x.id === id) ?? CODE_FONTS[0]).stack

export type Appearance = { theme: ThemeId; layout: Layout; fonts: Fonts }

export const DEFAULT_LAYOUT: Layout = { rail: true, inspector: true, drawer: false, focus: false, railRight: false }

// a theme id from any version: one of the ten as it is; the old five (default, mono, colour, light, hc) fold in,
// and anything unknown is Quiet ('dark', the default)
export function themeOf(v: unknown): ThemeId {
  return THEME_IDS.includes(v as ThemeId) ? v as ThemeId : 'dark'
}
/** the theme after (or before) this one, for the cycle shortcut */
export const nextTheme = (id: ThemeId, step = 1): ThemeId => THEME_IDS[(THEME_IDS.indexOf(id) + step + THEME_IDS.length) % THEME_IDS.length]

// what older prefs said, as the new shape (pure, for the test)
export function migrate(prefs: { appearance?: unknown; ui?: unknown; themeByUI?: unknown }): Appearance {
  const a = prefs.appearance as Partial<Appearance> | undefined
  if (a && typeof a === 'object') {
    const l = (a.layout ?? {}) as Partial<Layout>
    return { theme: themeOf(a.theme), layout: { ...DEFAULT_LAYOUT, ...Object.fromEntries(Object.entries(l).filter(([k, v]) => k in DEFAULT_LAYOUT && typeof v === 'boolean')) }, fonts: fontsOf(a.fonts) }
  }
  const ui = typeof prefs.ui === 'string' ? prefs.ui : 'default'
  const byUI = prefs.themeByUI && typeof prefs.themeByUI === 'object' ? prefs.themeByUI as Record<string, unknown> : {}
  return { theme: themeOf(byUI[ui]), layout: { ...DEFAULT_LAYOUT, focus: ui === 'focus' }, fonts: DEFAULT_FONTS }
}

