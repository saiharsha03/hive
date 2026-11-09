// Questions Claude asked through AskUserQuestion, waiting for the user's answer (the thread's card or the phone).
import type { AskQuestion } from '../shared/askCore'
import { cleanAnswers } from '../shared/askCore'

export type AskEnd = { kind: 'answers'; answers: Record<string, string> } | { kind: 'chat' } | { kind: 'cancelled' }
type Pending = { tabId: string; id: string; questions: AskQuestion[]; done: (e: AskEnd) => void }
const pending = new Map<string, Pending>() // by tool use id

// waits until the user answers, replies in the chat instead, or the turn is stopped (signal)
export function waitForAnswer(tabId: string, id: string, questions: AskQuestion[], signal: AbortSignal): Promise<AskEnd> {
  return new Promise((resolve) => {
    const done = (e: AskEnd) => { if (pending.get(id)?.done !== done) return; pending.delete(id); signal.removeEventListener('abort', onAbort); resolve(e) }
    const onAbort = () => done({ kind: 'cancelled' })
    pending.set(id, { tabId, id, questions, done })
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true })
  })
}

// the user's answer; false when that question is no longer open in that thread or an answer is missing
export function answerAsk(tabId: string, id: string, raw: unknown): boolean {
  const p = pending.get(id)
  if (!p || p.tabId !== tabId) return false
  const answers = cleanAnswers(p.questions, raw)
  if (!answers) return false
  p.done({ kind: 'answers', answers })
  return true
}

// the user wrote in the chat instead: every open question of that thread ends so Claude reads the message
export function replyInChat(tabId: string): void { for (const p of [...pending.values()]) if (p.tabId === tabId) p.done({ kind: 'chat' }) }
export function cancelAsks(tabId: string): void { for (const p of [...pending.values()]) if (p.tabId === tabId) p.done({ kind: 'cancelled' }) }

// a thread's open questions (the phone shows them)
export const openAsks = (tabId: string) => [...pending.values()].filter((p) => p.tabId === tabId).map((p) => ({ id: p.id, questions: p.questions }))
