// Plan mode, as in Claude Code: the choices offered when Claude finishes a plan (ExitPlanMode), what each one does,
// and the order Shift+Tab steps through the permission modes in the message box. Shared by main and the UI.
import type { AskQuestion } from './askCore'

export const PLAN_QUESTION = 'Would you like to proceed?'
export const PLAN_AUTO_EDITS = 'Yes, auto-accept edits'
export const PLAN_MANUAL = 'Yes, manually approve edits'
export const PLAN_KEEP = 'No, keep planning'

// the plan approval as a question, so it travels the same way AskUserQuestion does (the card, the phone, waiting)
export const planQuestions = (): AskQuestion[] => [{
  question: PLAN_QUESTION, header: 'Plan', multiSelect: false, options: [
    { label: PLAN_AUTO_EDITS, description: 'Approve and start in accept edits mode' },
    { label: PLAN_MANUAL, description: 'Approve and review each edit' },
    { label: PLAN_KEEP, description: 'Stay in plan mode and tell Claude what to change' },
  ],
}]

export const planText = (input: unknown): string => {
  const p = (input as { plan?: unknown })?.plan
  return typeof p === 'string' ? p : ''
}

export type PlanDecision = { behavior: 'allow'; mode: 'acceptEdits' | 'default' } | { behavior: 'deny'; message: string }

// the answer given (an option's label, or what was typed in the box) to what happens: an approve option allows the
// tool and switches the thread to its mode; anything else keeps planning, with what was typed as the feedback
export function planDecision(answer: string): PlanDecision {
  const a = answer.trim()
  if (a === PLAN_AUTO_EDITS) return { behavior: 'allow', mode: 'acceptEdits' }
  if (a === PLAN_MANUAL) return { behavior: 'allow', mode: 'default' }
  const feedback = a === PLAN_KEEP ? '' : a
  return { behavior: 'deny', message: feedback
    ? `The user wants to keep planning and said: ${feedback}\nRevise the plan with this in mind, then present it again with ExitPlanMode.`
    : 'The user wants to keep planning. Stay in plan mode and ask what they would like to change.' }
}

// What the plan card closed with, read from the tool's result: approved (allowed) or kept planning (denied).
export const planOutcome = (status: string, open: boolean): 'open' | 'approved' | 'kept' | 'closed' =>
  open ? 'open' : status === 'done' ? 'approved' : status === 'error' ? 'kept' : 'closed'

// Shift+Tab in the message box: Manual -> Accept edits -> Plan -> Manual. From a mode outside that cycle (auto,
// bypass), the first press goes to Manual, as the terminal does from auto.
const CYCLE = ['default', 'acceptEdits', 'plan'] as const
export function nextMode(mode: string): string {
  const i = (CYCLE as readonly string[]).indexOf(mode)
  return i < 0 ? 'default' : CYCLE[(i + 1) % CYCLE.length]
}
