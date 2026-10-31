import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './assets/codicon.css'
import './themes.css'
import './styles.css'
import './appearance'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
