// Dropdown under the "MCP servers" button: every MCP server the active tab's session sees (or, with no running
// session, the idle status process), with its status and how many tools it gives.
import { useEffect, useState } from 'react'

const ORDER: Record<string, number> = { failed: 0, 'needs-auth': 1, pending: 2, connected: 3, disabled: 4 }
const WORD: Record<string, string> = { connected: 'connected', failed: 'failed', 'needs-auth': 'needs sign-in', pending: 'connecting', disabled: 'off' }

export function McpMenu({ tabId }: { tabId: string | null | undefined }) {
  const [servers, setServers] = useState<McpServerRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.chatMcp(tabId ?? undefined).then(setServers).catch((e) => setError(String(e?.message ?? e)))
  }, [tabId])


  const rows = (servers ?? []).slice().sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.name.localeCompare(b.name))
  const connected = rows.filter((s) => s.status === 'connected').length

  return (
    <div data-testid="mcp-menu" className="dropdown wide">
      <div className="dd-head">
        <span>MCP servers</span>
        <span className="dd-count">{servers ? `${connected} of ${rows.length} connected` : ''}</span>
      </div>
      {error && <div className="dd-error">{error}</div>}
      {!servers && !error && <div className="dd-hint">Loading…</div>}
      <div className="dd-body">
        {rows.map((s) => (
          <div data-testid="mcp-server" key={s.name} className={s.status === 'disabled' ? 'hk off' : 'hk'} title={s.error || s.name}>
            <div className="hk-text">
              <span className="hk-name">{s.name}</span>
              <span className="hk-when">{[s.source, s.tools != null ? `${s.tools} tool${s.tools === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>
              {s.error && <span className="hk-desc">{s.error}</span>}
            </div>
            <span className={`mcp-st ${s.status}`}>{WORD[s.status] ?? s.status}</span>
          </div>
        ))}
      </div>
      <div className="dd-foot">From the active tab's running session, else as a new session would load them.</div>
    </div>
  )
}
