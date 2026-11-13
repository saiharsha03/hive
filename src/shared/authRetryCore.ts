// A turn that failed because the process's sign-in is no longer good (the account was switched under it, or its token
// could not be refreshed). A new process reads the login again, so such a turn is tried once more by itself.
export const isAuthFailure = (text: string): boolean =>
  /failed to authenticate|oauth (session|token)[^.]*?(expired|revoked|invalid)|authentication_error|invalid (api key|bearer token)|please run \/login/i.test(text)

// what a failed result said: its errors and its text
export const resultText = (r: { errors?: unknown[]; result?: unknown }): string => [...(r.errors ?? []), r.result].filter((x) => typeof x === 'string' && x).join('\n')

// one retry per thread within the gap: a login that is really broken fails the second time and says so
export const AUTH_RETRY_GAP_MS = 2 * 60_000
export const authRetryDue = (text: string, lastTried: number | undefined, now: number): boolean =>
  isAuthFailure(text) && (lastTried === undefined || now - lastTried > AUTH_RETRY_GAP_MS)

// the failure line is the same text Claude Code already put in the conversation as a reply: it is said once
export function dropEcho<T extends { kind: string }>(items: T[], why: string): T[] {
  const last = items[items.length - 1] as (T & { text?: unknown }) | undefined
  const a = typeof last?.text === 'string' ? last.text.trim() : ''
  const b = why.trim()
  return last?.kind === 'assistant' && a !== '' && b !== '' && (a === b || a.endsWith(b) || b.endsWith(a)) ? items.slice(0, -1) : items
}
