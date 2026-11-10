// The title bar: mark and name; the counts as coloured words (each jumps to the first such thread); the command field
// (Ctrl+K) whose palette lists threads, files, views, actions and every Claude command; the account switcher with
// name, plan, 5h and 7d. The bar drags the window; Windows draws minimise, maximise and close on the right.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppName } from './appSettings'
import { HiveMark } from './HiveMark'
import { useEscape } from './ui'
import { matchRank } from '../../shared/paletteRank'
import { filterCommands, type Command as EngineCommand } from '../../shared/composerCore'
import { live as liveStore, activate, openSession } from './actions'
import { liveLook } from './Rail'
import { useStore } from './store'
import { AccountSwitcher, useAccountSummary } from './AccountSwitcher'

export type Command = { id: string; group: 'Threads' | 'Files' | 'Views' | 'Actions' | 'Claude commands' | 'Your skills' | 'Notes'; label: string; hint?: string; run: () => void }

// what the palette is told by the shell, besides the static commands
export type PaletteSources = {
  commands: Command[]
  files: (q: string) => Promise<Command[]>
  engine: () => Promise<EngineCommand[]>
  runSlash: (c: EngineCommand) => void
}

// the counts: NEED YOU (waiting, not failed), WORKING, FAILED
function Counts() {
  const live = useStore(liveStore, (l) => l)
  const failed = live.waiting.filter((r) => liveLook(r).word === 'FAILED')
  const need = live.waiting.filter((r) => liveLook(r).word !== 'FAILED')
  const word = (n: number, w: string, cls: string, first: string | undefined, testid: string) => (
    <button className={`tb-count ${n ? cls : 'zero'}`} onClick={() => first && activate(first)} disabled={!first} title={first ? 'Show the first one' : undefined} data-testid={testid}>{n} {w}</button>
  )
  return (
    <div className="tb-counts" data-testid="title-counts">
      {word(need.length, 'NEED YOU', 'w', need[0]?.id, 'count-need')}
      {word(live.working.length, 'WORKING', 'k', live.working[0]?.id, 'count-working')}
      {word(failed.length, 'FAILED', 'f', failed[0]?.id, 'count-failed')}
    </div>
  )
}

// the field and the list under it
function CommandField({ src, open, setOpen, focusN }: { src: PaletteSources; open: boolean; setOpen: (b: boolean) => void; focusN: number }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState<Command[]>([])
  const [files, setFiles] = useState<Command[]>([])
  const [hits, setHits] = useState<Command[]>([])
  const [engine, setEngine] = useState<EngineCommand[]>([])
  useEffect(() => { if (focusN) { setOpen(true); input.current?.focus(); input.current?.select() } }, [focusN])
  // fresh lists each time it opens
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.api.listSessions().then((l) => { if (alive) setSaved(l.filter((s) => !s.watcherRun).map((s) => ({ id: `saved:${s.id}`, group: 'Threads', label: s.title, hint: s.project, run: () => openSession(s) }))) }).catch(() => {})
    void src.engine().then((c) => { if (alive) setEngine(c) }).catch(() => {})
    return () => { alive = false }
  }, [open])
  // files and full-text thread search from 2 characters on; a late answer for an older text is dropped
  const text = q.trim()
  const slash = text.startsWith('/')
  useEffect(() => {
    let alive = true
    if (text.length < 2 || slash) { setFiles([]); setHits([]); return }
    const t = setTimeout(() => {
      void src.files(text).then((f) => { if (alive) setFiles(f) }).catch(() => { if (alive) setFiles([]) })
      void window.api.searchQuery(text).then(async (r) => {
        if (!alive) return
        const all = await window.api.listSessions()
        const by = new Map(all.map((s) => [s.id, s]))
        setHits(r.results.flatMap((h) => { const s = by.get(h.sessionId); return s ? [{ id: `hit:${s.id}`, group: 'Threads' as const, label: s.title, hint: h.snippet.replace(/\s+/g, ' ').slice(0, 80), run: () => openSession(s) }] : [] }))
      }).catch(() => { if (alive) setHits([]) })
    }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [text, slash])
  const shown = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    const engineRows: Command[] = (slash ? filterCommands(engine, text.slice(1)) : text ? filterCommands(engine, text) : engine).map((c) => ({
      id: `slash:${c.name}`, group: c.builtin ? 'Claude commands' : 'Your skills', label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}`, hint: c.description, run: () => src.runSlash(c),
    }))
    if (slash) return engineRows
    const base = [...src.commands, ...saved.filter((s) => !src.commands.some((c) => c.id === `open:${s.id.slice(6)}`))]
    const hit = base.filter((c) => { const t = `${c.label} ${c.hint ?? ''}`.toLowerCase(); return words.every((w) => t.includes(w)) })
    const rank = (c: Command) => matchRank(c.label, text) ?? 3
    const order: Command['group'][] = ['Threads', 'Views', 'Actions', 'Files', 'Claude commands', 'Your skills']
    const byGroup = (g: Command['group']) => {
      if (g === 'Files') return files.slice(0, 12)
      if (g === 'Claude commands' || g === 'Your skills') return text ? engineRows.filter((c) => c.group === g).slice(0, 8) : []
      const rows = hit.filter((c) => c.group === g).sort((a, b) => rank(a) - rank(b))
      if (g === 'Threads') return [...rows, ...hits.filter((h) => !rows.some((r) => r.label === h.label))].slice(0, text ? 14 : 10)
      return rows
    }
    return order.flatMap(byGroup)
  }, [src.commands, saved, files, hits, engine, text, slash])
  useEffect(() => { setSel(0) }, [text])
  useEffect(() => { list.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const close = () => { setOpen(false); setQ(''); input.current?.blur() }
  useEscape(() => close(), open)
  const run = (c?: Command) => { if (!c) return; close(); c.run() }
  let lastGroup = ''
  return (
    <div className="tb-field">
      <input ref={input} placeholder="Search threads, run a command, or type / for Claude commands" value={q} aria-label="Command field" aria-expanded={open} aria-controls="palette-list" role="combobox"
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} data-testid="palette-input"
        onBlur={(e) => { if (!list.current?.contains(e.relatedTarget as Node)) setTimeout(() => setOpen(false), 120) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]) }
        }} />
      <span className="keys">Ctrl K</span>
      {open && (
        <div className="palette" id="palette-list" ref={list} role="listbox" data-testid="palette" onMouseDown={(e) => e.preventDefault()}>
          {!shown.length && <div className="pal-empty">{slash ? 'No Claude command matches.' : 'Nothing matches.'}</div>}
          {shown.map((c, i) => {
            const headNow = c.group !== lastGroup ? c.group : ''
            lastGroup = c.group
            return (
              <div key={`${c.group}:${c.id}:${i}`}>
                {headNow && <div className="pal-group">{headNow}</div>}
                <button className={i === sel ? 'pal-row on' : 'pal-row'} role="option" aria-selected={i === sel} tabIndex={-1} onMouseEnter={() => setSel(i)} onClick={() => run(c)} data-testid={`palette-${c.id}`}>
                  <span className="pal-label">{c.label}</span>
                  {c.hint && <span className="pal-hint">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AccountButton({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) {
  const a = useAccountSummary()
  const pct = (n: number | null | undefined) => (n == null ? '' : `${Math.round(n)}%`)
  return (
    <>
      <button className={`tb-acct${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Accounts (Ctrl+Alt+1..3 switches)" data-testid="account-button">
        <span>{a.label || 'Account'}</span>
        {a.plan && <i className="lim">{a.plan}</i>}
        {a.five != null && <span className={`lim${a.five > 60 ? ' warm' : ''}`}>5h {pct(a.five)}</span>}
        {a.seven != null && <i className="lim">7d {pct(a.seven)}</i>}
      </button>
      {open && <AccountSwitcher onClose={() => setOpen(false)} />}
    </>
  )
}

export function TitleBar({ src, paletteN, accountsOpen, setAccountsOpen }: { src: PaletteSources; paletteN: number; accountsOpen: boolean; setAccountsOpen: (b: boolean) => void }) {
  const name = useAppName()
  const [open, setOpen] = useState(false)
  return (
    <header className="tb" data-testid="titlebar">
      <span className="tb-brand" data-testid="brand"><HiveMark size={16} />{name}</span>
      <Counts />
      <CommandField src={src} open={open} setOpen={setOpen} focusN={paletteN} />
      <AccountButton open={accountsOpen} setOpen={setAccountsOpen} />
    </header>
  )
}
