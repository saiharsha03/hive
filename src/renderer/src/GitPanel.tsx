// Git panel: source control for the repos Hive lists and their worktrees; plain git, no Claude.
// Diffs open in the right-hand panel. No discard / reset / clean: nothing here throws work away.
import { useEffect, useRef, useState } from 'react'
import { DiffModeToggle } from './DiffView'
import type { DiffSpec } from './DiffPanel'
import { relativeTime, type Commit, type Detail, type Entry, type FileArea, type GitRow } from '../../shared/gitCore'

const ab = (r: { upstream: string | null; ahead: number; behind: number }) =>
  (!r.upstream ? 'no upstream' : !r.ahead && !r.behind ? 'up to date' : [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(' '))

// focus: open this repo's view (from a chat diff's "Open in Git panel"); n changes on every request
export function GitPanel({ onDiff, focus }: { onDiff: (s: DiffSpec) => void; focus?: { dir: string; n: number } | null }) {
  const [rows, setRows] = useState<GitRow[] | null>(null)
  const [listErr, setListErr] = useState('')
  const [sel, setSel] = useState<GitRow | null>(null)

  const loadList = () => {
    setListErr('')
    window.api.gitList().then(setRows).catch((e) => setListErr(String(e?.message ?? e)))
  }
  useEffect(loadList, [])
  const focused = useRef(0)
  useEffect(() => {
    if (!focus || !rows || focused.current === focus.n) return
    focused.current = focus.n
    const r = rows.find((x) => x.dir.replace(/\\/g, '/').toLowerCase() === focus.dir.replace(/\\/g, '/').toLowerCase())
    if (r) setSel(r)
  }, [focus, rows])

  return (
    <section data-testid="git-panel" className="tool gitpanel">
      <div className="dhead">
        <span className="dtitle"><span className="ph ph-git">⎇</span>Git</span>
        {sel
          ? <><button data-testid="git-button-1" className="dlink" onClick={() => { setSel(null); loadList() }}>‹ All repos</button><span className="dnote">{sel.name}</span></>
          : <span className="dnote">Repos and worktrees under the workspace root. Plain git; diffs open on the right.</span>}
        <span className="dspace" />
        <DiffModeToggle />
        {!sel && <button data-testid="git-button-2" className="dlink" onClick={() => { setRows(null); loadList() }}>Refresh</button>}
      </div>
      <div className="dbody">
        {sel ? <RepoDetail key={sel.dir} row={sel} onDiff={onDiff} /> : (
          <>
            {listErr && <div className="derr">{listErr}</div>}
            {!rows && !listErr && <div className="dnote">Reading repos…</div>}
            {rows && (
              <table className="dtable gtable">
                <thead><tr><th>Repo</th><th>Branch</th><th>Changes</th><th>Upstream</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr data-testid="git-repo" data-name={r.name} key={r.dir} className="grow" tabIndex={0} onClick={() => setSel(r)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(r) }} title={r.dir}>
                    <td>{r.name}{r.worktree && <span className="gtag">worktree</span>}</td>
                    <td>{r.error ? <span className="pr bad">{r.error}</span> : r.branch ?? <span className="pr warn">detached</span>}</td>
                    <td className={r.changes ? 'pr warn' : 'dd'}>{r.error ? '' : r.changes || '-'}</td>
                    <td className={r.behind ? 'pr warn' : r.ahead ? 'pr ok' : 'dd'}>{r.error ? '' : ab(r)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function RepoDetail({ row, onDiff }: { row: GitRow; onDiff: (s: DiffSpec) => void }) {
  const dir = row.dir
  const [d, setD] = useState<Detail | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [log, setLog] = useState<Commit[]>([])
  const [err, setErr] = useState('')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState('')
  const [newBranch, setNewBranch] = useState('')

  const load = () => {
    window.api.gitDetail(dir).then((x) => { setD(x); setErr('') }).catch((e) => setErr(String(e?.message ?? e)))
    window.api.gitBranches(dir).then((b) => { setBranches(b.branches); setPick(b.current ?? '') }).catch(() => {})
    window.api.gitLog(dir).then(setLog).catch(() => {})
  }
  useEffect(load, [dir])

  // every action: show what git said (success or error), then re-read the repo
  const act = (name: string, fn: () => Promise<string | void>, after?: () => void) => {
    setBusy(name); setOut('')
    fn().then((o) => { if (o) setOut(o); after?.() }).catch((e) => setOut(String(e?.message ?? e))).finally(() => { setBusy(''); load() })
  }
  const file = (e: Entry, area: FileArea) => onDiff({ t: 'file', dir, repo: row.name, path: e.path, area, orig: area === 'staged' ? e.orig : undefined })

  const group = (title: string, list: Entry[], area: FileArea) => list.length > 0 && (
    <div data-testid={`git-group-${area}`} className="ggroup">
      <div className="gghead">{title} <span className="dd">{list.length}</span></div>
      {list.map((e) => (
        <div data-testid="git-file" data-path={e.path} key={`${area}:${e.path}`} className="gfile">
          <input data-testid="git-stage" type="checkbox" checked={area === 'staged'} disabled={!!busy} title={area === 'staged' ? 'Unstage' : 'Stage'}
            onChange={() => act(area === 'staged' ? 'unstage' : 'stage', () => (area === 'staged' ? window.api.gitUnstage(dir, [e.path]) : window.api.gitStage(dir, [e.path])))} />
          <span className={`gl l${e.letter}`}>{e.letter}</span>
          <button data-testid="git-path" className="gpath" onClick={() => file(e, area)} title={e.orig ? `${e.orig} → ${e.path}` : e.path}>{e.orig ? `${e.orig} → ${e.path}` : e.path}</button>
          {e.binary ? <span className="dd">binary</span> : e.add !== undefined && <span className="gnum"><span className="dv-add">+{e.add}</span> <span className="dv-del">−{e.del}</span></span>}
        </div>
      ))}
    </div>
  )

  const changes = d ? d.staged.length + d.unstaged.length + d.untracked.length : 0
  return (
    <div className="gitgrid">
      <div>
        {err && <div className="derr">{err}</div>}
        <div className="drow gbranch">
          <span className="gname">{d ? d.branch ?? 'detached HEAD' : '…'}</span>
          {d && <span className="dd">{ab(d)}</span>}
        </div>
        {d && !changes && <div className="dnote">No changes.</div>}
        {d && (d.unstaged.length > 0 || d.untracked.length > 0) && (
          <div className="drow"><button data-testid="git-button-3" className="dbtn" disabled={!!busy} onClick={() => act('stageAll', () => window.api.gitStageAll(dir))}>Stage all</button></div>
        )}
        {d && group('Staged', d.staged, 'staged')}
        {d && group('Changes', d.unstaged, 'unstaged')}
        {d && group('Untracked', d.untracked, 'untracked')}
        <div className="gcommit">
          <textarea data-testid="git-message" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} />
          <div className="drow">
            <button data-testid="git-commit" className="dbtn primary" disabled={!!busy || !msg.trim() || !d?.staged.length}
              onClick={() => act('commit', () => window.api.gitCommit(dir, msg), () => setMsg(''))}>{busy === 'commit' ? 'Committing…' : 'Commit'}</button>
            <span className="dnote">{d?.staged.length ? `${d.staged.length} staged; the repo's hooks run` : 'Stage files to commit'}</span>
          </div>
        </div>
        {busy && busy !== 'commit' && <div className="dnote">Working…</div>}
        {out && <pre data-testid="git-output" className="dout gout">{out}</pre>}
      </div>
      <div>
        <div className="drow">
          <select data-testid="git-select-4" className="dsel" value={pick} disabled={!!busy} onChange={(e) => setPick(e.target.value)}>
            {!branches.includes(pick) && <option value={pick}>{pick || '(detached)'}</option>}
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button data-testid="git-button-5" className="dbtn" disabled={!!busy || !pick || pick === d?.branch} onClick={() => act('switch', () => window.api.gitSwitch(dir, pick))}>Switch</button>
          <button data-testid="git-button-6" className="dbtn" disabled={!!busy} onClick={() => act('fetch', () => window.api.gitFetch(dir))}>Fetch</button>
        </div>
        <div className="drow">
          <input data-testid="git-input-7" className="ginput" placeholder="new-branch-name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
          <button data-testid="git-button-8" className="dbtn" disabled={!!busy || !newBranch.trim()} onClick={() => act('branch', () => window.api.gitCreateBranch(dir, newBranch), () => setNewBranch(''))}>Create from HEAD</button>
        </div>
        <div className="drow gpushrow">
          <button data-testid="git-push" className="dbtn gpush" disabled={!!busy || !d?.branch} onClick={() => act('push', () => window.api.gitPush(dir))}>{busy === 'push' ? 'Pushing…' : 'Push'}</button>
          <span className="dnote">{!d?.branch ? 'Switch to a branch to push' : d.upstream ? `git push to ${d.upstream}` : `git push -u origin ${d.branch}`}</span>
        </div>
        <div className="gghead">Last commits</div>
        {!log.length && <div className="dnote">No commits yet.</div>}
        <table className="dtable glog">
          <tbody>{log.map((c) => (
            <tr key={c.sha} className="grow" tabIndex={0} onClick={() => onDiff({ t: 'commit', dir, repo: row.name, sha: c.sha, title: c.title })} onKeyDown={(e) => { if (e.key === 'Enter') onDiff({ t: 'commit', dir, repo: row.name, sha: c.sha, title: c.title }) }} title={c.sha}>
              <td className="gsha">{c.short}</td><td className="gtitle">{c.title}</td><td className="dd">{c.author}</td><td className="dd">{relativeTime(c.at, Date.now())}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
