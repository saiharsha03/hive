import { describe, expect, it } from 'vitest'
import { nextMode, PLAN_AUTO_EDITS, PLAN_KEEP, PLAN_MANUAL, PLAN_QUESTION, planDecision, planOutcome, planQuestions, planText } from '../../src/shared/planCore'
import { cleanAnswers, parseQuestions } from '../../src/shared/askCore'

describe('planDecision', () => {
  it('approves into the mode each option names', () => {
    expect(planDecision(PLAN_AUTO_EDITS)).toEqual({ behavior: 'allow', mode: 'acceptEdits' })
    expect(planDecision(PLAN_MANUAL)).toEqual({ behavior: 'allow', mode: 'default' })
  })
  it('keeps planning with what was typed as the feedback', () => {
    const d = planDecision('  use sqlite, not postgres ')
    expect(d.behavior).toBe('deny')
    expect(d.behavior === 'deny' && d.message).toContain('use sqlite, not postgres')
  })
  it('keeps planning with no feedback when only the option was picked', () => {
    const d = planDecision(PLAN_KEEP)
    expect(d.behavior === 'deny' && d.message).toMatch(/keep planning/)
    expect(d.behavior === 'deny' && d.message).not.toContain(PLAN_KEEP)
  })
})

describe('planQuestions', () => {
  it('is a valid one-question ask whose answers pass the usual cleaning', () => {
    const qs = planQuestions()
    expect(parseQuestions({ questions: qs })).toEqual(qs)
    expect(qs[0].options.map((o) => o.label)).toEqual([PLAN_AUTO_EDITS, PLAN_MANUAL, PLAN_KEEP])
    expect(cleanAnswers(qs, { [PLAN_QUESTION]: PLAN_MANUAL })).toEqual({ [PLAN_QUESTION]: PLAN_MANUAL })
  })
  it('reads the plan from the tool input', () => {
    expect(planText({ plan: '# Plan' })).toBe('# Plan')
    expect(planText({})).toBe('')
    expect(planText(null)).toBe('')
  })
  it('says how a closed card ended', () => {
    expect(planOutcome('running', true)).toBe('open')
    expect(planOutcome('done', false)).toBe('approved')
    expect(planOutcome('error', false)).toBe('kept')
    expect(planOutcome('running', false)).toBe('closed')
  })
})

describe('nextMode (Shift+Tab)', () => {
  it('cycles Manual -> Accept edits -> Plan -> Manual', () => {
    expect(nextMode('default')).toBe('acceptEdits')
    expect(nextMode('acceptEdits')).toBe('plan')
    expect(nextMode('plan')).toBe('default')
  })
  it('goes to Manual from a mode outside the cycle', () => {
    expect(nextMode('auto')).toBe('default')
    expect(nextMode('bypassPermissions')).toBe('default')
  })
})
