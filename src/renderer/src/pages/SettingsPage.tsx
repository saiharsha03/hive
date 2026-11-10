// Settings: a section list on the left, the form on the right, Save and Cancel in a bar at the bottom. The form is
// SettingsPanel; this page gives it the page frame and the links to the Watchers page and the account switcher.
import { PageHead, Keys } from '../kit'
import { SettingsPanel, pickSettingsSection } from '../SettingsPanel'
import { openPage } from '../actions'
import { pickWatcher } from '../WatchersView'
import { pickWatchersTab } from './WatchersPage'
import './workspace.css'

export { pickSettingsSection }

export function SettingsPage({ onAccounts }: { onAccounts: () => void }) {
  const toWatchers = (id?: string) => {
    pickWatchersTab('watchers')
    if (id) pickWatcher(id)
    openPage('watchers')
  }
  return (
    <div className="page set-page" data-testid="page-settings">
      <PageHead title="Settings" desc="Repos, stacks, deploy targets, scripts, watchers, Dependabot, appearance, accounts, phone, Claude Code and notifications" right={<Keys k="Ctrl ," />} />
      <SettingsPanel onWatchers={toWatchers} onAccounts={onAccounts} />
    </div>
  )
}
