// Read-only watcher threads: the SDK options a watcher's Claude process starts with. Its shell commands go through
// blockedCommand, its Python loads the guard (sitecustomize on PYTHONPATH), and its Postgres sessions open read-only.
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { blockedCommand, PYTHON_GUARD } from '../shared/readOnlyCore'
import { dataDir } from './testMode'

// Settings > General HIVE_WATCHER_POST_SHA256: SHA-256 fingerprints of host + path a watcher may POST to (an alert
// channel's Slack webhook), so the webhook itself is never stored in Hive's settings
let posts = ''
export const setWatcherPosts = (env: Record<string, string>) => { posts = (env.HIVE_WATCHER_POST_SHA256 ?? '').trim() }

function guardDir(): string {
  const dir = join(dataDir(), 'hive', 'readonly-python')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sitecustomize.py'), PYTHON_GUARD)
  return dir
}

export function readOnlyOptions(hooks: Options['hooks'] = {}): Partial<Options> {
  const env = process.env
  return {
    env: {
      ...env,
      HIVE_READONLY: '1',
      HIVE_READONLY_POST_SHA256: posts,
      PYTHONPATH: [guardDir(), env.PYTHONPATH].filter(Boolean).join(delimiter),
      PGOPTIONS: [env.PGOPTIONS, '-c default_transaction_read_only=on'].filter(Boolean).join(' '),
    },
    hooks: {
      ...hooks,
      PreToolUse: [...(hooks?.PreToolUse ?? []), {
        matcher: 'Bash|PowerShell',
        hooks: [async (input: any) => {
          const why = blockedCommand(String(input.tool_input?.command ?? ''))
          return why
            ? { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: `Read-only watcher thread: ${why}.` } }
            : {}
        }],
      }],
    },
  }
}
