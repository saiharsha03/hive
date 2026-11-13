// Atomic-ish file save that never throws. Writes a temp file and renames it over the target; on Windows that rename
// fails with EPERM/EBUSY while anything (antivirus, an indexer, a second Orbit) has the target open, so retry briefly,
// then write in place. A throw here would be an uncaught exception in main and take the whole app down.
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export function writeFileSafe(file: string, text: string): boolean {
  const tmp = `${file}.hive-tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, text)
    for (let i = 0; i < 5; i++) {
      try { renameSync(tmp, file); return true } catch { pause(40) }
    }
    writeFileSync(file, text)
    try { unlinkSync(tmp) } catch { /* left for the next save */ }
    return true
  } catch (e) {
    console.error(`[hive] could not save ${file}:`, e)
    return false
  }
}
