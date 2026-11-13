// The first start of Orbit copies Hive's data over (carryOverCore.ts says from where to where and what stays behind).
// Imported first in index.ts, so it runs before anything reads the state folder or Electron opens its storage. Hive's
// own folders are only read, never changed. Each place is copied into a side folder and renamed into place at the end,
// so a copy cut short is not taken for a finished one: it is left aside and the next start copies again.
import { app } from 'electron'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { carryOvers, skipOnCarry, type CarryKind } from '../shared/carryOverCore'
import { PRODUCT, STATE_FOLDER } from '../shared/edition'
import { TEST_MODE } from './testMode'

type Count = { files: number; skipped: number }

function copyTree(kind: CarryKind, from: string, to: string, rel: string, n: Count): void {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const r = rel ? `${rel}/${name}` : name
    const src = join(from, name)
    const dest = join(to, name)
    if (skipOnCarry(kind, r)) { n.skipped++; continue }
    const st = lstatSync(src)
    if (st.isDirectory()) copyTree(kind, src, dest, r, n)
    else if (st.isFile()) { cpSync(src, dest, { preserveTimestamps: true }); n.files++ }
    else if (st.isSymbolicLink()) { // a link (a junction) stays a link to the same place
      let dir: boolean
      try { dir = statSync(src).isDirectory() } catch { n.skipped++; continue } // it points nowhere
      symlinkSync(readlinkSync(src), dest, dir ? 'junction' : 'file'); n.files++
    }
    else n.skipped++ // a socket, a pipe: nothing to carry
  }
}

export function carryOverFromHive(): void {
  if (TEST_MODE || process.env.HIVE_DATA_DIR) return
  for (const c of carryOvers({ home: homedir(), appData: app.getPath('appData'), product: PRODUCT, stateFolder: STATE_FOLDER })) {
    if (existsSync(c.to) || !existsSync(c.from)) continue
    const side = `${c.to}.carrying`
    const n: Count = { files: 0, skipped: 0 }
    try {
      rmSync(side, { recursive: true, force: true })
      copyTree(c.kind, c.from, side, '', n)
      renameSync(side, c.to)
      console.log(`[carry-over] ${c.kind}: copied ${n.files} file${n.files === 1 ? '' : 's'} from Hive, left ${n.skipped} behind`)
    } catch (e) {
      console.warn(`[carry-over] ${c.kind}: not finished (${(e as NodeJS.ErrnoException)?.code ?? 'error'}) after ${n.files} files; the next start tries again`)
    }
  }
}

carryOverFromHive()
