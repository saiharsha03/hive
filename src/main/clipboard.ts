// Clipboard suggestions: when the Hive window gains focus, offer what was copied elsewhere as a one-click paste.
// The clipboard is read only on focus (plus once when the page turns the feature on) and, as a hash only, on blur.
// The content stays in this process until the click; the page gets a thumbnail or a short preview, never the
// full item, and nothing is written to disk or logged.
import { clipboard, nativeImage, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { blurred, dismissed, emptySeen, looksSecret, OFFER_MS, offered, shouldOffer, textLabel, type ClipOffer, type ClipTake, type Seen } from '../shared/clipboardCore'

type Pending = { offer: ClipOffer; png?: Buffer; text?: string; timer: NodeJS.Timeout }

let enabled = false
let seen: Seen = emptySeen()
let pending: Pending | null = null
let win: BrowserWindow | null = null
let reads = 0 // the clipboard reads are async: only the newest one may act

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

// what is on the clipboard now: an image wins over text; text only when non-empty
async function current(): Promise<{ hash: string; png?: Buffer; text?: string } | null> {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const png = nativeImage.createFromBuffer(Buffer.from(await ((await item.getType(type)) as Blob).arrayBuffer())).toPNG()
      if (png.length) return { hash: `i:${sha(png)}`, png }
    }
    const text = await clipboard.readText()
    if (text.trim()) return { hash: `t:${sha(text)}`, text }
  } catch { /* clipboard busy or an unreadable format: nothing to offer */ }
  return null
}

function send(offer: ClipOffer | null) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('clipboard:offer', offer)
}

function clear() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending = null
  send(null)
}

async function check() {
  if (!enabled) return
  const n = ++reads
  const c = await current()
  if (n !== reads || !enabled || !c || !shouldOffer(seen, c.hash)) return
  seen = offered(seen, c.hash)
  if (c.text !== undefined && looksSecret(c.text)) return // never offered, and not looked at again
  let offer: ClipOffer
  if (c.png) {
    const image = nativeImage.createFromBuffer(c.png)
    offer = { id: c.hash, kind: 'image', thumb: (image.getSize().height > 96 ? image.resize({ height: 96 }) : image).toDataURL() }
  } else {
    offer = { id: c.hash, kind: 'text', length: c.text!.length, ...textLabel(c.text!) }
  }
  if (pending) clearTimeout(pending.timer)
  pending = { offer, png: c.png, text: c.text, timer: setTimeout(clear, OFFER_MS) }
  send(offer)
}

export function watchClipboard(w: BrowserWindow) {
  win = w
  w.on('focus', () => void check())
  w.on('blur', async () => {
    if (!enabled) return
    const n = ++reads
    const c = await current()
    if (n === reads) seen = blurred(seen, c?.hash ?? null)
  })
}

// the page's switch; turning it on (including at page load) checks once and re-sends an offer a reload lost
export async function setClipboardEnabled(on: boolean) {
  enabled = on
  if (!on) return clear()
  const before = pending
  await check()
  if (pending && pending === before) send(pending.offer)
}

// the click: hand over the full item, once
export function takeClipboard(id: string): ClipTake | null {
  if (!pending || pending.offer.id !== id) return null
  const { png, text } = pending
  clear()
  return png ? { kind: 'image', dataUrl: `data:image/png;base64,${png.toString('base64')}` } : { kind: 'text', text: text ?? '' }
}

export function dismissClipboard(id: string) {
  seen = dismissed(seen, String(id))
  if (pending?.offer.id === id) clear()
}
