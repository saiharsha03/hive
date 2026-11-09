// Claude's AskUserQuestion (the terminal's multiple-choice questions): the questions it sends and the answers Hive
// returns (question text -> answer; several picks comma-separated, as the CLI expects). Shared by main and the UI.
export type AskOption = { label: string; description: string }
export type AskQuestion = { question: string; header: string; options: AskOption[]; multiSelect: boolean }

// the questions from the tool's input, or null when they are not the shape the tool defines
export function parseQuestions(input: unknown): AskQuestion[] | null {
  const qs = (input as { questions?: unknown })?.questions
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 4) return null
  const out: AskQuestion[] = []
  for (const q of qs) {
    if (typeof q?.question !== 'string' || !q.question.trim() || !Array.isArray(q.options) || q.options.length < 1) return null
    const options = q.options.filter((o: any) => typeof o?.label === 'string').map((o: any) => ({ label: o.label, description: typeof o.description === 'string' ? o.description : '' }))
    if (options.length !== q.options.length) return null
    out.push({ question: q.question, header: typeof q.header === 'string' ? q.header : '', options, multiSelect: q.multiSelect === true })
  }
  return out
}

// picks: per question, the chosen option labels; other: per question, free text typed in "Other" (used when non-empty).
// Every question needs an answer; null when one has none.
export function buildAnswers(qs: AskQuestion[], picks: string[][], other: string[]): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [i, q] of qs.entries()) {
    const typed = (other[i] ?? '').trim()
    const chosen = (picks[i] ?? []).filter((l) => q.options.some((o) => o.label === l))
    const parts = q.multiSelect ? [...chosen, ...(typed ? [typed] : [])] : typed ? [typed] : chosen.slice(0, 1)
    if (!parts.length) return null
    out[q.question] = parts.join(', ')
  }
  return out
}

// an answer from outside (the phone, the renderer): only the asked questions, as strings, each non-empty
export function cleanAnswers(qs: AskQuestion[], raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, string> = {}
  for (const q of qs) {
    const v = (raw as Record<string, unknown>)[q.question]
    if (typeof v !== 'string' || !v.trim()) return null
    out[q.question] = v.trim().slice(0, 2000)
  }
  return out
}
