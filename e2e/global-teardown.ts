// After the run: delete what it left on this computer (see cleanup.ts): the run folder in the OS temp folder and the
// Claude Code transcripts of the run's threads. HIVE_E2E_KEEP=1 keeps both, to look at a failure; Playwright's own
// report and traces (e2e-report/, e2e-results/) are not touched either way.
import { cleanRun } from './cleanup'

export default async function globalTeardown(): Promise<void> {
  const run = process.env.HIVE_E2E_RUN
  if (!run) return
  if (process.env.HIVE_E2E_KEEP === '1') { console.log(`Hive e2e: kept ${run} and its transcripts (HIVE_E2E_KEEP=1)`); return }
  const { removed, kept } = cleanRun(run)
  console.log(`Hive e2e: removed ${removed.length} folder${removed.length === 1 ? '' : 's'} of this run`)
  for (const k of kept) console.warn(`Hive e2e: could not remove ${k}`)
}
