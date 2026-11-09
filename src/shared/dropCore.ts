// Drop a file on the Hive window to start work on it: which files count, the choices, and the new thread's first message.
// Pure, so it can be tested without Electron.
export const DROP_TYPES = ['csv', 'xlsx', 'xls', 'pdf', 'json']

export type DropChoice = { id: string; skill: string; label: string; title: string }

// HIVE_DROP_SKILLS in the .env: "Title:skill-name" pairs, comma separated, one button each.
// Empty or missing: dropping a file only says how to turn this on.
export function parseDropChoices(v: string | undefined): DropChoice[] {
  return (v ?? '').split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const i = p.lastIndexOf(':')
    const title = (i > 0 ? p.slice(0, i) : p).trim()
    const skill = (i > 0 ? p.slice(i + 1) : p).trim()
    return title && skill ? [{ id: skill, skill, title, label: `${title} (${skill} skill)` }] : []
  })
}

export const extOf = (path: string) => (path.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase()
export const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path

// the first dropped file Hive can start work on (absolute paths only), or null
export function pickDropFile(paths: string[]): string | null {
  return paths.find((p) => /^([A-Za-z]:[\\/]|[\\/])/.test(p) && DROP_TYPES.includes(extOf(p))) ?? null
}

export const dropMessage = (c: DropChoice, path: string) => `Use the ${c.skill} skill on the file at ${path}`
export const dropTitle = (c: DropChoice, path: string) => `${c.title}: ${fileName(path)}`
