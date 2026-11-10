// Which public IPs the allowlist command has succeeded for (hive-allowlist.json), and whether the IP now is one of them.
// Moving between two known places (home, office) is no change; only an address never allowed, or one whose trust ran
// out (HIVE_ALLOWLIST_TRUST_HOURS, for rules that expire on the remote side; empty = no expiry), lights the button.
// A public IP that could not be read is its own state, not a change. Pure: the file text and the clock are passed in.
export type Known = { ip: string; at: string } // at: when the command last succeeded for it (ISO)
export type AllowFile = { known: Known[] }

// the saved file in either format: { known: [...] }, or the old single { ip, at }
export function readKnown(text: string | null): Known[] {
  if (!text) return []
  let j: any
  try { j = JSON.parse(text) } catch { return [] }
  const ok = (k: any): k is Known => !!k && typeof k.ip === 'string' && !!k.ip && typeof k.at === 'string'
  if (Array.isArray(j?.known)) return j.known.filter(ok)
  return ok(j) ? [{ ip: j.ip, at: j.at }] : []
}

// the command succeeded for ip: it is known from now (its time renewed), newest first
export const addKnown = (known: Known[], ip: string, at: string): Known[] => [{ ip, at }, ...known.filter((k) => k.ip !== ip)]
export const forgetKnown = (known: Known[], ip: string): Known[] => known.filter((k) => k.ip !== ip)

// trustMs: how long an allowed address counts as allowed (null = forever)
export function allowState(ip: string | null, known: Known[], now: number, trustMs: number | null): { changed: boolean; unreadable: boolean; match: Known | null } {
  if (!ip) return { changed: false, unreadable: true, match: null }
  const match = known.find((k) => k.ip === ip && (trustMs === null || now - Date.parse(k.at) < trustMs)) ?? null
  return { changed: !match, unreadable: false, match }
}

// HIVE_ALLOWLIST_TRUST_HOURS: a positive number of hours, else no expiry
export function trustMsOf(env: Record<string, string>): number | null {
  const n = Number((env.HIVE_ALLOWLIST_TRUST_HOURS ?? '').trim())
  return (env.HIVE_ALLOWLIST_TRUST_HOURS ?? '').trim() && Number.isFinite(n) && n > 0 ? n * 3_600_000 : null
}
