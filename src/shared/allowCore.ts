// IP allowlist button: the status the main process sends and the result of one run (see src/main/ipAllow.ts).
export type AllowStatus = { configured: boolean; ip: string | null; lastIp: string | null; at: string | null; changed: boolean; running: boolean; error: string }
export type AllowRun = { ok: boolean; ip: string | null; output: string }

const DENIED = /UnauthorizedOperation|not authorized to perform/i

// the command printed a failure even when it exited 0 (the allowlist script reports AWS errors and still exits 0).
// A group the user's account may not change (an access denial) is skipped, not a failure, as long as some group took the IP.
export function runFailed(code: number | null, output: string): boolean {
  if (code !== 0) return true
  const lines = output.split('\n')
  const rest = lines.filter((l) => !DENIED.test(l)).join('\n')
  if (/\bfailed\b|traceback|\berror\b/i.test(rest)) return true
  return rest.length < output.length && !/already exists|successfully/i.test(rest)
}
