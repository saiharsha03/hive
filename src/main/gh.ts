// The one `gh` (GitHub CLI) runner, main process. A failure rejects with gh's first stderr line (or why it did not run).
// gh reads only; ghWrite is the one way to change GitHub (a pull request merge, auto-merge on or off: exactly the
// shapes allowedGhWrite lists), so a read path cannot write by accident.
import { execFile } from 'node:child_process'
import { allowedGhWrite } from '../shared/prCore'

const runGh = (args: string[], opts: { cwd?: string; timeout?: number }) =>
  new Promise<string>((ok, bad) => {
    execFile('gh', args, { cwd: opts.cwd, timeout: opts.timeout ?? 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      (err ? bad(new Error((stderr || err.message).toString().trim().split('\n')[0])) : ok(stdout.toString())))
  })

const isMerge = (args: string[]) => args[0] === 'pr' && args[1] === 'merge'

export const gh = (args: string[], opts: { cwd?: string; timeout?: number } = {}) =>
  (isMerge(args) ? Promise.reject(new Error('gh: a merge goes through ghWrite')) : runGh(args, opts))

export const ghWrite = (args: string[], opts: { cwd?: string; timeout?: number } = {}) =>
  (allowedGhWrite(args) ? runGh(args, opts) : Promise.reject(new Error(`gh: ${args.slice(0, 2).join(' ')} is not a write Hive makes`)))
