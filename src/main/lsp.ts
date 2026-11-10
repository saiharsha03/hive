// Language servers for the editor: Pyright (Python, Django), typescript-language-server (TS/JS) and Volar (Vue), the
// servers VS Code itself runs. One server per language per repo (the folder with .git), started on the first file
// opened there and run with the app's own Node. The editor sends its open files and requests through here; the
// servers' diagnostics go back to it. A server with no open file for IDLE_MS stops; the next file opened starts it again.
// No Electron imports, so a script can drive it too.
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node'
import { langOf, languageIdOf, type Lang } from '../shared/editorCore'

type Server = { conn: MessageConnection; proc: ChildProcess; ready: Promise<void>; root: string; lang: Lang; open: Set<string>; idle: IdleStop }
export type Diagnostics = { uri: string; diagnostics: unknown[] }

const servers = new Map<string, Server>()
let onDiagnostics: (d: Diagnostics) => void = () => {}
export const setDiagnosticsSink = (f: (d: Diagnostics) => void) => { onDiagnostics = f }

export const uriOf = (file: string) => pathToFileURL(file).href

// A server with no open file stops after `ms`; a file opened meanwhile keeps it. arm: nothing open now; disarm: a file is
let IDLE_MS = 10 * 60_000
export const setLspIdleMs = (ms: number) => { IDLE_MS = ms } // tests
export type IdleStop = { arm: () => void; disarm: () => void }
export function idleStop(ms: () => number, stop: () => void): IdleStop {
  let t: ReturnType<typeof setTimeout> | undefined
  return {
    arm: () => { clearTimeout(t); t = setTimeout(stop, ms()); t.unref?.() },
    disarm: () => { clearTimeout(t); t = undefined },
  }
}
const req = createRequire(import.meta.url)
const pkg = (p: string) => dirname(req.resolve(`${p}/package.json`))

// the repo a file belongs to: the nearest folder with .git, else the file's own folder
export function rootOf(file: string): string {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d
    if (dirname(d) === d) return dirname(file)
  }
}

// the repo's own TypeScript when it has a JS-based one (TS 7 has no tsserver), else the one bundled with the app
function tsdk(root: string): string {
  const own = join(root, 'node_modules', 'typescript', 'lib')
  return existsSync(join(own, 'tsserver.js')) ? own : join(pkg('ts5'), 'lib')
}

// the repo's virtualenv, so Django and the other installed packages resolve
function pythonOf(root: string): string | undefined {
  for (const v of ['.venv', 'venv', 'env']) {
    const exe = process.platform === 'win32' ? join(root, v, 'Scripts', 'python.exe') : join(root, v, 'bin', 'python')
    if (existsSync(exe)) return exe
  }
  return undefined
}

function command(lang: Lang): string[] {
  if (lang === 'python') return [join(pkg('pyright'), 'langserver.index.js'), '--stdio']
  if (lang === 'typescript') return [join(pkg('typescript-language-server'), 'lib', 'cli.mjs'), '--stdio']
  return [join(pkg('@vue/language-server'), 'bin', 'vue-language-server.js'), '--stdio']
}

function initOptions(lang: Lang, root: string): unknown {
  if (lang === 'typescript') return { tsserver: { path: join(tsdk(root), 'tsserver.js') }, preferences: { includeCompletionsForModuleExports: true } }
  if (lang === 'vue') return { typescript: { tsdk: tsdk(root) }, vue: { hybridMode: false } }
  return {}
}

// what a server asks for through workspace/configuration
function settings(lang: Lang, root: string, section: string | undefined): unknown {
  if (lang !== 'python') return null
  const analysis = { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly', typeCheckingMode: 'basic' }
  if (section === 'python.analysis') return analysis
  if (section === 'python') return { pythonPath: pythonOf(root), analysis }
  return {}
}

const CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: true, resolveSupport: { properties: ['documentation', 'detail'] } }, contextSupport: true },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
    definition: { linkSupport: false },
    references: {},
    rename: { prepareSupport: true },
    publishDiagnostics: { relatedInformation: false },
  },
  workspace: { configuration: true, workspaceFolders: true },
  window: { workDoneProgress: false },
}

function start(lang: Lang, root: string): Server {
  const [script, ...args] = command(lang)
  const proc = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  const conn = createMessageConnection(new StreamMessageReader(proc.stdout!), new StreamMessageWriter(proc.stdin!))
  conn.onRequest('workspace/configuration', (p: any) => (p?.items ?? []).map((i: any) => settings(lang, root, i.section)))
  conn.onRequest('client/registerCapability', () => null)
  conn.onRequest('window/workDoneProgress/create', () => null)
  conn.onRequest('workspace/workspaceFolders', () => [{ uri: uriOf(root), name: root }])
  conn.onNotification('textDocument/publishDiagnostics', (p: any) => onDiagnostics({ uri: p.uri, diagnostics: p.diagnostics ?? [] }))
  conn.onError(() => {})
  conn.listen()
  const key = `${lang}:${root}`
  const idle = idleStop(() => IDLE_MS, () => { if (servers.get(key)?.proc === proc) servers.delete(key); try { conn.dispose(); proc.kill() } catch { /* gone */ } })
  proc.on('exit', () => { idle.disarm(); if (servers.get(key)?.proc === proc) servers.delete(key); conn.dispose() })
  const ready = conn.sendRequest('initialize', {
    processId: process.pid, rootUri: uriOf(root), rootPath: root, workspaceFolders: [{ uri: uriOf(root), name: root }],
    capabilities: CAPABILITIES, initializationOptions: initOptions(lang, root),
  }).then(() => { conn.sendNotification('initialized', {}) })
  idle.arm() // started for a request with no file open yet: it stops too if none is opened
  return { conn, proc, ready, root, lang, open: new Set(), idle }
}

function serverFor(file: string): Server | null {
  const lang = langOf(file)
  if (!lang) return null
  const root = rootOf(file)
  const key = `${lang}:${root}`
  let s = servers.get(key)
  if (!s) { s = start(lang, root); servers.set(key, s) }
  return s
}

export async function lspOpen(file: string, text: string): Promise<boolean> {
  const s = serverFor(file)
  if (!s) return false
  await s.ready
  if (s.open.has(file)) return true
  s.open.add(file)
  s.idle.disarm()
  await s.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: uriOf(file), languageId: languageIdOf(file), version: 1, text } })
  return true
}

export async function lspChange(file: string, text: string, version: number): Promise<void> {
  const s = serverFor(file)
  if (!s || !s.open.has(file)) return
  await s.ready
  await s.conn.sendNotification('textDocument/didChange', { textDocument: { uri: uriOf(file), version }, contentChanges: [{ text }] })
}

export async function lspSaved(file: string): Promise<void> {
  const s = serverFor(file)
  if (s?.open.has(file)) await s.conn.sendNotification('textDocument/didSave', { textDocument: { uri: uriOf(file) } })
}

export async function lspClose(file: string): Promise<void> {
  const s = servers.get(`${langOf(file)}:${rootOf(file)}`) // closing a file never starts a server
  if (!s?.open.delete(file)) return
  if (!s.open.size) s.idle.arm()
  await s.conn.sendNotification('textDocument/didClose', { textDocument: { uri: uriOf(file) } })
}

// any request for the server of this file (completion, hover, definition, references, rename, signature help)
export async function lspRequest(file: string, method: string, params: unknown): Promise<unknown> {
  const s = serverFor(file)
  if (!s) return null
  await s.ready
  // the document as the server knows it (the editor's URI spelling of the same file can differ: drive case, escapes)
  const p = params && typeof params === 'object' && 'textDocument' in params ? { ...params, textDocument: { uri: uriOf(file) } } : params
  return s.conn.sendRequest(method, p)
}

export function stopLanguageServers(): void {
  for (const s of servers.values()) { s.idle.disarm(); try { s.conn.dispose(); s.proc.kill() } catch { /* gone */ } }
  servers.clear()
}
