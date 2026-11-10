// The diff tab: the change picked last (an edit row in a conversation, a changed file in Changes or Git), split or
// unified, in a pane so it can sit beside the thread.
import { diffSpec, notice, showInspector } from '../actions'
import { useStore } from '../store'
import { DiffPanel } from '../DiffPanel'

export function DiffPage() {
  const spec = useStore(diffSpec, (d) => d)
  if (!spec) return <div className="page" data-testid="page-diff"><div className="empty-line">Pick a change: an edit row in a conversation, or a file in Changes.</div></div>
  return (
    <div className="diffpage" data-testid="page-diff">
      <DiffPanel spec={spec} onClose={() => diffSpec.set(null)} onOpenInGit={(f) => { showInspector('changes'); notice(`${f}: its repository is in the inspector's Changes tab`) }} />
    </div>
  )
}
