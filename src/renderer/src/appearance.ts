// Appearance: the UI (which regions sit where) and the Theme (colour scheme). Each UI remembers its own theme.
// Settings -> Appearance uses getUIs / getThemes / setUI / setTheme (and AppearancePicker); so does Ctrl+K.
// Applying is live: data-ui / data-theme on <html>, nothing remounts the chats.
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from './prefs'

export type UIId = 'default' | 'workbench' | 'strip' | 'focus'
export type ThemeId = 'default' | 'mono' | 'colour' | 'light' | 'hc'

export type UIInfo = { id: UIId; label: string; description: string }
export type ThemeInfo = { id: ThemeId; label: string; description: string }

const UIS: UIInfo[] = [
  { id: 'default', label: 'Default', description: 'Threads left by project, one chat in the centre, changes and split diff on the right, tabbed bottom panel' },
  { id: 'workbench', label: 'Workbench', description: 'Activity bar with badges, stacked side bar, chats in a 2x2 grid, bottom panel, preview on the right' },
  { id: 'strip', label: 'Thread strip & dock', description: 'Thread tabs across the top grouped by state, chat columns, a dock of tools on the right' },
  { id: 'focus', label: 'Focus', description: 'One chat full width; everything else behind Ctrl+K and popovers' },
]

const THEMES: ThemeInfo[] = [
  { id: 'default', label: 'Default', description: 'Calm grey with colour only where it means something' },
  { id: 'mono', label: 'Monochrome', description: 'Grey only; meaning through weight, underline and badges' },
  { id: 'colour', label: 'Colourful', description: 'The full colour pass: roles, tool verbs and section heads in colour' },
  { id: 'light', label: 'Light', description: 'VS Code Light Modern' },
  { id: 'hc', label: 'High Contrast', description: 'VS Code Dark High Contrast' },
]

const isUI = (v: unknown): v is UIId => UIS.some((u) => u.id === v)
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

type State = { ui: UIId; themes: Record<UIId, ThemeId> }
const DEFAULT_THEMES: Record<UIId, ThemeId> = { default: 'default', workbench: 'default', strip: 'default', focus: 'default' }

function load(): State {
  const ui = getPref<string>('ui', 'default')
  const saved = getPref<Record<string, string>>('themeByUI', {})
  const themes = { ...DEFAULT_THEMES }
  for (const u of UIS) if (isTheme(saved?.[u.id])) themes[u.id] = saved[u.id] as ThemeId
  return { ui: isUI(ui) ? ui : 'default', themes }
}

let state = load()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function apply() {
  const root = document.documentElement
  root.dataset.ui = state.ui
  root.dataset.theme = state.themes[state.ui]
  // the Windows min / max / close buttons follow the theme
  requestAnimationFrame(() => {
    const cs = getComputedStyle(root)
    try { window.api.setTitleBar(cs.getPropertyValue('--titlebar').trim() || '#181818', cs.getPropertyValue('--titlebar-symbol').trim() || '#cccccc') } catch { /* older main */ }
    themeListeners.forEach((f) => f())
  })
}
// things outside React that read colours (the xterm instances) re-read them after a theme change
const themeListeners = new Set<() => void>()
export const onThemeApplied = (f: () => void) => { themeListeners.add(f); return () => { themeListeners.delete(f) } }

function set(next: State) {
  state = next
  setPref('ui', next.ui)
  setPref('themeByUI', next.themes)
  apply()
  listeners.forEach((l) => l())
}

export const getUIs = (): UIInfo[] => UIS
// every UI offers all the themes; the list is per UI so a UI could narrow it later
export const getThemes = (_ui?: UIId): ThemeInfo[] => THEMES

export function setUI(id: UIId) {
  if (!isUI(id) || id === state.ui) return
  set({ ...state, ui: id })
}
// the theme of one UI (the current one unless given); each UI keeps its own choice
export function setTheme(id: ThemeId, ui: UIId = state.ui) {
  if (!isTheme(id) || !isUI(ui)) return
  set({ ...state, themes: { ...state.themes, [ui]: id } })
}

export function useAppearance(): { ui: UIId; theme: ThemeId; themes: Record<UIId, ThemeId> } {
  const s = useSyncExternalStore(subscribe, () => state)
  return { ui: s.ui, theme: s.themes[s.ui], themes: s.themes }
}

apply()
