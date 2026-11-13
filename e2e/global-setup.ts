// One temp run folder per `npm run e2e`: state files, the throwaway repo, screenshots (unless HIVE_E2E_SHOTS is set).
// global-teardown.ts deletes it again, with the run's Claude transcripts; set HIVE_E2E_SHOTS to a folder of your own
// to keep the screenshots.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default async function globalSetup(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  process.env.HIVE_E2E_RUN ||= join(tmpdir(), 'hive-e2e', stamp)
  process.env.HIVE_E2E_TAG ||= `e2e${Date.now().toString(36)}`
  mkdirSync(process.env.HIVE_E2E_RUN, { recursive: true })
  const { makeWorkspace, seedSettings, DATA, RUN, SHOTS } = await import('./harness')
  makeWorkspace()
  seedSettings(DATA)
  console.log(`Orbit e2e run folder: ${RUN}\nScreenshots: ${SHOTS}\nThe session specs send real Claude turns on your login (Haiku, low effort).`)
}
