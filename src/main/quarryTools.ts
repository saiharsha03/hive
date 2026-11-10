// What the quarry_ thread tools do (chat.ts registers them on Hive's MCP server): call Quarry's agent interface and
// turn the answer into the tool's text. Kept apart from chat.ts so the opt-in e2e can run these very handlers against
// a real Quarry without a Claude turn (index.ts, quarry:e2eTool). Hive adds no filter: Quarry enforces its own rules.
// A write asks the user first (confirm), then sets allowWrite, as Quarry asks of its host.
import { randomUUID } from 'node:crypto'
import { waitForAnswer } from './asks'
import { quarryCall } from './quarry'
import { DATA_NOTE, formatConnections, formatError, formatRows, RUN_WRITE, writeQuestion } from './quarryCore'

export type ToolResult = { ok: boolean; text: string }
// 'run' = the user said Run it; 'skip' = anything else; 'chat' = they replied in the chat instead; 'none' = nobody can
// answer (an unattended watcher run)
export type Confirm = (connection: string, sql: string) => Promise<'run' | 'skip' | 'chat' | 'none'>

const done = (text: string): ToolResult => ({ ok: true, text })
const failed = (e: unknown): ToolResult => ({ ok: false, text: formatError(e) })

export async function quarryConnections(): Promise<ToolResult> {
  try { return done(formatConnections(await quarryCall('agent.listConnections', {}))) } catch (e) { return failed(e) }
}

export async function quarrySchema(a: { connection: string; schema?: string; table?: string }): Promise<ToolResult> {
  try {
    const r = await quarryCall('agent.describeSchema', { connection: a.connection, ...(a.schema ? { schema: a.schema } : {}), ...(a.table ? { table: a.table } : {}) })
    return done(`${DATA_NOTE}\n${JSON.stringify(r, null, 1)}`)
  } catch (e) { return failed(e) }
}

export async function quarryQuery(a: { connection: string; sql: string; max_rows?: number; timeout_ms?: number; allow_write?: boolean }, confirm: Confirm): Promise<ToolResult> {
  let allowWrite = false
  if (a.allow_write) {
    const answer = await confirm(a.connection, a.sql)
    if (answer === 'none') return { ok: false, text: 'A watcher run is unattended: nobody can confirm a write. Note it in your findings instead.' }
    if (answer === 'chat') return done('The user replied in the chat instead: read their next message. The write was not run.')
    if (answer !== 'run') return done('The user did not confirm the write; it was not run.')
    allowWrite = true
  }
  try {
    const r = await quarryCall<Parameters<typeof formatRows>[0]>('agent.query', {
      connection: a.connection, sql: a.sql, ...(a.max_rows ? { maxRows: a.max_rows } : {}), ...(a.timeout_ms ? { timeoutMs: a.timeout_ms } : {}), ...(allowWrite ? { allowWrite: true } : {}),
    }, (a.timeout_ms ?? 60_000) + 30_000)
    return done(formatRows(r))
  } catch (e) { return failed(e) }
}

export async function quarryExplain(a: { connection: string; sql: string; analyze?: boolean }): Promise<ToolResult> {
  try {
    const r = await quarryCall<{ text?: string; plan?: unknown; planningMs?: number; executionMs?: number | null }>('agent.explain', { connection: a.connection, sql: a.sql, ...(a.analyze ? { analyze: true } : {}) }, 90_000)
    return done(`${DATA_NOTE}\n${r.text ?? JSON.stringify(r.plan)}\nplanning ${r.planningMs ?? '?'} ms${r.executionMs != null ? `, execution ${r.executionMs} ms` : ''}`)
  } catch (e) { return failed(e) }
}

// The write question as a card in the thread's tab (the same card Claude's own questions use): hive_ask carries the
// questions, so the window draws it even with no AskUserQuestion call behind it. waiting: the thread shows as
// waiting for the user meanwhile (and tells the phone); it is cleared again once the card is answered.
export function confirmByCard(tabId: string, emit: (ev: unknown) => void, signal: AbortSignal, waiting: (reason: string | null) => void = () => {}): Confirm {
  return async (connection, sql) => {
    const id = `quarry-write-${randomUUID()}`
    const questions = writeQuestion(connection, sql)
    const reason = `Question: ${questions[0].question.split('\n')[0]}`.slice(0, 200)
    waiting(reason)
    emit({ type: 'hive_ask', id, questions })
    emit({ type: 'hive_organize', action: 'waiting', reason })
    const end = await waitForAnswer(tabId, id, questions, signal)
    emit({ type: 'hive_ask_done', id })
    waiting(null)
    if (end.kind === 'chat') return 'chat'
    return end.kind === 'answers' && end.answers[questions[0].question] === RUN_WRITE ? 'run' : 'skip'
  }
}
