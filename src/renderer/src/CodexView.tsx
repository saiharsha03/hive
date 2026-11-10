// Codex from the side bar: give it a task, it runs `codex exec` once in the workspace folder on your own Codex login.
// The side view holds the task box; the editor area shows what Codex is doing and its answer.
import { useEffect, useState } from 'react'
import { createStore, useStore } from './store'
import { getPref, setPref } from './prefs'
import { place } from './actions'
import { Btn } from './kit'
import { MdBody } from './MdBody'

type CodexState = { running: boolean; task: string; folder: string; lines: string[]; answer: string; ok: boolean | null }
export const codex = createStore<CodexState>({ running: false, task: '', folder: '', lines: [], answer: '', ok: null })

let listening = false
function listen() {
  if (listening || !window.api.onCodexLine) return
  listening = true
  window.api.onCodexLine((l) => codex.set({ ...codex.get(), lines: [...codex.get().lines, l].slice(-400) }))
}

export async function runCodexTask(task: string, edits: boolean) {
  const t = task.trim()
  if (!t || codex.get().running) return
  listen()
  const folder = place.get().workspace || place.get().folder
  codex.set({ running: true, task: t, folder, lines: [], answer: '', ok: null })
  try {
    const r = await window.api.codexRun(t, folder, edits)
    codex.set({ ...codex.get(), running: false, answer: r.answer, ok: r.ok })
  } catch (e) {
    codex.set({ ...codex.get(), running: false, answer: String((e as Error)?.message ?? e), ok: false })
  }
}

export function CodexSide() {
  const st = useStore(codex, (c) => c)
  const [task, setTask] = useState('')
  const [edits, setEditsState] = useState(() => getPref<boolean>('codex.edits', true))
  const setEdits = (b: boolean) => { setEditsState(b); setPref('codex.edits', b) }
  const where = useStore(place, (p) => p.workspace || p.folder)
  useEffect(listen, [])
  const go = () => { void runCodexTask(task, edits); setTask('') }
  return (
    <div className="side-pad codex-side" data-testid="side-codex">
      <textarea className="cx-task" value={task} placeholder="What should Codex do?" onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); go() } }} data-testid="codex-task" rows={5} />
      <div className="cx-row">
        <label className="cx-check"><input type="checkbox" checked={edits} onChange={(e) => setEdits(e.target.checked)} data-testid="codex-edits" /> Can edit files</label>
        <span className="cx-gap" />
        {st.running
          ? <Btn kind="plain" onClick={() => void window.api.codexStop()} testid="codex-stop">Stop</Btn>
          : <Btn kind="primary" onClick={go} disabled={!task.trim()} testid="codex-run">Run</Btn>}
      </div>
      <div className="cx-note">{where ? `Runs in ${where}` : 'No workspace folder set: it runs in your home folder.'}</div>
      {st.task && <div className="cx-last"><span className={st.running ? 'cx-work' : st.ok ? 'cx-ok' : 'cx-fail'}>{st.running ? 'Working' : st.ok ? 'Done' : 'Failed'}</span> {st.task}</div>}
    </div>
  )
}

/** the editor area while the Codex view is on show and a task has been given; null = nothing to show yet */
export function CodexOutput() {
  const st = useStore(codex, (c) => c)
  if (!st.task) return null
  return (
    <div className="cx-out" data-testid="codex-output">
      <div className="cx-head"><span className={st.running ? 'cx-work' : st.ok ? 'cx-ok' : 'cx-fail'}>{st.running ? 'Codex is working' : st.ok ? 'Codex finished' : 'Codex failed'}</span></div>
      <div className="cx-asked">{st.task}</div>
      {st.lines.length > 0 && <pre className="cx-lines">{st.lines.join('\n')}</pre>}
      {st.answer && <div className="cx-answer"><MdBody text={st.answer} /></div>}
    </div>
  )
}
