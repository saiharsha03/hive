// Orbit's own state lives in its own folder, ~/.orbit (threads list, to-dos, notes, watchers, settings). Claude Code's
// files stay where Claude Code keeps them (~/.claude: conversations, login, its settings, the shared usage reading).
// NEXT keeps the conveniences of a run from source while the app is still being reworked: Ctrl+R / F5 and reloading
// on a new build.
export const NEXT = true
// Orbit is the app that was called Hive: its own name, state folder, Electron storage and instance lock. On the first
// start, Hive's state is copied over (carryOverCore.ts).
export const PRODUCT = 'Orbit'
/** the folder in the home folder for this app's state */
export const STATE_FOLDER = '.orbit'
export const APP_ID = 'io.github.saiharsha03.orbit'
// While it is tried out beside Hive, this app wakes nothing by itself: no scheduled wake-up and no automatic continue
// after a usage limit. Hive stays the one app that does. Set to false when this becomes the app in daily use.
export const WAKEUPS_OFF: boolean = true
