// What the phone app's Teams, background-work and Wake-ups screens show, shaped from the desktop's own state. Pure, so
// it can be tested without Electron; the relay ops in mobile.ts send these as they are.
import type { LogEntry, MemberStatus, Team } from './teamCore'
import { kindLabel, taskHeading, type Task } from './taskCore'
import type { AskQuestion } from './askCore'
import type { PhoneThread } from './threadsCore'

export type PhoneMember = { id: string; open: string; name: string; role: string; state: string }
export type PhoneTeam = { id: string; name: string; goal: string; word: 'WORKING' | 'IDLE' | 'PAUSED'; members: PhoneMember[]; posts: { from: string; text: string; at: number }[] }

// running teams, newest first; open = the id the phone's thread request takes (the live tab when the thread runs, else
// its Claude session); the last few posts of the team log
export function phoneTeams(teams: Team[], view: (t: Team) => { states: Record<string, MemberStatus>; log: LogEntry[]; liveId: (id: string) => string | null }, posts = 5): PhoneTeam[] {
  return teams.filter((t) => !t.endedAt).sort((a, b) => b.createdAt - a.createdAt).map((t) => {
    const v = view(t)
    const people = [{ id: t.lead.id, name: 'Lead', role: 'lead', sessionId: t.lead.sessionId }, ...t.members]
    const members = people.map((p) => ({
      id: p.id, open: v.liveId(p.id) ?? p.sessionId ?? p.id, name: p.name, role: p.role, state: v.states[p.id]?.state ?? 'closed',
    }))
    const word = t.pausedAt ? 'PAUSED' : members.some((m) => m.state === 'working') ? 'WORKING' : 'IDLE'
    return { id: t.id, name: t.name, goal: t.goal, word, members, posts: v.log.slice(-posts).map((e) => ({ from: e.fromName, text: e.text.slice(0, 500), at: e.at })) }
  })
}

// a thread's running background work with its live line
export const phoneTasks = (tasks: Task[]): { id: string; kind: string; title: string; now: string }[] =>
  tasks.filter((t) => t.status === 'running').map((t) => ({ id: t.id, kind: kindLabel(t.kind), title: /workflow/.test(t.kind) ? taskHeading(t) : t.name ? `${t.name}: ${t.title}` : t.title, now: t.now ?? '' }))

export type PhoneWakeup = { kind: 'wake' | 'continue'; id: string; open: string; title: string; at: number; prompt: string; every: number | null }
type WakeRow = { id: number; session_id: string; title: string; wake_at: string; prompt: string; every_minutes: number | null; status: string }

// every scheduled wake-up, soonest first: a thread's own (schedule_wakeup) and the usage-limit auto-continues
export function phoneWakeups(rows: WakeRow[], continues: { key: string; title: string; at: number }[]): PhoneWakeup[] {
  const own = rows.filter((r) => r.status === 'pending').map((r) => ({
    kind: 'wake' as const, id: String(r.id), open: r.session_id, title: r.title || 'Thread', at: Date.parse(r.wake_at), prompt: r.prompt.slice(0, 300), every: r.every_minutes,
  }))
  const cont = continues.map((c) => ({ kind: 'continue' as const, id: c.key, open: c.key, title: c.title, at: c.at, prompt: 'Continue after the usage limit resets', every: null }))
  return [...own, ...cont].filter((w) => Number.isFinite(w.at)).sort((a, b) => a.at - b.at)
}

// ---- 2.0 app: the Needs me inbox, Running across threads, answers from a notification ----

export type PhoneAsk = { id: string; questions: AskQuestion[] }
// a thread right now, as far as the phone's inbox and notifications need it
export type PhonePeek = { working: boolean; asks: PhoneAsk[] }
export type PhoneRunning = { thread: string; threadTitle: string; id: string; kind: string; title: string; now: string; state: 'working' | 'failed' }
export type PhoneFail = { thread: string; title: string; note: string; at: number }
// ask: a question that one tap can answer (one question, one choice); options are its labels
export type PhoneNeed = { kind: 'waiting' | 'failed'; thread: string; title: string; note: string; at: number; ask?: { id: string; question: string; options: string[] } }
export type PhoneAccount = { id: string; name: string; detail: string; note: string; inUse: boolean }
export type QuietHours = { on: boolean; from: string; to: string }

// The one question a single tap can answer: the thread has exactly one open ask, with one question that takes one
// choice. Anything else (several questions, pick-many) needs the question card, so it gets none.
export function oneTapAsk(asks: PhoneAsk[]): { id: string; question: string; options: string[] } | null {
  if (asks.length !== 1 || asks[0].questions.length !== 1) return null
  const q = asks[0].questions[0]
  if (q.multiSelect || !q.options.length) return null
  return { id: asks[0].id, question: q.question, options: q.options.map((o) => o.label) }
}

// What needs the user, most pressing first: threads waiting for an answer, then threads that failed and were not
// looked at since; and what is coming up (the next wake-ups and auto-continues).
export function phoneInbox(threads: PhoneThread[], asks: Record<string, PhoneAsk[]>, fails: PhoneFail[], wakeups: PhoneWakeup[], now: number, comingMax = 5): { needs: PhoneNeed[]; coming: PhoneWakeup[] } {
  const waiting: PhoneNeed[] = threads.filter((t) => t.state === 'waiting').map((t) => {
    const ask = oneTapAsk(asks[t.id] ?? [])
    return { kind: 'waiting' as const, thread: t.id, title: t.title, note: t.note || ask?.question || 'Needs your input', at: t.updated, ...(ask ? { ask } : {}) }
  })
  // a thread that failed and is now waiting or working again is not a failure any more
  const busy = new Set(threads.filter((t) => t.state !== 'idle').map((t) => t.id))
  const failed: PhoneNeed[] = fails.filter((f) => !busy.has(f.thread)).sort((a, b) => b.at - a.at).map((f) => ({ kind: 'failed' as const, thread: f.thread, title: f.title, note: f.note, at: f.at }))
  return { needs: [...waiting, ...failed], coming: wakeups.filter((w) => w.at >= now - 60_000).slice(0, comingMax) }
}

// ---- answering from a notification ----
// A notification's buttons work while the app is locked, with the notification key and no fingerprint. So they may
// only do what is safe from a phone someone else could be holding unlocked: stop a thread, or pick a choice that
// holds back, declines or asks to see more. Every other choice ("Promote now", "Yes", "Delete the branch") opens the
// app, and its fingerprint, instead. So a choice is taken from a button only when it starts like one that holds back
// AND names nothing that acts ("Wait for the freeze, then promote" still promotes). Orbit checks again on arrival.
const HOLDS = /^\s*(no\b|not\b|wait|later|hold|pause|stop|cancel|skip|don'?t\b|do not\b|show\b|explain|summar|review|neither|none\b|nothing|leave\b|keep (it|this|that|as)\b|let me\b|ask me\b|i'?ll\b)/i
const ACTS = /\b(deploy\w*|promot\w*|ship\w*|releas\w*|publish\w*|push\w*|merg\w*|rebas\w*|forc\w*|delet\w*|remov\w*|drop\w*|destroy\w*|wip\w*|reset\w*|overwrit\w*|rm|prod|production|migrat\w*|pay\w*|send\w*|email\w*|buy|purchas\w*|charg\w*|refund\w*|grant\w*|install\w*|upgrad\w*|then|and then|after that)\b/i
export const riskyChoice = (label: string): boolean => !HOLDS.test(label) || ACTS.test(label)

// what a notification for this thread may offer: the one-tap question's choices (open: that one opens the app) and Stop
export type NoteActions = { ask?: { id: string; opts: { l: string; open?: true }[] }; stop?: true }
export function noteActions(peek: PhonePeek | null, maxOpts = 3, maxLabel = 40): NoteActions {
  if (!peek) return {}
  const ask = oneTapAsk(peek.asks)
  // a label too long for a button, or more choices than fit: the card in the app is the place to answer
  if (ask && ask.options.length <= maxOpts && ask.options.every((l) => l.length <= maxLabel)) {
    return { ask: { id: ask.id, opts: ask.options.map((l) => (riskyChoice(l) ? { l, open: true as const } : { l })) } }
  }
  return peek.working && !peek.asks.length ? { stop: true } : {}
}

// An answer that came sealed with the notification key: taken only for the thread's one open one-tap question, with
// one of its own labels, and never a risky one. Returns what to hand the ask, or why not.
export function limitedAnswer(peek: PhonePeek | null, askId: string, label: string): { answers: Record<string, string> } | { refused: string } {
  const ask = peek ? oneTapAsk(peek.asks) : null
  if (!ask || ask.id !== askId) return { refused: 'That question is no longer open' }
  if (!ask.options.includes(label)) return { refused: 'That is not one of the choices' }
  if (riskyChoice(label)) return { refused: 'That choice needs the app to be opened' }
  return { answers: { [ask.question]: label } }
}

// what kind of notification a title is (chat.ts writes "Question: ...", "Failed: ..." and so on): the app rings
// through quiet hours only for failures
export type NoteKind = 'ask' | 'fail' | 'done' | 'limit' | 'note'
export function noteKind(title: string): NoteKind {
  if (/^(Question|Waiting):/.test(title)) return 'ask'
  if (/^Failed:/.test(title)) return 'fail'
  if (/^Finished:/.test(title)) return 'done'
  if (/^Usage limit:/.test(title)) return 'limit'
  return 'note'
}

// ---- wake-ups on thread rows, and the usage guard ----

// A thread with a wake-up or an auto-continue pending says so on its row (WAKES 14:00, CONTINUES 15:00) in place of
// its age: the time of the next one. A wake-up names its thread by session id, which is a saved thread's id; a thread
// that is open has a tab id instead, so it is matched by its title when exactly one thread has it.
export type PhoneThreadRow = PhoneThread & { wakes?: number; continues?: number }
export function withWakes(threads: PhoneThread[], wakeups: PhoneWakeup[]): PhoneThreadRow[] {
  const titles = new Map<string, number>()
  for (const t of threads) titles.set(t.title, (titles.get(t.title) ?? 0) + 1)
  return threads.map((t) => {
    // by id first (the thread's tab or its Claude session); a title only when no id is known and exactly one thread has it
    const mine = wakeups.filter((w) => w.open === t.id || (!!t.sessionId && w.open === t.sessionId) || (t.sessionId === undefined && w.title === t.title && titles.get(t.title) === 1))
    const wake = mine.find((w) => w.kind === 'wake')
    const cont = mine.find((w) => w.kind === 'continue')
    return { ...t, ...(wake ? { wakes: wake.at } : {}), ...(cont ? { continues: cont.at } : {}) }
  })
}

// The usage guard: the plan window closest to its limit once one is at 85% or more. fullAt: when it reaches 100% if
// it goes on as it has since the window opened, when that is before it resets (else null: it will last).
export type GuardRow = { key: string; label: string; pct: number; resetsAt: string | null }
export type UsageGuard = { key: string; window: string; pct: number; resetAt: number; fullAt: number | null }
export const GUARD_AT = 85
const windowMs = (key: string): number | null => (key.startsWith('five_hour') ? 5 * 3_600_000 : key.startsWith('seven_day') ? 7 * 86_400_000 : null)
// "5-hour window", "7-day window", "7-day Opus window"
export function windowName(key: string): string {
  if (key.startsWith('five_hour')) return '5-hour window'
  const model = key.replace(/^seven_day_?/, '')
  return key.startsWith('seven_day') ? `7-day ${model ? `${model[0].toUpperCase()}${model.slice(1)} ` : ''}window` : 'plan window'
}
export function usageGuard(rows: GuardRow[], now: number, at = GUARD_AT): UsageGuard | null {
  const near = rows.filter((r) => r.pct >= at && r.resetsAt && Date.parse(r.resetsAt) > now).sort((a, b) => b.pct - a.pct)[0]
  if (!near) return null
  const resetAt = Date.parse(near.resetsAt as string)
  const len = windowMs(near.key)
  const full = len && near.pct < 100 ? resetAt - len + ((now - (resetAt - len)) * 100) / near.pct : null
  return { key: near.key, window: windowName(near.key), pct: Math.floor(near.pct), resetAt, fullAt: full !== null && full > now && full < resetAt ? Math.round(full) : null }
}
// the guard as a notification: which window, how full, when it fills, what pauses and when it carries on
export function guardNote(g: UsageGuard, working: number, clock: (ms: number) => string): { title: string; body: string } {
  const fills = g.pct >= 100 ? 'It is full. ' : g.fullAt ? `Fills about ${clock(g.fullAt)}. ` : ''
  const then = working > 0 ? `${working} working ${working === 1 ? 'thread pauses' : 'threads pause'} then and ${working === 1 ? 'continues' : 'continue'} at ${clock(g.resetAt)}.` : `It resets at ${clock(g.resetAt)}.`
  return { title: `${g.window[0].toUpperCase()}${g.window.slice(1)} at ${g.pct}%`, body: fills + then }
}
// said once when a window passes 85% and once more at 95%, per window and reset
export const guardStep = (g: UsageGuard): string => `${g.key}:${g.resetAt}:${g.pct >= 95 ? 95 : GUARD_AT}`
