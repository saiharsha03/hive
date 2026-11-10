// Claude account profiles: several logins kept side by side, switched without the browser and without restarting Hive.
// Claude Code keeps a login in two places: the tokens in <config>/.credentials.json under "claudeAiOauth" (the same
// file also holds MCP servers' own OAuth tokens, which belong to no account), and who it is in ~/.claude.json under
// "oauthAccount" (that file is the CLI's big state file). A profile is exactly those two keys,
// { claudeAiOauth, oauthAccount }, in ~/.claude/hive/accounts/<id>.json; a switch touches only those two keys.
// Tokens never leave this module: what goes anywhere else (IPC, the phone, logs) is the id, email, plan and dates.
// Every function takes the paths, so tests run on temp folders and never on the real files.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dataDir } from './testMode'

export type AccountPaths = { credentials: string; claudeJson: string; dir: string }
// what may leave the main process: never a token
export type AccountEntry = { id: string; email: string; plan: string | null; savedAt: number; lastUsed: number | null }
export type AccountRow = AccountEntry & { active: boolean }
type Profile = { claudeAiOauth: unknown; oauthAccount: Record<string, unknown> }
type Index = { profiles: AccountEntry[] }

export const BACKUPS_KEPT = 5

// the engine's files as Claude Code finds them: CLAUDE_CONFIG_DIR, else ~/.claude and ~/.claude.json
export function realAccountPaths(env: NodeJS.ProcessEnv = process.env): AccountPaths {
  const cfg = env.CLAUDE_CONFIG_DIR
  return {
    credentials: join(cfg || join(homedir(), '.claude'), '.credentials.json'),
    claudeJson: cfg ? join(cfg, '.claude.json') : join(homedir(), '.claude.json'),
    dir: join(dataDir(), 'hive', 'accounts'),
  }
}

// a file id for an email: readable, safe as a file name, and distinct for emails that differ only in punctuation
export const profileId = (email: string): string => {
  const e = email.trim().toLowerCase()
  return `${e.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'account'}-${createHash('sha256').update(e).digest('hex').slice(0, 6)}`
}

const readJson = (file: string): Record<string, unknown> => {
  const v = JSON.parse(readFileSync(file, 'utf8'))
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${file} is not a JSON object`)
  return v as Record<string, unknown>
}
const indentOf = (file: string): number => { try { return /^\{\r?\n {2}"/.test(readFileSync(file, 'utf8')) ? 2 : 0 } catch { return 0 } }
// written next to the target then renamed over it; throws on failure (the caller rolls back). Owner-only where the
// system honours it (the files hold tokens)
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.hive-switch`
  writeFileSync(tmp, text, { mode: 0o600 })
  try { renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
}
const withKey = (file: string, obj: Record<string, unknown>) => JSON.stringify(obj, null, indentOf(file) || undefined)

const indexFile = (p: AccountPaths) => join(p.dir, 'index.json')
function readIndex(p: AccountPaths): Index {
  try { const v = readJson(indexFile(p)); return { profiles: Array.isArray(v.profiles) ? (v.profiles as AccountEntry[]).filter((x) => x && typeof x.id === 'string' && typeof x.email === 'string') : [] } } catch { return { profiles: [] } }
}
const writeIndex = (p: AccountPaths, i: Index) => { mkdirSync(p.dir, { recursive: true }); writeAtomic(indexFile(p), JSON.stringify(i, null, 2)) }
const profileFile = (p: AccountPaths, id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Not an account id')
  return join(p.dir, `${id}.json`)
}

// the login the engine has now: its two keys, and the email from the identity (null when there is no login)
function live(p: AccountPaths): { creds: Record<string, unknown>; cj: Record<string, unknown>; profile: Profile | null; email: string | null } {
  const creds = readJson(p.credentials)
  let cj: Record<string, unknown> = {}
  try { cj = readJson(p.claudeJson) } catch { /* no identity file: no profile */ }
  const acct = cj.oauthAccount as Record<string, unknown> | undefined
  const email = typeof acct?.emailAddress === 'string' && acct.emailAddress ? acct.emailAddress : null
  const profile = creds.claudeAiOauth && acct && email ? { claudeAiOauth: creds.claudeAiOauth, oauthAccount: acct } : null
  return { creds, cj, profile, email }
}

const planOf = (pr: Profile): string | null => {
  const a = pr.oauthAccount.planDisplayName
  const b = (pr.claudeAiOauth as { subscriptionType?: unknown } | null)?.subscriptionType
  return typeof a === 'string' && a ? a : typeof b === 'string' && b ? b : null
}

// The login the engine has now, saved as (or over) its profile: done after every sign-in, once at start, and before
// every switch (tokens rotate while in use, so the profile must hold the newest ones). null: no login to save.
export function saveCurrent(p: AccountPaths, now = Date.now()): AccountEntry | null {
  let l
  try { l = live(p) } catch { return null }
  if (!l.profile || !l.email) return null
  const id = profileId(l.email)
  mkdirSync(p.dir, { recursive: true })
  writeAtomic(profileFile(p, id), JSON.stringify(l.profile))
  const idx = readIndex(p)
  const old = idx.profiles.find((x) => x.id === id)
  const entry: AccountEntry = { id, email: l.email, plan: planOf(l.profile), savedAt: now, lastUsed: old?.lastUsed ?? now }
  writeIndex(p, { profiles: [...idx.profiles.filter((x) => x.id !== id), entry].sort((a, b) => a.email.localeCompare(b.email)) })
  return entry
}

export function listAccounts(p: AccountPaths): AccountRow[] {
  let email: string | null = null
  try { email = live(p).email } catch { /* no login */ }
  return readIndex(p).profiles.map((x) => ({ ...x, active: !!email && x.email.toLowerCase() === email.toLowerCase() }))
}

// deletes the saved profile only; the engine's own login is left as it is
export function removeAccount(p: AccountPaths, id: string): boolean {
  const idx = readIndex(p)
  if (!idx.profiles.some((x) => x.id === id)) return false
  rmSync(profileFile(p, id), { force: true })
  writeIndex(p, { profiles: idx.profiles.filter((x) => x.id !== id) })
  return true
}

// the last BACKUPS_KEPT pairs of the two files as they were before a switch, in <dir>/backups
function backup(p: AccountPaths, now: number): { credentials: string; claudeJson: string | null } {
  const dir = join(p.dir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = String(now)
  const credentials = join(dir, `${stamp}-credentials.json`)
  copyFileSync(p.credentials, credentials)
  let claudeJson: string | null = join(dir, `${stamp}-claude.json`)
  try { copyFileSync(p.claudeJson, claudeJson) } catch { claudeJson = null }
  const stamps = [...new Set(readdirSync(dir).map((f) => f.split('-')[0]).filter((s) => /^\d+$/.test(s)))].sort((a, b) => Number(b) - Number(a))
  for (const old of stamps.slice(BACKUPS_KEPT)) for (const f of readdirSync(dir)) if (f.startsWith(`${old}-`)) rmSync(join(dir, f), { force: true })
  return { credentials, claudeJson }
}

const without = (o: Record<string, unknown>, key: string) => { const { [key]: _gone, ...rest } = o; return JSON.stringify(rest) }

export type SwitchDone = { account: AccountEntry; changed: boolean }

// Switch to a saved profile: the current login is saved first, a backup of both files is taken, then the tokens go
// into .credentials.json (its other keys, the MCP logins, kept) and the identity into ~/.claude.json (read again just
// before, so the CLI's own latest state is kept). If the second write fails the first is put back; afterwards every
// other key of both files is checked unchanged, and anything off puts both files back from the backup.
export function switchAccount(p: AccountPaths, id: string, now = Date.now()): SwitchDone {
  const entry = readIndex(p).profiles.find((x) => x.id === id)
  if (!entry) throw new Error('No saved account with that id')
  let target: Profile
  try { target = readJson(profileFile(p, id)) as unknown as Profile } catch { throw new Error(`The saved login for ${entry.email} is missing; sign in to it with the browser again (Add account).`) }
  if (!target?.claudeAiOauth || !target.oauthAccount || typeof target.oauthAccount !== 'object') throw new Error(`The saved login for ${entry.email} is incomplete; sign in to it with the browser again (Add account).`)
  const current = live(p) // throws when the credentials file cannot be read: nothing has been touched yet
  if (current.email && current.email.toLowerCase() === entry.email.toLowerCase()) {
    saveCurrent(p, now)
    return { account: { ...entry, lastUsed: now }, changed: false }
  }
  saveCurrent(p, now)
  const saved = backup(p, now)
  const credsText = readFileSync(p.credentials, 'utf8')
  const creds = JSON.parse(credsText) as Record<string, unknown>
  writeAtomic(p.credentials, withKey(p.credentials, { ...creds, claudeAiOauth: target.claudeAiOauth }))
  let cjBefore: Record<string, unknown>
  try {
    try { cjBefore = readJson(p.claudeJson) } catch { cjBefore = {} }
    writeAtomic(p.claudeJson, withKey(p.claudeJson, { ...cjBefore, oauthAccount: target.oauthAccount }))
  } catch (e) {
    writeAtomic(p.credentials, credsText) // the tokens go back: the two files never disagree about who is signed in
    throw new Error(`Could not switch the account (writing ${p.claudeJson} failed: ${(e as Error).message}); nothing changed.`, { cause: e })
  }
  // the keys Hive did not mean to touch are as they were
  let ok: boolean
  try {
    const credsAfter = readJson(p.credentials)
    const cjAfter = readJson(p.claudeJson)
    ok = without(credsAfter, 'claudeAiOauth') === without(creds, 'claudeAiOauth') && without(cjAfter, 'oauthAccount') === without(cjBefore, 'oauthAccount')
      && JSON.stringify(credsAfter.claudeAiOauth) === JSON.stringify(target.claudeAiOauth) && JSON.stringify(cjAfter.oauthAccount) === JSON.stringify(target.oauthAccount)
  } catch { ok = false }
  if (!ok) {
    copyFileSync(saved.credentials, p.credentials)
    if (saved.claudeJson) copyFileSync(saved.claudeJson, p.claudeJson)
    throw new Error('The account files changed while switching (a terminal Claude session may have written them); both were put back. Close other Claude sessions and try again.')
  }
  const idx = readIndex(p)
  const next = { ...entry, lastUsed: now }
  writeIndex(p, { profiles: idx.profiles.map((x) => (x.id === id ? next : x)) })
  return { account: next, changed: true }
}

// Claude processes that are not Hive's own (a terminal session, an IDE): they keep the old login and may write their
// copy of ~/.claude.json back, so a switch warns about them. Hive's own threads and its status process are its children.
export async function otherClaudeProcesses(ownPid = process.pid): Promise<number> {
  const { execFile } = await import('node:child_process')
  const run = (cmd: string, args: string[]) => new Promise<string>((res) => execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (_e, out) => res(String(out ?? ''))))
  const rows = process.platform === 'win32'
    ? (await run('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"])).split(/\r?\n/)
    : (await run('ps', ['-A', '-o', 'pid=,ppid=,comm='])).split('\n').filter((l) => /(^|\/)claude$/.test(l.trim().split(/\s+/)[2] ?? ''))
  const pairs = rows.map((l) => l.trim().split(/\s+/).map(Number)).filter(([pid, ppid]) => Number.isFinite(pid) && Number.isFinite(ppid)) as [number, number][]
  return othersOf(pairs, ownPid)
}

// of these claude processes ([pid, parent pid]), how many are not Hive's: started by Hive, or by one of its own
export function othersOf(pairs: [number, number][], ownPid: number): number {
  const ours = new Set<number>()
  for (let changed = true; changed;) {
    changed = false
    for (const [pid, ppid] of pairs) if (!ours.has(pid) && (ppid === ownPid || ours.has(ppid))) { ours.add(pid); changed = true }
  }
  return pairs.filter(([pid]) => !ours.has(pid)).length
}
