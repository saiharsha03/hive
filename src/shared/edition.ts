// This app is being rebuilt beside the Hive that runs today, so for now it is its own app: its own name, its own state
// folder (dataDir) and its own taskbar identity, and nothing of Hive's is touched. When it takes over, NEXT becomes
// false and it is Hive.
export const NEXT = true
export const PRODUCT = NEXT ? 'Hive Next' : 'Hive'
/** the folder under ~/.claude for this app's own state while it runs beside Hive ('' = ~/.claude itself) */
export const STATE_FOLDER = NEXT ? 'hive-next' : ''
export const APP_ID = NEXT ? 'io.github.saiharsha03.hive.next' : 'io.github.saiharsha03.hive'
