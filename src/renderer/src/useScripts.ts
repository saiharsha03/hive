// Scripts state for the app: main pushes every change. A running script is a background "Working" item; a run that
// finished and found its report opens that file in the preview panel once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { elapsed, type ScriptRun } from '../../shared/scriptsCore'
import type { LiveRow } from './background'

export const scriptRows = (runs: ScriptRun[]): LiveRow[] => runs.filter((r) => r.phase === 'running').map((r) => ({
  id: `script:${r.name}`, kind: 'script', title: `${r.name}: ${r.label}`, state: 'working', note: `running ${elapsed(Date.now() - r.startedAt)}`, since: 0,
}))

export function useScripts(onOpen: (path: string) => void) {
  const [runs, setRuns] = useState<ScriptRun[]>([])
  const shown = useRef(new Set<string>())
  useEffect(() => {
    // runs that finished before this page loaded do not pop open again
    window.api.scriptsState().then((all) => { for (const r of all) shown.current.add(r.id); setRuns(all) }).catch(() => {})
    return window.api.onScriptsUpdate(setRuns)
  }, [])
  useEffect(() => {
    for (const r of runs) if (r.opened && !shown.current.has(r.id)) { shown.current.add(r.id); onOpen(r.opened) }
  }, [runs])
  const liveRows = useMemo(() => scriptRows(runs), [runs])
  return { runs, liveRows }
}
