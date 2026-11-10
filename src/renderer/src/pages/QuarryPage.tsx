// Quarry: the user's SQL app, its own UI inside Hive. Main runs `quarry serve` and serves the UI from quarry://app/;
// the view is a <webview> whose preload (src/preload/quarry.ts) gives the UI its window.quarryHost bridge. Main fixes
// the view's source, preload and settings, and answers Quarry calls only from it. The page exists only when Quarry is
// installed and usable (the rail link and the palette entry follow useQuarry).
import { createElement, useEffect, useRef, useState } from 'react'
import { Unavailable } from '../kit'
import { useAppearance } from '../appearance'
import { quarryFonts, quarryTheme } from './quarryCore'

type QuarryStatus = Awaited<ReturnType<Window['api']['quarryStatus']>>

// whether Quarry is there, kept current (Settings can change the exe; main says when it does)
export function useQuarry(): QuarryStatus | null {
  const [s, setS] = useState<QuarryStatus | null>(null)
  useEffect(() => {
    if (!window.api.quarryStatus) return
    let live = true
    void window.api.quarryStatus().then((x) => { if (live) setS(x) }).catch(() => {})
    const off = window.api.onQuarryChanged((x) => setS(x))
    return () => { live = false; off() }
  }, [])
  return s
}

type View = HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }

export function QuarryPage() {
  const s = useQuarry()
  const look = useAppearance()
  const theme = quarryTheme(look.theme)
  const fonts = quarryFonts(look.fonts)
  // the view starts with the theme and fonts Hive has now (in its address, for the bridge); the address is fixed for
  // the view's life, so a later change in Settings > Appearance is sent in with Quarry's own setters
  const [start] = useState(() => ({ theme, fonts }))
  const view = useRef<View | null>(null)
  const ready = useRef(false)
  useEffect(() => {
    const v = view.current
    if (!v) return
    const onReady = () => { ready.current = true }
    v.addEventListener('dom-ready', onReady)
    return () => v.removeEventListener('dom-ready', onReady)
  }, [s?.available])
  useEffect(() => {
    if (!ready.current || !view.current?.executeJavaScript) return
    const code = `window.quarrySetTheme?.(${JSON.stringify(theme)}); window.quarrySetFonts?.(${JSON.stringify(fonts)}); void 0`
    void view.current.executeJavaScript(code).catch(() => {})
  }, [theme, fonts.ui, fonts.code]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <div className="page" data-testid="page-quarry" />
  if (!s.available) return <div className="page" data-testid="page-quarry"><Unavailable reason={`Quarry is not available: ${s.reason}. Set its path in Settings > General.`} /></div>
  const src = `quarry://app/?theme=${encodeURIComponent(start.theme)}&ui=${encodeURIComponent(start.fonts.ui)}&code=${encodeURIComponent(start.fonts.code)}`
  return (
    <div className="page quarry-page" data-testid="page-quarry" style={{ padding: 0, display: 'flex' }}>
      {createElement('webview', { ref: view, src, style: { flex: 1, border: 0, width: '100%', height: '100%' }, 'data-testid': 'quarry-view' })}
    </div>
  )
}
