// A file dropped on the window (outside a message box): start a background thread on it with one of the skills, or cancel.
import { useEffect } from 'react'
import { fileName, type DropChoice } from '../../shared/dropCore'

export function DropPrompt({ path, choices, onPick, onCancel }: { path: string; choices: DropChoice[]; onPick: (c: DropChoice) => void; onCancel: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onCancel])
  return (
    <div className="dropask" role="dialog" aria-label="Start work on the dropped file">
      <div className="dq-head">Start work on <span title={path}>{fileName(path)}</span></div>
      <div className="dq-note">A new background thread in the workspace root, in auto mode.</div>
      {choices.map((c) => <button data-testid="drop-button-1" key={c.id} onClick={() => onPick(c)}>{c.label}</button>)}
      <button data-testid="drop-button-2" className="dq-cancel" onClick={onCancel}>Cancel</button>
    </div>
  )
}
