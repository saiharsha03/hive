// Where a rewind forks, read from the transcript file line by line (a transcript can be hundreds of MB, so it is never
// read as one string). shared/rewindCore.forkPoint decides; it only needs the rewound message's line, its parent's line
// and how many entries hang off that parent, so those are what is kept: one pass finds the message and counts children,
// a second fetches the parent's line.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { forkPoint } from '../shared/rewindCore'

async function eachLine(path: string, f: (line: string) => boolean | void): Promise<void> {
  const input = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) if (f(line) === false) break
  } finally { rl.close(); input.destroy() }
}

const parse = (line: string): any => { try { return JSON.parse(line) } catch { return null } }

export async function forkPointOfFile(path: string, uuid: string): Promise<ReturnType<typeof forkPoint>> {
  const quoted = JSON.stringify(uuid)
  let hit: string | null = null
  let hitParent: string | null = null
  const children = new Map<string, number>()
  try {
    await eachLine(path, (line) => {
      if (!line.startsWith('{')) return
      // the parent of every line is counted without parsing the line when it can be found as text
      const pm = line.match(/"parentUuid":"([^"]+)"/)
      if (pm) children.set(pm[1], (children.get(pm[1]) ?? 0) + 1)
      if (!line.includes(quoted)) return // the last such line wins, as in forkPoint
      const e = parse(line)
      if (e?.type === 'user' && e.uuid === uuid) { hit = line; hitParent = e.parentUuid ?? null }
    })
  } catch { return forkPoint('', uuid) }
  if (!hit) return forkPoint('', uuid)
  let parent: string | null = null
  if (hitParent) {
    const p = JSON.stringify(hitParent)
    await eachLine(path, (line) => {
      if (!line.includes(p)) return
      const e = parse(line)
      if (e?.uuid === hitParent) { parent = line; return false }
    }).catch(() => {})
  }
  // the same answer forkPoint gives on the whole transcript: the parent, the message, and the parent's other children
  // (only whether there is more than one matters)
  const others = Math.max(0, (hitParent ? children.get(hitParent) ?? 0 : 0) - 1)
  const extra = Array.from({ length: Math.min(others, 1) }, (_, i) => JSON.stringify({ uuid: `hive-other-child-${i}`, parentUuid: hitParent }))
  return forkPoint([...(parent ? [parent] : []), hit, ...extra].join('\n'), uuid)
}
