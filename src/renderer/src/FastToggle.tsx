// Fast mode for one thread, beside the model and effort in the message box, and the message box's Alt keys:
// Alt+O turns fast mode on or off (as /fast does), Alt+T opens Claude's thinking rows by default (ChatRows.tsx).
// The keys act only while this thread's message box has the focus.
// On a subscription fast mode is billed only from usage credits: while the usage reading says they are off (or used
// up) the control cannot be turned on, and a thread that has it on is turned off.
import { useEffect, useRef, useState } from 'react'
import { creditsWords, fastLabel, fastSupported } from '../../shared/contextCore'
import { useThreadStatus } from './statusStore'
import { toggleThinkingOpen } from './ChatRows'

type Model = { value: string; supportsFastMode?: boolean }
type Credits = NonNullable<Status['credits']>
let modelList: Promise<Model[]> | null = null // one list for every thread: which models take fast mode
let creditsRead: { at: number; p: Promise<Credits | null> } | null = null // one reading a minute for every thread
const readCredits = (): Promise<Credits | null> => {
  if (!creditsRead || Date.now() - creditsRead.at > 60_000) {
    creditsRead = { at: Date.now(), p: window.api.getStatus().then((s) => s?.credits ?? null).catch(() => null) }
  }
  return creditsRead.p
}

export function FastToggle({ tabId }: { tabId: string }) {
  const st = useThreadStatus(tabId)
  const ref = useRef<HTMLButtonElement>(null)
  const [models, setModels] = useState<Model[] | null>(null)
  const [credits, setCredits] = useState<Credits | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    modelList ??= window.api.chatModels(tabId).catch(() => { modelList = null; return [] })
    void modelList.then(setModels)
  }, [tabId])
  useEffect(() => {
    let alive = true
    const load = () => void readCredits().then((c) => { if (alive) setCredits(c) })
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const on = !!st.fast
  // no credits: the usage reading says so, or the engine refused fast for that reason at the end of a turn
  const noCredits = credits?.on === false || st.fastReason === 'extra_usage_disabled'
  useEffect(() => {
    if (on && noCredits) window.api.chatSetFast(tabId, false).catch((x) => setErr(String(x?.message ?? x)))
  }, [on, noCredits, tabId])
  const flip = () => {
    setErr('')
    window.api.chatSetFast(tabId, !on).catch((x) => setErr(String(x?.message ?? x)))
  }
  const flipRef = useRef(flip)
  flipRef.current = flip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
      if (e.code !== 'KeyO' && e.code !== 'KeyT') return
      const box = document.activeElement
      if (!(box instanceof HTMLTextAreaElement) || !ref.current?.closest('.composer')?.contains(box)) return
      e.preventDefault()
      if (e.code === 'KeyO') flipRef.current()
      else toggleThinkingOpen() // the thinking rows open or close at once: that is the answer
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // a model that does not take fast mode gets no control, unless fast is on (so it can be turned off)
  const hidden = !on && fastSupported(models, st.model) === false
  const why = err || st.fastError
  const money = creditsWords(credits)
  // with no credits only turning it off is left (the effect above does that by itself)
  const blocked = noCredits && !on
  const title = why || (blocked
    ? creditsWords(credits ?? { on: false, used: null, limit: null, currency: null })
    : `Fast mode: faster output at a higher price, billed from usage credits, from the next turn. Click or Alt+O to turn it ${on ? 'off' : 'on'}${money ? `. ${money}` : ''}`)
  return (
    <button ref={ref} className={on ? 'pick pick-on' : 'pick'} hidden={hidden} disabled={blocked} onClick={flip} data-testid="fast-toggle" title={title}>
      {blocked ? 'fast: no usage credits' : fastLabel(on, st.fastState, st.fastReason)}{why ? ', switch failed' : ''}
    </button>
  )
}
