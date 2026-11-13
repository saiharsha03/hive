// The open thread's context meter, fast mode's words and the thinking row's one-line preview. Pure, so they are
// tested on their own; StatusLine.tsx, FastToggle.tsx and ChatRows.tsx draw them.

// above this share of the window the meter takes the signal colour
export const CONTEXT_WARN_PCT = 80

// the share of the window in use, 0..100, rounded; null when the window size is not known
export function contextPct(total: number, max: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return null
  return Math.round(Math.max(0, Math.min(100, (total / max) * 100)))
}

export const contextWarn = (pct: number | null): boolean => pct !== null && pct > CONTEXT_WARN_PCT

// Compact is offered only for a running thread that is not working (a /compact sent mid-turn would wait in the queue)
export const canCompact = (t: { live: boolean; busy: boolean; compacting?: boolean }): boolean => t.live && !t.busy && !t.compacting

// why fast mode cannot serve now, in words (the SDK's fast_mode_disabled_reason)
const FAST_WHY: Record<string, string> = {
  free: 'not on a free plan',
  preference: 'turned off by policy',
  extra_usage_disabled: 'needs extra usage turned on',
  network_error: 'could not be checked (network)',
  unknown: 'unavailable',
  not_first_party: 'not available on this provider',
  disabled_by_env: 'turned off by an environment variable',
  model_not_allowed: 'not available for this model',
  sdk_opt_in_required: 'not turned on for this thread',
  pending: 'being checked',
}

// the fast control's word: off, on, on but cooling down after a rate limit, or asked for but refused (with why)
export function fastLabel(on: boolean, state?: string | null, reason?: string | null): string {
  if (!on) return 'fast off'
  if (reason && reason !== 'sdk_opt_in_required') return `fast: ${FAST_WHY[reason] ?? reason}`
  if (state === 'cooldown') return 'fast, cooling down'
  return 'fast'
}

// does the thread's model take fast mode? true / false from the model list, null when it cannot be told
export function fastSupported(models: { value: string; supportsFastMode?: boolean }[] | null, model?: string | null): boolean | null {
  if (!models || !model) return null
  const m = models.find((x) => x.value === model) ?? models.find((x) => x.value !== 'default' && model.includes(x.value))
  return typeof m?.supportsFastMode === 'boolean' ? m.supportsFastMode : null
}

// the closed thinking row's preview: its first line that says something, cut short
export function thinkingPreview(text: string, n = 90): string {
  const line = text.split('\n').map((l) => l.replace(/[*_#`>]/g, '').trim()).find(Boolean) ?? ''
  return line.length > n ? `${line.slice(0, n - 1)}…` : line
}
