// Conversation-level messages that are not the user's own words: the compaction summary a resumed or
// compacted session starts from, and hook output worth a quiet warning row. Pure, so it can be tested without Electron.

const CONTINUED = /^This session is being continued from a previous conversation/

// the summary Claude Code writes after compaction, stored (and replayed) as a user turn
export const isContinuation = (text: string) => CONTINUED.test(text.trimStart())

// the summary without Claude Code's reminder blocks, for the expanded view
export const summaryBody = (text: string) => text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '').trim()

// Events whose hooks only set the session up; their output is context for Claude, never a warning.
const QUIET_EVENTS = new Set(['SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact'])
// fields a hook's JSON output uses for words meant for the user, or for Claude about a tool call
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

// The words a hook_response carries for the user, or null when it says nothing (empty output, metrics only, async markers).
// systemMessage counts for every event; additionalContext / decision reasons only for tool-call hooks;
// stderr when the hook blocked (exit 2) or failed.
export function hookWarning(ev: any): { event: string; name: string; text: string } | null {
  if (ev?.type !== 'system' || ev.subtype !== 'hook_response') return null
  const event = String(ev.hook_event ?? '')
  if (QUIET_EVENTS.has(event)) return null
  const said: string[] = []
  for (const line of String(ev.output || ev.stdout || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    let j: any
    try { j = JSON.parse(line) } catch { continue }
    if (typeof j.systemMessage === 'string') said.push(j.systemMessage)
    if (!TOOL_EVENTS.has(event)) continue
    const h = j.hookSpecificOutput ?? {}
    if (typeof h.additionalContext === 'string') said.push(h.additionalContext)
    if (typeof h.permissionDecisionReason === 'string') said.push(h.permissionDecisionReason)
    if (j.decision === 'block' && typeof j.reason === 'string') said.push(j.reason)
  }
  const blocked = ev.exit_code === 2 || ev.outcome === 'error'
  if (blocked && String(ev.stderr ?? '').trim()) said.push(String(ev.stderr))
  const text = [...new Set(said.map((s) => s.trim()).filter(Boolean))].join('\n\n')
  return text ? { event, name: String(ev.hook_name ?? event), text } : null
}
