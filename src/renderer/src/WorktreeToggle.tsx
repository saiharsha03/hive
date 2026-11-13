// A new thread's folder and, in a git repo Orbit lists, the Worktree toggle (as in Claude Code Desktop: off by default,
// remembered per repo). With it on, the first message starts the thread in its own worktree on a new branch.
import { useEffect, useState } from 'react'
import { getPref, setPref } from './prefs'
import { setSessions } from './store'

const WT_PREF = 'worktreeByRepo'
export const worktreeOn = (repo: string) => !!getPref<Record<string, boolean>>(WT_PREF, {})[repo]
const setWorktreeOn = (repo: string, on: boolean) => setPref(WT_PREF, { ...getPref<Record<string, boolean>>(WT_PREF, {}), [repo]: on })

export function NewThreadPlace({ tabId, cwd }: { tabId: string; cwd: string }) {
  const [repo, setRepo] = useState<{ repo: string; branch: string | null } | null>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    setRepo(null)
    window.api.worktreeRepoOf(cwd).then((r) => { if (live) { setRepo(r); setOn(!!r && worktreeOn(r.repo)) } }).catch(() => {})
    return () => { live = false }
  }, [cwd])
  const pick = () => void window.api.pickFolder().then((f) => { if (f) setSessions((all) => all.map((s) => (s.id === tabId ? { ...s, cwd: f } : s))) })
  const flip = () => { if (!repo) return; setWorktreeOn(repo.repo, !on); setOn(!on) }
  const name = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Folder'
  return (
    <>
      <button className="pick" onClick={pick} title={`${cwd}\nThe folder this thread starts in. Click to choose another.`} data-testid="new-thread-folder">{name}</button>
      {repo && (
        <button className={on ? 'pick pick-on' : 'pick'} aria-pressed={on} onClick={flip} data-testid="worktree-toggle"
          title={on
            ? `Worktree on: the first message starts this thread in its own git worktree, an isolated copy of ${repo.repo}, on a new branch from ${repo.branch ?? 'HEAD'}. Gitignored files the repo's .worktreeinclude names are copied in.`
            : `Worktree off: Claude works in the project folder itself. Turn on to run this thread in its own git worktree of ${repo.repo}.`}>
          Worktree{on ? ' on' : ''}
        </button>
      )}
    </>
  )
}
