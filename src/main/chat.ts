// Live Claude sessions, one per open tab. Each tab keeps one Claude Code process running
// (streaming input mode), so every message continues the same conversation and reuses the cache.
import { createSdkMcpServer, query, tool, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

// No permission prompts in the app yet, so sessions run in bypass mode (shown under the message box).
export const PERMISSION_MODE = 'bypassPermissions' as const

const APPEND = [
  'You are running inside Hive, the user\'s desktop app for Claude Code.',
  'To show the user an image, screenshot, HTML mockup, PDF or any file, call mcp__hive__show_to_user with its absolute path.',
  'It opens in a preview panel beside the chat and shows inline in the conversation. Use it instead of opening files in other apps (Start-Process, start, open).',
].join(' ')

type Live = { q: Query; push: (m: SDKUserMessage) => void; sessionId: string | null }
const live = new Map<string, Live>()

// ~/.claude/projects/<cwd with every non-alphanumeric as "-">/<session>.jsonl
export const transcriptPath = (cwd: string, sessionId: string) =>
  join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`)

// messages the user sends, handed to the SDK one at a time as they arrive
function inbox() {
  const waiting: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  const push = (m: SDKUserMessage) => { waiting.push(m); wake?.() }
  async function* stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (waiting.length) yield waiting.shift()!
      await new Promise<void>((r) => (wake = r))
      wake = null
    }
  }
  return { push, stream }
}

type Start = { tabId: string; cwd: string; resume?: string; web: WebContents }

function start({ tabId, cwd, resume, web }: Start): Live {
  // events only while this process is still the tab's live one; a closed process stays silent
  let s: Live
  const send = (event: unknown) => {
    if (live.get(tabId) === s && !web.isDestroyed()) web.send('chat:event', tabId, event)
  }

  const hive = createSdkMcpServer({
    name: 'hive',
    version: '1.0.0',
    tools: [
      tool(
        'show_to_user',
        'Open a file (image, screenshot, HTML page, PDF, video, text) in the preview panel of the Hive app, beside the chat. Use whenever you want the user to look at something.',
        { path: z.string().describe('Absolute path of the file to show') },
        async ({ path }) => {
          send({ type: 'hive_show', path })
          return { content: [{ type: 'text', text: `Shown to the user in the preview panel: ${path}` }] }
        },
      ),
    ],
  })

  const { push, stream } = inbox()
  const q = query({
    prompt: stream(),
    options: {
      cwd,
      resume,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND },
      mcpServers: { hive },
      includePartialMessages: true,
      permissionMode: PERMISSION_MODE,
      allowDangerouslySkipPermissions: true,
    },
  })
  s = { q, push, sessionId: resume ?? null }

  void (async () => {
    try {
      for await (const m of q as AsyncIterable<SDKMessage>) {
        if (m.type === 'system' && (m as any).subtype === 'init') {
          s.sessionId = (m as any).session_id
          send({ type: 'hive_session', sessionId: s.sessionId, path: transcriptPath(cwd, s.sessionId!) })
        }
        send(m)
      }
    } catch (e: any) {
      send({ type: 'hive_error', message: String(e?.message ?? e) })
    } finally {
      // only if this tab still points at this process: a reopened tab may already have a new one
      if (live.get(tabId) === s) {
        send({ type: 'hive_closed' })
        live.delete(tabId)
      }
    }
  })()
  return s
}

export type Outgoing = { text: string; images: { mediaType: string; data: string }[] }

export function sendMessage(tabId: string, cwd: string, resume: string | undefined, msg: Outgoing, web: WebContents): void {
  let s = live.get(tabId)
  if (!s) live.set(tabId, (s = start({ tabId, cwd, resume, web })))
  const content: any[] = msg.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }))
  if (msg.text) content.push({ type: 'text', text: msg.text })
  s.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage)
}

export async function interrupt(tabId: string): Promise<void> {
  await live.get(tabId)?.q.interrupt()
}

export function closeTab(tabId: string): void {
  live.get(tabId)?.q.close()
  live.delete(tabId)
}

export function closeAll(): void {
  for (const id of [...live.keys()]) closeTab(id)
}
