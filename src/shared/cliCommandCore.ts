// Claude Code commands that only the interactive CLI can run (/design-login, /login, /mcp, /config, ...): the SDK
// answers "/x isn't available in this environment", and Orbit runs the same command in the real CLI in the thread's
// terminal. Pure, so it can be tested without Electron.

// the command the engine said it cannot run here, or null. Only a plain /name (letters, digits, : . _ -) is taken,
// so nothing else from the message can reach the shell line
export function cliOnlyCommand(content: unknown): string | null {
  const m = String(content ?? '').match(/(\/[\w:.-]+) isn't available in this environment/)
  return m ? m[1] : null
}

// what is typed in the thread's shell: the CLI, opened on that command
export const cliLine = (command: string): string => `claude "${command}"`
