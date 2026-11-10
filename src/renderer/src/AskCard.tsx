// Claude's multiple-choice question (AskUserQuestion) and a permission request, as one card: the question, its options
// as rows you can click or pick with the number keys, a row for your own answer, then Answer. Enter sends once every
// question has an answer. Typing in the chat instead also ends it (Claude reads that message).
import { useRef, useState } from 'react'
import { buildAnswers, parseQuestions } from '../../shared/askCore'

export function AskCard({ tabId, id, input, open }: { tabId: string; id: string; input: unknown; open: boolean }) {
  const qs = parseQuestions(input)
  const [picks, setPicks] = useState<string[][]>(() => (qs ?? []).map(() => []))
  const [other, setOther] = useState<string[]>(() => (qs ?? []).map(() => ''))
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  if (!qs) return null
  const answers = buildAnswers(qs, picks, other)
  const toggle = (i: number, label: string, multi: boolean) => {
    setPicks((p) => p.map((x, j) => (j !== i ? x : multi ? (x.includes(label) ? x.filter((l) => l !== label) : [...x, label]) : [label])))
    if (!multi) setOther((x) => x.map((v, j) => (j === i ? '' : v)))
  }
  const submit = async () => {
    if (!answers) return
    setSending(true); setErr('')
    const ok = await window.api.chatAnswer(tabId, id, answers).catch(() => false)
    if (!ok) { setErr('That question is no longer open'); setSending(false) }
  }
  // the question the number keys pick for: the first one with no answer yet, else the first
  const target = () => { const i = qs.findIndex((_q, j) => !picks[j].length && !other[j].trim()); return i < 0 ? 0 : i }
  const keys = (e: React.KeyboardEvent) => {
    if (!open) return
    const typing = (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text'
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); if (answers && !sending) void submit(); return }
    if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      const i = target(), o = qs[i].options[Number(e.key) - 1]
      if (o) { e.preventDefault(); e.stopPropagation(); toggle(i, o.label, qs[i].multiSelect) }
    }
  }
  const picked = (i: number, label: string) => picks[i].includes(label) && !(!qs[i].multiSelect && other[i].trim())
  return (
    <div className={`askcard ask2${open ? '' : ' done'}`} data-testid="ask-card" ref={box} tabIndex={open ? 0 : -1} onKeyDown={keys}>
      {qs.map((q, i) => (
        <div key={i} className="askq">
          {q.header && <div className="ask2-head">{q.header}</div>}
          <div className="asktext">{q.question}</div>
          {open && (
            <div className="ask2-opts" role={q.multiSelect ? 'group' : 'radiogroup'}>
              {q.options.map((o, n) => (
                <button key={o.label} type="button" role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={picked(i, o.label)} className={`ask2-opt${picked(i, o.label) ? ' on' : ''}`}
                  onClick={() => toggle(i, o.label, q.multiSelect)} data-testid="ask-option">
                  <span className="ask2-key">{n + 1}</span>
                  <span className="ask2-body"><span className="ask2-label">{o.label}</span>{o.description && <span className="ask2-desc">{o.description.replace(/\.$/, '')}</span>}</span>
                  <i className={`codicon codicon-${picked(i, o.label) ? 'check' : 'blank'}`} aria-hidden />
                </button>
              ))}
              <label className={`ask2-opt ask2-own${other[i].trim() ? ' on' : ''}`}>
                <span className="ask2-key"><i className="codicon codicon-edit" aria-hidden /></span>
                <input type="text" className="ask2-input" placeholder="Something else: type your own answer" value={other[i]} onChange={(e) => { const v = e.target.value; setOther((x) => x.map((s, j) => (j === i ? v : s))) }} data-testid="ask-other" />
              </label>
            </div>
          )}
        </div>
      ))}
      {open
        ? <div className="ask2-foot"><span className="hint">{qs.some((q) => q.multiSelect) ? 'Pick any that apply' : 'Pick one'} with a click or the number keys. Enter sends. Or just reply below.</span>{err && <span className="s-fail">{err}</span>}<button className="primary" disabled={!answers || sending} onClick={() => void submit()} data-testid="ask-submit">{sending ? 'Sending' : 'Answer'}</button></div>
        : <div className="hint">Question closed</div>}
    </div>
  )
}
