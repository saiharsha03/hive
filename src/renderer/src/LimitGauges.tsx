// The plan's usage limits at the foot of the rail: one small vertical level per window, filling upward as it is used.
// A thin tick marks how much of the window's time has passed, so a level above its tick is spending ahead of the clock
// (it turns the wait colour). Each level says its numbers on hover; a click opens the Usage page.
import { useEffect, useState } from 'react'
import { gaugeOf, type UsageRow } from '../../shared/limitsCore'

export function LimitGauges({ onOpen }: { onOpen: () => void }) {
  const [rows, setRows] = useState<UsageRow[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    const load = () => void window.api.getStatus().then((s) => { if (alive) { setRows(s?.usage ?? []); setNow(Date.now()) } }).catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!rows.length) return null
  const gauges = rows.map((u) => gaugeOf(u, now))
  return (
    <button type="button" className="lim" onClick={onOpen} aria-label={`Usage limits. ${gauges.map((g) => g.says).join('. ')}`} data-testid="rail-limits">
      {gauges.map((g) => (
        <span key={g.key} className={`lim-c${g.ahead ? ' ahead' : ''}`} title={g.says} data-testid={`rail-limit-${g.key}`}>
          <span className="lim-n">{Math.round(g.used)}</span>
          <span className="lim-g">
            <i style={{ height: `${g.used}%` }} />
            {g.passed !== null && <u style={{ bottom: `${g.passed}%` }} />}
          </span>
          <span className="lim-k">{g.short}</span>
        </span>
      ))}
    </button>
  )
}
