// Dev stack state for the app: main pushes every change. Stacks live in their own bottom-panel tab, never as
// sidebar or Agents rows.
import { useEffect, useState } from 'react'
import type { DevState } from '../../shared/devCore'

export function useDev() {
  const [state, setState] = useState<DevState | null>(null)
  useEffect(() => {
    window.api.devSnapshot().then(setState).catch(() => {})
    return window.api.onDevUpdate(setState)
  }, [])
  return { state, setState }
}
