// Team roles: a library of roles (lead, builder, reviewer, ...) the Lead picks from, each with its instructions and a
// memory that every later teammate in that role starts with and adds to; plus one shared memory for all roles.
// Pure parts: the default roles, the role file format, and what goes into a teammate's brief.

export type Role = { id: string; name: string; summary: string; instructions: string }

// written once into the roles folder; the user can edit the files after that
export const DEFAULT_ROLES: Role[] = [
  { id: 'lead', name: 'Lead', summary: 'Plans the job, puts major to-dos on the team board, picks the team, settles disagreements, reports.',
    instructions: 'Break the job into board items with owners before anyone builds. Pick the fewest teammates that cover the job; roles may repeat. Chase open board items. Bring push, merge and deploy decisions to the user.' },
  { id: 'builder', name: 'Builder', summary: 'Writes the code for one part, in its own worktree, with tests.',
    instructions: 'Read the repo CLAUDE.md and the existing patterns before writing. Work in your own worktree. Keep changes small and tested; run the repo checks (typecheck, tests) before you call a part done. Agree interfaces with other builders through team_post before you code against them.' },
  { id: 'reviewer', name: 'Reviewer', summary: 'Reviews diffs for bugs, tenant scoping, reuse and over-engineering.',
    instructions: 'Review the exact commit you are given. Look for correctness bugs first, then authorization and tenant scoping, then reuse of existing helpers, then needless complexity. Post findings to the builder who owns the code, each with file:line and a concrete failure case. Say OK plainly when it is OK.' },
  { id: 'validator', name: 'Validator', summary: 'Runs the tests, data checks and builds that prove a part works.',
    instructions: 'Run the real gates (tests, coverage, dbt tests, builds) on the exact commit, inside Docker when the repo uses Docker. Report pass or fail with the command and the exit code, never a summary guess.' },
  { id: 'qa', name: 'QA', summary: 'Uses the product like a user and reports what breaks.',
    instructions: 'Click through the changed pages and flows on a local or staging stack (never production). Report each problem with steps, what you expected and what happened, and a screenshot path when you have one.' },
  { id: 'researcher', name: 'Researcher', summary: 'Finds facts in code, docs and data so builders do not guess.',
    instructions: 'Answer the question asked with sources (file paths, queries, links). Read-only unless told otherwise. Put lasting facts in knowledge.md.' },
]

// role.md: "# Name", a summary line, then the instructions
export const roleFile = (r: Role) => `# ${r.name}\n\n${r.summary}\n\n${r.instructions}\n`
export function parseRole(id: string, text: string): Role {
  const lines = text.replace(/\r/g, '').split('\n')
  const name = (lines.find((l) => l.startsWith('# ')) ?? `# ${id}`).slice(2).trim()
  const body = lines.filter((l) => !l.startsWith('# ')).join('\n').trim().split(/\n\s*\n/)
  return { id, name, summary: (body[0] ?? '').trim(), instructions: body.slice(1).join('\n\n').trim() }
}

// a role id from what the Lead typed: "Builders" / "builder" / "Senior Builder!" -> builder / senior-builder
export const roleId = (role: string) => role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/s$/, '') || 'teammate'

// the last lines of a memory file, so a brief stays short however long the memory grows
export function tail(text: string, maxLines = 60): string {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() && !l.startsWith('# '))
  return (lines.length > maxLines ? [`(${lines.length - maxLines} earlier lines in the file)`, ...lines.slice(-maxLines)] : lines).join('\n')
}

// the role part of a teammate's brief: instructions, role memory, shared memory, and how to add to them
export function roleBrief(r: Role, roleMemory: string, shared: string, paths: { role: string; shared: string }): string {
  return [
    `Your role, ${r.name}: ${r.summary}`,
    r.instructions,
    '',
    `What earlier ${r.name}s learned (${paths.role}):`,
    tail(roleMemory) || '(nothing yet)',
    '',
    `What every role learned (${paths.shared}):`,
    tail(shared) || '(nothing yet)',
    '',
    `Before you stop, save lessons that will help the next ${r.name} with mcp__orbit__remember (scope "role"), and lessons for everyone with scope "shared": `
      + 'gotchas, commands that worked, mistakes to avoid. Facts only this job needs go in knowledge.md (team_note) instead.',
  ].join('\n')
}

export const formatRoles = (roles: Role[]) => roles.map((r) => `- ${r.id}: ${r.summary}`).join('\n')

export const memoryLine = (text: string, by: string, now: number) =>
  `- ${text.trim().replace(/\n+/g, ' ')} (${by}, ${new Date(now).toISOString().slice(0, 10)})\n`
