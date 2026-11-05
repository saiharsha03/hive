// Team roles on disk: ~/.claude/hive/roles/<id>/role.md (instructions, editable) and memory.md (what every teammate
// in that role learned, kept across teams), plus ~/.claude/hive/roles/shared-memory.md for all roles. The default
// roles are written on first use; a role the Lead names that does not exist yet gets a folder of its own.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './testMode'
import { writeFileSafe } from './safeWrite'
import { DEFAULT_ROLES, memoryLine, parseRole, roleBrief, roleFile, roleId, type Role } from '../shared/roleCore'

export const rolesDir = () => process.env.HIVE_ROLES_DIR || join(dataDir(), 'hive', 'roles')
const sharedFile = () => join(rolesDir(), 'shared-memory.md')
const read = (f: string) => { try { return readFileSync(f, 'utf8') } catch { return '' } }

function seed(): void {
  const root = rolesDir()
  for (const r of DEFAULT_ROLES) {
    const dir = join(root, r.id)
    if (existsSync(join(dir, 'role.md'))) continue
    mkdirSync(dir, { recursive: true })
    writeFileSafe(join(dir, 'role.md'), roleFile(r))
    if (!existsSync(join(dir, 'memory.md'))) writeFileSafe(join(dir, 'memory.md'), `# What ${r.name}s learned\n\n`)
  }
  if (!existsSync(sharedFile())) writeFileSafe(sharedFile(), '# What every role learned\n\n')
}

export function listRoles(): Role[] {
  seed()
  return readdirSync(rolesDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(rolesDir(), d.name, 'role.md')))
    .map((d) => parseRole(d.name, read(join(rolesDir(), d.name, 'role.md'))))
    .sort((a, b) => (a.id === 'lead' ? -1 : b.id === 'lead' ? 1 : a.id.localeCompare(b.id)))
}

// the role for what the Lead typed; a new one is created with a plain description so its memory can grow
export function ensureRole(role: string): Role {
  seed()
  const id = roleId(role)
  const dir = join(rolesDir(), id)
  if (!existsSync(join(dir, 'role.md'))) {
    mkdirSync(dir, { recursive: true })
    writeFileSafe(join(dir, 'role.md'), roleFile({ id, name: role.trim(), summary: `${role.trim()} on the team.`, instructions: 'Do the task you are given; ask the Lead when the scope is unclear.' }))
    writeFileSafe(join(dir, 'memory.md'), `# What ${role.trim()}s learned\n\n`)
  }
  return parseRole(id, read(join(dir, 'role.md')))
}

export const roleMemoryPath = (id: string) => join(rolesDir(), id, 'memory.md')
export const sharedMemoryPath = () => sharedFile()

// the role part of a teammate's brief, with both memories as they are now
export function briefForRole(role: string): string {
  const r = ensureRole(role)
  return roleBrief(r, read(roleMemoryPath(r.id)), read(sharedFile()), { role: roleMemoryPath(r.id), shared: sharedFile() })
}

export function remember(scope: 'role' | 'shared', role: string, text: string, by: string, now = Date.now()): string {
  const file = scope === 'shared' ? sharedFile() : roleMemoryPath(ensureRole(role).id)
  appendFileSync(file, memoryLine(text, by, now))
  return file
}

// a role the Lead writes (or rewrites): kept in the library for every later team; its memory is left as it is
export function defineRole(name: string, summary: string, instructions: string): Role {
  seed()
  const id = roleId(name)
  const dir = join(rolesDir(), id)
  mkdirSync(dir, { recursive: true })
  const r: Role = { id, name: name.trim(), summary: summary.trim(), instructions: instructions.trim() }
  writeFileSafe(join(dir, 'role.md'), roleFile(r))
  if (!existsSync(join(dir, 'memory.md'))) writeFileSafe(join(dir, 'memory.md'), `# What ${r.name}s learned\n\n`)
  return r
}
