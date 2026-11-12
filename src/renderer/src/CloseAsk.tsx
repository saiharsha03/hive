// Closing a thread that is still working: keep it running in the background (the default, Enter), close it (stops
// it), or Cancel (Esc). Queued asks (Close all) show one at a time.
import { answerCloseAsk, closeAsks } from './actions'
import { getSessions, useStore } from './store'
import { Modal } from './ui'

export function CloseAsk() {
  const id = useStore(closeAsks, (q) => q[0] ?? null)
  if (!id) return null
  const title = getSessions().find((s) => s.id === id)?.title || 'This thread'
  return (
    <Modal title="This thread is still working" onClose={() => answerCloseAsk(id, 'cancel')} testid="close-ask">
      <div className="confirm">
        <div className="confirm-body"><b>{title}</b> is still running. Keep it working in the background, or close it and stop it?</div>
        <div className="drow confirm-acts">
          <span className="dspace" />
          <button className="dbtn" onClick={() => answerCloseAsk(id, 'cancel')} data-testid="close-ask-cancel">Cancel</button>
          <button className="dbtn danger" onClick={() => answerCloseAsk(id, 'close')} data-testid="close-ask-stop">Close and stop</button>
          <button className="dbtn primary" autoFocus onClick={() => answerCloseAsk(id, 'background')} data-testid="close-ask-bg">Keep in background</button>
        </div>
      </div>
    </Modal>
  )
}
