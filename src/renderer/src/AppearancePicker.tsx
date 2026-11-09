// Settings -> Appearance: pick the UI (layout) and, for that UI, its Theme. Applies live.
import { getThemes, getUIs, setTheme, setUI, useAppearance, type UIId } from './appearance'

export function AppearancePicker({ ui: forUI }: { ui?: UIId } = {}) {
  const { ui, themes } = useAppearance()
  const target = forUI ?? ui
  return (
    <div className="appearance" data-testid="appearance-picker">
      <div className="ap-head">UI</div>
      <div className="ap-note">Which regions sit where. Every feature is reachable in every UI.</div>
      <div className="ap-list" role="radiogroup" aria-label="UI">
        {getUIs().map((u) => (
          <button key={u.id} role="radio" aria-checked={ui === u.id} className={ui === u.id ? 'ap-row on' : 'ap-row'} onClick={() => setUI(u.id)} data-testid={`appearance-ui-${u.id}`}>
            <span className={`codicon ${ui === u.id ? 'codicon-pass-filled' : 'codicon-circle-large-outline'}`} />
            <span className="ap-text"><span className="ap-label">{u.label}</span><span className="ap-desc">{u.description}</span></span>
          </button>
        ))}
      </div>
      <div className="ap-head">Theme <span className="ap-for">for {getUIs().find((u) => u.id === target)?.label}</span></div>
      <div className="ap-note">Each UI remembers its own theme.</div>
      <div className="ap-list" role="radiogroup" aria-label="Theme">
        {getThemes(target).map((t) => (
          <button key={t.id} role="radio" aria-checked={themes[target] === t.id} className={themes[target] === t.id ? 'ap-row on' : 'ap-row'} onClick={() => setTheme(t.id, target)} data-testid={`appearance-theme-${t.id}`}>
            <span className={`codicon ${themes[target] === t.id ? 'codicon-pass-filled' : 'codicon-circle-large-outline'}`} />
            <span className="ap-text"><span className="ap-label">{t.label}</span><span className="ap-desc">{t.description}</span></span>
            {/* this theme's own tokens: surface, accent, working, waiting, failed, git modified */}
            <span className="ap-swatch" data-theme={t.id} aria-hidden>
              <i style={{ background: 'var(--bg)' }} /><i style={{ background: 'var(--accent)' }} /><i style={{ background: 'var(--work)' }} />
              <i style={{ background: 'var(--wait)' }} /><i style={{ background: 'var(--fail)' }} /><i style={{ background: 'var(--git-modified)' }} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
