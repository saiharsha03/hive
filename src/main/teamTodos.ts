// Team to-dos on disk: todos.json in the team folder (the team board and every personal list in one file).
// Writes go one at a time through change(), so two teammates checking items off at once never lose an edit.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { parseTodos, type Todo } from '../shared/teamTodoCore'
import type { Team } from '../shared/teamCore'

const file = (team: Team) => join(team.dir, 'todos.json')

export function readTodos(team: Team): Todo[] {
  try { return parseTodos(readFileSync(file(team), 'utf8')) } catch { return [] }
}

// read, apply, write in one synchronous step (main is single-threaded, so no other write can land in between);
// fn returns the new list, or a message saying why not
export function changeTodos(team: Team, fn: (todos: Todo[]) => Todo[] | string, onChange?: () => void): Todo[] | string {
  const next = fn(readTodos(team))
  if (typeof next === 'string') return next
  writeFileSafe(file(team), JSON.stringify(next, null, 2))
  onChange?.()
  return next
}
