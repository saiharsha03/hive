// The landed check after a push: what ECS and S3 + CloudFront have to show before a deploy counts as serving.
import { describe, expect, it } from 'vitest'
import { HOLD_POLLS, TIMEOUT_MS, decide, imageSha, sameSha, stepApi, stepWeb, type ApiService, type Hold } from '../../src/shared/deployCore'

const SHA = 'abc1234def5678'
const svc = (over: Partial<ApiService> = {}): ApiService => ({ name: 'api', image: `123.dkr.ecr.us-east-1.amazonaws.com/app:${SHA}`, rollout: 'COMPLETED', deployments: 1, desired: 2, running: 2, tasks: 't1,t2', ...over })
const none: Hold = { ok: 0, tasks: '' }

describe('imageSha', () => {
  it('is the tag, and nothing for an image without a commit tag', () => {
    expect(imageSha('repo:abc1234')).toBe('abc1234')
    expect(imageSha('registry.example.com:5000/team/repo:abc1234')).toBe('abc1234')
    expect(imageSha('registry.example.com:5000/team/repo')).toBe('') // a port is not a tag
    expect(imageSha('repo@sha256:0123456789abcdef')).toBe('') // a digest is not a commit
    expect(imageSha('repo:abc1234@sha256:0123456789abcdef')).toBe('')
    expect(imageSha('repo')).toBe('')
  })
  it('shas match on a prefix of at least 7', () => {
    expect(sameSha('abc1234', SHA)).toBe(true)
    expect(sameSha(SHA, 'abc1234')).toBe(true)
    expect(sameSha('abc12', SHA)).toBe(false)
    expect(sameSha('', SHA)).toBe(false)
    expect(sameSha(undefined, SHA)).toBe(false)
  })
})

describe('stepApi', () => {
  it('lands only after the healthy state held for HOLD_POLLS polls', () => {
    let hold = none
    for (let i = 1; i < HOLD_POLLS; i++) {
      const r = stepApi(SHA, { services: [svc()] }, hold)
      expect(r.verdict).toEqual({ state: 'waiting', note: `healthy ${i}/${HOLD_POLLS} (2/2 tasks)` })
      hold = r.hold
    }
    expect(stepApi(SHA, { services: [svc()] }, hold).verdict).toEqual({ state: 'landed', note: 'landed on abc1234' })
  })

  it('a changed task set starts the hold again', () => {
    const one = stepApi(SHA, { services: [svc()] }, none).hold
    const two = stepApi(SHA, { services: [svc()] }, one).hold
    expect(two.ok).toBe(2)
    expect(stepApi(SHA, { services: [svc({ tasks: 't1,t3' })] }, two).hold).toEqual({ ok: 1, tasks: 't1,t3' })
  })

  it('waits while the old image, a second deployment or missing tasks are there', () => {
    expect(stepApi(SHA, { services: [svc({ image: 'app:0000000aaaa' })] }, { ok: 3, tasks: 't1,t2' })).toEqual({ verdict: { state: 'waiting', note: 'rolling out (2/2 tasks)' }, hold: none })
    expect(stepApi(SHA, { services: [svc({ deployments: 2 })] }, none).verdict.note).toBe('settling (2/2 tasks)')
    expect(stepApi(SHA, { services: [svc({ running: 1 })] }, none).verdict.note).toBe('settling (1/2 tasks)')
    expect(stepApi(SHA, { services: [svc({ desired: 0, running: 0 })] }, none).verdict.state).toBe('waiting')
    expect(stepApi(SHA, { services: [svc(), svc({ name: 'worker', rollout: 'IN_PROGRESS' })] }, none).verdict.state).toBe('waiting')
  })

  it('no data yet waits; a failed rollout fails', () => {
    expect(stepApi(SHA, { services: [] }, none).verdict).toEqual({ state: 'waiting', note: 'no service data yet' })
    expect(stepApi(SHA, { services: [svc(), svc({ name: 'worker', rollout: 'FAILED' })] }, none).verdict).toEqual({ state: 'failed', note: 'ECS rollout FAILED for worker' })
  })

  it('an image with no commit tag fails at once instead of waiting out the timeout', () => {
    const r = stepApi(SHA, { services: [svc({ image: 'app@sha256:0123456789abcdef' })] }, none)
    expect(r.verdict.state).toBe('failed')
    expect(r.verdict.note).toContain('no commit tag')
  })
})

describe('stepWeb', () => {
  it('lands when S3, the live site and the invalidation all agree', () => {
    expect(stepWeb(SHA, { s3: SHA, live: 'abc1234', invalidation: '2026-11-09T10:00:00Z\tCompleted' })).toEqual({ state: 'landed', note: 'landed on abc1234' })
  })
  it('says what is still behind', () => {
    expect(stepWeb(SHA, { s3: SHA, live: SHA, invalidation: 't\tInProgress' }).note).toBe('rolling out (s3 abc1234, live abc1234, invalidation pending)')
    expect(stepWeb(SHA, { s3: SHA, live: '0000000aaaa' }).note).toBe('rolling out (s3 abc1234, live 0000000)')
    expect(stepWeb(SHA, {})).toEqual({ state: 'waiting', note: 'rolling out (s3 ?, live ?)' })
  })
})

describe('decide', () => {
  it('landed and failed end the watch; waiting ends it only at the timeout', () => {
    expect(decide({ state: 'landed', note: 'landed on abc1234' }, 5_000)).toEqual({ done: true, ok: true, note: 'landed on abc1234' })
    expect(decide({ state: 'failed', note: 'ECS rollout FAILED for api' }, 5_000)).toEqual({ done: true, ok: false, note: 'stuck: ECS rollout FAILED for api' })
    expect(decide({ state: 'waiting', note: 'settling' }, TIMEOUT_MS - 1)).toEqual({ done: false, ok: false, note: 'settling' })
    expect(decide({ state: 'waiting', note: 'settling' }, TIMEOUT_MS)).toEqual({ done: true, ok: false, note: 'stuck: not serving after 20 min (settling)' })
    expect(decide({ state: 'waiting', note: 'x' }, 61_000, 60_000).done).toBe(true)
  })
})
