// Workspace: pull, stacks, scripts, git for every repo, to-dos, notes and Dependabot, one tab each. The panels
// (DevPanel, ScriptsPanel, GitPanel, TodoPanel, NotesPanel) keep their behaviour; workspace.css draws them in the
// page language.
import { useEffect, useState } from 'react'
import { Btn, Empty, PageHead, Section, State, age } from '../kit'
import { DevPanel } from '../DevPanel'
import { ScriptsPanel } from '../ScriptsPanel'
import { GitPanel } from '../GitPanel'
import { TodoPanel } from '../TodoPanel'
import { NotesPanel } from '../NotesPanel'
import { useDev } from '../useDev'
import { useScripts } from '../useScripts'
import { useTodos } from '../useTodos'
import { getPref, setPref } from '../prefs'
import { notice, openPage, openSession, openStackLog, setPreview, showDiff, talkAbout } from '../actions'
import { pickSettingsSection } from '../SettingsPanel'
import { splitList } from '../../../shared/settingsCore'
import './workspace.css'

export const WORKSPACE_TABS = [
  ['pull', 'Pull'], ['stacks', 'Stacks'], ['scripts', 'Scripts'], ['git', 'Git'], ['todos', 'To-dos'], ['notes', 'Notes'], ['dependabot', 'Dependabot'],
] as const
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number][0]
const isTab = (t: unknown): t is WorkspaceTab => WORKSPACE_TABS.some(([id]) => id === t)

// which tab to show: set from the palette or the status line, before or while the page is up
let wantedTab: WorkspaceTab | null = null
const pickers = new Set<(t: WorkspaceTab) => void>()
export const pickWorkspaceTab = (tab: WorkspaceTab) => {
  wantedTab = tab
  setPref('workspace.tab', tab)
  pickers.forEach((f) => f(tab))
}

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---- Pull ----
function PullTab() {
  const [names, setNames] = useState<string[]>([])
  const [res, setRes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'' | 'pull' | 'check'>('')
  const [err, setErr] = useState('')
  const [said, setSaid] = useState('')
  // the repos under the workspace root (worktrees are not pulled); each one's result comes back with the run
  useEffect(() => {
    window.api.gitList().then((rows) => setNames(rows.filter((r) => !r.worktree).map((r) => r.name))).catch((e) => setErr(clean(e)))
  }, [])

  const run = (dry: boolean) => {
    if (busy) return
    setBusy(dry ? 'check' : 'pull'); setErr(''); setSaid(''); setRes({})
    window.api.pullRun(dry).then((rows) => {
      setRes(Object.fromEntries(rows.map((r) => [r.repo, r.result])))
      const n = (p: string) => rows.filter((r) => r.result.startsWith(p)).length
      const text = `${dry ? 'Check only' : 'Pull latest'}: ${n('updated')} updated, ${n('skipped')} skipped, ${n('failed')} failed, ${rows.length - n('updated') - n('skipped') - n('failed')} already up to date`
      setSaid(text)
      if (!dry) notice(text)
    }).catch((e) => setErr(clean(e))).finally(() => setBusy(''))
  }

  const repos = [...names, ...Object.keys(res).filter((r) => !names.includes(r))]
  const result = (r: string) => {
    const v = res[r]
    if (v === undefined) return <span className="ws-res">{busy ? 'waiting' : ''}</span>
    if (v.startsWith('failed')) return <span className="ws-res"><State word="failed" tone="fail" />{v.replace(/^failed:?\s*/, '')}</span>
    if (v.startsWith('updated')) return <span className="ws-res"><State word="updated" tone="done" />{v.replace(/^updated:?\s*/, '')}</span>
    return <span className="ws-res">{v}</span>
  }
  return (
    <Section title="Pull latest" note="Fetches every repo and fast-forwards its default branch" testid="ws-pull">
      <div className="ws-pull-bar">
        <Btn kind="primary" testid="dock-pull" disabled={!!busy} onClick={() => run(false)}>{busy === 'pull' ? 'Pulling' : 'Pull latest'}</Btn>
        <Btn testid="pull-check" disabled={!!busy} onClick={() => run(true)}>{busy === 'check' ? 'Checking' : 'Check only'}</Btn>
        <span className="sp" />
        {said && <span className="ws-res" data-testid="pull-summary">{said}</span>}
      </div>
      {err && <div className="derr" data-testid="pull-error">{err}</div>}
      {repos.length === 0 && !err ? <Empty>No repos found under the workspace root.</Empty> : (
        <table className="dt" data-testid="pull-table">
          <thead><tr><th>Repo</th><th>Result</th></tr></thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r} className={res[r]?.startsWith('failed') ? 'fail' : ''} data-testid="pull-row" data-repo={r}>
                <td className="strong">{r}</td>
                <td>{result(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ---- tabs that hold a panel ----
function StacksTab() {
  const { state, setState } = useDev()
  return <DevPanel state={state} setState={setState} onLogs={openStackLog} />
}
function ScriptsTab() {
  const { runs } = useScripts(setPreview)
  return <ScriptsPanel runs={runs} onOpen={setPreview} />
}
function TodosTab() {
  const t = useTodos()
  return <TodoPanel todos={t.todos} today={t.today} error={t.error} reload={t.reload} onTalk={talkAbout} />
}

// ---- Dependabot ----
const label = (k: string) => { const w = k.replace(/^HIVE_DEPENDABOT_/, '').toLowerCase().replace(/_/g, ' '); return w[0].toUpperCase() + w.slice(1) }

function DependabotTab() {
  const [env, setEnv] = useState<Record<string, string> | null>(null)
  const [threads, setThreads] = useState<SessionInfo[] | null>(null)
  const [err, setErr] = useState('')
  const load = () => {
    window.api.settingsGet().then((v) => setEnv(v.env)).catch((e) => setErr(clean(e)))
    window.api.listSessions().then((l) => setThreads(l.filter((s) => s.dependabot).sort((a, b) => b.updated - a.updated))).catch((e) => setErr(clean(e)))
  }
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t) }, [])

  const repos = splitList(env?.HIVE_DEPENDABOT_REPOS ?? '')
  const extra = Object.keys(env ?? {}).filter((k) => k.startsWith('HIVE_DEPENDABOT_') && k !== 'HIVE_DEPENDABOT_REPOS' && k !== 'HIVE_DEPENDABOT_TIME').sort()
  const rows: [string, React.ReactNode][] = [
    ['Repos', repos.length ? repos.join(', ') : <span className="dimt">None set</span>],
    ['Time', env?.HIVE_DEPENDABOT_TIME?.trim() || '12:00 (default)'],
    ...extra.map((k): [string, React.ReactNode] => [label(k), env?.[k] || <span className="dimt">Not set</span>]),
  ]
  const edit = () => { pickSettingsSection('dependabot'); openPage('settings') }
  return (
    <>
      <Section title="Dependabot reviewer" note="Once a day, each open Dependabot PR in these repos gets one background review thread" testid="ws-dependabot">
        {err && <div className="derr">{err}</div>}
        {env ? <dl className="kv" data-testid="dependabot-settings">{rows.map(([k, v]) => <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <Empty>Reading settings</Empty>}
        <div className="ws-dep-actions"><Btn onClick={edit} testid="dependabot-edit">Edit in Settings</Btn></div>
      </Section>
      <Section title="Review threads" note={threads ? `${threads.length}` : ''}>
        {threads && threads.length === 0 ? <Empty>No Dependabot review threads yet.</Empty> : (
          <table className="dt" data-testid="dependabot-threads">
            <thead><tr><th>Thread</th><th>Repo</th><th className="num">Updated</th><th /></tr></thead>
            <tbody>
              {(threads ?? []).map((s) => (
                <tr key={s.id} data-testid="dependabot-row">
                  <td className="strong">{s.title}</td>
                  <td>{s.project}</td>
                  <td className="num">{age(s.updated)}</td>
                  <td className="acts"><Btn kind="link" onClick={() => openSession(s)}>Open</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  )
}

export function WorkspacePage() {
  const [tab, setTab] = useState<WorkspaceTab>(() => { const t = wantedTab ?? getPref<unknown>('workspace.tab', 'pull'); return isTab(t) ? t : 'pull' })
  useEffect(() => {
    wantedTab = null
    const pick = (t: WorkspaceTab) => { wantedTab = null; setTab(t) }
    pickers.add(pick)
    return () => { pickers.delete(pick) }
  }, [])
  const choose = (t: WorkspaceTab) => { setTab(t); setPref('workspace.tab', t) }

  return (
    <div className="page ws-page" data-testid="page-workspace">
      <PageHead title="Workspace" desc="Pull, stacks, scripts, git for every repo, to-dos, notes and Dependabot" />
      <div className="page-tabs" role="tablist">
        {WORKSPACE_TABS.map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => choose(id)} data-testid={`ws-tab-${id}`}>{text}</button>
        ))}
      </div>
      {tab === 'pull' && <PullTab />}
      {tab === 'stacks' && <StacksTab />}
      {tab === 'scripts' && <ScriptsTab />}
      {tab === 'git' && <GitPanel onDiff={showDiff} />}
      {tab === 'todos' && <TodosTab />}
      {tab === 'notes' && <NotesPanel />}
      {tab === 'dependabot' && <DependabotTab />}
    </div>
  )
}
