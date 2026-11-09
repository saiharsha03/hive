// A conversation as Markdown, for copying or saving. Items are the chat's Item list; the tool-line text comes in
// as a function because it lives in the renderer.
type ExportItem = { kind: string; [k: string]: any }

export function conversationMarkdown(title: string, items: ExportItem[], toolText: (name: string, input: any) => string, partial = false): string {
  const out: string[] = [`# ${title}`]
  if (partial) out.push('_Earlier messages were not loaded: this export starts at the loaded part._')
  let tools: string[] = [] // consecutive tool calls share one list
  const flush = () => { if (tools.length) out.push(tools.join('\n')); tools = [] }
  for (const it of items) {
    if (it.kind === 'tool') { tools.push(`- ${toolText(it.name, it.input)}`); continue }
    flush()
    switch (it.kind) {
      case 'user': out.push(`## You\n\n${[it.text, ...(it.images ?? []).map(() => '[image]')].filter(Boolean).join('\n\n')}`); break
      case 'assistant': out.push(`## Claude\n\n${it.text}`); break
      case 'thread': out.push(`## ${it.fromTitle}\n\n${it.text}`); break
      case 'agent': out.push(`## ${it.from}\n\n${it.text}`); break
      case 'note': out.push(`_${it.text}_`); break
      case 'error': out.push(`**Error:** ${it.text}`); break
      case 'warning': out.push(`**Warning (${it.name}):** ${it.text}`); break
    }
  }
  flush()
  return out.join('\n\n') + '\n'
}
