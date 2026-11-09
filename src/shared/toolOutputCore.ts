// A tool result's content as plain text, for the tool row that folds open to show it.
// Content is a string or a list of blocks; images are noted, not kept. Transcripts can hold megabytes of output,
// so what is kept per call is capped.
export const OUTPUT_CAP = 200_000

export function resultText(content: unknown, cap = OUTPUT_CAP): string {
  const parts = typeof content === 'string' ? [content]
    : Array.isArray(content) ? content.map((b: any) => b?.type === 'text' ? String(b.text ?? '') : b?.type === 'image' ? '[image]' : '').filter(Boolean)
    : []
  // Claude Code wraps a refused / failed call's message in <tool_use_error>
  const text = parts.join('\n').replace(/^<tool_use_error>([\s\S]*)<\/tool_use_error>$/, '$1')
  return text.length > cap ? `${text.slice(0, cap)}\n… output cut (${text.length.toLocaleString('en-US')} chars in all)` : text
}
