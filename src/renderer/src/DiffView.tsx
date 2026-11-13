// One diff, side by side (default) or unified: line numbers, added / removed coloring, unchanged stretches between
// hunks collapsed into a row that shows the whole file when clicked. The split / unified choice is one app-wide
// preference, saved across restarts. With a file named, a line's "+" (on hover) opens a comment box: the comments
// collect on the diff and go to the thread as one message (DiffComments).
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { getPref, setPref } from './prefs'
import { createStore, useStore } from './store'
import { gapBefore, splitRows, type DiffLine, type Hunk } from '../../shared/diffCore'
import { commentAt, diffCommentsMessage, type DiffComment } from '../../shared/diffCommentCore'
import { Btn } from './kit'
import './diffComments.css'

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

// the comments left on the diff that is open (one diff tab, so one list); cleared when it is sent or another diff opens
export const diffComments = createStore<DiffComment[]>([])
const lineKey = (file: string, l: DiffLine) => `${file}|${l.t === '-' ? `-${l.a}` : `+${l.b}`}`
const commentKey = (c: DiffComment) => `${c.file}|${c.side === 'old' ? '-' : '+'}${c.line}`

// Send N comments to Claude (Ctrl+Enter in a comment box does the same); to: the thread the diff belongs to
export function DiffComments({ to, onSend }: { to: string | null; onSend: (text: string) => void }) {
  const list = useStore(diffComments, (c) => c)
  if (!list.length) return null
  return (
    <div className="dv-csend" data-testid="diff-comments-bar">
      <span className="dimt">{list.length} comment{list.length === 1 ? '' : 's'} on this diff</span>
      <Btn kind="link" onClick={() => diffComments.set([])} testid="diff-comments-clear">Clear</Btn>
      <Btn kind="primary" disabled={!to} title={to ? 'One message to the thread this diff came from (Ctrl+Enter)' : 'This diff was not opened from a thread'}
        onClick={() => { onSend(diffCommentsMessage(list)); diffComments.set([]) }} testid="diff-comments-send">
        Send {list.length} comment{list.length === 1 ? '' : 's'} to Claude
      </Btn>
    </div>
  )
}
let sendAll: (() => void) | null = null
export const setDiffCommentsSend = (f: (() => void) | null) => { sendAll = f }

const cls = (l: DiffLine | null) => (!l ? 'empty' : l.t === '+' ? 'add' : l.t === '-' ? 'del' : '')

export function DiffView({ hunks, onShowAll, file }: { hunks: Hunk[]; onShowAll?: () => void; file?: string }) {
  const [m] = useDiffMode()
  const all = useStore(diffComments, (c) => c)
  const [editing, setEditing] = useState<{ key: string; l: DiffLine } | null>(null)
  const [text, setText] = useState('')
  if (!hunks.length) return <div className="dv-none">No changes to show.</div>
  const cols = m === 'split' ? 4 : 3
  const mine = file ? all.filter((c) => c.file === file) : []
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
  // the number cell, with the "+" that opens a comment box on its line
  const num = (l: DiffLine | null, n: number | null | undefined) => (
    <td className={`dv-n ${cls(l)}`}>
      {file && l && <button className="dv-plus" aria-label="Comment on this line" title="Comment on this line" data-testid="diff-comment-add"
        onClick={() => { setEditing({ key: lineKey(file, l), l }); setText('') }}>+</button>}
      {n ?? ''}
    </td>
  )
  const add = () => {
    const c = file && editing ? commentAt(file, editing.l, text) : null
    if (c) diffComments.set((cur) => [...cur, c])
    setEditing(null); setText('')
    return !!c
  }
  // under a row: its comments, and the box when one of its lines is being commented on
  const below = (lines: (DiffLine | null)[], k: string): ReactNode[] => {
    if (!file) return []
    const keys = lines.filter((l): l is DiffLine => !!l).map((l) => lineKey(file, l))
    const out: ReactNode[] = mine.filter((c) => keys.includes(commentKey(c))).map((c, j) => (
      <tr key={`${k}:c${j}`} className="dv-crow"><td colSpan={cols}>
        <div className="dv-comment" data-testid="diff-comment"><span>{c.comment}</span>
          <Btn kind="link" onClick={() => diffComments.set((cur) => cur.filter((x) => x !== c))} testid="diff-comment-remove">Remove</Btn></div>
      </td></tr>
    ))
    if (editing && keys.includes(editing.key)) out.push(
      <tr key={`${k}:box`} className="dv-crow"><td colSpan={cols}>
        <textarea className="dv-cbox" autoFocus rows={2} value={text} placeholder="Comment for Claude. Enter adds it, Ctrl+Enter sends every comment, Esc cancels" data-testid="diff-comment-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
            else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); add(); sendAll?.() }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add() }
          }} />
      </td></tr>,
    )
    return out
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
                <Fragment key={j}>
                  <tr>
                    {num(r.l, r.l?.a)}
                    <td className={`dv-t ${cls(r.l)}`}>{r.l?.text ?? ''}</td>
                    {num(r.r, r.r?.b)}
                    <td className={`dv-t ${cls(r.r)}`}>{r.r?.text ?? ''}</td>
                  </tr>
                  {below([r.l, r.r], `${i}:${j}`)}
                </Fragment>
              ))
              : h.lines.map((l, j) => (
                <Fragment key={j}>
                  <tr>
                    {num(l, l.a)}
                    <td className={`dv-n ${cls(l)}`}>{l.b ?? ''}</td>
                    <td className={`dv-t ${cls(l)}`}><span className="dv-sign">{l.t}</span>{l.text}</td>
                  </tr>
                  {below([l], `${i}:${j}`)}
                </Fragment>
              ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
