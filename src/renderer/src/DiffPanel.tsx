// Right-hand diff panel (where the Preview opens): a file's working-tree or staged diff or a commit from the Git panel,
// or what one of the agent's Edit / MultiEdit / Write calls changed.
import { useEffect, useState } from 'react'
import { DiffModeToggle, DiffView } from './DiffView'
import { counts, type FileDiff, type Hunk } from '../../shared/diffCore'
import { parseUnifiedDiff, type FileArea } from '../../shared/gitCore'

export type DiffSpec =
  | { t: 'file'; dir: string; repo: string; path: string; area: FileArea; orig?: string }
  | { t: 'commit'; dir: string; repo: string; sha: string; title: string }
  | { t: 'edit'; file: string; label: string; tool: string; hunks: Hunk[] }

const AREA: Record<FileArea, string> = { staged: 'staged', unstaged: 'not staged', untracked: 'untracked' }

function FileBlock({ f, onShowAll, head }: { f: FileDiff; onShowAll?: () => void; head: boolean }) {
  const c = counts(f.hunks)
  return (
    <div className="dv-file">
      {head && (
        <div className="dv-fhead">
          <span className="dv-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
          <span className="dv-add">+{c.add}</span><span className="dv-del">−{c.del}</span>
        </div>
      )}
      {f.binary ? <div className="dv-none">Binary file changed.</div> : <DiffView hunks={f.hunks} onShowAll={onShowAll} />}
    </div>
  )
}

export function DiffPanel({ spec, onClose, onOpenInGit }: { spec: DiffSpec; onClose: () => void; onOpenInGit: (file: string) => void }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [err, setErr] = useState('')
  const [full, setFull] = useState(false)
  const [n, setN] = useState(0) // Reload

  useEffect(() => { setFull(false) }, [spec])
  useEffect(() => {
    if (spec.t === 'edit') { setErr(''); setFiles([{ path: spec.label, binary: false, hunks: spec.hunks }]); return }
    let live = true
    setErr('')
    const text = spec.t === 'file' ? window.api.gitDiff(spec.dir, spec.path, spec.area, full, spec.orig) : window.api.gitShow(spec.dir, spec.sha)
    text.then((t) => live && setFiles(parseUnifiedDiff(t))).catch((e) => live && setErr(String(e?.message ?? e)))
    return () => { live = false }
  }, [spec, full, n])

  const title = spec.t === 'file' ? spec.path : spec.t === 'edit' ? spec.label : `${spec.sha.slice(0, 7)} ${spec.title}`
  const sub = spec.t === 'file' ? `${spec.repo}, ${AREA[spec.area]}` : spec.t === 'edit' ? `${spec.tool} by the agent` : spec.repo
  return (
    <aside data-testid="diff-panel" className="preview diffpanel">
      <div className="pv-head" title={title}>
        <span className="pv-name">{title}<span className="dv-sub">{sub}</span></span>
        <DiffModeToggle />
        {spec.t === 'edit'
          ? <button data-testid="diff-button-1" className="link" onClick={() => onOpenInGit(spec.file)} title="The file's whole uncommitted diff, in the Git panel">Open in Git panel</button>
          : <button data-testid="diff-button-2" className="link" onClick={() => setN((x) => x + 1)}>Reload</button>}
        <button data-testid="diff-button-3" className="x pv-x" aria-label="Close diff" onClick={onClose}>×</button>
      </div>
      <div className="pv-body dv-body">
        {err && <div className="pv-msg">{err}</div>}
        {!err && !files && <div className="pv-msg">Loading…</div>}
        {!err && files && !files.length && <div className="pv-msg">No changes to show.</div>}
        {!err && files?.map((f, i) => (
          <FileBlock key={`${f.path}-${i}`} f={f} head={spec.t === 'commit'} onShowAll={spec.t === 'file' && !full ? () => setFull(true) : undefined} />
        ))}
      </div>
    </aside>
  )
}
