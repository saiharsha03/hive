// Hive's own state lives in its own folder, ~/.hive (threads list, to-dos, notes, watchers, settings). Claude Code's
// files stay where Claude Code keeps them (~/.claude: conversations, login, its settings, the shared usage reading).
// NEXT keeps the conveniences of a run from source while the app is still being reworked: Ctrl+R / F5 and reloading
// on a new build.
export const NEXT = true
// The hive-next branch is its own app beside Hive: its own name, state folder, Electron storage and instance lock,
// so both can run at once and neither touches the other's threads list, watchers, wake-ups or settings.
export const PRODUCT = 'Hive Next'
/** the folder in the home folder for this app's state */
export const STATE_FOLDER = '.hive-next'
export const APP_ID = 'io.github.saiharsha03.hive.next'
// While it is tried out beside Hive, this app wakes nothing by itself: no scheduled wake-up and no automatic continue
// after a usage limit. Hive stays the one app that does. Set to false when this becomes the app in daily use.
export const WAKEUPS_OFF: boolean = true
