// /btw: a quick side question about a thread that does not go into its conversation (the terminal's /btw is
// interactive-only, the engine does not offer it to apps). A throwaway fork of the thread answers with no tools, and
// the fork's transcript is deleted so it never shows as a thread.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { rm } from 'node:fs/promises'
import { claudeExecutable } from './engine'
import { blocked, TEST_MODE } from './testMode'
import { transcriptPath } from './chat'

export async function askBtw(cwd: string, sessionId: string | null, question: string): Promise<string> {
  if (TEST_MODE) return blocked('/btw (it asks Claude)')
  const q = query({
    prompt: question,
    options: {
      cwd, pathToClaudeCodeExecutable: claudeExecutable(), settingSources: ['user', 'project', 'local'],
      ...(sessionId ? { resume: sessionId, forkSession: true } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'This is a quick side question (/btw) about the conversation so far. Answer it briefly and directly from what you already know; do not use tools.' },
      canUseTool: async () => ({ behavior: 'deny' as const, message: 'A /btw side question answers without tools.' }),
      maxTurns: 2,
    },
  })
  let text = ''
  let fork = ''
  try {
    for await (const m of q) {
      if (m.type === 'assistant') for (const b of (m.message.content as any[])) if (b.type === 'text') text += b.text
      if (m.type === 'result') { fork = m.session_id; break }
    }
  } finally {
    q.close()
    if (fork && fork !== sessionId) await rm(transcriptPath(cwd, fork), { force: true }).catch(() => {})
  }
  return text.trim() || '(no answer)'
}
