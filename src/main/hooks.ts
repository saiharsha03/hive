// Hooks from the user settings and the working folder's project/local settings, with on/off.
// Claude Code has no per-hook "disabled" flag, so turning a hook off moves it out of its settings
// file into ~/.claude/hive-disabled-hooks.json, and turning it on puts it back.
// Every settings write first copies the file to <file>.hive-bak.
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type HookRow = {
  id: string
  scope: 'User' | 'Project' | 'Local'
  file: string
  event: string
  matcher: string
  command: string
  name: string
  enabled: boolean
}
type Stashed = { file: string; event: string; matcher: string; hook: any }

const STASH = join(homedir(), '.claude', 'hive-disabled-hooks.json')

const settingsFiles = (folder: string) => [
  { scope: 'User' as const, file: join(homedir(), '.claude', 'settings.json') },
  { scope: 'Project' as const, file: join(folder, '.claude', 'settings.json') },
  { scope: 'Local' as const, file: join(folder, '.claude', 'settings.local.json') },
]

// A missing file reads as `fallback`; a file that exists but doesn't parse is an error,
// so nothing is ever written over a settings file we couldn't read.
async function readJson(file: string, fallback: any): Promise<any> {
  let text: string
  try { text = await readFile(file, 'utf8') } catch (e: any) {
    if (e?.code === 'ENOENT') return fallback
    throw e
  }
  try { return JSON.parse(text) } catch { throw new Error(`${file} is not valid JSON; fix it before changing hooks`) }
}
// temp file + rename, so a crash mid-write never leaves a half-written file
async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.hive-tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}
async function writeSettings(file: string, data: any): Promise<void> {
  await copyFile(file, `${file}.hive-bak`).catch(() => {}) // the file parsed, so the backup is good
  await writeAtomic(file, JSON.stringify(data, null, 2) + '\n')
}
// one settings change at a time, so two quick switches can't overwrite each other
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}

// "usage_guard.py" from the command; inline shell hooks show their first words
function hookName(cmd: string): string {
  const script = cmd.match(/([\w.-]+\.(?:py|sh|ps1|js|ts|cmd|bat))\b/)
  return script ? script[1] : cmd.replace(/\s+/g, ' ').slice(0, 48)
}
const idOf = (file: string, event: string, matcher: string, cmd: string) => JSON.stringify([file, event, matcher, cmd])

export async function listHooks(folder: string): Promise<HookRow[]> {
  const stash: Stashed[] = await readJson(STASH, [])
  const rows: HookRow[] = []
  for (const { scope, file } of settingsFiles(folder)) {
    const s = await readJson(file, {})
    const row = (event: string, matcher: string, hook: any, enabled: boolean): HookRow => {
      const command = String(hook.command ?? hook.prompt ?? hook.type ?? '')
      return { id: idOf(file, event, matcher, command), scope, file, event, matcher, command, name: hookName(command), enabled }
    }
    for (const [event, groups] of Object.entries<any[]>(s.hooks ?? {}))
      for (const g of groups) for (const h of g.hooks ?? []) rows.push(row(event, g.matcher ?? '', h, true))
    // a hook found both active and stashed (a half-finished switch) shows once, as on
    const active = new Set(rows.map((r) => r.id))
    for (const x of stash) {
      if (x.file !== file) continue
      const r = row(x.event, x.matcher, x.hook, false)
      if (!active.has(r.id)) rows.push(r)
    }
  }
  return rows
}

// ---- plugins ----
// A plugin's hooks live in its own install folder (overwritten on update), so the only supported
// switch is the whole plugin: enabledPlugins["name@marketplace"] in the user settings.
export type PluginInfo = { key: string; name: string; source: string; description: string; events: string[]; mod: boolean; enabled: boolean }

const USER_SETTINGS = join(homedir(), '.claude', 'settings.json')
const INSTALLED = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')

export async function listPlugins(): Promise<PluginInfo[]> {
  const installed = (await readJson(INSTALLED, {})).plugins ?? {}
  const enabled = (await readJson(USER_SETTINGS, {})).enabledPlugins ?? {}
  const out: PluginInfo[] = []
  for (const [key, installs] of Object.entries<any[]>(installed)) {
    const path = installs.at(-1)?.installPath
    if (!path) continue
    // a broken plugin file shouldn't hide the whole list
    const h = await readJson(join(path, 'hooks', 'hooks.json'), {}).catch(() => ({}))
    const meta = await readJson(join(path, '.claude-plugin', 'plugin.json'), {}).catch(() => ({}))
    // mods register their hooks from code ("modules"), plain plugins list them by event
    const [name, source] = key.split('@')
    out.push({ key, name, source: source ?? '', description: meta.description ?? '', events: Object.keys(h.hooks ?? {}), mod: !!h.modules, enabled: enabled[key] !== false })
  }
  return out.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
}

export function setPlugin(key: string, on: boolean): Promise<void> {
  return serial(async () => {
    const s = await readJson(USER_SETTINGS, null)
    if (!s) throw new Error('Could not read ~/.claude/settings.json')
    s.enabledPlugins = { ...(s.enabledPlugins ?? {}), [key]: on }
    await writeSettings(USER_SETTINGS, s)
  })
}

export function setHook(folder: string, id: string, enabled: boolean): Promise<void> {
  return serial(() => setHookNow(folder, id, enabled))
}

// The hook is always in at least one place. Off: save it to the stash first, then remove it from
// settings. On: put it back in settings first, then remove it from the stash.
async function setHookNow(folder: string, id: string, enabled: boolean): Promise<void> {
  const [file, event, matcher, command] = JSON.parse(id) as string[]
  if (!settingsFiles(folder).some((f) => f.file === file)) throw new Error('Unknown settings file')
  const stash: Stashed[] = await readJson(STASH, [])
  const s = await readJson(file, {})
  const cmdOf = (h: any) => String(h.command ?? h.prompt ?? h.type ?? '')
  // Both directions are safe to repeat after a half-finished switch: never two stash entries,
  // never two active copies.
  const stashIdx = () => stash.findIndex((x) => x.file === file && x.event === event && x.matcher === matcher && cmdOf(x.hook) === command)
  const groups: any[] = s.hooks?.[event] ?? []
  const g = groups.find((x) => (x.matcher ?? '') === matcher && x.hooks?.some((h: any) => cmdOf(h) === command))
  const activeHook = g?.hooks.find((h: any) => cmdOf(h) === command)

  if (!enabled) {
    if (!activeHook) return
    if (stashIdx() < 0) {
      stash.push({ file, event, matcher, hook: activeHook })
      await writeAtomic(STASH, JSON.stringify(stash, null, 2) + '\n')
    }
    g.hooks = g.hooks.filter((h: any) => h !== activeHook)
    if (!g.hooks.length) s.hooks[event] = groups.filter((x) => x !== g)
    if (!s.hooks[event].length) delete s.hooks[event]
    await writeSettings(file, s)
  } else {
    const i = stashIdx()
    if (i < 0) return
    const [{ hook }] = stash.splice(i, 1)
    if (!activeHook) {
      s.hooks ??= {}
      s.hooks[event] ??= []
      let target = s.hooks[event].find((x: any) => (x.matcher ?? '') === matcher)
      if (!target) s.hooks[event].push((target = matcher ? { matcher, hooks: [] } : { hooks: [] }))
      target.hooks.push(hook)
      await writeSettings(file, s)
    }
    await writeAtomic(STASH, JSON.stringify(stash, null, 2) + '\n')
  }
}
