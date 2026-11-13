// Changes: the focused thread's changed files (its repo's working tree, plus the files the agent edited in this
// thread). The one picked shows in the Git view's diff panel below; commit and push live there too.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from './chat'
import type { DiffSpec } from './DiffPanel'
import { counts, FILE_TOOLS, type Hunk } from '../../shared/diffCore'
import type { Detail, Entry, FileArea } from '../../shared/gitCore'
import { sinceLastPr } from '../../shared/changesCore'
import { checksText, protectedBranch, shipPrompt } from '../../shared/ciCore'
import { fixChecksPrompt } from '../../shared/prAutoCore'
import type { MergeInfo, MergeInfoResult } from '../../shared/prCore'
import { hunksOf, shortPath } from './SessionView'
import { notice, offerUndo, send } from './actions'
import { applyPr, markSent, threadKey } from './prAuto'
import { prChecksSeen } from './store'
import { archive, archiveKeepingWork, setPrToggle, useThreads } from './threads'
import { anchorOf, Icon, Modal, Popover, type Anchor } from './ui'

type Row = { key: string; path: string; letter: string; add?: number; del?: number; spec: DiffSpec; agent: boolean }
const LETTER_CLASS: Record<string, string> = { M: 'g-modified', A: 'g-added', '?': 'g-untracked', U: 'g-untracked', D: 'g-deleted', R: 'g-renamed', C: 'g-renamed' }
const base = (p: string) => p.split('/').at(-1) ?? p
const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')
const isPr = (r: MergeInfoResult | undefined): r is MergeInfo => !!r && 'pr' in r
// merged / closed / draft beat the checks' own state
const prWord = (p: { state: string; isDraft: boolean }) => (p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : '')

// the agent's edits in this thread since it last opened a pull request (what went into the PR is done), one row per
// file with the counts of all its edits. Uncommitted files in the working tree still show from git.
function agentEdits(s: Session | null): { file: string; label: string; tool: string; hunks: Hunk[] }[] {
  if (!s) return []
  const by = new Map<string, { file: string; label: string; tool: string; hunks: Hunk[] }>()
  for (const it of sinceLastPr(s.items)) {
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

  // the branch's pull request (gh, read-only): read when the branch, its head or what is ahead changes, on refresh, and
  // every 30 s while the PR is open with checks still running
  const [info, setPr] = useState<MergeInfoResult | undefined>(undefined)
  const pr = isPr(info) ? info.pr : null
  const [prN, setPrN] = useState(0)
  const asked = useRef('')
  useEffect(() => { setPr(undefined); asked.current = '' }, [where])
  const prKey = repo && d ? `${repo.dir}|${d.branch}|${d.head}|${d.ahead}|${prN}` : ''
  useEffect(() => {
    if (!prKey || !repo || prKey === asked.current) return
    asked.current = prKey
    window.api.gitPrMergeInfo(repo.dir).then((r) => {
      if (asked.current !== prKey) return
      setPr(r)
      if (session && isPr(r)) applyPr(session.id, r)
    }).catch(() => {})
  }, [prKey, repo])
  const states = useThreads()
  const key = session ? threadKey(session) : ''
  const st = states[key]
  // re-read every 30 s while the PR is open and something waits on it: running checks, auto-merge, Auto-fix or
  // Auto-archive
  const running = !!pr && pr.state === 'OPEN' && (pr.checks.state === 'pending' || !!pr.autoMerge || !!st?.autoFix || !!st?.autoArchive)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') setPrN((x) => x + 1) }, 30_000)
    return () => clearInterval(t)
  }, [running])
  // the thread's header shows the same state beside its PR number
  const sid = session?.id
  useEffect(() => {
    if (!sid || !pr) return
    const seen = { num: pr.number, state: prWord(pr) || pr.checks.state, text: checksText(pr.checks) }
    prChecksSeen.set((all) => ({ ...all, [sid]: seen }))
  }, [pr, sid])

  const [ship, setShip] = useState(false)
  const files = rows.filter((r) => !r.agent).length
  const ahead = d?.ahead ?? 0
  const openPr = pr && pr.state === 'OPEN' ? pr : null
  const nothing = !files && !ahead && !!d?.upstream
  const doShip = () => {
    if (!session || !d?.branch) return
    send(session.id, shipPrompt({ branch: d.branch, upstream: d.upstream, ahead, files, pr: openPr }), [])
    setShip(false)
  }

  // the PR's menu, and the confirm for Merge / Merge when ready, holding the info (and head sha) it shows
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [confirm, setConfirm] = useState<{ auto: boolean; info: MergeInfo } | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeErr, setMergeErr] = useState('')
  const refreshPr = () => setPrN((x) => x + 1)
  const doMerge = async () => {
    if (!confirm || !repo || merging) return
    setMerging(true); setMergeErr('')
    const { auto, info: at } = confirm
    try {
      const r = auto ? await window.api.gitPrAutoMerge(repo.dir, at.pr.headRefOid, true) : await window.api.gitPrMerge(repo.dir, at.pr.headRefOid)
      if (r.ok) { setConfirm(null); notice(auto ? `Auto-merge is on for PR #${r.number}: GitHub merges it (${r.method}) when its checks pass.` : `Merged PR #${r.number} (${r.method}).`); refreshPr() }
      else setMergeErr(r.reason)
    } catch (e) { setMergeErr(String((e as Error)?.message ?? e)) }
    setMerging(false)
  }
  const autoOff = async () => {
    if (!repo || !isPr(info) || merging) return
    setMerging(true)
    try {
      const r = await window.api.gitPrAutoMerge(repo.dir, info.pr.headRefOid, false)
      notice(r.ok ? `Auto-merge is off for PR #${r.number}.` : `Could not turn auto-merge off: ${r.reason}`)
    } catch (e) { notice(`Could not turn auto-merge off: ${(e as Error)?.message ?? e}`) }
    setMerging(false); refreshPr()
  }
  const fixChecks = () => {
    if (!session || !pr) return
    markSent(key, { sha: pr.headRefOid }) // Auto-fix does not send it again for this head
    send(session.id, fixChecksPrompt(pr.number, pr.failing ?? []), [])
  }
  const archiveNow = () => {
    if (!session) return
    archiveKeepingWork(key)
    offerUndo(`Archived ${session.title}`, () => archive(key, false))
  }

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
            <button onClick={() => { setN((x) => x + 1); setPrN((x) => x + 1) }} title="Re-read the working tree and the pull request's checks" data-testid="changes-refresh"><Icon name="refresh" /></button>
            <button onClick={() => setShip(true)} disabled={!d?.branch || session.busy || nothing} data-testid="changes-ship"
              title={session.busy ? 'The thread is working' : nothing ? 'Nothing to ship: no changes and nothing ahead' : openPr ? `Ask Claude to push to PR #${openPr.number}` : 'Ask Claude to ship this branch as a pull request'}>
              {openPr ? 'Update PR' : 'Ship'}
            </button>
            <button className="pri" onClick={onOpenGit} title="Stage, commit and push in the Git view" data-testid="changes-commit"><Icon name="git-commit" />Commit…</button>
          </span>
        </div>
        {isPr(info) && pr && (
          <div className="prchip" data-testid="changes-pr">
            <a href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>PR #{pr.number}</a>
            {prWord(pr) && <span>{prWord(pr)}</span>}
            <span className={`ci-${pr.checks.state}`} data-testid="changes-pr-checks">{pr.checks.state === 'none' ? 'no checks' : pr.checks.state}</span>
            {pr.checks.total > 0 && <span>{checksText(pr.checks)}</span>}
            {pr.autoMerge && pr.state === 'OPEN' && <span data-testid="changes-pr-automerge">merge when ready</span>}
            <span className="practs">
              {openPr && pr.checks.state === 'failing' && (
                <button onClick={fixChecks} disabled={session.busy} title={session.busy ? 'The thread is working' : `Ask Claude to fix ${pr.failing?.length ? pr.failing.join(', ') : 'the failing checks'} and push to PR #${pr.number}`} data-testid="changes-pr-fix">
                  <Icon name="wrench" />Fix failing checks
                </button>
              )}
              {openPr && (
                <button onClick={() => { setMergeErr(''); setConfirm({ auto: false, info }) }} disabled={!!info.block || merging} title={info.block ?? `Merge PR #${pr.number} (${info.method})`} data-testid="changes-pr-merge">
                  <Icon name="git-merge" />Merge
                </button>
              )}
              {!openPr && (pr.state === 'MERGED' || pr.state === 'CLOSED') && !st?.archivedAt && (
                <button onClick={archiveNow} title="Archive this thread; its worktree and branch are kept" data-testid="changes-pr-archive"><Icon name="archive" />Archive this thread</button>
              )}
              <button onClick={(e) => setMenu(anchorOf(e.currentTarget))} title="Auto-fix, Merge when ready, Auto-archive" aria-label="Pull request options" data-testid="changes-pr-menu"><Icon name="kebab-vertical" /></button>
            </span>
          </div>
        )}
        {openPr && isPr(info) && info.block && <div className="prchip prblock" data-testid="changes-pr-block">Merge: {info.block}</div>}
        {info && 'unavailable' in info && <div className="prchip" title={info.unavailable} data-testid="changes-pr-unavailable">Pull request status unavailable</div>}
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
      {menu && isPr(info) && pr && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={280} align="right" testid="changes-pr-menu-pop">
          <button className="pop-row" onClick={() => { setPrToggle(key, 'autoFix', !st?.autoFix); setMenu(null) }} data-testid="changes-pr-autofix"
            title="When this PR's checks fail on a new commit, or a reviewer leaves new comments, ask Claude to fix them and push (once per commit, only while the thread is idle)">
            <Icon name={st?.autoFix ? 'check' : 'blank'} />Auto-fix
          </button>
          <button className="pop-row" disabled={!openPr || merging || (!pr.autoMerge && !!info.autoBlock)} data-testid="changes-pr-automerge-toggle"
            onClick={() => { setMenu(null); if (pr.autoMerge) void autoOff(); else { setMergeErr(''); setConfirm({ auto: true, info }) } }}
            title={pr.autoMerge ? "Turn GitHub's auto-merge off for this PR" : info.autoBlock ?? "Turn on GitHub's auto-merge: it merges the PR when its checks pass"}>
            <Icon name={pr.autoMerge ? 'check' : 'blank'} />Merge when ready
          </button>
          <button className="pop-row" onClick={() => { setPrToggle(key, 'autoArchive', !st?.autoArchive); setMenu(null) }} data-testid="changes-pr-autoarchive"
            title="Archive this thread when its PR merges or closes (not while it is working); its worktree and branch are kept">
            <Icon name={st?.autoArchive ? 'check' : 'blank'} />Auto-archive after PR merge or close
          </button>
          {!pr.autoMerge && info.autoBlock && openPr && <div className="pop-hint">Merge when ready: {info.autoBlock}</div>}
        </Popover>
      )}
      {confirm && (
        <Modal title={confirm.auto ? `Merge when ready: PR #${confirm.info.pr.number}` : `Merge PR #${confirm.info.pr.number}`} onClose={() => { if (!merging) setConfirm(null) }} testid="changes-merge-modal">
          <div className="confirm">
            <div className="confirm-body">
              <div>{confirm.info.repo} <b>#{confirm.info.pr.number}</b> {confirm.info.pr.title}</div>
              <div>Into <b>{confirm.info.pr.baseRefName}</b> by <b>{confirm.info.method}</b>, at head <code>{confirm.info.pr.headRefOid.slice(0, 7)}</code></div>
              <div>Checks: <span className={`ci-${confirm.info.pr.checks.state}`}>{confirm.info.pr.checks.state === 'none' ? 'no checks' : confirm.info.pr.checks.state}</span>{confirm.info.pr.checks.total > 0 ? `, ${confirm.info.pr.checksText}` : ''}</div>
              <div className="dim">{confirm.auto
                ? 'GitHub merges it when its required checks pass, unless new commits are pushed first. The branch and the worktree are kept.'
                : 'GitHub merges it now, only if the head is still the one above. The branch and the worktree are kept.'}</div>
              {mergeErr && <div className="ship-warn" data-testid="changes-merge-error">{mergeErr}</div>}
            </div>
            <div className="drow confirm-acts">
              <span className="dspace" />
              <button className="dbtn" autoFocus onClick={() => setConfirm(null)} disabled={merging} data-testid="changes-merge-cancel">Cancel</button>
              <button className="dbtn primary" onClick={() => void doMerge()} disabled={merging} data-testid="changes-merge-go">{merging ? 'Merging…' : confirm.auto ? 'Merge when ready' : 'Merge'}</button>
            </div>
          </div>
        </Modal>
      )}
      {ship && d?.branch && (
        <Modal title={openPr ? `Update PR #${openPr.number}` : 'Ship this branch'} onClose={() => setShip(false)} testid="changes-ship-modal">
          <div className="confirm">
            <div className="confirm-body">
              <div>Branch <b>{d.branch}</b>, {d.upstream ? <>upstream {d.upstream}</> : 'no upstream yet'}</div>
              <div>{files} changed file{files === 1 ? '' : 's'}, {ahead} commit{ahead === 1 ? '' : 's'} ahead</div>
              {protectedBranch(d.branch) && <div className="ship-warn" data-testid="changes-ship-protected">This is {d.branch}, a protected branch: ship from a feature branch instead.</div>}
              <div className="dim">Claude follows the project's shipping rules, then {openPr ? `pushes the new commits to PR #${openPr.number}` : 'commits, pushes and opens a pull request ready for review'}.</div>
            </div>
            <div className="drow confirm-acts">
              <span className="dspace" />
              <button className="dbtn" autoFocus onClick={() => setShip(false)} data-testid="changes-ship-cancel">Cancel</button>
              <button className="dbtn primary" onClick={doShip} data-testid="changes-ship-go">Ask Claude to ship</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
