// Small UI preferences in ~/.claude/hive-prefs.json (through the main process), shared by dev and built Hive.
let prefs: Record<string, unknown> = (() => { try { return window.api.uiLoad('prefs') } catch { return {} } })()

export function getPref<T>(key: string, fallback: T): T {
  return key in prefs ? (prefs[key] as T) : fallback
}

export function setPref(key: string, value: unknown) {
  prefs = { ...prefs, [key]: value }
  try { window.api.uiSave('prefs', prefs) } catch { /* in-memory only */ }
}
