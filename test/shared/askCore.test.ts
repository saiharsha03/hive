import { describe, expect, it } from 'vitest'
import { answerParts, answersFromResult, buildAnswers, cleanAnswers, parseQuestions } from '../../src/shared/askCore'
import { answerAsk, cancelAsks, openAsks, replyInChat, waitForAnswer } from '../../src/main/asks'

const input = { questions: [
  { question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres', description: 'safe' }, { label: 'SQLite', description: '' }], multiSelect: false },
  { question: 'Which features?', header: 'Features', options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: true },
] }

describe('askCore', () => {
  it('parses the tool input and refuses malformed questions', () => {
    expect(parseQuestions(input)?.map((q) => [q.header, q.options.length, q.multiSelect])).toEqual([['DB', 2, false], ['Features', 2, true]])
    expect(parseQuestions({ questions: [] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: 'x', options: [{ nope: 1 }] }] })).toBeNull()
    expect(parseQuestions(null)).toBeNull()
  })
  it('builds answers: one pick, several comma-separated, Other text winning a single choice', () => {
    const qs = parseQuestions(input)!
    expect(buildAnswers(qs, [['SQLite'], ['A', 'B']], ['', ''])).toEqual({ 'Which DB?': 'SQLite', 'Which features?': 'A, B' })
    expect(buildAnswers(qs, [['SQLite'], ['A']], ['Mongo', 'C'])).toEqual({ 'Which DB?': 'Mongo', 'Which features?': 'A, C' })
    expect(buildAnswers(qs, [['SQLite'], []], ['', ''])).toBeNull()
    expect(buildAnswers(qs, [['Bogus'], ['A']], ['', ''])).toBeNull()
  })
  it('accepts an outside answer only for the asked questions', () => {
    const qs = parseQuestions(input)!
    expect(cleanAnswers(qs, { 'Which DB?': ' Postgres ', 'Which features?': 'A', extra: 'x' })).toEqual({ 'Which DB?': 'Postgres', 'Which features?': 'A' })
    expect(cleanAnswers(qs, { 'Which DB?': 'Postgres' })).toBeNull()
    expect(cleanAnswers(qs, 'nope')).toBeNull()
  })
})

describe('asks', () => {
  const qs = parseQuestions(input)!
  const answers = { 'Which DB?': 'Postgres', 'Which features?': 'A' }
  it('resolves with the answer from the right thread only', async () => {
    const p = waitForAnswer('tab1', 'tu1', qs, new AbortController().signal)
    expect(openAsks('tab1').map((a) => a.id)).toEqual(['tu1'])
    expect(answerAsk('tab2', 'tu1', answers)).toBe(false)
    expect(answerAsk('tab1', 'tu1', { 'Which DB?': 'x' })).toBe(false)
    expect(answerAsk('tab1', 'tu1', answers)).toBe(true)
    expect(await p).toEqual({ kind: 'answers', answers })
    expect(answerAsk('tab1', 'tu1', answers)).toBe(false)
    expect(openAsks('tab1')).toEqual([])
  })
  it('ends on a chat reply, a cancel or the abort signal', async () => {
    const chat = waitForAnswer('t', 'a', qs, new AbortController().signal)
    replyInChat('t')
    expect(await chat).toEqual({ kind: 'chat' })
    const c = waitForAnswer('t', 'b', qs, new AbortController().signal)
    cancelAsks('t')
    expect(await c).toEqual({ kind: 'cancelled' })
    const ac = new AbortController()
    const ab = waitForAnswer('t', 'c', qs, ac.signal)
    ac.abort()
    expect(await ab).toEqual({ kind: 'cancelled' })
  })
})

describe('an answered question says what was answered', () => {
  const qs = parseQuestions(input)!
  it('reads each answer back from the tool result, in either wording the engine uses', () => {
    expect(answersFromResult(qs, 'Your questions have been answered: "Which DB?"="Postgres", "Which features?"="A, B". You can now continue.')).toEqual({ 'Which DB?': 'Postgres', 'Which features?': 'A, B' })
    expect(answersFromResult(qs, 'The user answered: "Which DB?"="you recommend", "Which features?"="A". Read the answers carefully.')).toEqual({ 'Which DB?': 'you recommend', 'Which features?': 'A' })
  })
  it('keeps quotes and commas inside a typed answer', () => {
    expect(answersFromResult(qs, 'Your questions have been answered: "Which DB?"="the "old" one, for now", "Which features?"="B". Done.')['Which DB?']).toBe('the "old" one, for now')
  })
  it('is empty when the result holds no answer', () => {
    expect(answersFromResult(qs, 'The user declined to answer.')).toEqual({})
    expect(answersFromResult(qs, undefined)).toEqual({})
  })
  it('splits an answer into the options it names and what was typed', () => {
    expect(answerParts(qs[0], 'Postgres')).toEqual({ picked: [qs[0].options[0]], typed: '' })
    expect(answerParts(qs[0], 'you recommend')).toEqual({ picked: [], typed: 'you recommend' })
    expect(answerParts(qs[1], 'A, B')).toEqual({ picked: qs[1].options, typed: '' })
    expect(answerParts(qs[1], 'A, something else')).toEqual({ picked: [qs[1].options[0]], typed: 'something else' })
  })
})
