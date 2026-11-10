// Settings: a page (a section list on the left, the form on the right) for everything that used to live in the
// .env and scripts.json. Edits a draft; Save validates in the main process, writes ~/.claude/hive-settings.json and
// re-applies it to every feature. Credential-looking keys never come here: the panel only says whether they are set.
import { useEffect, useState, type ReactNode } from 'react'
import {
  EFFORTS, envKey, isSecretKey, joinList, sectionOf, splitList,
  type Draft, type General, type Problem, type SettingsView,
} from '../../shared/settingsCore'
import { PhonePairing } from './PhonePairing'
import { HooksMenu } from './HooksMenu'
import { PluginsMenu } from './PluginsMenu'
import { Btn, Unavailable } from './kit'
import { getThemes, setLayout, setTheme, useAppearance, type Layout } from './appearance'
import { quietHoursGet, quietHoursSet, type QuietHours } from './api/next'
import { useStore } from './store'
import { place } from './actions'
import { ENVS } from '../../shared/deployCore'
import { appName } from '../../shared/appName'
import { setClipboardOn, useClipboardOn } from './clipboardOffer'
import { getPref, setPref } from './prefs'
import { applyGeneral } from './appSettings'
import { Confirm } from './ui'

const SECTIONS = [
  ['watch', 'Watchers'], ['dependabot', 'Dependabot'], ['scripts', 'Scripts'], ['deploy', 'Deploy'],
  ['dev', 'Dev stack and Pull latest'], ['general', 'General'], ['appearance', 'Appearance'], ['accounts', 'Accounts'],
  ['phone', 'Phone'], ['claude', 'Claude Code'], ['notify', 'Notifications'], ['other', 'Other keys'],
] as const
type Sec = (typeof SECTIONS)[number][0]
export type SettingsSectionId = Sec

// which section to show: set from the palette or a link elsewhere, before or while the page is up
let wantedSection: Sec | null = null
const sectionPickers = new Set<(id: Sec) => void>()
export const pickSettingsSection = (id: Sec) => { wantedSection = id; sectionPickers.forEach((f) => f(id)) }

const LAYOUT_ROWS: { k: keyof Layout; label: string; keys: string }[] = [
  { k: 'rail', label: 'Rail', keys: 'Ctrl [' }, { k: 'inspector', label: 'Inspector', keys: 'Ctrl ]' }, { k: 'drawer', label: 'Drawer', keys: 'Ctrl `' },
  { k: 'focus', label: 'Focus: hide the rail and the inspector', keys: 'Ctrl Shift F' }, { k: 'railRight', label: 'Rail on the right', keys: '' },
]
type Env = Record<string, string>
type Script = { name: string; cwd: string; open: string; options: { label: string; cmd: string }[] }

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const asScript = (x: unknown): Script => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const options = Array.isArray(o.options) ? o.options.map((p) => { const q = (p ?? {}) as Record<string, unknown>; return { label: s(q.label), cmd: s(q.cmd) } }) : []
  return { name: s(o.name), cwd: s(o.cwd), open: s(o.open), options }
}
const scriptOut = (s: Script) => ({ name: s.name, cwd: s.cwd, options: s.options, ...(s.open.trim() ? { open: s.open } : {}) })

function Msgs({ list }: { list: Problem[] }) {
  return <>{list.map((p, i) => <div key={i} className={p.level === 'error' ? 'serr' : 'swarn'}>{p.message}</div>)}</>
}

function Row({ label, hint, children, problems = [] }: { label: string; hint?: string; children: ReactNode; problems?: Problem[] }) {
  return (
    <div className="srow">
      <label className="slabel">{label}</label>
      <div className="sfield">
        {children}
        {hint && <div className="dnote">{hint}</div>}
        <Msgs list={problems} />
      </div>
    </div>
  )
}

// onWatchers: open the Watchers page; onAccounts: open the account switcher; onClose: called after Cancel discards
export function SettingsPanel({ onClose, onWatchers, onAccounts }: { onClose?: () => void; onWatchers?: (id?: string) => void; onAccounts?: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState('') // JSON of the draft as last loaded / saved, for "unsaved changes"
  const [sec, setSec] = useState<Sec>(wantedSection ?? 'watch')
  const app = useAppearance()
  const workspace = useStore(place, (p) => p.workspace)
  // quiet hours live in main, apart from the settings file: null = not read yet, 'na' = the adapter has no answer
  const [quiet, setQuiet] = useState<QuietHours | null>(null)
  const [quietSaved, setQuietSaved] = useState('')
  const [quietNa, setQuietNa] = useState('')
  const [problems, setProblems] = useState<Problem[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // values kept outside the settings file: two page preferences
  const clipOn = useClipboardOn()
  const [clip, setClip] = useState(clipOn)
  const [sendMode, setSendMode] = useState(['queue', 'interrupt'].includes(getPref<string>('sendMode', 'steer')) ? getPref<string>('sendMode', 'steer') : 'steer')
  // what is being typed into each "new id" box, the script being edited, the new key under Other, and the list
  // rows just added that hold nothing yet: each its own state, so one never wipes another
  const [adds, setAdds] = useState<Record<string, string>>({})
  const [openScript, setOpenScript] = useState(-1)
  const [otherNew, setOtherNew] = useState('')
  const [blank, setBlank] = useState<Record<string, boolean>>({})
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    wantedSection = null
    const pick = (id: Sec) => { wantedSection = null; setSec(id) }
    sectionPickers.add(pick)
    return () => { sectionPickers.delete(pick) }
  }, [])
  const loadQuiet = () => quietHoursGet().then((r) => {
    if (r.ok) { setQuiet(r.data); setQuietSaved(JSON.stringify(r.data)); setQuietNa('') } else { setQuiet(null); setQuietNa(r.reason) }
  })

  const load = () => window.api.settingsGet(true).then((v) => {
    const d = { env: v.env, scripts: v.scripts, general: v.general }
    setView(v); setDraft(d); setSaved(JSON.stringify(d)); setProblems(v.problems); setErr('')
  }).catch((e) => setErr(clean(e)))
  useEffect(() => {
    void load()
    void loadQuiet()
  }, [])

  // validate as you type (paths are checked by the main process)
  useEffect(() => {
    if (!draft) return
    const t = setTimeout(() => { window.api.settingsValidate(draft).then(setProblems).catch((e) => setErr(clean(e))) }, 300)
    return () => clearTimeout(t)
  }, [draft])

  const dirty = !!draft && (JSON.stringify(draft) !== saved || clip !== clipOn || sendMode !== getPref<string>('sendMode', 'steer') || (!!quiet && JSON.stringify(quiet) !== quietSaved))
  // Cancel: put every field back as last saved
  const discard = () => {
    setAsking(false); setClip(clipOn); setSendMode(getPref<string>('sendMode', 'steer')); setNotes([])
    void load(); void loadQuiet()
    onClose?.()
  }

  const env: Env = draft?.env ?? {}
  const get = (k: string) => env[k] ?? ''
  const setEnv = (f: (e: Env) => Env) => setDraft((d) => (d ? { ...d, env: f({ ...d.env }) } : d))
  const set = (k: string, v: string) => setEnv((e) => ({ ...e, [k]: v }))
  const setGeneral = (g: Partial<General>) => setDraft((d) => (d ? { ...d, general: { ...d.general, ...g } } : d))
  const setScripts = (s: Script[]) => setDraft((d) => (d ? { ...d, scripts: s.map(scriptOut) } : d))
  const of = (k: string) => problems.filter((p) => p.key === k)
  const errors = problems.filter((p) => p.level === 'error')

  const save = async () => {
    if (!draft) return
    setBusy(true); setErr('')
    try {
      const r = await window.api.settingsSave(draft)
      setProblems(r.problems)
      if (!r.ok) { setNotes([]); return }
      const extra: string[] = []
      if (quiet && JSON.stringify(quiet) !== quietSaved) {
        const q = await quietHoursSet(quiet)
        if (q.ok) setQuietSaved(JSON.stringify(quiet)); else extra.push(`Quiet hours not saved: ${q.reason}`)
      }
      if (clip !== clipOn) setClipboardOn(clip)
      if (sendMode !== getPref<string>('sendMode', 'steer')) { setPref('sendMode', sendMode); extra.push('Steer, queue or interrupt: used by threads you open or switch to from now on.') }
      applyGeneral(draft.general)
      setNotes(['Saved. Dependabot, Deploy, Dev stack, Pull latest, Scripts, the app name, tagline and appearance use it now.', ...r.notes, ...extra])
      await load()
    } catch (e) { setErr(clean(e)) } finally { setBusy(false) }
  }

  const text = (k: string, placeholder = '', wide = true) => (
    <input className={wide ? 'sin wide' : 'sin'} value={get(k)} placeholder={placeholder} spellCheck={false} onChange={(e) => set(k, e.target.value)} />
  )
  const field = (k: string, label: string, hint?: string, placeholder?: string) => <Row key={k} label={label} hint={hint} problems={of(k)}>{text(k, placeholder)}</Row>

  // a comma list edited as rows (repos, folders)
  const listRows = (k: string, placeholder: string) => {
    const xs = splitList(get(k))
    // a row just added is empty (the example shows as a hint) until something is typed in it: only typed values are saved
    const rows = blank[k] ? [...xs, ''] : xs
    const put = (next: string[]) => { set(k, next.filter((x) => x.trim()).join(',')); setBlank((b) => ({ ...b, [k]: false })) }
    return (
      <div className="slist">
        {rows.map((x, i) => (
          <div key={i} className="sline">
            <input className="sin wide" value={x} placeholder={placeholder} spellCheck={false} autoFocus={!!blank[k] && i === xs.length} onChange={(e) => put(rows.map((y, j) => (j === i ? e.target.value : y)))} />
            <button className="dlink" onClick={() => put(rows.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button className="dlink" disabled={!!blank[k]} onClick={() => setBlank((b) => ({ ...b, [k]: true }))}>Add</button>
      </div>
    )
  }

  // a list of ids (stacks, services, suites), each with its own PREFIX_<ID>_FIELD keys
  type F = { f: string; label: string; hint?: string; choices?: string[] }
  const group = (title: string, listKey: string, prefix: string, fields: F[], what: string) => {
    const ids = splitList(get(listKey))
    const adding = adds[listKey] ?? ''
    const setAdding = (v: string) => setAdds((a) => ({ ...a, [listKey]: v }))
    const add = () => {
      const id = adding.trim()
      if (!id || ids.includes(id)) return
      set(listKey, joinList([...ids, id])); setAdding('')
    }
    const remove = (id: string) => setEnv((e) => {
      const p = `${prefix}${envKey(id)}_`
      for (const k of Object.keys(e)) if (k.startsWith(p)) delete e[k]
      e[listKey] = joinList(ids.filter((x) => x !== id))
      return e
    })
    return (
      <div className="sgroup">
        <div className="sgtitle">{title}</div>
        <Msgs list={of(listKey)} />
        {ids.map((id) => {
          const p = `${prefix}${envKey(id)}_`
          return (
            <div key={id} className="scard">
              <div className="sline"><b>{id}</b><span className="dspace" /><button className="dlink" onClick={() => remove(id)}>Remove {what}</button></div>
              {fields.map((x) => (
                <Row key={x.f} label={x.label} hint={x.hint} problems={of(p + x.f)}>
                  {x.choices
                    ? <select className="sin" value={get(p + x.f)} onChange={(e) => set(p + x.f, e.target.value)}>{x.choices.map((c) => <option key={c} value={c}>{c || '(default)'}</option>)}</select>
                    : text(p + x.f)}
                </Row>
              ))}
            </div>
          )
        })}
        <div className="sline">
          <input className="sin" placeholder={`new ${what} id`} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          <button className="dbtn" onClick={add}>Add {what}</button>
        </div>
      </div>
    )
  }

  // ---- Watchers: each has its own folder and schedule now (the Watchers view and the agent tools edit them) ----
  const watch = (
    <>
      <Row label="Watchers" hint="Each watcher has its own folder, schedule and thread (~/.claude/hive/watchers). Make, switch on or off, schedule and run them on the Watchers and teams page.">
        {onWatchers && <div><Btn onClick={() => onWatchers()} testid="settings-open-watchers">Open Watchers</Btn></div>}
      </Row>
      {view?.weekly && <Row label="Weekly use" hint="Adaptive watchers pick their tier from it.">{view.weekly.pct === null ? `unreadable (${view.weekly.error})` : `${Math.round(view.weekly.pct)}%`}</Row>}
      {field('HIVE_WATCHERS_REPORTS_DIR', 'Reports folder', 'Each watcher saves its reports in a folder named after it here. Empty = "Watch reports" in the repos root; a relative path is under the repos root; "-" keeps them inside each watcher folder.', 'Watch reports')}
      {field('HIVE_WATCHER_POST_SHA256', 'Alert channels', 'Watchers are read-only; they may still POST to these: comma-separated SHA-256 fingerprints of host + path (e.g. of hooks.slack.com/services/... for an alert channel\'s webhook), so the webhook itself is not stored here.', '')}
    </>
  )

  // ---- Scripts ----
  const scripts = (draft?.scripts ?? []).map(asScript)
  const putScript = (i: number, s: Partial<Script>) => setScripts(scripts.map((x, j) => (j === i ? { ...x, ...s } : x)))
  const scriptsSec = (
    <>
      {!draft?.scripts && <div className="dnote">No scripts saved here yet{view ? ` (${appName()} falls back to ${view.scriptsFile})` : ''}. Adding one saves the list here.</div>}
      <Msgs list={of('scripts')} />
      {scripts.map((s, i) => (
        <div key={i} className="scard">
          <div className="sline">
            <b>{s.name || '(no name)'}</b><span className="dnote">{s.options.length} option{s.options.length === 1 ? '' : 's'}</span>
            <span className="dspace" />
            <button className="dlink" onClick={() => setOpenScript(openScript === i ? -1 : i)}>{openScript === i ? 'Done' : 'Edit'}</button>
            <button className="dlink" onClick={() => { setScripts(scripts.filter((_, j) => j !== i)); setOpenScript(-1) }}>Remove</button>
          </div>
          {openScript === i && (
            <>
              <Row label="Name"><input className="sin wide" value={s.name} onChange={(e) => putScript(i, { name: e.target.value })} /></Row>
              <Row label="Folder" hint="Absolute path the commands run in."><input className="sin wide" value={s.cwd} spellCheck={false} onChange={(e) => putScript(i, { cwd: e.target.value })} /></Row>
              <Row label="Options" hint="A button each: label and the command it runs.">
                <div className="slist">
                  {s.options.map((o, k) => (
                    <div key={k} className="sline">
                      <input className="sin" placeholder="label" value={o.label} onChange={(e) => putScript(i, { options: s.options.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                      <input className="sin wide mono" placeholder="command" spellCheck={false} value={o.cmd} onChange={(e) => putScript(i, { options: s.options.map((x, j) => (j === k ? { ...x, cmd: e.target.value } : x)) })} />
                      <button className="dlink" onClick={() => putScript(i, { options: s.options.filter((_, j) => j !== k) })}>Remove</button>
                    </div>
                  ))}
                  <button className="dlink" onClick={() => putScript(i, { options: [...s.options, { label: '', cmd: '' }] })}>Add option</button>
                </div>
              </Row>
              <Row label="File to open" hint="Optional glob under the folder; the newest match opens after a run (e.g. reports/*/*.html)."><input className="sin wide" value={s.open} spellCheck={false} onChange={(e) => putScript(i, { open: e.target.value })} /></Row>
            </>
          )}
        </div>
      ))}
      <button className="dbtn" onClick={() => { setScripts([...scripts, { name: '', cwd: '', open: '', options: [{ label: 'Run', cmd: '' }] }]); setOpenScript(scripts.length) }}>Add script</button>
    </>
  )

  // ---- Other keys + credentials ----
  const otherKeys = Object.keys(env).filter((k) => sectionOf(k) === 'other').sort()
  const otherBad = otherNew && (!/^[A-Za-z_]\w*$/.test(otherNew) ? 'Not a KEY name' : isSecretKey(otherNew) ? 'Looks like a credential: keep it in the vault or the .env, not here' : otherNew in env ? 'Already listed' : '')
  const other = (
    <>
      <div className="dnote">Keys no section above covers. Restart {appName()} after changing them.</div>
      {otherKeys.map((k) => (
        <Row key={k} label={k} problems={of(k)}>
          <div className="sline">{text(k)}<button className="dlink" onClick={() => setEnv((e) => { delete e[k]; return e })}>Remove</button></div>
        </Row>
      ))}
      <div className="sline">
        <input className="sin" placeholder="NEW_KEY" value={otherNew} onChange={(e) => setOtherNew(e.target.value.trim())} />
        <button className="dbtn" disabled={!otherNew || !!otherBad} onClick={() => { set(otherNew, ''); setOtherNew('') }}>Add key</button>
        {otherBad && <span className="serr">{otherBad}</span>}
      </div>
      <div className="sgroup">
        <div className="sgtitle">Credentials</div>
        <div className="dnote">Never stored in {appName()} settings and never shown. They live in your local vault or the .env{view ? ` (${view.envFile})` : ''}.</div>
        {view?.secrets.length ? view.secrets.map((s) => (
          <div key={s.key} className="sline"><span className="mono">{s.key}</span><span className="dspace" /><span className={s.set ? 'sok' : 'dnote'}>{s.set ? 'set' : 'not set'}</span></div>
        )) : <div className="dnote">None in the .env.</div>}
      </div>
    </>
  )

  const g = draft?.general
  const body: Record<Sec, ReactNode> = {
    watch,
    dependabot: (
      <>
        <Row label="Repos" hint="owner/name, one per row. Open Dependabot PRs get one background review thread each." problems={of('HIVE_DEPENDABOT_REPOS')}>{listRows('HIVE_DEPENDABOT_REPOS', 'owner/')}</Row>
        {field('HIVE_DEPENDABOT_TIME', 'Time', 'Once a day at HH:MM local (at the next start if the app was closed then).', '12:00')}
      </>
    ),
    scripts: scriptsSec,
    deploy: (
      <>
        {group('Suites', 'HIVE_DEPLOY_SUITES', 'HIVE_DEPLOY_SUITE_', [
          { f: 'LABEL', label: 'Label' }, { f: 'API', label: 'API repos', hint: 'Comma list of folders under the repos root; deploy before web.' }, { f: 'WEB', label: 'Web repos', hint: 'Comma list.' },
        ], 'suite')}
        {field('HIVE_DEPLOY_ORG', 'GitHub owner', 'For the changelog compare links.')}
        {field('HIVE_DEPLOY_SCRIPT', 'Deploy script', 'Run as bash <script> staging|prod in the repo; relative to the repos root or absolute.')}
        {field('HIVE_DIFFS_SCRIPT', 'Diffs script', 'Empty = diffs.sh next to the deploy script.')}
        {field('HIVE_DEPLOY_REGION', 'Region', undefined, 'us-east-1')}
        {field('HIVE_DEPLOY_API_REPO', 'API repo (landed check)')}
        {field('HIVE_DEPLOY_API_CLUSTER', 'API cluster', '{env} becomes dev / qa / staging / prod.')}
        {field('HIVE_DEPLOY_API_SERVICES', 'API services', 'Comma list; the first is what "served" means.')}
        {field('HIVE_DEPLOY_API_SERVICE_NAME', 'Service name pattern', 'Uses {cluster} and {service}.')}
        {field('HIVE_DEPLOY_WEB_REPO', 'Web repo (landed check)')}
        {ENVS.map((e) => field(`HIVE_DEPLOY_WEB_${envKey(e)}`, `Web ${e}`, 'bucket/host,CloudFront distribution id'))}
        <Msgs list={of('deploy')} />
      </>
    ),
    dev: (
      <>
        {field('HIVE_REPOS_ROOT', 'Repos root', 'Folder whose direct children are your git repos.')}
        <Row label="Agent folders" hint="Folders in the root whose children are also repos." problems={of('HIVE_AGENTS_FOLDERS')}>{listRows('HIVE_AGENTS_FOLDERS', 'agents')}</Row>
        <Row label="Pull latest skips" hint="Root-relative paths. Folders starting with _ or . are always skipped." problems={of('HIVE_PULL_SKIP')}>{listRows('HIVE_PULL_SKIP', 'repo/sub')}</Row>
        {field('HIVE_WORKTREES_DIR', 'Worktrees folder', 'Relative to the root, or absolute.', '.hive-worktrees')}
        {group('Stacks', 'HIVE_STACKS', 'HIVE_STACK_', [{ f: 'LABEL', label: 'Label' }, { f: 'SERVICES', label: 'Services', hint: 'Comma list of service ids below.' }], 'stack')}
        {group('Services', 'HIVE_SERVICES', 'HIVE_SVC_', [
          { f: 'NAME', label: 'Name' }, { f: 'KIND', label: 'Kind', choices: ['', 'process', 'docker'] }, { f: 'REPO', label: 'Repo folder' },
          { f: 'CMD', label: 'Command', hint: 'Process services. {python} becomes the Python path below.' }, { f: 'PYTHON', label: 'Python' },
          { f: 'COMPOSE', label: 'Compose service', hint: 'Docker services.' }, { f: 'PORT', label: 'Port' },
          { f: 'ENV', label: 'Env defaults', hint: 'KEY=VALUE;KEY=VALUE (no credentials).' }, { f: 'ENVFILE', label: 'Env file', hint: 'Default .env in the repo.' },
          { f: 'OPEN', label: 'Open link', choices: ['', 'true', 'false'] },
        ], 'service')}
        {field('HIVE_DOCKER_DESKTOP', 'Docker Desktop', 'Path to Docker Desktop, to start it when needed. Read at start.')}
        <Msgs list={of('dev')} />
      </>
    ),
    general: g && (
      <>
        <Row label="App name" hint="Top bar and window title." problems={of('general.appName')}><input data-testid="settings-app-name" className="sin" value={g.appName} onChange={(e) => setGeneral({ appName: e.target.value })} /></Row>
        <Row label="Tagline" hint="Shown beside the name in the top bar. Empty = none." problems={of('general.appTagline')}><input className="sin wide" value={g.appTagline} onChange={(e) => setGeneral({ appTagline: e.target.value })} /></Row>
        {field('HIVE_ALLOWLIST_CMD', 'IP allowlist command', 'Runs from the "Allow my IP" button, which turns on when your public IP changes. It should add the current IP wherever it must be allowed. Empty = no button.', '')}
        <Row label="Claude in Chrome" hint="Threads started after saving can use your Chrome through the Claude extension (claude --chrome). Needs the extension installed and signed in."><label className="scheck"><input type="checkbox" data-testid="settings-chrome" checked={g.chrome} onChange={(e) => setGeneral({ chrome: e.target.checked })} /> Let threads use Chrome</label></Row>
        <Row label="Clipboard suggestions"><label className="scheck"><input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} /> Offer copied text and images to the active thread</label></Row>
        <Row label="While Claude works" hint="What Enter does; Alt+Enter does the other.">
          <select className="sin" value={sendMode} onChange={(e) => setSendMode(e.target.value)}><option value="steer">Steer the running turn</option><option value="queue">Queue for the next turn</option><option value="interrupt">Interrupt Claude and send now</option></select>
        </Row>
        <Row label="Terminal shell" hint="Empty = the system default. Used by terminals opened after saving." problems={of('general.shell')}><input className="sin wide" value={g.shell} spellCheck={false} onChange={(e) => setGeneral({ shell: e.target.value })} /></Row>
        <Row label="Default model" hint="Empty = Claude Code's default. Used by threads started after saving." problems={of('general.model')}><input className="sin" value={g.model} spellCheck={false} placeholder="(default)" onChange={(e) => setGeneral({ model: e.target.value })} /></Row>
        <Row label="Default effort" problems={of('general.effort')}>
          <select className="sin" value={g.effort} onChange={(e) => setGeneral({ effort: e.target.value as General['effort'] })}>
            <option value="">(default)</option>{EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Row>
      </>
    ),
    // UI and Theme apply live and are kept with the other page preferences (each UI remembers its own theme), so they
    // are not part of the Save below
    appearance: (
      <>
        <Row label="Theme" hint="Applies at once and is kept; it is not part of Save.">
          <div className="set-radios" role="radiogroup" aria-label="Theme">
            {getThemes().map((t) => (
              <label key={t.id} className="scheck set-radio">
                <input type="radio" name="theme" data-testid={`appearance-theme-${t.id}`} checked={app.theme === t.id} onChange={() => setTheme(t.id)} />
                <span className="set-rl">{t.label}</span><span className="dnote">{t.description}</span>
              </label>
            ))}
          </div>
        </Row>
        <Row label="Layout" hint="Applies at once. The same toggles are in the palette.">
          <div className="set-radios">
            {LAYOUT_ROWS.map((r) => (
              <label key={r.k} className="scheck set-radio">
                <input type="checkbox" data-testid={`appearance-layout-${r.k}`} checked={app.layout[r.k]} onChange={(e) => setLayout({ [r.k]: e.target.checked })} />
                <span className="set-rl">{r.label}</span>{r.keys && <span className="dnote">{r.keys}</span>}
              </label>
            ))}
          </div>
        </Row>
      </>
    ),
    accounts: (
      <Row label="Accounts" hint="Sign in, add and switch accounts in the account switcher at the top right. Threads that are running keep the account they started on.">
        <div><Btn onClick={() => onAccounts?.()} disabled={!onAccounts} testid="settings-open-accounts">Open the account switcher</Btn></div>
      </Row>
    ),
    phone: (
      <>
        {field('HIVE_MOBILE_RELAY', 'Relay', 'The relay the Hive phone app and this computer both connect to (https://...). See Phone app in README.md: on a server, or on this computer behind cloudflared.', 'https://hive-relay.example.com')}
        {field('HIVE_MOBILE_ADMIN_TOKEN', 'Relay admin token', 'The HIVE_RELAY_ADMIN_TOKEN the relay runs with, so this computer can register a paired phone.', '')}
        <Row label="Phone app" hint="Pair once by scanning a code with the phone app. Claude can then notify the phone (notify_phone), and you get a notification when a thread waits for you or a background thread finishes."><PhonePairing /></Row>
      </>
    ),
    claude: (
      <>
        <Row label="Hooks" hint={workspace ? 'Hooks of the workspace folder, its project and your user settings.' : 'No workspace folder is set: only your user hooks show.'}><HooksMenu folder={workspace} /></Row>
        <Row label="Plugins"><PluginsMenu /></Row>
      </>
    ),
    notify: g && (
      <>
        <Row label="Desktop notifications" hint="A Windows notification and a flashing taskbar icon when a thread is waiting for you, asks a question, finishes or fails while Hive is not the focused window."><label className="scheck"><input type="checkbox" data-testid="settings-desktop-notify" checked={g.desktopNotify} onChange={(e) => setGeneral({ desktopNotify: e.target.checked })} /> Notify me on the desktop</label></Row>
        <Row label="Quiet hours" hint="No desktop or phone ring between the two times, except failures and deploys when kept on below.">
          {quiet ? (
            <div className="slist">
              <label className="scheck"><input type="checkbox" data-testid="quiet-on" checked={quiet.on} onChange={(e) => setQuiet({ ...quiet, on: e.target.checked })} /> Keep quiet</label>
              <div className="sline">
                <span className="dnote">from</span><input className="sin num" data-testid="quiet-from" value={quiet.from} placeholder="22:00" disabled={!quiet.on} onChange={(e) => setQuiet({ ...quiet, from: e.target.value })} />
                <span className="dnote">to</span><input className="sin num" data-testid="quiet-to" value={quiet.to} placeholder="07:00" disabled={!quiet.on} onChange={(e) => setQuiet({ ...quiet, to: e.target.value })} />
              </div>
              <label className="scheck"><input type="checkbox" checked={quiet.ringFailures} disabled={!quiet.on} onChange={(e) => setQuiet({ ...quiet, ringFailures: e.target.checked })} /> Still ring for failures</label>
              <label className="scheck"><input type="checkbox" checked={quiet.ringDeploys} disabled={!quiet.on} onChange={(e) => setQuiet({ ...quiet, ringDeploys: e.target.checked })} /> Still ring for deploys</label>
            </div>
          ) : quietNa ? <Unavailable reason={quietNa} /> : <div className="dnote">Reading</div>}
        </Row>
      </>
    ),
    other,
  }
  const count = (s: Sec) => problems.filter((p) => secOfProblem(p.key) === s && p.level === 'error').length

  return (
    <div className="set-wrap">
      <div data-testid="settings" className="smodal set-body" aria-label="Settings">
        {view && <div className="set-file dnote" title={view.file}>{view.file}</div>}
        <div className="smain">
          <nav className="snav">
            {SECTIONS.map(([id, label]) => (
              <button data-testid={`settings-nav-${id}`} key={id} className={sec === id ? 'on' : ''} onClick={() => setSec(id)}>
                {label}{count(id) > 0 && <span className="sbad">{count(id)}</span>}
              </button>
            ))}
          </nav>
          <div className="sbody">
            {err && <div className="derr">{err}</div>}
            {!draft ? <div className="dnote">Loading</div> : body[sec]}
          </div>
        </div>
        <div className="sfoot">
          {errors.length > 0
            ? <span data-testid="settings-errors" className="serr">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix before saving: {errors[0].message}</span>
            : notes.length > 0 ? <span data-testid="settings-notes" className="sok">{notes.join(' ')}</span>
            : <span className="dnote">{dirty ? 'Unsaved changes' : 'No changes'}</span>}
          <span className="dspace" />
          <Btn onClick={() => (dirty ? setAsking(true) : onClose?.())} testid="settings-cancel">Cancel</Btn>
          <Btn kind="primary" testid="settings-save" disabled={!dirty || busy || errors.length > 0} onClick={() => void save()}>{busy ? 'Saving' : 'Save'}</Btn>
        </div>
        {asking && (
          <Confirm title="Discard unsaved settings?" action="Discard" danger testid="settings-discard" onCancel={() => setAsking(false)} onConfirm={discard}>
            <div>The changes you made here have not been saved.</div>
          </Confirm>
        )}
      </div>
    </div>
  )
}

// which nav section a problem belongs to, for the error counts
function secOfProblem(key: string): Sec {
  if (key === 'scripts') return 'scripts'
  if (key === 'deploy') return 'deploy'
  if (key === 'dev') return 'dev'
  if (key === 'HIVE_MOBILE_RELAY' || key === 'HIVE_MOBILE_ADMIN_TOKEN') return 'phone'
  if (key === 'HIVE_WATCHERS_REPORTS_DIR' || key === 'HIVE_WATCHER_POST_SHA256') return 'watch'
  if (key === 'general.ui' || key === 'general.theme') return 'appearance'
  if (key.startsWith('general.')) return 'general'
  const s = sectionOf(key)
  return s === 'other' ? 'other' : s
}
