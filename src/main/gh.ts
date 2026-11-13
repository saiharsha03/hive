// The one `gh` (GitHub CLI) runner, main process. A failure rejects with gh's first stderr line (or why it did not run).
import { execFile } from 'node:child_process'

export const gh = (args: string[], opts: { cwd?: string; timeout?: number } = {}) =>
  new Promise<string>((ok, bad) => {
    execFile('gh', args, { cwd: opts.cwd, timeout: opts.timeout ?? 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      (err ? bad(new Error((stderr || err.message).toString().trim().split('\n')[0])) : ok(stdout.toString())))
  })
