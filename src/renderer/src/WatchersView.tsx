// Watchers: every scheduled background thread with its switch, state, last and next run, adaptive tier and findings;
// clicking one shows its findings, reports, runs and its thread. Self-contained (data from useWatchers), so the same
// component can sit in a panel today or a sidebar view later. WatchersToggleList is the compact form for a popover.
import { useEffect, useState } from 'react'
import { DAYS, DEFAULT_TIERS, parseEvery, parseTiers, parseWeekly, pickTier, type RunKind } from '../../shared/watchCore'
import { checkDraft, draftOf, tierRows, type ScheduleDraft, type ScheduleMode, type TierRow, type WatcherDetail } from '../../shared/watchersCore'
import { reloadWatchers, useWatchers, type WatcherRow } from './useWatchers'
import { Confirm } from './ui'
import { State, type Tone } from './kit'

export type OpenThread = { tabId: string | null; sessionId: string | null; path: string | null; cwd: string; title: string; at: number }
type Props = { onOpen: (path: string) => void; onOpenThread: (t: OpenThread) => void }

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-')
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)
const every = (ms: number | null) => (ms === null ? 'off' : ms % 86_400_000 === 0 ? `${ms / 86_400_000}d` : ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`)
const TONE: Record<string, Tone> = { running: 'work', failed: 'fail', waiting: 'wait', idle: 'done' }
const stateWord = (s: WatcherRow['state']) => <State word={s} tone={TONE[s] ?? 'idle'} />

// which watcher to show: set from a watcher's name in the sidebar, the title-bar list or Settings, before or while
// the view is up
let wantedWatcher: string | null = null
const watcherPickers = new Set<(id: string) => void>()
export const pickWatcher = (id: string) => { wantedWatcher = id; watcherPickers.forEach((f) => f(id)) }

export function plan(w: WatcherRow): string {
  const s = w.schedule
  const sweep = s.every === 'adaptive'
    ? `adaptive${w.tier ? `: every ${every(w.tier.everyMs)} (tier ${w.tier.index + 1}, weekly ${w.tier.pct === null ? '?' : `${Math.round(w.tier.pct)}%`})` : ''}`
    : s.every === 'self' ? 'self-scheduled' : s.every === 'off' ? '' : `every ${s.every}`
  return [sweep, s.daily ? `daily ${s.daily}` : '', s.weekly ? `weekly ${s.weekly}` : ''].filter(Boolean).join(', ') || 'no schedule'
}

// the compact list: one switch per watcher, for a top-bar popover or a sidebar
export function WatchersToggleList({ onPick }: { onPick?: (id: string) => void }) {
  const { watchers, busy, setEnabled, error } = useWatchers()
  return (
    <div className="wtl">
      {watchers.map((w) => (
        <div key={w.id} className="wtl-row" title={w.message || w.goal}>
          <input type="checkbox" checked={w.enabled} disabled={!!busy[w.id]} onChange={(e) => void setEnabled(w.id, e.target.checked)} aria-label={`${w.name} on/off`} />
          {stateWord(w.state)}
          <button className="dlink wtl-name" onClick={() => onPick?.(w.id)}>{w.name}</button>
          <span className="dnote">{w.waiting ? 'waiting' : w.state === 'running' ? 'running' : w.nextRun ? `next ${when(w.nextRun)}` : w.enabled ? '' : 'off'}</span>
        </div>
      ))}
      {!watchers.length && <div className="dnote">No watchers yet.</div>}
      {error && <div className="derr">{error}</div>}
    </div>
  )
}

function NewWatcher({ onDone }: { onDone: (id: string, msg: string) => void }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<'adaptive' | 'fixed'>('adaptive')
  const [fixed, setFixed] = useState('1h')
  const [daily, setDaily] = useState('')
  const [weekly, setWeekly] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const bad = mode === 'fixed' && parseEvery(fixed) === undefined ? 'Interval like 30m, 1h, 1d or off'
    : daily && !/^\d{1,2}:\d{2}$/.test(daily) ? 'Daily time is HH:MM'
      : weekly && !parseWeekly(weekly) ? `Weekly like "Mon 08:00" (${DAYS.join(', ')})` : ''
  const create = () => {
    setSaving(true)
    window.api.watcherCreate({ name, goal, schedule: { every: mode === 'adaptive' ? 'adaptive' : fixed, ...(mode === 'adaptive' ? { tiers: DEFAULT_TIERS } : {}), daily: daily || undefined, weekly: weekly || undefined } })
      .then((r) => onDone(r.id, r.message))
      .catch((e) => setErr(clean(e)))
      .finally(() => setSaving(false))
  }
  return (
    <div className="wnew">
      <div className="drow"><span className="wlab">Name</span><input data-testid="watcher-name" className="sin wide" value={name} placeholder="Deploy health" onChange={(e) => setName(e.target.value)} /></div>
      <div className="drow"><span className="wlab">Goal</span><textarea data-testid="watcher-goal" className="sin wide" rows={3} value={goal} placeholder="What it keeps an eye on and why" onChange={(e) => setGoal(e.target.value)} /></div>
      <div className="drow">
        <span className="wlab">Schedule</span>
        <label className="scheck"><input type="radio" checked={mode === 'adaptive'} onChange={() => setMode('adaptive')} /> Adaptive ({DEFAULT_TIERS})</label>
        <label data-testid="watcher-fixed" className="scheck"><input type="radio" checked={mode === 'fixed'} onChange={() => setMode('fixed')} /> Every</label>
        {mode === 'fixed' && <input className="sin num" value={fixed} onChange={(e) => setFixed(e.target.value)} />}
      </div>
      <div className="drow">
        <span className="wlab">Reports</span>
        <input className="sin num" value={daily} placeholder="daily" title="Daily report HH:MM (optional)" onChange={(e) => setDaily(e.target.value)} />
        <input className="sin" value={weekly} placeholder="weekly: Mon 08:00" title="Weekly report (optional)" onChange={(e) => setWeekly(e.target.value)} />
      </div>
      {(bad || err) && <div data-testid="watcher-error" className="derr">{bad || err}</div>}
      <div className="drow">
        <button data-testid="watcher-create" className="dbtn primary" disabled={saving || !name.trim() || !goal.trim() || !!bad} onClick={create}>{saving ? 'Creating' : 'Create and start'}</button>
        <span className="dnote">Writes a prompt from the goal (with its memory folder and SQLite db), turns it on and starts its thread.</span>
      </div>
    </div>
  )
}

// a watcher's schedule, edited in place: adaptive tiers, a fixed interval or reports only, plus the report times.
// Saving writes watcher.json through main, which re-plans the watcher at once; the next run shown follows.
function ScheduleEditor({ id, d, onSaved }: { id: string; d: WatcherDetail; onSaved: () => Promise<unknown> }) {
  const savedKey = JSON.stringify(d.schedule)
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(d.schedule))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setDraft(draftOf(d.schedule)) }, [savedKey])
  const { errors, schedule } = checkDraft(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(d.schedule))
  const bad = (f: string) => (errors.some((e) => e.field === f) ? { borderColor: 'var(--fail)' } : undefined)
  const set = (p: Partial<ScheduleDraft>) => { setDraft((x) => ({ ...x, ...p })); setMsg('') }
  const setTier = (i: number, p: Partial<TierRow>) => set({ tiers: draft.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) })
  // the tier the live weekly use falls in, for these (possibly unsaved) tiers; usage is read only for adaptive watchers
  const parsed = draft.mode === 'adaptive' ? parseTiers(draft.tiers.map((t) => `${t.below}:${t.every}`).join(',')).tiers : null
  const pct = d.tier ? d.tier.pct : undefined
  const cur = parsed && pct !== undefined ? pickTier(parsed, pct).tier : -1
  const save = () => {
    if (!schedule) return
    setSaving(true)
    window.api.watcherUpdate(id, { schedule })
      .then((r) => onSaved().then(() => setMsg(r || 'Saved')))
      .catch((e) => setMsg(clean(e)))
      .finally(() => setSaving(false))
  }
  const mode = (m: ScheduleMode, label: string) => (
    <label className="scheck"><input data-testid={`schedule-mode-${m}`} type="radio" name={`mode-${id}`} checked={draft.mode === m} onChange={() => set({ mode: m })} /> {label}</label>
  )
  return (
    <div data-testid="schedule-section" className="wsched">
      <div className="drow">
        <span className="wlab">Schedule</span>
        {mode('adaptive', 'Adaptive')}{mode('fixed', 'Fixed interval')}{mode('reports', 'Reports only')}{mode('self', 'Self-scheduled')}
        <span className="dspace" />
        <span className="dnote">next run <span data-testid="watcher-next" data-next={d.nextRun ?? ''}>{d.enabled ? when(d.nextRun) : 'off'}</span></span>
      </div>
      {draft.mode === 'adaptive' && (
        <div className="wtiers">
          <div className="dnote">Below this share of the weekly limit, sweep this often.{pct === undefined ? ' Weekly use shows once saved as adaptive.' : pct === null ? ' Weekly use unknown: the slowest tier applies.' : ''}</div>
          {draft.tiers.map((t, i) => (
            <div key={i} data-testid="tier-row" data-index={i} data-current={i === cur ? '1' : undefined} className="drow" style={i === cur ? { background: 'var(--sel)' } : undefined}>
              <span className="wlab">Tier {i + 1}</span>
              <span className="dnote">below</span>
              <input data-testid="tier-below" className="sin num" style={bad(`tier-${i}-below`)} value={t.below} aria-label={`Tier ${i + 1} threshold %`} onChange={(e) => setTier(i, { below: e.target.value })} />
              <span className="dnote">% every</span>
              <input data-testid="tier-every" className="sin num" style={bad(`tier-${i}-every`)} value={t.every} aria-label={`Tier ${i + 1} interval`} onChange={(e) => setTier(i, { every: e.target.value })} />
              {i === cur && <span data-testid="tier-usage" className="dnote">now: {pct === null || pct === undefined ? 'usage unknown' : `${Math.round(pct)}% weekly`}</span>}
              <span className="dspace" />
              <button data-testid="tier-remove" className="dlink" disabled={draft.tiers.length < 2} onClick={() => set({ tiers: draft.tiers.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="drow">
            <button data-testid="tier-add" className="dlink" onClick={() => {
              const last = draft.tiers.at(-1)
              set({ tiers: [...draft.tiers, { below: last ? String(Math.min(100, (Number(last.below) || 90) + 10)) : '100', every: last?.every || '1d' }] })
            }}>Add tier</button>
            <button data-testid="tier-reset" className="dlink" onClick={() => set({ tiers: tierRows(DEFAULT_TIERS) })}>Reset to default</button>
          </div>
        </div>
      )}
      {draft.mode === 'fixed' && (
        <div className="drow">
          <span className="wlab">Every</span>
          <input data-testid="schedule-every" className="sin num" style={bad('every')} value={draft.every} placeholder="1h" onChange={(e) => set({ every: e.target.value })} />
        </div>
      )}
      {draft.mode === 'self' && (
        <div className="drow"><span data-testid="schedule-self-note" className="dnote">The watcher plans its own wake-ups in schedule.db in its folder. With nothing pending it is woken after 6 hours.</span></div>
      )}
      {draft.mode !== 'self' && <div className="drow">
        <span className="wlab">Reports</span>
        <span className="dnote">daily</span>
        <input data-testid="schedule-daily" className="sin num" style={bad('daily')} value={draft.daily} placeholder="HH:MM" title="Daily report time (optional)" onChange={(e) => set({ daily: e.target.value })} />
        <span className="dnote">weekly</span>
        <select data-testid="schedule-weekly-day" className="wsel" style={bad('weekly')} value={draft.weeklyDay} onChange={(e) => set({ weeklyDay: e.target.value })}>
          <option value="">none</option>
          {DAYS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
        </select>
        <input data-testid="schedule-weekly-time" className="sin num" style={bad('weekly')} value={draft.weeklyTime} placeholder="HH:MM" title="Weekly report time (optional)" onChange={(e) => set({ weeklyTime: e.target.value })} />
      </div>}
      {errors.map((e, i) => <div key={i} data-testid="schedule-error" className="derr">{e.message}</div>)}
      <div className="drow">
        <button data-testid="schedule-save" className="dbtn primary" disabled={saving || !dirty || !schedule} onClick={save}>{saving ? 'Saving' : 'Save schedule'}</button>
        <button data-testid="schedule-revert" className="dlink" disabled={saving || !dirty} onClick={() => set(draftOf(d.schedule))}>Revert</button>
        {msg && <span data-testid="schedule-saved" className="dnote">{msg}</span>}
      </div>
    </div>
  )
}

function Detail({ id, row, onOpen, onOpenThread, onGone }: { id: string; row: WatcherRow; onOpen: Props['onOpen']; onOpenThread: Props['onOpenThread']; onGone: () => void }) {
  const [d, setD] = useState<WatcherDetail | null>(null)
  const [tab, setTab] = useState<'findings' | 'reports' | 'runs'>('findings')
  const [kind, setKind] = useState<RunKind>('sweep')
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState(false)
  const { runNow, busy } = useWatchers()
  const load = () => window.api.watcherDetail(id).then((x) => { setD(x); setErr('') }).catch((e) => setErr(clean(e)))
  // follow the row: a new run, a finished turn or a new finding refreshes the detail
  useEffect(() => { void load() }, [id, row.lastRun, row.state, row.findings, row.enabled])

  if (row.builtin) return <div className="wdetail"><div className="dnote">{row.goal}</div>{row.message && <div className="derr">{row.message}</div>}<div className="dnote">Last run {when(row.lastRun)}, next {when(row.nextRun)}, {row.findings} PRs reviewed so far. Its review threads show in the rail.</div></div>
  if (!d) return <div className="wdetail">{err ? <div className="derr">{err}</div> : <div className="dnote">Loading</div>}</div>
  const latest = d.runs.find((r) => r.sessionId) ?? null
  const openThread = () => onOpenThread({ tabId: d.tabId, sessionId: d.sessionId ?? latest?.sessionId ?? null, path: latest?.path ?? null, cwd: latest?.cwd ?? '', title: `Watcher: ${d.name}`, at: latest?.startedAt ?? Date.now() })
  const del = () => {
    setAsking(false)
    window.api.watcherDelete(id).then(() => { onGone(); void reloadWatchers() }).catch((e) => setErr(clean(e)))
  }
  return (
    <div className="wdetail">
      <div className="drow">
        <span className="dnote wgoal">{d.goal}</span>
        <span className="dspace" />
        <select className="wsel" value={kind} onChange={(e) => setKind(e.target.value as RunKind)}>
          <option value="sweep">Sweep</option><option value="daily">Daily report</option><option value="weekly">Weekly report</option>
        </select>
        <button data-testid="watcher-run" className="dbtn" disabled={row.state === 'running' || !!busy[id]} onClick={() => void runNow(id, kind)}>{row.state === 'running' ? 'Running' : 'Run now'}</button>
        <button className="dlink" disabled={!d.tabId && !latest} onClick={openThread}>Open thread</button>
        <button className="dlink" title={d.dir} onClick={() => void window.api.openExternal(d.dir)}>Folder</button>
        <button className="dlink" title={d.prompt} onClick={() => onOpen(d.prompt)}>Prompt</button>
        <button className="dlink" onClick={() => setAsking(true)} data-testid="watcher-delete">Delete</button>
      </div>
      {d.waitingReason && <div className="derr">Waiting: {d.waitingReason}</div>}
      {d.message && <div data-testid="watcher-message" className="derr">{d.message}</div>}
      {err && <div data-testid="watcher-detail-error" className="derr">{err}</div>}
      <ScheduleEditor id={id} d={d} onSaved={() => Promise.all([load(), reloadWatchers()])} />
      <div className="drow">
        {(['findings', 'reports', 'runs'] as const).map((t) => (
          <button key={t} className={`dlink${tab === t ? ' won' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)} ({t === 'findings' ? d.findingsList.length : t === 'reports' ? d.reports.length : d.runs.length})
          </button>
        ))}
      </div>
      {tab === 'findings' && (d.findingsList.length ? d.findingsList.map((f, i) => (
        <div key={i} className="wfind">
          <div className="ckrow">
            {f.kind === 'good' ? <State word="good" tone="done" /> : f.kind === 'bad' ? <State word="bad" tone="fail" /> : null}
            <span className="ckl">{f.title}</span>
            <span className="dspace" />
            <span className="dnote">{f.at ? when(Date.parse(f.at)) : ''}</span>
            {f.link && <button className="dlink" title={f.link} onClick={() => (/^https?:/i.test(f.link!) ? void window.api.openExternal(f.link!) : onOpen(f.link!))}>Open</button>}
          </div>
          {f.why && <div className="dnote wwhy">{f.why}</div>}
        </div>
      )) : <div className="dnote">No findings yet.</div>)}
      {tab === 'reports' && (d.reports.length ? d.reports.map((r) => (
        <div key={r.path} className="ckrow">
          <button className="dlink" title={r.path} onClick={() => onOpen(r.path)}>{r.name}</button>
          <span className="dspace" />
          <span className="dnote">{when(r.mtime)}</span>
        </div>
      )) : <div className="dnote">No reports yet.</div>)}
      {tab === 'runs' && (d.runs.length ? d.runs.map((r) => (
        <div key={r.id} className="ckrow">
          {r.error ? <State word="failed" tone="fail" /> : r.endedAt ? <State word="done" tone="done" /> : <State word="working" tone="work" />}
          <span className="ckl">{r.kind}</span>
          <span className="dnote">{when(r.startedAt)}{r.endedAt ? `, ${mins(r.endedAt - r.startedAt)}` : ''}</span>
          {r.error && <span className="derr">{r.error}</span>}
          <span className="dspace" />
          {(r.path || r.tabId) && <button className="dlink" onClick={() => onOpenThread({ tabId: r.tabId, sessionId: r.sessionId ?? null, path: r.path, cwd: r.cwd, title: `Watcher: ${d.name}`, at: r.startedAt })}>Open thread</button>}
        </div>
      )) : <div className="dnote">No runs yet.</div>)}
      {asking && (
        <Confirm title={`Delete watcher "${d.name}"?`} action="Delete" danger testid="watcher-delete-confirm" onCancel={() => setAsking(false)} onConfirm={del}>
          <div>It stops running and its folder moves to _deleted.</div>
        </Confirm>
      )}
    </div>
  )
}

// the list plus the selected watcher's detail, or the New watcher form
export function WatchersView({ onOpen, onOpenThread }: Props) {
  const { list, watchers, error, busy, setEnabled, reload } = useWatchers()
  const [sel, setSel] = useState<string | null>(wantedWatcher)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    wantedWatcher = null
    const pick = (id: string) => { wantedWatcher = null; setCreating(false); setSel(id) }
    watcherPickers.add(pick)
    return () => { watcherPickers.delete(pick) }
  }, [])
  const [note, setNote] = useState('')
  const row = watchers.find((w) => w.id === sel) ?? null
  useEffect(() => { if (!sel && watchers.length && !creating) setSel(watchers[0].id) }, [watchers.length])

  return (
    <section data-testid="watchers-panel" className="deploy watchers wt-view">
      <div className="dhead">
        <span className="dtitle">Watchers</span>
        <span data-testid="watchers-summary" className="dnote">{watchers.filter((w) => w.enabled).length}/{watchers.length} on{list?.testMode ? ', test mode: nothing runs on its own' : ''}</span>
        <span className="dspace" />
        <button data-testid="watcher-new" className="dlink" onClick={() => { setCreating(true); setSel(null) }}>New watcher</button>
        <button data-testid="watchers-reload" className="dlink" onClick={() => void reload()}>Reload</button>
      </div>
      <div className="wsplit">
        <div className="wlist">
          {watchers.map((w) => (
            <div data-testid="watcher-row" data-id={w.id} key={w.id} className={`wrow${w.id === sel ? ' on' : ''}`} role="button" tabIndex={0} aria-pressed={w.id === sel} onClick={() => { setSel(w.id); setCreating(false) }}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(w.id); setCreating(false) } }} title={w.message || w.goal}>
              <input data-testid="watcher-toggle" type="checkbox" checked={w.enabled} disabled={!!busy[w.id]} onClick={(e) => e.stopPropagation()} onChange={(e) => void setEnabled(w.id, e.target.checked)} aria-label={`${w.name} on/off`} />
              <div className="wmain">
                <div className="wname">{w.name}{w.builtin ? <span className="dnote"> built in</span> : null}<span className="dspace" />{stateWord(w.state)}</div>
                <div className="dnote">{plan(w)}</div>
                <div className="dnote">last {when(w.lastRun)}, next {when(w.nextRun)}, {w.findings} {w.builtin ? 'reviewed' : 'findings'}</div>
                {w.message && <div className="dnote wwarn">{w.message}</div>}
              </div>
            </div>
          ))}
          {!watchers.length && <div className="dnote">No watchers yet. Make one here, or ask any thread to create_watcher.</div>}
          {list?.problems.map((p) => <div key={p} className="derr">{p}</div>)}
          {error && <div className="derr">{error}</div>}
        </div>
        <div className="dbody wright">
          {note && <div className="dnote">{note}</div>}
          {creating
            ? <NewWatcher onDone={(id, msg) => { setCreating(false); setSel(id); setNote(msg ? `Created ${id}: ${msg}` : `Created ${id}; its first run started.`); void reload() }} />
            : row ? <Detail key={row.id} id={row.id} row={row} onOpen={onOpen} onOpenThread={onOpenThread} onGone={() => setSel(null)} /> : <div className="dnote">Pick a watcher.</div>}
        </div>
      </div>
    </section>
  )
}
