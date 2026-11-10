// Clipboard suggestion rules: which clipboard items may be offered as a one-click paste. Pure, so it can be
// tested without Electron or a real clipboard.

// what the page gets: a thumbnail or a short preview, never the full item; the full item only on the click
export type ClipOffer =
  | { id: string; kind: 'image'; thumb: string }
  | { id: string; kind: 'text'; preview: string; big: boolean; length: number }
export type ClipTake = { kind: 'image'; dataUrl: string } | { kind: 'text'; text: string }

export const PREVIEW_CHARS = 80
export const BIG_TEXT = 20_000
export const OFFER_MS = 60_000
const MAX_DISMISSED = 200

// prefixes and shapes of well-known credentials
const SECRET_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic style API keys
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprse]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key ids
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
const SECRET_WORDS = /password|passwd|token|secret/i

// Shannon entropy in bits per character
function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p) }
  return h
}

// a long run of key-like characters with letters and digits mixed and high entropy; hex (git shas, uuids) stays
// under the threshold, since hex tops out at 4 bits per character
function highEntropyToken(word: string): boolean {
  if (word.length < 32 || !/^[A-Za-z0-9_\-+/=]+$/.test(word)) return false
  if (!/[0-9]/.test(word) || !/[A-Za-z]/.test(word)) return false
  return entropy(word) > 4.2
}

// true when the text looks like a credential and must not be offered
export function looksSecret(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (SECRET_SHAPES.some((re) => re.test(t))) return true
  if (!/[\r\n]/.test(t) && SECRET_WORDS.test(t)) return true
  return t.split(/\s+/).some(highEntropyToken)
}

// the chip's text: the first characters on one line, or just the size for a very long text
export function textLabel(text: string): { preview: string; big: boolean } {
  if (text.length > BIG_TEXT) return { preview: '', big: true }
  const one = text.replace(/\s+/g, ' ').trim()
  return { preview: one.length > PREVIEW_CHARS ? `${one.slice(0, PREVIEW_CHARS)}…` : one, big: false }
}

// What has been seen. lastOffered: the most recent offer. atBlur: what the clipboard held when Hive lost focus,
// so anything copied inside Hive (by Hive itself or by a Ctrl+C in the window) is not offered back.
export type Seen = { lastOffered: string | null; atBlur: string | null; dismissed: string[] }
export const emptySeen = (): Seen => ({ lastOffered: null, atBlur: null, dismissed: [] })

export function shouldOffer(s: Seen, hash: string | null): boolean {
  if (!hash) return false
  return hash !== s.lastOffered && hash !== s.atBlur && !s.dismissed.includes(hash)
}

export const offered = (s: Seen, hash: string): Seen => ({ ...s, lastOffered: hash })
export const blurred = (s: Seen, hash: string | null): Seen => ({ ...s, atBlur: hash })
export const dismissed = (s: Seen, hash: string): Seen =>
  s.dismissed.includes(hash) ? s : { ...s, dismissed: [...s.dismissed, hash].slice(-MAX_DISMISSED) }
