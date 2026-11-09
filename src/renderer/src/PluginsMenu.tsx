// Dropdown under the Plugins button: every installed plugin with an on/off switch,
// grouped by where it came from, plus what it hooks into.
import { useEffect, useRef, useState } from 'react'
import { setClipboardOn, useClipboardOn } from './clipboardOffer'

export function PluginsMenu({ onClose }: { onClose: () => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const clipOn = useClipboardOn()

  const load = () => window.api.listPlugins().then(setPlugins).catch((e) => setError(String(e?.message ?? e)))
  useEffect(() => { load() }, [])

  // close on a click outside the menu or on Escape
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => document.addEventListener('mousedown', down))
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  const toggle = async (p: PluginInfo) => {
    setBusy(p.key)
    setError('')
    try { await window.api.setPlugin(p.key, !p.enabled); await load() }
    catch (e: any) { setError(String(e?.message ?? e)) }
    finally { setBusy(null) }
  }

  const q = query.toLowerCase()
  const shown = (plugins ?? []).filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q))
  const sources = [...new Set(shown.map((p) => p.source))]
  const on = plugins?.filter((p) => p.enabled).length ?? 0

  return (
    <div className="dropdown wide" ref={ref}>
      <div className="dd-head">
        <span>Plugins</span>
        <span className="dd-count">{plugins ? `${on} on, ${plugins.length - on} off` : ''}</span>
      </div>
      <input data-testid="plugins-input-1" className="search dd-search" placeholder="Filter plugins" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      {error && <div className="dd-error">{error}</div>}
      {!plugins && !error && <div className="dd-hint">Loading…</div>}
      <div className="dd-body">
        <div className="dd-group">Hive</div>
        <div className={clipOn ? 'hk' : 'hk off'}>
          <div className="hk-text">
            <span className="hk-name">Clipboard suggestions</span>
            <span className="hk-desc">When Hive gains focus, offer a new screenshot or copied text above the message box. Applies right away.</span>
          </div>
          <button data-testid="plugins-button-2" className={clipOn ? 'switch on' : 'switch'} onClick={() => setClipboardOn(!clipOn)} aria-label={clipOn ? 'Turn off' : 'Turn on'}>
            <i />
          </button>
        </div>
        {sources.map((source) => (
          <div key={source}>
            <div className="dd-group">{source}</div>
            {shown.filter((p) => p.source === source).map((p) => (
              <div key={p.key} className={p.enabled ? 'hk' : 'hk off'} title={p.description || p.key}>
                <div className="hk-text">
                  <span className="hk-name">{p.name}</span>
                  {p.description && <span className="hk-desc">{p.description}</span>}
                  {(p.mod || p.events.length > 0) && (
                    <span className="hk-when">{p.mod ? 'Hooks: registered in code (mod)' : `Hooks: ${p.events.join(', ')}`}</span>
                  )}
                </div>
                <button data-testid="plugins-button-3" className={p.enabled ? 'switch on' : 'switch'} disabled={busy === p.key} onClick={() => toggle(p)} aria-label={p.enabled ? 'Turn off' : 'Turn on'}>
                  <i />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="dd-foot">Changes apply to sessions started after the switch.</div>
    </div>
  )
}
