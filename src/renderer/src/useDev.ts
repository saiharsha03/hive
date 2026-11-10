// Dev stack state for the app: main pushes every change. Stacks live in their own bottom-panel tab, never as
// sidebar or Agents rows.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevState } from '../../shared/devCore'

export function useDev() {
  const [state, set] = useState<DevState | null>(null)
  // the Stacks tab asks again every 3 s: an answer that changes nothing does not re-render the app
  const last = useRef('')
  const setState = useCallback((s: DevState) => { const j = JSON.stringify(s); if (j === last.current) return; last.current = j; set(s) }, [])
  useEffect(() => {
    window.api.devSnapshot().then(setState).catch(() => {})
    return window.api.onDevUpdate(setState)
  }, [setState])
  return { state, setState }
}
