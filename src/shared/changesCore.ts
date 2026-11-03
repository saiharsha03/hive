// The Git tab's list of what a thread changed: once the thread opens a pull request, what went into it is done.

type ToolLike = { kind: string; name?: string; input?: unknown; status?: string }

// one command of a shell line that runs gh (or a gh wrapper script) with pr create; variable assignments, & and sh may lead
const GH_PR_CREATE = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:&\s*)?(?:(?:ba)?sh\s+)?(?:\S*[\\/])?(?:gh(?:\.exe)?|[\w.-]*gh\.sh)\s+pr\s+create\b/
// a shell command that opened a pull request (gh pr create, also through a wrapper script); not a grep or echo of it
export const opensPr = (name: string | undefined, input: unknown): boolean => {
  if (name !== 'Bash' && name !== 'PowerShell') return false
  const cmd = String((input as { command?: unknown } | null)?.command ?? '')
    .split('<<')[0] // a heredoc body is text, not commands
    // a quoted string is one word: its spaces and separators can never start a command ("C:\Program Files\...\gh.exe" stays a path)
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => q.slice(1, -1).replace(/[\s;&|]/g, '_'))
  return cmd.split(/&&|\|\||\$\(|`|[;\n|()]/).some((part) => GH_PR_CREATE.test(part.trim())) // $( ) and backticks start commands too
}

// the thread's items after the last pull request it opened successfully (all of them when it opened none)
export function sinceLastPr<T extends ToolLike>(items: T[]): T[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'tool' && it.status === 'done' && opensPr(it.name, it.input)) return items.slice(i + 1)
  }
  return items
}
