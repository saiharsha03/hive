// The plan Claude made in plan mode (ExitPlanMode), as Claude Code shows it: the plan, then "Would you like to proceed?"
// with approve and start in accept edits, approve and review each edit, or keep planning with what to change typed in
// the box. Number keys pick, Enter sends. Typing in the chat instead also ends it (Claude reads that message).
import { useState } from 'react'
import { MdBody } from './MdBody'
import { PLAN_KEEP, PLAN_QUESTION, planOutcome, planQuestions, planText } from '../../shared/planCore'

const OUTCOME = { approved: 'Plan approved', kept: 'Kept planning', closed: 'Closed without an answer from this card: replied to in the chat, or the turn stopped' }

export function PlanCard({ tabId, id, input, open, status, repo }: { tabId: string; id: string; input: unknown; open: boolean; status: string; repo?: string }) {
  const q = planQuestions()[0]
  const [pick, setPick] = useState('')
  const [feedback, setFeedback] = useState('')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  // keep planning sends what was typed (Claude revises the plan with it); an approve option sends its label
  const answer = pick === PLAN_KEEP ? feedback.trim() || PLAN_KEEP : pick
  const submit = async () => {
    if (!answer || sending) return
    setSending(true); setErr('')
    const ok = await window.api.chatAnswer(tabId, id, { [PLAN_QUESTION]: answer }).catch(() => false)
    if (!ok) { setErr('That plan is no longer open'); setSending(false) }
  }
  const keys = (e: React.KeyboardEvent) => {
    if (!open) return
    const typing = (e.target as HTMLElement).tagName === 'INPUT'
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); void submit(); return }
    if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-3]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); setPick(q.options[Number(e.key) - 1].label) }
  }
  const outcome = planOutcome(status, open)
  return (
    <div className={`askcard ask2${open ? '' : ' done'}`} data-testid="plan-card" tabIndex={open ? 0 : -1} onKeyDown={keys}>
      <div className="ask2-head">Plan</div>
      <div className="plan-body"><MdBody text={planText(input) || '(no plan text)'} repo={repo} /></div>
      {open ? (
        <>
          <div className="asktext">{PLAN_QUESTION}</div>
          <div className="ask2-opts" role="radiogroup">
            {q.options.map((o, n) => (
              <button key={o.label} type="button" role="radio" aria-checked={pick === o.label} className={`ask2-opt${pick === o.label ? ' on' : ''}`} onClick={() => setPick(o.label)} data-testid="plan-option">
                <span className="ask2-key">{n + 1}</span>
                <span className="ask2-body"><span className="ask2-label">{o.label}</span><span className="ask2-desc">{o.description}</span></span>
                <i className={`codicon codicon-${pick === o.label ? 'check' : 'blank'}`} aria-hidden />
              </button>
            ))}
            {pick === PLAN_KEEP && (
              <label className="ask2-opt ask2-own on">
                <span className="ask2-key"><i className="codicon codicon-edit" aria-hidden /></span>
                <input type="text" className="ask2-input" autoFocus placeholder="Tell Claude what to change" value={feedback} onChange={(e) => setFeedback(e.target.value)} data-testid="plan-feedback" />
              </label>
            )}
          </div>
          <div className="ask2-foot"><span className="hint">Pick with a click or the number keys. Enter sends. Or just reply below.</span>{err && <span className="s-fail">{err}</span>}<button className="primary" disabled={!answer || sending} onClick={() => void submit()} data-testid="plan-submit">{sending ? 'Sending' : 'Send'}</button></div>
        </>
      ) : <div className="hint" data-testid="plan-outcome">{OUTCOME[outcome as keyof typeof OUTCOME]}</div>}
    </div>
  )
}
