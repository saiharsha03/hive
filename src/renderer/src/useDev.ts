// Dev stack state for the app: main pushes every change; running services show up as background "Working" items.
import { useEffect, useMemo, useState } from 'react'
import type { DevState } from '../../shared/devCore'
import type { LiveRow } from './background'

// One row per stack, not per service. A service shared by several stacks (helix_api) joins the stack with the most
// live services, so prevent_api + helix_api show as one HelixPrevent row. The row id lists its services
// (`dev:a,b,c`) so closing it stops all of them.
export function devRows(s: DevState | null): LiveRow[] {
  if (!s?.configured) return []
  const rows: LiveRow[] = []
  if (s.docker.phase === 'starting') rows.push({ id: 'dev:docker', kind: 'dev', title: 'Docker', state: 'working', note: s.docker.message, since: 0 })
  const live = s.services.filter((v) => v.kind === 'process' && !v.external && ['starting', 'running', 'failed'].includes(v.state))
  const left = new Set(live.map((v) => v.name))
  const count = (ids: string[]) => ids.filter((n) => left.has(n)).length
  const groups: { title: string; names: string[] }[] = []
  for (const st of [...s.stacks].sort((a, b) => count(b.services) - count(a.services))) {
    const names = st.services.filter((n) => left.has(n))
    if (!names.length) continue
    names.forEach((n) => left.delete(n))
    groups.push({ title: st.label, names })
  }
  for (const n of left) groups.push({ title: n, names: [n] })
  for (const g of groups) {
    const vs = live.filter((v) => g.names.includes(v.name))
    const failed = vs.filter((v) => v.state === 'failed')
    const id = `dev:${g.names.join(',')}`
    if (failed.length) {
      rows.push({ id, kind: 'dev', title: g.title, state: 'waiting', note: `failed: ${failed.map((v) => `${v.name} ${v.note}`).join('; ')}`, since: Math.max(...failed.map((v) => v.startedAt)) })
      continue
    }
    const starting = vs.filter((v) => v.state === 'starting').length
    const ports = vs.map((v) => (v.port ? `${v.name} :${v.port}` : v.name)).join(', ')
    rows.push({ id, kind: 'dev', title: g.title, state: 'working', note: starting ? `starting ${vs.length - starting}/${vs.length} up, ${ports}` : ports, since: 0 })
  }
  return rows
}

export function useDev() {
  const [state, setState] = useState<DevState | null>(null)
  useEffect(() => {
    window.api.devSnapshot().then(setState).catch(() => {})
    return window.api.onDevUpdate(setState)
  }, [])
  const liveRows = useMemo(() => devRows(state), [state])
  return { state, setState, liveRows }
}
