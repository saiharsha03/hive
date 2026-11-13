// Fast mode for one thread, beside the model and effort in the message box, and the message box's Alt keys:
// Alt+O turns fast mode on or off (as /fast does), Alt+T opens Claude's thinking rows by default (ChatRows.tsx).
// The keys act only while this thread's message box has the focus.
import { useEffect, useRef, useState } from 'react'
import { fastLabel, fastSupported } from '../../shared/contextCore'
import { useThreadStatus } from './statusStore'
import { toggleThinkingOpen } from './ChatRows'

type Model = { value: string; supportsFastMode?: boolean }
let modelList: Promise<Model[]> | null = null // one list for every thread: which models take fast mode

export function FastToggle({ tabId }: { tabId: string }) {
  const st = useThreadStatus(tabId)
  const ref = useRef<HTMLButtonElement>(null)
  const [models, setModels] = useState<Model[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    modelList ??= window.api.chatModels(tabId).catch(() => { modelList = null; return [] })
    void modelList.then(setModels)
  }, [tabId])
  const on = !!st.fast
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
  return (
    <button ref={ref} className={on ? 'pick pick-on' : 'pick'} hidden={hidden} onClick={flip} data-testid="fast-toggle"
      title={why || `Fast mode: faster output at a higher price, from the next turn. Click or Alt+O to turn it ${on ? 'off' : 'on'}`}>
      {fastLabel(on, st.fastState, st.fastReason)}{why ? ', switch failed' : ''}
    </button>
  )
}
