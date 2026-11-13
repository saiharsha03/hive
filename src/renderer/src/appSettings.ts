// The Settings > General values the whole page uses live: the app name (top bar, window title), the tagline (top bar) and the
// Appearance choices (data-ui / data-theme on <html>, for the stylesheets to key on). Updated after every save.
import { useSyncExternalStore } from 'react'
import { DEFAULT_APP_NAME, DEFAULT_APP_TAGLINE, type General } from '../../shared/settingsCore'
import { setAppName } from '../../shared/appName'

type Look = Pick<General, 'appName' | 'appTagline' | 'ui' | 'theme'>
let look: Look = { appName: DEFAULT_APP_NAME, appTagline: DEFAULT_APP_TAGLINE, ui: '', theme: '' }
const subs = new Set<() => void>()
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export function applyGeneral(g: Look) {
  look = { appName: g.appName.trim() || DEFAULT_APP_NAME, appTagline: g.appTagline.trim(), ui: g.ui, theme: g.theme }
  setAppName(look.appName, look.appTagline)
  document.title = look.appName
  // data-ui / data-theme belong to the appearance store (appearance.ts), which also keeps one theme per UI
  subs.forEach((f) => f())
}

export const useAppName = () => useSyncExternalStore(subscribe, () => look.appName)

void window.api.settingsGet().then((v) => applyGeneral(v.general)).catch(() => { /* keep the defaults */ })
