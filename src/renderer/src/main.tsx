import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './assets/codicon.css'
import './themes.css'
import './styles.css'
import './shell.css'
import './conversation.css'
import './appearance'
import { Shell } from './Shell'
import { startEngine } from './engine'
import { TeamWindow, pickTeam } from './TeamView'
import { teamWindowOf } from '../../shared/teamSidebarCore'

// ?view=team: the pop-out Team window, the Team view alone; otherwise the whole app
const teamWin = teamWindowOf(location.search)
if (teamWin?.team) pickTeam(teamWin.team)
if (!teamWin) startEngine()
createRoot(document.getElementById('root')!).render(teamWin ? <TeamWindow /> : <Shell />)
