// The Board's Jira read: the signed-in user's tickets from Jira Cloud's REST API. GET only; nothing here writes to Jira.
// The token (HIVE_TRACKER_TOKEN in the .env, or the file HIVE_TRACKER_TOKEN_FILE names) stays in this process: the page
// gets cards. Nothing is logged: not the token, the Authorization header or a response body. Test mode makes no call.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { blocked, TEST_MODE } from './testMode'
import { buildJql, fetchFailure, httpError, mapIssue, MAX_PAGES, searchUrl, trackerConfig, type Board, type Card } from '../shared/trackerCore'

const TIMEOUT_MS = 15_000

let env: Record<string, string> = {}
export function initTracker(e: Record<string, string>): void { env = e }

export async function trackerBoard(): Promise<Board> {
  const cfg = trackerConfig(env)
  if (!cfg.ok) return { state: 'unset', message: cfg.message }
  if (TEST_MODE) return { state: 'error', message: blocked('the Jira fetch') }
  let token = cfg.token
  if (!token) {
    try { token = readFileSync(cfg.tokenFile.replace(/^~(?=$|[\\/])/, homedir()), 'utf8').trim() } catch { return { state: 'error', message: `The API token file ${cfg.tokenFile} could not be read.` } }
    if (!token) return { state: 'error', message: `The API token file ${cfg.tokenFile} is empty.` }
  }
  const headers = { Authorization: `Basic ${Buffer.from(`${cfg.email}:${token}`).toString('base64')}`, Accept: 'application/json' }
  const cards: Card[] = []
  let next = '', more = false
  try {
    for (let page = 0; ; page++) {
      if (page === MAX_PAGES) { more = true; break }
      // redirect: 'error' so the token only ever goes to the configured site
      const r = await fetch(searchUrl(cfg.origin, buildJql(), next), { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!r.ok) return { state: 'error', message: httpError(r.status, await r.text().catch(() => '')) }
      const j = (await r.json()) as { issues?: unknown; nextPageToken?: unknown }
      for (const i of Array.isArray(j.issues) ? j.issues : []) { const c = mapIssue(i, cfg.origin); if (c) cards.push(c) }
      next = typeof j.nextPageToken === 'string' ? j.nextPageToken : ''
      if (!next) break
    }
  } catch (e) {
    return { state: 'error', message: fetchFailure((e as Error)?.name ?? '', cfg.origin, TIMEOUT_MS / 1000) }
  }
  return { state: 'ok', cards, at: Date.now(), more }
}
