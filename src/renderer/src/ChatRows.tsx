// Quiet rows in the conversation: the compaction summary a continued session starts from (one collapsed line),
// and hook messages such as security warnings on an edit.
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { summaryBody } from '../../shared/summaryCore'
import { thinkingPreview } from '../../shared/contextCore'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'

// Claude's thinking opens by default when this is on (Alt+T in the message box); a row clicked keeps its own choice
export const thinkingOpen = createStore<boolean>(getPref('thinking.open', false))
export function toggleThinkingOpen(): boolean {
  const on = !thinkingOpen.get()
  thinkingOpen.set(on)
  setPref('thinking.open', on)
  return on
}

// Claude's thinking: one dim line, the text when opened
export function ThinkingRow({ text }: { text: string }) {
  const dflt = useStore(thinkingOpen, (v) => v)
  const [own, setOwn] = useState<boolean | null>(null)
  const open = own ?? dflt
  return (
    <div className="sumrow" data-testid="thinking-row">
      <button className="link" onClick={() => setOwn(!open)} aria-expanded={open} title="Claude's thinking. Alt+T in the message box opens every thinking row by default" data-testid="thinking-toggle">
        {open ? '▾' : '▸'} Thinking{open ? '' : `: ${thinkingPreview(text)}`}
      </button>
      {open && <div className="body md sum-body"><Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown></div>}
    </div>
  )
}

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
