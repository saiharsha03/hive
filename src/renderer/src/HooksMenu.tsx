// Dropdown under the Hooks button: every hook with an on/off switch, grouped by settings file.
import { useEffect, useState } from 'react'

export function HooksMenu({ folder }: { folder: string }) {
  const [hooks, setHooks] = useState<HookRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = () => window.api.listHooks(folder).then(setHooks).catch((e) => setError(String(e?.message ?? e)))
  useEffect(() => { load() }, [folder])


  const toggle = async (h: HookRow) => {
    setBusy(h.id)
    setError('')
    try { await window.api.setHook(folder, h.id, !h.enabled); await load() }
    catch (e: any) { setError(String(e?.message ?? e)) }
    finally { setBusy(null) }
  }

  const scopes = ['User', 'Project', 'Local'] as const
  const on = hooks?.filter((h) => h.enabled).length ?? 0

  return (
    <div className="dropdown">
      <div className="dd-head">
        <span>Hooks</span>
        <span className="dd-count">{hooks ? `${on} on, ${hooks.length - on} off` : ''}</span>
      </div>
      {error && <div className="dd-error">{error}</div>}
      {!hooks && !error && <div className="dd-hint">Loading…</div>}
      <div className="dd-body">
        {scopes.map((scope) => {
          const rows = hooks?.filter((h) => h.scope === scope) ?? []
          if (!rows.length) return null
          return (
            <div key={scope}>
              <div className="dd-group" title={rows[0].file}>{scope} settings</div>
              {rows.map((h) => (
                <div key={h.id} className={h.enabled ? 'hk' : 'hk off'} title={h.command}>
                  <div className="hk-text">
                    <span className="hk-name">{h.name}</span>
                    <span className="hk-when">{h.event}{h.matcher && h.matcher !== '*' ? `: ${h.matcher}` : ''}</span>
                  </div>
                  <button data-testid="hooks-button-1"
                    className={h.enabled ? 'switch on' : 'switch'}
                    disabled={busy === h.id}
                    onClick={() => toggle(h)}
                    aria-label={h.enabled ? 'Turn off' : 'Turn on'}
                  >
                    <i />
                  </button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="dd-foot">Changes apply to sessions started after the switch. Plugin hooks are under Plugins.</div>
    </div>
  )
}
