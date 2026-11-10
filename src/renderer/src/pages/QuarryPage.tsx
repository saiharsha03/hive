// Quarry: the user's SQL app, its own UI inside Hive. Main runs `quarry serve` and serves the UI from quarry://app/;
// the view is a <webview> whose preload (src/preload/quarry.ts) gives the UI its window.quarryHost bridge. Main fixes
// the view's source, preload and settings, and answers Quarry calls only from it. The page exists only when Quarry is
// installed and usable (the rail link and the palette entry follow useQuarry).
import { createElement, useEffect, useState } from 'react'
import { Unavailable } from '../kit'
import { quarryTheme } from './quarryCore'

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

export function QuarryPage() {
  const s = useQuarry()
  if (!s) return <div className="page" data-testid="page-quarry" />
  if (!s.available) return <div className="page" data-testid="page-quarry"><Unavailable reason={`Quarry is not available: ${s.reason}. Set its path in Settings > General.`} /></div>
  // the theme is read once when the view starts (Quarry's bridge); the fonts are Hive's (the preload sets them)
  const theme = quarryTheme(document.documentElement.dataset.theme)
  return (
    <div className="page quarry-page" data-testid="page-quarry" style={{ padding: 0, display: 'flex' }}>
      {createElement('webview', { src: `quarry://app/?theme=${encodeURIComponent(theme)}`, style: { flex: 1, border: 0, width: '100%', height: '100%' }, 'data-testid': 'quarry-view' })}
    </div>
  )
}
