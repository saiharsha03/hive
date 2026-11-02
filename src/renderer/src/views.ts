// The app's views (what a region can show) and where each UI puts them. A UI is only an arrangement: every view
// is reachable in every UI, through its region, a popover, a modal or Ctrl+K.
import type { UIId } from './appearance'

export type ViewId = 'threads' | 'git' | 'files' | 'agents' | 'terminal' | 'watchers' | 'deploy' | 'scripts' | 'todos' | 'notes' | 'editor' | 'dev' | 'pull'

export const VIEW: Record<ViewId, { label: string; icon: string; mk: string }> = {
  threads: { label: 'Threads', icon: 'comment-discussion', mk: 'mk-threads' },
  git: { label: 'Git', icon: 'source-control', mk: 'mk-git' },
  files: { label: 'Files', icon: 'files', mk: 'mk-files' },
  editor: { label: 'Open file', icon: 'code', mk: 'mk-files' },
  agents: { label: 'Agents', icon: 'type-hierarchy', mk: 'mk-agents' },
  terminal: { label: 'Terminal', icon: 'terminal', mk: 'mk-terminal' },
  watchers: { label: 'Watchers', icon: 'eye', mk: 'mk-watch' },
  deploy: { label: 'Deploy', icon: 'rocket', mk: 'mk-deploy' },
  scripts: { label: 'Scripts', icon: 'play', mk: 'mk-scripts' },
  todos: { label: 'To-dos', icon: 'checklist', mk: 'mk-todos' },
  notes: { label: 'Notes', icon: 'note', mk: 'mk-todos' },
  dev: { label: 'Dev stack', icon: 'server-process', mk: 'mk-dev' },
  pull: { label: 'Pull latest', icon: 'repo-pull', mk: 'mk-pull' },
}

export type Region = 'left' | 'right' | 'bottom'
export type Arrangement = {
  left: ViewId[] // Default: the threads pane; Workbench: the activity bar's views (one shown at a time)
  right: ViewId[] // tabs in the right side view; Thread strip: the dock (one at a time, toggled)
  bottom: ViewId[] // bottom panel tabs
  chat: 'grid' | 'columns' | 'single'
  tabs: 'full' | 'title' | 'none'
  // regions that start closed (opened on demand)
  closed: Region[]
}

const BOTTOM: ViewId[] = ['agents', 'terminal', 'watchers', 'deploy', 'scripts', 'todos', 'notes']

export const ARRANGE: Record<UIId, Arrangement> = {
  default: { left: ['threads'], right: ['files', 'editor', 'git', 'agents'], bottom: BOTTOM, chat: 'grid', tabs: 'full', closed: [] },
  workbench: {
    left: ['threads', 'files', 'git', 'dev', 'scripts', 'todos', 'notes', 'watchers', 'agents'], right: ['editor', 'git'], bottom: BOTTOM,
    chat: 'grid', tabs: 'full', closed: [],
  },
  strip: {
    left: [], right: ['agents', 'watchers', 'git', 'dev', 'scripts', 'todos', 'notes', 'editor', 'files', 'deploy'],
    bottom: ['terminal', 'agents', 'watchers', 'deploy', 'scripts', 'todos', 'notes'], chat: 'columns', tabs: 'title', closed: ['right'],
  },
  focus: {
    left: [], right: ['files', 'editor', 'git', 'agents', 'watchers', 'scripts', 'todos', 'notes', 'dev'], bottom: BOTTOM,
    chat: 'single', tabs: 'none', closed: ['right', 'bottom'],
  },
}

// where a view opens in a UI: its region, else a popover (Pull latest, Dev stack outside Workbench)
export function placeOf(ui: UIId, v: ViewId): Region | 'popover' {
  const a = ARRANGE[ui]
  if (v === 'threads') return a.left.includes('threads') ? 'left' : 'popover'
  if (a.left.includes(v) && ui === 'workbench') return 'left'
  if (a.right.includes(v)) return 'right'
  if (a.bottom.includes(v)) return 'bottom'
  return 'popover'
}
