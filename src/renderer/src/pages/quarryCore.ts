// The Quarry page's pure part: which of Quarry's themes matches Hive's (Quarry's names: graphite, quiet, classic,
// midnight, forest, slate, mocha, light, paper, high-contrast). Hive's own ids differ for two of them: 'dark' is the
// one shown as Quiet and 'hc' is High contrast. Any other Hive theme with Quarry's name is passed as is; an unknown
// light one becomes light, a high-contrast one high-contrast, anything else Quarry's dark graphite.
export const QUARRY_THEMES = ['graphite', 'quiet', 'classic', 'midnight', 'forest', 'slate', 'mocha', 'light', 'paper', 'high-contrast'] as const

export function quarryTheme(hive: string | undefined): (typeof QUARRY_THEMES)[number] {
  const t = (hive ?? '').toLowerCase()
  if (t === 'dark') return 'quiet'
  if (t === 'hc') return 'high-contrast'
  const same = QUARRY_THEMES.find((q) => q === t)
  if (same) return same
  if (/contrast/.test(t)) return 'high-contrast'
  if (/light|paper|day/.test(t)) return 'light'
  return 'graphite'
}

// Hive's fonts (Settings > Appearance) in Quarry's names. Quarry's UI fonts: inter, segoe, plex-sans, space-grotesk,
// system; code: cascadia, jetbrains, plex-mono, space-mono, consolas. Geist has no match in Quarry: Inter stands in;
// Hive's system monospace becomes Consolas (Quarry has no system mono).
export function quarryFonts(f: { ui: string; code: string }): { ui: string; code: string } {
  const ui: Record<string, string> = { inter: 'inter', segoe: 'segoe', plex: 'plex-sans', geist: 'inter', system: 'system' }
  const code: Record<string, string> = { cascadia: 'cascadia', consolas: 'consolas', 'plex-mono': 'plex-mono', system: 'consolas' }
  return { ui: ui[f.ui] ?? 'inter', code: code[f.code] ?? 'cascadia' }
}
