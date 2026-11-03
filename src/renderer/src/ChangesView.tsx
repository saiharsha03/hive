// Changes: the focused thread's changed files (its repo's working tree, plus the files the agent edited in this
// thread). The one picked shows in the Git view's diff panel below; commit and push live there too.
import { useEffect, useMemo, useState } from 'react'
import type { Session } from './chat'
import type { DiffSpec } from './DiffPanel'
import { counts, FILE_TOOLS, type Hunk } from '../../shared/diffCore'
import type { Detail, Entry, FileArea } from '../../shared/gitCore'
import { hunksOf, shortPath } from './SessionView'
import { Icon } from './ui'

type Row = { key: string; path: string; letter: string; add?: number; del?: number; spec: DiffSpec; agent: boolean }
const LETTER_CLASS: Record<string, string> = { M: 'g-modified', A: 'g-added', '?': 'g-untracked', U: 'g-untracked', D: 'g-deleted', R: 'g-renamed', C: 'g-renamed' }
const base = (p: string) => p.split('/').at(-1) ?? p
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')

// the agent's edits in this thread, one row per file with the counts of all its edits
function agentEdits(s: Session | null): { file: string; label: string; tool: string; hunks: Hunk[] }[] {
  if (!s) return []
  const by = new Map<string, { file: string; label: string; tool: string; hunks: Hunk[] }>()
  for (const it of s.items) {
    if (it.kind !== 'tool' || !FILE_TOOLS.includes(it.name) || it.status === 'error' || typeof it.input?.file_path !== 'string') continue
    const file = it.input.file_path as string
    const prev = by.get(file.toLowerCase())
    const hunks = hunksOf(it)
    by.set(file.toLowerCase(), { file, label: shortPath(file, s.cwd), tool: it.name, hunks: prev ? [...prev.hunks, ...hunks] : hunks })
  }
  return [...by.values()]
}

// diff = this list's pick; shown = the Git view's diff panel shows something (this pick or a repo file)
export function ChangesView({ session, diff, shown, onDiff, onOpenGit }: {
  session: Session | null; diff: DiffSpec | null; shown: boolean; onDiff: (s: DiffSpec | null) => void; onOpenGit: () => void
}) {
  const [repo, setRepo] = useState<{ dir: string; name: string } | null>(null)
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const where = session?.worktrees?.at(-1)?.path ?? session?.cwd ?? ''

  useEffect(() => {
    let live = true
    setD(null); setErr(''); setRepo(null)
    if (!where) return
    window.api.gitLocate(`${where.replace(/[\\/]+$/, '')}/.`).then(async (at) => {
      if (!live) return
      if (!at) { setErr('This thread\'s folder is not in a repo the Git view lists.'); return }
      setRepo({ dir: at.dir, name: at.name })
      const x = await window.api.gitDetail(at.dir)
      if (live) setD(x)
    }).catch((e) => live && setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => { live = false }
  }, [where, n])
  // re-read after the agent edits a file in this thread
  const edits = useMemo(() => agentEdits(session), [session?.items])
  useEffect(() => { const t = setTimeout(() => setN((x) => x + 1), 600); return () => clearTimeout(t) }, [edits.length])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    const seen = new Set<string>()
    if (d && repo) {
      const add = (e: Entry, area: FileArea) => {
        if (seen.has(e.path)) return
        seen.add(e.path)
        out.push({ key: `${area}:${e.path}`, path: e.path, letter: area === 'untracked' ? 'U' : e.letter, add: e.add, del: e.del, agent: false,
          spec: { t: 'file', dir: repo.dir, repo: repo.name, path: e.path, area, orig: area === 'staged' ? e.orig : undefined } })
      }
      d.unstaged.forEach((e) => add(e, 'unstaged'))
      d.staged.forEach((e) => add(e, 'staged'))
      d.untracked.forEach((e) => add(e, 'untracked'))
    }
    // edits outside the repo (or already committed) still show, from the conversation
    for (const e of edits) {
      const rel = repo ? shortPath(e.file, repo.dir) : e.label
      if (seen.has(rel)) continue
      const c = counts(e.hunks)
      out.push({ key: `edit:${e.file}`, path: e.label, letter: 'E', add: c.add, del: c.del, agent: true, spec: { t: 'edit', file: e.file, label: e.label, tool: e.tool, hunks: e.hunks } })
    }
    return out
  }, [d, repo, edits])

  const tot = rows.reduce((a, r) => ({ add: a.add + (r.add ?? 0), del: a.del + (r.del ?? 0) }), { add: 0, del: 0 })
  const selKey = diff ? (diff.t === 'file' ? diff.path : diff.t === 'edit' ? diff.label : '') : ''
  // pick the first file when the diff panel shows nothing yet (never over a repo file picked in the Git panel)
  useEffect(() => { if (!shown && rows.length) onDiff(rows[0].spec) }, [rows.length > 0, session?.id])

  if (!session) return <div className="pane-empty">Open a thread to see what it changed.</div>
  return (
    <div className="changes" data-testid="changes-view">
      <div className="files">
        <div className="fh">
          <b>{rows.length} file{rows.length === 1 ? '' : 's'} changed</b>
          {rows.length > 0 && <span><span className="dv-add">+{tot.add}</span> <span className="dv-del">−{tot.del}</span></span>}
          {repo && <span className="dim">{repo.name}{d?.branch ? ` on ${d.branch}` : ''}</span>}
          <span className="acts">
            <button onClick={() => setN((x) => x + 1)} title="Re-read the working tree" data-testid="changes-refresh"><Icon name="refresh" /></button>
            <button className="pri" onClick={onOpenGit} title="Stage, commit and push in the Git view" data-testid="changes-commit"><Icon name="git-commit" />Commit…</button>
          </span>
        </div>
        <div className="flist">
          {err && <div className="hint">{err}</div>}
          {!err && !d && !edits.length && <div className="hint">Reading changes…</div>}
          {d && !rows.length && <div className="hint">No changes.</div>}
          {rows.map((r) => (
            <button key={r.key} className={`fr ${LETTER_CLASS[r.letter] ?? ''}${selKey && (r.path === selKey) ? ' on' : ''}`} onClick={() => onDiff(r.spec)} title={r.path} data-testid={`changes-file-${r.path}`}>
              <Icon name={r.agent ? 'edit' : 'file'} className="ficon-c" />
              <span className="fname">{base(r.path)}</span>
              <span className="fdir">{dirOf(r.path)}</span>
              <span className="fnum">{r.add !== undefined && <><span className="dv-add">+{r.add}</span> <span className="dv-del">−{r.del}</span></>}</span>
              <span className="gletter" title={r.agent ? 'Edited by the agent in this thread' : undefined}>{r.letter}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
