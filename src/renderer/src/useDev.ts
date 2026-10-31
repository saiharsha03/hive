// Dev stack state for the app: main pushes every change; running services show up as background "Working" items.
import { useEffect, useMemo, useState } from 'react'
import type { DevState } from '../../shared/devCore'
import type { LiveRow } from './background'

export function devRows(s: DevState | null): LiveRow[] {
  if (!s?.configured) return []
  const rows: LiveRow[] = []
  if (s.docker.phase === 'starting') rows.push({ id: 'dev:docker', kind: 'dev', title: 'Docker', state: 'working', note: s.docker.message, since: 0 })
  for (const v of s.services) {
    if (v.kind !== 'process' || v.external) continue
    const where = [v.port ? `port ${v.port}` : '', v.fromLabel].filter(Boolean).join(', ')
    if (v.state === 'starting' || v.state === 'running') rows.push({ id: `dev:${v.name}`, kind: 'dev', title: v.name, state: 'working', note: `${v.state}, ${where}`, since: 0 })
    else if (v.state === 'failed') rows.push({ id: `dev:${v.name}`, kind: 'dev', title: v.name, state: 'waiting', note: `failed: ${v.note}`, since: v.startedAt })
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
