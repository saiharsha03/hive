// The editor's files: read and save text with the time it was last changed on disk (so the editor can tell when
// something else changed it), and the "Open in VS Code" hand-off for what Hive's editor does not do (debugging).
import { readFile, stat, writeFile } from 'node:fs/promises'
import { isLocalPath } from './preview'

const MAX = 20 * 1024 * 1024 // a bigger file is not a text file anyone edits by hand

// local drive paths only, like Preview: a network (UNC) path would make Windows send the login to that machine
function local(path: string): string {
  if (!isLocalPath(path)) throw new Error('Only files on a local drive open in the editor')
  return path
}

export async function editorRead(path: string): Promise<{ text: string; mtime: number }> {
  const st = await stat(local(path))
  if (st.size > MAX) throw new Error(`${path} is ${Math.round(st.size / 1048576)} MB, too big to open in the editor`)
  return { text: await readFile(path, 'utf8'), mtime: st.mtimeMs }
}

export async function editorMtime(path: string): Promise<number | null> {
  try { return (await stat(local(path))).mtimeMs } catch { return null }
}

export async function editorWrite(path: string, text: string): Promise<number> {
  await writeFile(local(path), text, 'utf8')
  return (await stat(path)).mtimeMs
}

// VS Code's own link for a file at a line (no shell, so no path can turn into a command)
export const vsCodeUrl = (path: string, line: number) =>
  `vscode://file/${encodeURI(path.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')}:${Math.max(1, Math.floor(line))}`
