// The per-thread advisor picker's state, pure so it is tested. The Advisor group sits at the bottom of the model menu:
// Off, Default (the Settings > General value) and the same models the model picker offers. A thread's advisor is
// what main last said (hive_advisor), else what the user just picked, else the Settings default.

// Off and Default use their own keys, so a model whose id is "default" never shares a row key with them
export const ADVISOR_OFF = 'advisor-off'
export const ADVISOR_DEFAULT = 'advisor-default'
const PREFIX = 'advisor:'

export type AdvisorState = {
  advisor?: string | null // what main reported (hive_advisor): a model, null = none; undefined = not told yet
  advisorPick?: string // the menu row picked last (ADVISOR_OFF, ADVISOR_DEFAULT or advisor:<model>)
}
export type AdvisorItem = { value: string; label: string; note?: string }

export const isAdvisorValue = (v: string): boolean => v === ADVISOR_OFF || v === ADVISOR_DEFAULT || v.startsWith(PREFIX)

// An advisor is there to give a stronger second opinion, so a thread is only offered models above its own: Haiku may
// ask Sonnet, Opus or Fable; Sonnet may ask Opus or Fable; Opus may ask Fable. Fable is the top, so it may ask Fable.
// A model whose family is not known here (a new name, "default") is never held back.
// Mythos and Fable are the same top tier. A class not listed here has no rank yet: add it when its place is known.
const TIERS = [['haiku'], ['sonnet'], ['opus'], ['fable', 'mythos']]
export const modelTier = (m: string): number => TIERS.findIndex((names) => names.some((t) => m.toLowerCase().includes(t)))
export function advisorAllowed(thread: string, advisor: string): boolean {
  const t = modelTier(thread), a = modelTier(advisor)
  if (t < 0 || a < 0) return true
  return a > t || (a === t && t === TIERS.length - 1)
}

/** the Advisor group's rows; thread: the model the thread runs on, which limits the models offered */
export function advisorItems(models: { value: string; displayName: string }[], dflt: string, label: (m: string) => string, thread = ''): AdvisorItem[] {
  const weak = !!dflt && !advisorAllowed(thread, dflt)
  return [
    { value: ADVISOR_OFF, label: 'Off' },
    { value: ADVISOR_DEFAULT, label: 'Default', note: dflt ? `${label(dflt)}${weak ? ", not above this thread's model" : ''}` : 'off' },
    ...models.filter((m) => advisorAllowed(thread, m.value)).map((m) => ({ value: `${PREFIX}${m.value}`, label: m.displayName })),
  ]
}

/** what a picked row sends to main (chatSetAdvisor): '' = off */
export function advisorModelOf(pick: string, dflt: string): string {
  if (pick === ADVISOR_OFF) return ''
  if (pick === ADVISOR_DEFAULT) return dflt
  return pick.slice(PREFIX.length)
}

/** the model the thread's advisor runs on now, or null */
export function advisorNow(st: AdvisorState, dflt: string): string | null {
  if (st.advisor !== undefined) return st.advisor || null
  if (st.advisorPick) return advisorModelOf(st.advisorPick, dflt) || null
  return dflt || null
}

/** the row the menu ticks */
export function advisorChecked(st: AdvisorState, dflt: string): string {
  if (st.advisorPick) return st.advisorPick
  const now = advisorNow(st, dflt)
  if (st.advisor === undefined || (now ?? '') === dflt) return ADVISOR_DEFAULT
  return now ? `${PREFIX}${now}` : ADVISOR_OFF
}

/** the composer's quiet word: "advisor <model>" when the thread has one, else nothing */
export function advisorWord(st: AdvisorState, dflt: string, label: (m: string) => string): string {
  const now = advisorNow(st, dflt)
  return now ? `advisor ${label(now)}` : ''
}

// The pickers list only the newest model of each class, not every older version the engine still accepts. The class
// is read from the name, so a class that does not exist yet is handled the day it appears. A variant of a class (a
// "1M context" entry) is its own row, kept at its newest too. Kept whatever its age: the model the thread runs on
// now, and an entry with no version in its name (an alias such as "opus", or "default").
type Listed = { value: string; displayName: string }
// the class and version a name carries, whatever the class is called: "claude-opus-5-5", "Mythos 5.2", "nova-3"
const named = (m: Listed): { cls: string; version: number } | null => {
  for (const text of [m.value, m.displayName]) {
    const v = text.toLowerCase().match(/(?:claude[ -])?([a-z]{3,})[ -](\d+)(?:[.-](\d{1,2}))?(?!\d)/)
    if (v) return { cls: v[1], version: Number(v[2]) * 100 + Number(v[3] ?? 0) }
  }
  return null
}
const variantOf = (m: Listed): string => ((`${m.value} ${m.displayName}`.toLowerCase().match(/\b1m\b|\[[^\]]+\]|\(([^)]+)\)/) ?? [''])[0])
export function latestPerClass<T extends Listed>(models: T[], keep = ''): T[] {
  const newest = new Map<string, number>()
  const keyOf = (m: T, cls: string) => `${cls}|${variantOf(m)}`
  for (const m of models) { const n = named(m); if (n) newest.set(keyOf(m, n.cls), Math.max(newest.get(keyOf(m, n.cls)) ?? 0, n.version)) }
  return models.filter((m) => { const n = named(m); return m.value === keep || !n || n.version === newest.get(keyOf(m, n.cls)) })
}
