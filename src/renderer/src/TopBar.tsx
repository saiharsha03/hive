import { useState } from 'react'
import { HooksMenu } from './HooksMenu'
import { PluginsMenu } from './PluginsMenu'

export type Panel = 'sessions' | 'files' | null
type Menu = 'hooks' | 'plugins' | null
type Props = { onNew: () => void; panel: Panel; onPanel: (p: Panel) => void; folder: string }

export function TopBar({ onNew, panel, onPanel, folder }: Props) {
  const [menu, setMenu] = useState<Menu>(null)
  // clicking the open panel's / menu's button closes it
  const toggle = (p: Panel) => onPanel(panel === p ? null : p)
  const toggleMenu = (m: Menu) => setMenu(menu === m ? null : m)
  return (
    <header className="top">
      <div className="brand">Hive</div>
      <button className="new" onClick={onNew}>New</button>
      <nav className="menu">
        <button className={panel === 'sessions' ? 'on' : ''} onClick={() => toggle('sessions')}>Sessions</button>
        <button className={panel === 'files' ? 'on' : ''} onClick={() => toggle('files')}>Files</button>
        <div className="anchor">
          <button className={menu === 'hooks' ? 'on' : ''} onClick={() => toggleMenu('hooks')}>Hooks</button>
          {menu === 'hooks' && <HooksMenu folder={folder} onClose={() => setMenu(null)} />}
        </div>
        <button>Connectors</button>
        <div className="anchor">
          <button className={menu === 'plugins' ? 'on' : ''} onClick={() => toggleMenu('plugins')}>Plugins</button>
          {menu === 'plugins' && <PluginsMenu onClose={() => setMenu(null)} />}
        </div>
      </nav>
    </header>
  )
}
