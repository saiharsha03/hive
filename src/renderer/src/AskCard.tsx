// Claude's multiple-choice question (AskUserQuestion), as in the terminal: pick an option (or several), or type your
// own under Other, then Submit. Typing in the chat instead also ends it (Claude reads that message).
import { useState } from 'react'
import { buildAnswers, parseQuestions } from '../../shared/askCore'

export function AskCard({ tabId, id, input, open }: { tabId: string; id: string; input: unknown; open: boolean }) {
  const qs = parseQuestions(input)
  const [picks, setPicks] = useState<string[][]>(() => (qs ?? []).map(() => []))
  const [other, setOther] = useState<string[]>(() => (qs ?? []).map(() => ''))
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  if (!qs) return null
  const answers = buildAnswers(qs, picks, other)
  const toggle = (i: number, label: string, multi: boolean) => setPicks((p) => p.map((x, j) => (j !== i ? x : multi ? (x.includes(label) ? x.filter((l) => l !== label) : [...x, label]) : [label])))
  const submit = async () => {
    if (!answers) return
    setSending(true); setErr('')
    const ok = await window.api.chatAnswer(tabId, id, answers).catch(() => false)
    if (!ok) { setErr('That question is no longer open'); setSending(false) }
  }
  return (
    <div className={`askcard${open ? '' : ' done'}`} data-testid="ask-card">
      {qs.map((q, i) => (
        <div key={i} className="askq">
          <div className="asktext">{q.question}</div>
          {open && q.options.map((o) => (
            <label key={o.label} className="askopt">
              <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${id}-${i}`} checked={picks[i].includes(o.label) && !(!q.multiSelect && other[i].trim())} onChange={() => { toggle(i, o.label, q.multiSelect); if (!q.multiSelect) setOther((x) => x.map((v, j) => (j === i ? '' : v))) }} />
              <span>{o.label}{o.description && <span className="askdesc">{o.description.replace(/\.$/, '')}</span>}</span>
            </label>
          ))}
          {open && <input className="askother" placeholder="Or type your own answer" value={other[i]} onChange={(e) => { const v = e.target.value; setOther((x) => x.map((s, j) => (j === i ? v : s))) }} data-testid="ask-other" />}
        </div>
      ))}
      {open
        ? <div className="askfoot"><button className="primary" disabled={!answers || sending} onClick={submit} data-testid="ask-submit">Answer</button><span className="hint">{qs.length === 1 && qs[0].options.length ? `${qs[0].multiSelect ? 'Pick any' : 'Pick one'}, or just reply below` : 'Or just reply below'}</span>{err && <span className="s-fail">{err}</span>}</div>
        : <div className="hint">Question closed</div>}
    </div>
  )
}
