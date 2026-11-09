// The app's display name and tagline for code outside the page (system prompt, error messages, window title):
// a mirror of Settings > General appName / appTagline, which main sets after loading or saving settings.
// The page reads the same values through appSettings. Package name, folders and paths stay "hive".
import { DEFAULT_APP_NAME, DEFAULT_APP_TAGLINE } from './settingsCore'

let name = DEFAULT_APP_NAME
let tagline = DEFAULT_APP_TAGLINE

export const appName = (): string => name
export const appTagline = (): string => tagline
// the window title: the name (the tagline shows beside the brand in the page)
export const windowTitle = (): string => name

export function setAppName(n: string | undefined | null, t?: string | undefined | null): void {
  name = (n ?? '').trim() || DEFAULT_APP_NAME
  tagline = t == null ? DEFAULT_APP_TAGLINE : t.trim()
}
