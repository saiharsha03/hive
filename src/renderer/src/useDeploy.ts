// Deploy wizard state for the app: runs the effects the pure state machine (shared/deployWizard) asks for.
import { useEffect, useRef, useState } from 'react'
import { initial, step, wizardRow, type Action, type Effect, type Wizard } from '../../shared/deployWizard'
import type { DeployConfig } from '../../shared/deployCore'
import type { LiveRow } from './background'

export function useDeploy() {
  const [w, setW] = useState<Wizard>(initial)
  const [out, setOut] = useState('')
  const logSeen = useRef({ id: '', n: 0 })
  const [cfg, setCfg] = useState<{ config: DeployConfig | null; message: string } | null>(null)
  const ref = useRef(w)
  const runPrefix = useRef('')

  const act = (a: Action) => {
    const r = step(ref.current, a)
    ref.current = r.state
    setW(r.state)
    if (r.effect) run(r.effect)
  }
  const run = (e: Effect) => {
    const msg = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    const fail = (err: unknown, from?: 'refresh' | 'watch') => act({ t: 'error', error: msg(err), ...(from ? { from } : {}) })
    if (e.kind === 'diffs' && e.forProd) {
      // entering prod: the plan comes from a fresh diffs.sh run
      window.api.deployDiffs(e.suite).then((d) => act({ t: 'diffs', diffs: d.diffs, changelog: d.changelog, output: d.output, root: d.root, at: Date.now() })).catch((err) => fail(err))
    } else if (e.kind === 'diffs') {
      // show the local refs right away, then replace them with diffs.sh's answer once it is back
      window.api.deployDiffs(e.suite, false).then((d) => {
        act({ t: 'diffs', diffs: d.diffs, changelog: d.changelog, output: d.output, root: d.root, at: Date.now(), local: true })
        // the diffs.sh refresh behind the local view fails on its own: the local plan stays usable
        window.api.deployDiffs(e.suite).then((f) => act({ t: 'refresh', diffs: f.diffs, changelog: f.changelog, output: f.output, root: f.root })).catch((err) => fail(err, 'refresh'))
      }).catch((err) => fail(err))
    } else if (e.kind === 'deploy') {
      setOut('')
      runPrefix.current = `${e.repo}-${e.target}-`
      window.api.deployRun(e.repo, e.target).catch((err) => act({ t: 'deployEnd', ok: false, message: (err as Error).message, sha: '', watchId: '', at: Date.now() }))
    } else if (e.kind === 'watch') {
      window.api.deployRewatch(e.repo, e.target, e.sha).then((id) => act({ t: 'watchId', id })).catch((err) => fail(err, 'watch'))
    } else {
      void window.api.deployDismiss(e.id)
    }
  }

  useEffect(() => {
    window.api.deployConfig().then(setCfg).catch((e) => setCfg({ config: null, message: (e as Error).message }))
    // a reload loses the wizard but not main's watchers: drop the orphans
    window.api.deployWatchers().then((ws) => ws.forEach((x) => void window.api.deployDismiss(x.id))).catch(() => {})
    const offs = [
      window.api.onDeployOut((runId, text) => { if (runId.startsWith(runPrefix.current)) setOut((o) => o + text) }),
      window.api.onDeployEnd((runId, code, message, sha, watchId) => {
        if (runId.startsWith(runPrefix.current)) act({ t: 'deployEnd', ok: code === 0, message, sha, watchId, at: Date.now() })
      }),
      window.api.onDeployWatch((list) => {
        const mine = list.find((x) => x.id === ref.current.watchId)
        if (!mine) return
        // the watch command's output goes on under the deploy output, as it comes
        if (mine.log) {
          const seen = logSeen.current.id === mine.id ? logSeen.current.n : 0
          if (mine.log.length > seen) { const more = mine.log.slice(seen); setOut((o) => o + (seen ? '' : '\n') + more) }
          logSeen.current = { id: mine.id, n: mine.log.length }
        }
        if (mine.landed) act({ t: 'watchDone', landed: true, note: mine.note, at: Date.now() })
        else if (mine.stuck) act({ t: 'watchDone', landed: false, note: mine.note, at: Date.now() })
        else act({ t: 'watchNote', note: mine.note })
      }),
    ]
    return () => offs.forEach((f) => f())
  }, [])

  const row = wizardRow(w)
  const liveRow: LiveRow | null = row ? { id: 'deploy', kind: 'deploy', title: row.title, state: row.state, note: row.note, since: 0 } : null
  return { w, out, act, liveRow, cfg }
}
