// Permission mode per session: anything running in the background runs in "auto" (a classifier approves or denies each
// tool call); foreground tabs keep the app's normal mode. Pure, so it can be tested without Electron.
export const BACKGROUND_MODE = 'auto' as const

export const modeFor = <M extends string>(background: boolean, foreground: M): M | typeof BACKGROUND_MODE =>
  background ? BACKGROUND_MODE : foreground

// the mode to switch the live session to, or null when it is already right
export const modeSwitch = <M extends string>(current: string | null, background: boolean, foreground: M): M | typeof BACKGROUND_MODE | null => {
  const want = modeFor(background, foreground)
  return current === want ? null : want
}

const LABELS: Record<string, string> = {
  bypassPermissions: 'Bypass permissions',
  auto: 'Auto mode',
  acceptEdits: 'Accept edits',
  default: 'Manual',
  dontAsk: "Don't ask",
  plan: 'Plan mode',
}
export const modeLabel = (mode: string) => LABELS[mode] ?? mode
