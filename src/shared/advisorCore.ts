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

/** the Advisor group's rows */
export function advisorItems(models: { value: string; displayName: string }[], dflt: string, label: (m: string) => string): AdvisorItem[] {
  return [
    { value: ADVISOR_OFF, label: 'Off' },
    { value: ADVISOR_DEFAULT, label: 'Default', note: dflt ? label(dflt) : 'off' },
    ...models.map((m) => ({ value: `${PREFIX}${m.value}`, label: m.displayName })),
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
