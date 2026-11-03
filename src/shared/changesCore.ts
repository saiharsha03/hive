// The Git tab's list of what a thread changed: once the thread opens a pull request, what went into it is done.

type ToolLike = { kind: string; name?: string; input?: unknown; status?: string }

// a shell command that opened a pull request (gh pr create, also through a wrapper script)
export const opensPr = (name: string | undefined, input: unknown): boolean =>
  (name === 'Bash' || name === 'PowerShell') && /\bpr\s+create\b/.test(String((input as { command?: unknown } | null)?.command ?? ''))

// the thread's items after the last pull request it opened successfully (all of them when it opened none)
export function sinceLastPr<T extends ToolLike>(items: T[]): T[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'tool' && it.status === 'done' && opensPr(it.name, it.input)) return items.slice(i + 1)
  }
  return items
}
