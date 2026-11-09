// The sealed link between Hive and the phone app: AES-256-GCM with the key from pairing, a fresh 12-byte nonce per
// message, and the pair id plus the direction as associated data (a blob sealed for one direction never opens in the
// other). Each message carries a counter; a counter not above the last one seen is a replay and is refused.
// The relay in between only ever sees the base64 blob.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type Dir = 'd2p' | 'p2d' // desk (Hive) to phone, phone to desk

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
    return msg && typeof msg === 'object' ? msg : null
  } catch {
    return null
  }
}
