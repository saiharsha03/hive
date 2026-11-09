// Local files for the Preview panel, served through our own "hive-file" scheme.
// Each previewed file's folder gets a random host: hive-file://<token>/<file>. A page can only
// reach files inside that folder (its own images, CSS), never anything else on disk.
import { net, protocol, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEME = 'hive-file'

// HTML previews: their own folder, inline code, and a few well-known font / script CDNs (so mockups
// render). No fetch/XHR, forms, frames or plugins, and images only from the folder. A page can't read
// other files; the one way out left is a CDN request URL, which can carry only the page's own content.
const HTML_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

const roots = new Map<string, string>() // token -> folder
const tokens = new Map<string, string>() // folder -> token

// must run before app "ready"
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

// inside root (root itself counts); path.relative handles drive roots like C:\ and is case-insensitive on Windows
const within = (root: string, p: string) => {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function previewUrl(path: string): Promise<string> {
  if (!isLocalPath(path)) throw new Error('Only local drive paths can be previewed')
  const dir = await realpath(dirname(resolve(path)))
  let token = tokens.get(dir)
  if (!token) {
    token = randomBytes(12).toString('hex')
    tokens.set(dir, token)
    roots.set(token, dir)
  }
  return `${SCHEME}://${token}/${encodeURIComponent(basename(path))}`
}

export function handleScheme(): void {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    const root = roots.get(url.hostname)
    if (!root) return new Response('Unknown preview', { status: 403 })
    let file: string
    try {
      file = await realpath(resolve(root, '.' + decodeURIComponent(url.pathname)))
    } catch {
      return new Response('Not found', { status: 404 })
    }
    if (!within(root, file)) return new Response('Outside the previewed folder', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    // every document a preview can reach gets the policy (a page could navigate itself to an .svg or
    // .xml in its folder); PDFs are the exception, the policy would block Chromium's PDF viewer
    if (!/\.pdf$/i.test(file)) headers.set('Content-Security-Policy', HTML_CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

export async function readText(path: string): Promise<string> {
  if (!isLocalPath(path)) throw new Error('Only local drive paths can be previewed')
  return readFile(path, 'utf8')
}

// "Open outside" only opens documents and media in their Windows app; every other file
// (programs, scripts, shortcuts, anything unknown) is shown in Explorer instead
const SAFE_TO_OPEN = /\.(pdf|png|jpe?g|gif|webp|bmp|svg|avif|ico|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|txt|md|csv|tsv|json|log|docx?|xlsx?|pptx?|html?)$/i

export async function openExternal(path: string): Promise<string> {
  const clean = path.replace(/::\$DATA$/i, '').replace(/[. ]+$/, '')
  if (!isLocalPath(clean)) throw new Error('Only local drive paths can be opened')
  if (!SAFE_TO_OPEN.test(clean)) {
    shell.showItemInFolder(clean)
    return ''
  }
  return shell.openPath(clean)
}

// drive-letter paths only: no \\server\share or \\?\ device paths (those can leak the Windows login)
export const isLocalPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p)
