// Deploy against the real repos: diffs.sh only fetches (and copies its message to the clipboard, as by hand); the run
// step is a stub in test mode, so deploy.sh never spawns. Opt-in, because diffs.sh touches the real repos and the real
// clipboard: it runs only when HIVE_E2E_DEPLOY_ENV names a .env with the repos root and the HIVE_DEPLOY_* keys.
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { close, deployEnvFile, launch, RUN, shot } from './harness'
import { Hive } from './hive'

test('deploy shows diffs.sh output and the run step is a stub', async () => {
  const envFile = deployEnvFile()
  test.skip(!envFile, 'opt-in: set HIVE_E2E_DEPLOY_ENV to a .env with the repos root and the HIVE_DEPLOY_* keys')
  const l = await launch({ envFile: envFile!, data: join(RUN, 'data-deploy') })
  const h = new Hive(l.page)
  try {
    await h.open('deploy')
    await h.id('deploy-suite').first().click()
    // the local view first, then diffs.sh's own output once it is back
    await expect(h.id('deploy-panel').getByText('diffs.sh output')).toBeVisible({ timeout: 200_000 })
    await expect(h.id('deploy-diffs')).toContainText('copied to clipboard')
    await shot(l.page, 'deploy-diffs')

    // the run step, straight through the same IPC the wizard's Yes uses
    const res = await l.page.evaluate(async () => {
      const api = (window as any).api
      const { config } = await api.deployConfig()
      const repo = [...config.suites[0].api, ...config.suites[0].web][0]
      return new Promise<{ out: string; code: number; msg: string }>((resolve) => {
        let out = ''
        api.onDeployOut((_id: string, t: string) => { out += t })
        api.onDeployEnd((_id: string, code: number, msg: string) => resolve({ out, code, msg }))
        api.deployRun(repo, 'staging')
      })
    })
    expect(res.out).toContain('test mode')
    expect(res.code).not.toBe(0)

    // and through the wizard, when it has something to deploy
    await h.id('deploy-next').click()
    const yes = h.id('deploy-yes')
    if (await yes.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await yes.click()
      await expect(h.id('deploy-output')).toContainText('test mode')
      await shot(l.page, 'deploy-stub')
    } else {
      await shot(l.page, 'deploy-nothing-to-deploy')
    }
  } finally {
    await close(l)
  }
})
