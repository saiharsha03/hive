// The sealed link between Orbit and the phone app: AES-256-GCM with the key from pairing, a fresh 12-byte nonce per
// message, and the pair id plus the direction as associated data (a blob sealed for one direction never opens in the
// other). Each message carries a counter; a counter not above the last one seen is a replay and is refused.
// The relay in between only ever sees the base64 blob.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

// desk (Orbit) to phone, phone to desk, a notification (d2n) and the press of a notification's button (n2d); the last
// two are sealed with the notification key, see notifyKey
export type Dir = 'd2p' | 'p2d' | 'd2n' | 'n2d'

// The key notifications are sealed with: derived from the pairing key, so the phone can keep it where a push can open
// it while the app is locked, and keep the pairing key itself behind the fingerprint. It opens notifications, and
// seals the press of a notification's button (n2d), which Orbit takes for two things only: stopping a thread and
// picking a harmless choice of an open question (mobile.ts, limitedRequest). The app derives the same key (Link.kt).
export const notifyKey = (key: Buffer): Buffer => createHmac('sha256', key).update('hive-notify-v1').digest()

export function seal(key: Buffer, pair: string, dir: Dir, msg: object): string {
  const nonce = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, nonce)
  c.setAAD(Buffer.from(`${pair}:${dir}`))
  const body = Buffer.concat([c.update(JSON.stringify(msg), 'utf8'), c.final()])
  return Buffer.concat([nonce, body, c.getAuthTag()]).toString('base64')
}

// the message, or null when the blob was not sealed with this key for this pair and direction
export function open(key: Buffer, pair: string, dir: Dir, blob: string): Record<string, unknown> | null {
  try {
    const b = Buffer.from(blob, 'base64')
    if (b.length < 12 + 16) return null
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
    d.setAAD(Buffer.from(`${pair}:${dir}`))
    d.setAuthTag(b.subarray(b.length - 16))
    const out = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()])
    const msg = JSON.parse(out.toString('utf8'))
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null
  } catch {
    return null
  }
}
