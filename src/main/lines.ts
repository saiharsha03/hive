// Whole lines of a file from a byte offset, read in chunks, with the byte offset where the last whole line ended: a
// half-written last line is left for the next read. For transcripts, which only grow and can be hundreds of MB.
import { open } from 'node:fs/promises'

const CHUNK = 4 * 1024 * 1024

export async function readLines(path: string, from: number, onLine: (line: string) => void, to?: number): Promise<number> {
  const fh = await open(path, 'r')
  try {
    const end = to ?? (await fh.stat()).size
    let pos = from
    let carry = Buffer.alloc(0)
    let done = from
    while (pos < end) {
      const n = Math.min(CHUNK, end - pos)
      const buf = Buffer.alloc(n)
      const { bytesRead } = await fh.read(buf, 0, n, pos)
      if (!bytesRead) break
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      const last = data.lastIndexOf(0x0a)
      if (last < 0) carry = data
      else {
        for (const line of data.subarray(0, last).toString('utf8').split('\n')) onLine(line.endsWith('\r') ? line.slice(0, -1) : line)
        carry = data.subarray(last + 1)
        done = pos + bytesRead - carry.length
      }
      pos += bytesRead
    }
    return done
  } finally { await fh.close() }
}
