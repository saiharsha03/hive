// The Quarry page's pure part: which of Quarry's themes matches Hive's (Quarry's names: graphite, quiet, classic,
// midnight, forest, slate, mocha, light, paper, high-contrast). A Hive theme with the same name is passed as is; a light
// one becomes light, a high-contrast one high-contrast, anything else Quarry's dark graphite.
export const QUARRY_THEMES = ['graphite', 'quiet', 'classic', 'midnight', 'forest', 'slate', 'mocha', 'light', 'paper', 'high-contrast'] as const

export function quarryTheme(hive: string | undefined): (typeof QUARRY_THEMES)[number] {
  const t = (hive ?? '').toLowerCase()
  const same = QUARRY_THEMES.find((q) => q === t)
  if (same) return same
  if (/contrast/.test(t)) return 'high-contrast'
  if (/light|paper|day/.test(t)) return 'light'
  return 'graphite'
}
