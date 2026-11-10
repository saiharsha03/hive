// Codex as a subagent: one fresh `codex exec` run per task, on the user's own Codex login.
// Its JSON event stream is turned into short activity lines for the live box in the tab.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

let exe: string | null | undefined
function codexExecutable(): string | null {
  if (exe === undefined) {
    const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
    const dirs = [
      ...(process.env.PATH ?? '').split(delimiter),
      join(homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin'),
    ]
    exe = dirs.map((d) => join(d, name)).find((p) => existsSync(p)) ?? null
  }
  return exe
}

export type CodexRun = {
  task: string
  folder: string
  model?: string
  effort?: string
  allowEdits?: boolean
  onLine: (line: string) => void // one line of live activity
}
export type CodexResult = { ok: boolean; answer: string }

// "powershell.exe -Command '...'" -> just the command Codex ran
const shortCommand = (c: string) =>
  String(c).replace(/^"?[^"]*powershell(\.exe)?"?\s+-Command\s+/i, '').replace(/^'|'$/g, '').replace(/\s+/g, ' ').slice(0, 160)

function describe(e: any): string | null {
  const it = e.item ?? {}
  if (e.type === 'item.started' && it.type === 'command_execution') return `$ ${shortCommand(it.command)}`
  if (e.type === 'item.completed') {
    if (it.type === 'command_execution') return `  exit ${it.exit_code ?? '?'}`
    if (it.type === 'agent_message') return String(it.text ?? '').trim() || null
    if (it.type === 'reasoning') return `thinking: ${String(it.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`
    if (it.type === 'file_change') return `edited: ${(it.changes ?? []).map((c: any) => c.path).join(', ')}`
    if (it.type === 'mcp_tool_call') return `tool: ${it.server ?? ''}.${it.tool ?? ''}`
    if (it.type === 'web_search') return `searched: ${it.query ?? ''}`
  }
  if (e.type === 'turn.failed' || e.type === 'error') return `error: ${e.error?.message ?? e.message ?? 'Codex failed'}`
  return null
}

export function runCodex(run: CodexRun, track: (p: ChildProcess) => void): Promise<CodexResult> {
  const bin = codexExecutable()
  if (!bin) return Promise.resolve({ ok: false, answer: 'Codex is not installed (codex.exe not found).' })
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-C', run.folder,
    '-s', run.allowEdits ? 'workspace-write' : 'read-only']
  if (run.model) args.push('-m', run.model)
  if (run.effort) args.push('-c', `model_reasoning_effort="${run.effort}"`)
  args.push('-')

  return new Promise((resolve) => {
    const p = spawn(bin, args, { cwd: run.folder, windowsHide: true })
    track(p)
    let answer = ''
    let failed = ''
    let buf = ''
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue
        let e: any
        try { e = JSON.parse(line) } catch { continue }
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') answer = String(e.item.text ?? '')
        if (e.type === 'turn.failed' || e.type === 'error') failed = e.error?.message ?? e.message ?? 'Codex failed'
        const d = describe(e)
        if (d) run.onLine(d)
      }
    })
    p.on('error', (err) => resolve({ ok: false, answer: `Codex could not start: ${err.message}` }))
    p.on('close', (code) => resolve(code === 0 && !failed
      ? { ok: true, answer: answer || '(Codex finished without a final message)' }
      : { ok: false, answer: failed || answer || `Codex exited with code ${code}` }))
    p.stdin.end(run.task)
  })
}
