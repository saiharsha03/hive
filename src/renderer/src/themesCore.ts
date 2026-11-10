// The ten themes as token sets. Each theme names a few seeds (pane surface, well, lift, main and secondary text, the
// signal colour and its red); everything else is derived here, so every theme defines the same token names and no
// component knows which theme it is in. Body text is pushed until it reads at 4.5:1 on every surface.
// Pure (no DOM), so the test can check every theme.

export type ThemeId = 'dark' | 'graphite' | 'classic' | 'midnight' | 'forest' | 'slate' | 'mocha' | 'light' | 'paper' | 'hc'
export type ThemeInfo = { id: ThemeId; label: string; description: string }

type Seeds = {
  bg: string; side: string; lift: string; hi: string; dim: string
  signal: string | null // null: no accent, "needs you" is the main text on a lifted block
  red: string
  light?: boolean; square?: boolean; hc?: boolean
  ink?: string; faint?: string; lift2?: string; rule?: string
}

const SEEDS: Record<ThemeId, Seeds & { label: string; description: string }> = {
  dark: { label: 'Quiet', description: 'Charcoal and paper, honey only for what needs you', bg: '#16171A', side: '#111214', lift: '#1E2024', hi: '#ECEAE5', dim: '#8B8983', signal: '#E9B44C', red: '#E2574C', ink: '#C9C7C1', faint: '#5C5B57', lift2: '#26282D', rule: '#24262A' },
  graphite: { label: 'Graphite', description: 'Grey and white, no accent at all', bg: '#18191B', side: '#121314', lift: '#222326', hi: '#F0F0EE', dim: '#8E8E8A', signal: null, red: '#E2574C' },
  classic: { label: 'Classic', description: 'The pre-rebuild Hive: VS Code Dark Modern, square corners', bg: '#1F1F1F', side: '#181818', lift: '#2A2D2E', hi: '#CCCCCC', dim: '#9D9D9D', signal: '#3794FF', red: '#F14C4C', square: true, ink: '#CCCCCC' },
  midnight: { label: 'Midnight', description: 'Deep navy with an ice signal', bg: '#0F1420', side: '#0B0F18', lift: '#18202F', hi: '#E6EAF2', dim: '#8792A6', signal: '#8FC7FF', red: '#F0625A' },
  forest: { label: 'Forest', description: 'Dark green with a moss signal', bg: '#141A17', side: '#0F1411', lift: '#1C2520', hi: '#E7ECE6', dim: '#8A968C', signal: '#A8D08D', red: '#E8665A' },
  slate: { label: 'Slate', description: 'Blue grey with a teal signal', bg: '#22262B', side: '#1C2024', lift: '#2B3036', hi: '#DADDE1', dim: '#949BA5', signal: '#6FC9C2', red: '#E5675D' },
  mocha: { label: 'Mocha', description: 'Warm brown with a cream signal', bg: '#1D1917', side: '#161311', lift: '#272220', hi: '#EEE6DC', dim: '#9A8F84', signal: '#E8D9A8', red: '#E0605A' },
  light: { label: 'Light', description: 'White zones with a dark honey signal', bg: '#FFFFFF', side: '#F4F5F6', lift: '#ECEEF0', hi: '#17191C', dim: '#5F6670', signal: '#9A6A00', red: '#C5352B', light: true },
  paper: { label: 'Paper', description: 'Warm paper, no accent at all', bg: '#FAF8F3', side: '#F1EEE7', lift: '#E7E3DA', hi: '#1E1C19', dim: '#6E6A62', signal: null, red: '#B8382E', light: true },
  hc: { label: 'High contrast', description: 'Black and white, a yellow signal, outlines and 2 px focus rings', bg: '#000000', side: '#000000', lift: '#141414', hi: '#FFFFFF', dim: '#D6D6D6', signal: '#FFD60A', red: '#FF6B5E', hc: true, ink: '#FFFFFF', faint: '#A8A8A8', lift2: '#222222', rule: '#6E6E6E' },
}

export const THEME_IDS = Object.keys(SEEDS) as ThemeId[]
export const THEMES: ThemeInfo[] = THEME_IDS.map((id) => ({ id, label: SEEDS[id].label, description: SEEDS[id].description }))

// ---- colour arithmetic ----
type RGB = [number, number, number]
const rgb = (hex: string): RGB => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB
}
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
/** a over b: t = 0 gives b, 1 gives a */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex([0, 1, 2].map((i) => x[i] * t + y[i] * (1 - t)) as RGB) }
const alpha = (c: string, a: number) => { const [r, g, b] = rgb(c); return `rgba(${r}, ${g}, ${b}, ${a})` }
const lum = (c: string) => {
  const [r, g, b] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
/** move fg away from the surfaces (to white on dark, to black on light) until it reads at `min` on every one */
export const ensure = (fg: string, surfaces: string[], min: number, light: boolean) => {
  let c = fg
  for (let i = 0; i < 40 && surfaces.some((s) => contrast(c, s) < min); i++) c = mix(light ? '#000000' : '#FFFFFF', c, 0.06)
  return c
}

// ---- the token set ----
function derive(s: Seeds): Record<string, string> {
  const L = !!s.light
  const surfaces = [s.bg, s.side, s.lift]
  const hi = ensure(s.hi, surfaces, 7, L)
  const ink = ensure(s.ink ?? mix(s.hi, s.dim, 0.64), surfaces, 4.5, L)
  const dim = ensure(s.dim, surfaces, 4.5, L)
  const faint = s.faint ?? mix(s.dim, s.bg, L ? 0.78 : 0.6)
  const signal = s.signal ? ensure(s.signal, surfaces, 4.5, L) : hi
  const red = ensure(s.red, [s.bg, s.side], 4.5, L) // failed text sits on panes and the rail
  const lift2 = s.lift2 ?? mix(s.hi, s.lift, L ? 0.05 : 0.04)
  const rule = s.rule ?? mix(s.hi, s.bg, L ? 0.1 : 0.065)
  const rule2 = s.hc ? '#A8A8A8' : mix(s.hi, s.bg, L ? 0.2 : 0.14)
  const add = s.hc ? '#7EE2A1' : L ? '#1D7A43' : '#7FBF8E'
  const del = s.hc ? '#FF8A80' : L ? '#C42B2B' : '#D9776F'
  const r = (n: number) => (s.square ? '0px' : `${n}px`)
  return {
    'color-scheme': L ? 'light' : 'dark',
    // surfaces
    bg: s.bg, side: s.side, raised: s.lift, band: s.lift, sel: s.lift, lift2, hover: s.lift, selin: lift2,
    rule, rule2,
    // text
    hi, ink, dim, faint,
    // the one signal (needs you) and failed
    signal, 'signal-wash': s.signal ? alpha(signal, L ? 0.1 : 0.07) : s.lift, 'signal-line': s.signal ? alpha(signal, 0.16) : rule2,
    wait: signal, 'wait-bg': s.signal ? alpha(signal, L ? 0.1 : 0.07) : s.lift,
    fail: red, 'fail-bg': alpha(red, L ? 0.07 : 0.08),
    // the primary button is the main text colour; quiet buttons a faint fill of it
    accent: hi, 'on-accent': s.bg, 'btn-quiet': alpha(hi, L ? 0.07 : 0.09), 'pick-bg': alpha(hi, L ? 0.06 : 0.08),
    focus: s.hc ? signal : hi, 'focus-w': s.hc ? '2px' : '1px', edge: s.hc ? rule2 : 'transparent',
    'brand-bar': s.signal ? signal : dim,
    // git and diff
    'git-added': add, 'git-deleted': del, 'git-modified': L ? '#8A5A00' : s.hc ? '#F5CF73' : '#D8B26A', 'git-untracked': add, 'git-ignored': faint,
    'diff-add-bg': alpha(add, L ? 0.1 : 0.13), 'diff-del-bg': alpha(del, L ? 0.09 : 0.13),
    // syntax (Markdown code blocks; Monaco keeps its own)
    'sy-kw': L ? '#1F56B5' : '#8FB8F0', 'sy-fn': L ? '#7A4E00' : '#DCCB8A', 'sy-str': L ? '#1D7A43' : '#A4CF9E', 'sy-cm': faint, 'sy-num': L ? '#A0480A' : '#D9A57C',
    // overlays
    'overlay-shadow': s.hc ? 'none' : L ? '0 10px 28px rgba(15, 19, 24, 0.14)' : '0 12px 36px rgba(0, 0, 0, 0.5)',
    scroll: alpha(s.dim, 0.3), scrim: L ? 'rgba(15, 19, 24, 0.24)' : 'rgba(0, 0, 0, 0.5)', overlay: L ? 'rgba(15, 19, 24, 0.55)' : 'rgba(0, 0, 0, 0.78)', drop: alpha(hi, 0.07),
    'code-bg': s.lift, 'pre-bg': s.side,
    // the Windows caption buttons
    titlebar: s.side, 'titlebar-symbol': dim,
    // terminal
    'term-bg': s.side, 'term-fg': ink, 'term-cursor': hi, 'term-sel': alpha(hi, 0.2),
    'ansi-black': L ? '#17191C' : s.bg, 'ansi-red': red, 'ansi-green': add, 'ansi-yellow': L ? '#8A5A00' : '#D8B26A', 'ansi-blue': L ? '#1F56B5' : '#7FAEE8',
    'ansi-magenta': L ? '#8E3E86' : '#C99BC4', 'ansi-cyan': L ? '#0B6F8F' : '#7CC4D4', 'ansi-white': ink, 'ansi-bright-black': faint, 'ansi-bright-red': L ? '#D84040' : '#F08A82',
    'ansi-bright-green': L ? '#22914F' : '#9AD4A8', 'ansi-bright-yellow': L ? '#A06A00' : '#E8CB8C', 'ansi-bright-blue': L ? '#2E73DD' : '#A2C4F0', 'ansi-bright-magenta': L ? '#A04F98' : '#DAB4D6',
    'ansi-bright-cyan': L ? '#138DB5' : '#9AD6E2', 'ansi-bright-white': hi,
    // shape
    'r-row': r(6), 'r-block': r(8), 'r-comp': r(10), 'r-small': r(4),
  }
}

export const THEME_TOKENS: Record<ThemeId, Record<string, string>> = Object.fromEntries(THEME_IDS.map((id) => [id, derive(SEEDS[id])])) as Record<ThemeId, Record<string, string>>
export const TOKEN_NAMES = Object.keys(THEME_TOKENS.dark)
export const isLightTheme = (id: ThemeId) => !!SEEDS[id].light

/** the stylesheet: one block per theme under [data-theme], the same names in each */
export function themeCss(): string {
  return THEME_IDS.map((id) => {
    const t = THEME_TOKENS[id]
    const body = Object.entries(t).map(([k, v]) => (k === 'color-scheme' ? `color-scheme: ${v};` : `--${k}: ${v};`)).join(' ')
    return `${id === 'dark' ? ':root, ' : ''}[data-theme='${id}'] { ${body} }`
  }).join('\n')
}

/** the swatch Settings > Appearance draws for a theme: its own pane, well, lift, text and signal */
export const swatchOf = (id: ThemeId) => {
  const t = THEME_TOKENS[id]
  return { bg: t.bg, side: t.side, lift: t.raised, hi: t.hi, dim: t.dim, signal: t.signal, fail: t.fail }
}
