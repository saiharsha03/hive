// One diff, side by side (default) or unified: line numbers, added / removed coloring, unchanged stretches between
// hunks collapsed into a row that shows the whole file when clicked. The split / unified choice is one app-wide
// preference, saved across restarts.
import { Fragment, useEffect, useState } from 'react'
import { getPref, setPref } from './prefs'
import { gapBefore, splitRows, type DiffLine, type Hunk } from '../../shared/diffCore'

export type DiffMode = 'split' | 'unified'
const KEY = 'diffMode'
let mode: DiffMode = getPref<string>(KEY, 'split') === 'unified' ? 'unified' : 'split'
const subs = new Set<(m: DiffMode) => void>()

function useDiffMode(): [DiffMode, (m: DiffMode) => void] {
  const [m, setM] = useState(mode)
  useEffect(() => { subs.add(setM); return () => { subs.delete(setM) } }, [])
  return [m, (next) => { mode = next; setPref(KEY, next); subs.forEach((f) => f(next)) }]
}

export function DiffModeToggle() {
  const [m, setM] = useDiffMode()
  return (
    <div className="seg diffseg" role="group" aria-label="Diff layout">
      {(['split', 'unified'] as const).map((k) => (
        <button data-testid={`diff-mode-${k}`} key={k} className={m === k ? 'on' : ''} aria-pressed={m === k} onClick={() => setM(k)}>{k === 'split' ? 'Split' : 'Unified'}</button>
      ))}
    </div>
  )
}

const cls = (l: DiffLine | null) => (!l ? 'empty' : l.t === '+' ? 'add' : l.t === '-' ? 'del' : '')

export function DiffView({ hunks, onShowAll }: { hunks: Hunk[]; onShowAll?: () => void }) {
  const [m] = useDiffMode()
  if (!hunks.length) return <div className="dv-none">No changes to show.</div>
  const cols = m === 'split' ? 4 : 3
  const gap = (i: number) => {
    const n = gapBefore(hunks, i)
    if (!n) return null
    return (
      <tr className="dv-gap">
        <td colSpan={cols}>
          {onShowAll ? <button data-testid="diffview-button-1" onClick={onShowAll}>{n} unchanged line{n === 1 ? '' : 's'} (show whole file)</button> : <span>{n} unchanged line{n === 1 ? '' : 's'}</span>}
        </td>
      </tr>
    )
  }
  return (
    <table data-testid="diff-table" className={`dv ${m}`}>
      {m === 'split' && <colgroup><col className="dv-nc" /><col /><col className="dv-nc" /><col /></colgroup>}
      {m === 'unified' && <colgroup><col className="dv-nc" /><col className="dv-nc" /><col /></colgroup>}
      <tbody>
        {hunks.map((h, i) => (
          <Fragment key={i}>
            {gap(i)}
            {m === 'split'
              ? splitRows(h).map((r, j) => (
                <tr key={j}>
                  <td className={`dv-n ${cls(r.l)}`}>{r.l?.a ?? ''}</td>
                  <td className={`dv-t ${cls(r.l)}`}>{r.l?.text ?? ''}</td>
                  <td className={`dv-n ${cls(r.r)}`}>{r.r?.b ?? ''}</td>
                  <td className={`dv-t ${cls(r.r)}`}>{r.r?.text ?? ''}</td>
                </tr>
              ))
              : h.lines.map((l, j) => (
                <tr key={j}>
                  <td className={`dv-n ${cls(l)}`}>{l.a ?? ''}</td>
                  <td className={`dv-n ${cls(l)}`}>{l.b ?? ''}</td>
                  <td className={`dv-t ${cls(l)}`}><span className="dv-sign">{l.t}</span>{l.text}</td>
                </tr>
              ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
