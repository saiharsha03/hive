// Quiet rows in the conversation: the compaction summary a continued session starts from (one collapsed line),
// and hook messages such as security warnings on an edit.
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { summaryBody } from '../../shared/summaryCore'

export function SummaryRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sumrow">
      <button data-testid="chatrow-button-1" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '▾' : '▸'} Continued from an earlier conversation, summary
      </button>
      {open && <div className="body md sum-body"><Markdown remarkPlugins={[remarkGfm]}>{summaryBody(text)}</Markdown></div>}
    </div>
  )
}

export function WarningRow({ event, text }: { event: string; text: string }) {
  const [open, setOpen] = useState(false)
  const first = text.split('\n').find((l) => l.trim() && !/^\[from [^\]]+\]$/.test(l.trim())) ?? text
  const long = text.length > first.length + 1
  return (
    <div className="warnrow" title={`${event} hook`}>
      <span className="wr-tag">{event} hook</span>
      {open ? <div className="wr-text full">{text}</div> : <span className="wr-text">{first}</span>}
      {long && <button data-testid="chatrow-button-2" className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Less' : 'More'}</button>}
    </div>
  )
}
