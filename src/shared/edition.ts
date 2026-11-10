// Hive's own state lives in its own folder, ~/.hive (threads list, to-dos, notes, watchers, settings). Claude Code's
// files stay where Claude Code keeps them (~/.claude: conversations, login, its settings, the shared usage reading).
// NEXT keeps the conveniences of a run from source while the app is still being reworked: Ctrl+R / F5 and reloading
// on a new build.
export const NEXT = true
export const PRODUCT = 'Hive'
/** the folder in the home folder for this app's state */
export const STATE_FOLDER = '.hive'
export const APP_ID = 'io.github.saiharsha03.hive'
