// A thread's /goal: what it is, since when, and whether it is met. The SDK sends no live goal event;
// the "/goal" replies arrive as synthetic assistant text, and the met / not-met verdicts are written to the
// session transcript as goal_status attachments. Pure, so it can be tested without Electron.

export type Goal = {
  condition: string
  status: 'active' | 'met'
  setAt: number // Orbit's own clock when "Goal set:" arrived, or the transcript time for a resumed session
  metAt?: number
  reason?: string // the evaluator's last reason (met, or not yet met)
  iterations?: number
}

export type GoalReply =
  | { kind: 'set'; condition: string }
  | { kind: 'cleared'; condition: string }
  | { kind: 'none' }
  | { kind: 'active'; condition: string; note?: string; full?: string } // full: the text with its last "(...)", which may be the condition's own

// "Goal set: X" / "Goal cleared: X" / "No goal set…" / "Goal active: X (not yet evaluated)"
export function parseGoalReply(text: string): GoalReply | null {
  const t = text.trim()
  let m = t.match(/^Goal set:\s*([\s\S]+)$/)
  if (m) return { kind: 'set', condition: m[1].trim() }
  m = t.match(/^Goal cleared:\s*([\s\S]+)$/)
  if (m) return { kind: 'cleared', condition: m[1].trim() }
  if (/^No goal set\b/.test(t)) return { kind: 'none' }
  m = t.match(/^Goal active:\s*([\s\S]+?)(?:\s+\(([^()]*)\))?$/)
  if (m) return { kind: 'active', condition: m[1].trim(), note: m[2], ...(m[2] === undefined ? {} : { full: t.replace(/^Goal active:\s*/, '') }) }
  return null
}

export type GoalStatus = { met: boolean; sentinel?: boolean; condition: string; reason?: string; iterations?: number }
export type GoalMark = { status: GoalStatus; at: number }

// goal_status attachments in transcript lines (JSONL); partial or foreign lines are skipped
export function goalMarks(lines: string[]): GoalMark[] {
  const out: GoalMark[] = []
  for (const line of lines) {
    if (!line.includes('"goal_status"')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    const a = e?.attachment
    if (e?.type !== 'attachment' || a?.type !== 'goal_status' || typeof a.condition !== 'string') continue
    const at = Date.parse(e.timestamp)
    out.push({ status: { met: !!a.met, sentinel: !!a.sentinel, condition: a.condition, reason: a.reason, iterations: a.iterations }, at: Number.isFinite(at) ? at : Date.now() })
  }
  return out
}

// One event into the goal. Transcript marks: sentinel + not met = set, sentinel + met = cleared,
// no sentinel = the evaluator's verdict (met, or not yet met with a reason).
export type GoalEvent =
  | { t: 'reply'; reply: GoalReply; now: number }
  | { t: 'mark'; mark: GoalMark }
  | { t: 'active_goal'; value: { condition: string; iterations: number; set_at: number; last_reason?: string } | null }

export function goalReduce(prev: Goal | null, ev: GoalEvent): Goal | null {
  if (ev.t === 'reply') {
    const r = ev.reply
    if (r.kind === 'none' || r.kind === 'cleared') return null
    if (r.kind === 'set') return { condition: r.condition, status: 'active', setAt: ev.now }
    // "Goal active": still running; keep our own start time when it is the same goal. A condition that itself ends
    // in "(...)" ("tests pass (all of them)") is the same goal too: the reply's last parenthesis is then not a note
    if (prev && (prev.condition === r.condition || prev.condition === r.full)) return { ...prev, status: 'active' }
    return { condition: r.condition, status: 'active', setAt: ev.now }
  }
  if (ev.t === 'active_goal') {
    const v = ev.value
    if (!v) return null
    const same = prev && prev.condition === v.condition
    return { condition: v.condition, status: 'active', setAt: same ? prev!.setAt : v.set_at, iterations: v.iterations, reason: v.last_reason }
  }
  const { status: s, at } = ev.mark
  const same = prev && prev.condition === s.condition
  if (s.sentinel && s.met) return same || !prev ? null : prev // cleared
  if (s.sentinel) return same && prev!.status === 'active' ? prev : { condition: s.condition, status: 'active', setAt: at }
  if (s.met) return { condition: s.condition, status: 'met', setAt: same ? prev!.setAt : at, metAt: at, reason: s.reason, iterations: s.iterations }
  return { condition: s.condition, status: 'active', setAt: same ? prev!.setAt : at, reason: s.reason, iterations: s.iterations }
}

// a whole transcript on resume: only a goal still running is worth showing, not one met long ago
export function goalOnResume(marks: GoalMark[]): Goal | null {
  const g = marks.reduce<Goal | null>((p, mark) => goalReduce(p, { t: 'mark', mark }), null)
  return g?.status === 'active' ? g : null
}
