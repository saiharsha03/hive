// The app's display name and tagline for code outside the page (system prompt, error messages, window title):
// a mirror of Settings > General appName / appTagline, which main sets after loading or saving settings.
// The page reads the same values through appSettings. Package name, folders and paths stay "hive".
import { DEFAULT_APP_NAME, DEFAULT_APP_TAGLINE } from './settingsCore'

// null until main or the page sets them: the defaults are read on use, not when this file loads, because settingsCore
// reaches this file through devCore before it has defined them (a run from source loads the files in that order)
let name: string | null = null
let tagline: string | null = null

export const appName = (): string => name ?? DEFAULT_APP_NAME
export const appTagline = (): string => tagline ?? DEFAULT_APP_TAGLINE
// the window title: the name (the tagline shows beside the brand in the page)
export const windowTitle = (): string => appName()

export function setAppName(n: string | undefined | null, t?: string | undefined | null): void {
  name = (n ?? '').trim() || DEFAULT_APP_NAME
  tagline = t == null ? DEFAULT_APP_TAGLINE : t.trim()
}
