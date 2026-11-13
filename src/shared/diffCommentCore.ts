// Comments left on diff lines (the "+" beside a line), sent to the thread as one message: each one quotes its file and
// line and the line's text, then says what to do about it.
import type { DiffLine } from './diffCore'

export type DiffComment = { file: string; line: number; side: 'old' | 'new'; text: string; comment: string }

// the line a comment is about: a removed line by its old number, any other by its new one
export function commentAt(file: string, l: DiffLine, comment: string): DiffComment | null {
  const old = l.t === '-'
  const line = old ? l.a : l.b
  if (line == null || !comment.trim()) return null
  return { file, line, side: old ? 'old' : 'new', text: l.text, comment: comment.trim() }
}

export function diffCommentsMessage(list: DiffComment[]): string {
  if (!list.length) return ''
  const one = (c: DiffComment) => [
    `${c.file}:${c.line}${c.side === 'old' ? ' (removed line)' : ''}`,
    `> ${c.text}`,
    c.comment,
  ].join('\n')
  return [`Comments on the diff (${list.length}):`, ...list.map(one)].join('\n\n')
}
