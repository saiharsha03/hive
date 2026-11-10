// A call to Claude Code's advisor, as the reply records it: a `server_tool_use` block named "advisor", then an
// `advisor_tool_result` block for it. The advice itself usually comes back encrypted (only the model reads it), so the
// row says that the advisor answered, which model it was and how much it read and wrote (the reply's usage.iterations).
export const ADVISOR_TOOL = 'advisor'
export const isAdvisorCall = (b: any): boolean => b?.type === 'server_tool_use' && b?.name === ADVISOR_TOOL
export const isAdvisorResult = (b: any): boolean => b?.type === 'advisor_tool_result'

const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : '')
/** the row's output for an answer block, with the advisor's own usage when the reply carries it */
export function advisorOutput(b: any, usage: any): { text: string; failed: boolean } {
  const c = b?.content ?? {}
  const it = (Array.isArray(usage?.iterations) ? usage.iterations : []).find((x: any) => x?.type === 'advisor_message')
  const cost = it ? `${it.model ?? 'advisor'}: read ${n(it.input_tokens)} tokens, wrote ${n(it.output_tokens)}.` : ''
  if (typeof c.type === 'string' && /error/.test(c.type)) return { text: [`The advisor call failed${c.error_code ? `: ${c.error_code}` : ''}.`, cost].filter(Boolean).join('\n'), failed: true }
  const said = typeof c.text === 'string' && c.text.trim() ? c.text.trim() : ''
  if (said) return { text: [said, cost].filter(Boolean).join('\n\n'), failed: false }
  return { text: ['The advisor answered. Its advice comes back encrypted: Claude reads it, it cannot be shown here.', cost].filter(Boolean).join('\n'), failed: false }
}
