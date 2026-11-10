// The theme and the one layout's toggles, and how older saved preferences fold into them. Pure, so it is tested.
// Older Hive saved one of four layouts ("ui": default, workbench, strip, focus) and a theme per layout ("themeByUI":
// default, mono, colour, light, hc): the Focus layout becomes Focus mode, the rest the one layout; Monochrome and
// Colourful become Dark.

export type ThemeId = 'dark' | 'light' | 'hc'
export type ThemeInfo = { id: ThemeId; label: string; description: string }

export const THEMES: ThemeInfo[] = [
  { id: 'dark', label: 'Dark', description: 'Calm grey zones; colour only for state, git, diff and the one accent' },
  { id: 'light', label: 'Light', description: 'The same layout and words on light zones' },
  { id: 'hc', label: 'High contrast', description: 'Black zones, light rules and brighter state words' },
]

export type Layout = { rail: boolean; inspector: boolean; drawer: boolean; focus: boolean; railRight: boolean }
export type Appearance = { theme: ThemeId; layout: Layout }

export const DEFAULT_LAYOUT: Layout = { rail: true, inspector: true, drawer: false, focus: false, railRight: false }

// a theme id from any version: the old five fold into the three
export function themeOf(v: unknown): ThemeId {
  if (v === 'light') return 'light'
  if (v === 'hc') return 'hc'
  return 'dark'
}

// what older prefs said, as the new shape (pure, for the test)
export function migrate(prefs: { appearance?: unknown; ui?: unknown; themeByUI?: unknown }): Appearance {
  const a = prefs.appearance as Partial<Appearance> | undefined
  if (a && typeof a === 'object') {
    const l = (a.layout ?? {}) as Partial<Layout>
    return { theme: themeOf(a.theme), layout: { ...DEFAULT_LAYOUT, ...Object.fromEntries(Object.entries(l).filter(([k, v]) => k in DEFAULT_LAYOUT && typeof v === 'boolean')) } }
  }
  const ui = typeof prefs.ui === 'string' ? prefs.ui : 'default'
  const byUI = prefs.themeByUI && typeof prefs.themeByUI === 'object' ? prefs.themeByUI as Record<string, unknown> : {}
  return { theme: themeOf(byUI[ui]), layout: { ...DEFAULT_LAYOUT, focus: ui === 'focus' } }
}

