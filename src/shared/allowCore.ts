// IP allowlist button: the status the main process sends and the result of one run (see src/main/ipAllow.ts).
export type AllowStatus = { configured: boolean; ip: string | null; lastIp: string | null; at: string | null; changed: boolean; running: boolean; error: string }
export type AllowRun = { ok: boolean; ip: string | null; output: string }

// the command printed a failure even when it exited 0 (the allowlist script reports AWS errors and still exits 0)
export const runFailed = (code: number | null, output: string): boolean => code !== 0 || /\bfailed\b|traceback|\berror\b/i.test(output)
