import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  adfToText, buildJql, columnOf, columnsOf, fetchFailure, filterCards, firstMessage, httpError, mapIssue, searchUrl, statusNote,
  threadFor, threadTitle, trackerConfig, trackerOrigin, trimDescription, type Card,
} from '../../src/shared/trackerCore'

const SITE = 'https://acme.atlassian.net'
const issue = (key: string, o: { summary?: string; status?: string; cat?: string; updated?: string; description?: unknown; priority?: string | null } = {}) => ({
  key,
  fields: {
    summary: o.summary ?? `Summary of ${key}`, updated: o.updated ?? '2026-11-10T14:03:11.000+0000', description: o.description ?? null,
    status: { name: o.status ?? 'To Do', statusCategory: { key: o.cat ?? 'new' } },
    issuetype: { name: 'Bug' }, priority: o.priority === null ? null : { name: o.priority ?? 'High' }, project: { key: key.split('-')[0], name: 'Acme Web' },
  },
})
const card = (key: string, o: Parameters<typeof issue>[1] = {}): Card => mapIssue(issue(key, o), SITE)!

test('settings: what is missing is named in one sentence, and the site must be https', () => {
  const none = trackerConfig({})
  assert.equal(none.ok, false)
  assert.equal(!none.ok && none.message, 'Set the Jira site, your Jira email and the API token file in Settings, under General, to see your Jira tickets here.')
  const noToken = trackerConfig({ HIVE_TRACKER_SITE: SITE, HIVE_TRACKER_EMAIL: 'a@b.c' })
  assert.equal(!noToken.ok && noToken.message, 'Set the API token file in Settings, under General, to see your Jira tickets here.')
  const http = trackerConfig({ HIVE_TRACKER_SITE: 'http://acme.atlassian.net', HIVE_TRACKER_EMAIL: 'a@b.c', HIVE_TRACKER_TOKEN_FILE: '~/.t' })
  assert.ok(!http.ok && /https address/.test(http.message))
  // a path or a trailing slash on the site is dropped: only the origin is ever called
  assert.deepEqual(trackerConfig({ HIVE_TRACKER_SITE: ` ${SITE}/jira/your-work `, HIVE_TRACKER_EMAIL: ' a@b.c ', HIVE_TRACKER_TOKEN_FILE: '~/.t' }),
    { ok: true, origin: SITE, email: 'a@b.c', token: '', tokenFile: '~/.t' })
  assert.equal(trackerOrigin('not a url'), null)
  assert.equal(trackerOrigin('file:///c:/x'), null)
})

test('the search: mine, open or done in the last 14 days, as a GET address on the site', () => {
  assert.equal(buildJql(), 'assignee = currentUser() AND (statusCategory != Done OR statusCategoryChangedDate >= -14d) ORDER BY updated DESC')
  assert.match(buildJql(3), />= -3d\)/)
  const u = new URL(searchUrl(SITE, buildJql(), 'tok+1'))
  assert.equal(u.origin + u.pathname, `${SITE}/rest/api/3/search/jql`)
  assert.equal(u.searchParams.get('jql'), buildJql())
  assert.equal(u.searchParams.get('nextPageToken'), 'tok+1')
  assert.ok(u.searchParams.get('fields')!.split(',').includes('description'))
  assert.equal(new URL(searchUrl(SITE, buildJql())).searchParams.has('nextPageToken'), false)
})

test('errors in plain words: a refused token, Jira\'s own short reason, a timeout, no connection', () => {
  assert.equal(httpError(401), 'Jira refused the token (401). Check the email and the API token in Settings.')
  assert.match(httpError(403, '{"errorMessages":["x"]}'), /refused the token \(403\)/)
  assert.equal(httpError(400, '{"errorMessages":["The value does not exist for the field assignee."]}'), 'Jira answered 400: The value does not exist for the field assignee..')
  assert.equal(httpError(502, '<html>Bad gateway</html>'), 'Jira answered 502.')
  assert.equal(fetchFailure('TimeoutError', SITE, 15), 'Jira did not answer within 15 seconds.')
  assert.equal(fetchFailure('TypeError', SITE, 15), 'Could not reach acme.atlassian.net.')
})

test('a Jira description becomes plain text, and unknown node types keep their words', () => {
  const doc = {
    type: 'doc', version: 1, content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Open the page', marks: [{ type: 'strong' }] }, { type: 'hardBreak' }, { type: 'text', text: 'then ask ' }, { type: 'mention', attrs: { id: '1', text: '@Ana' } }, { type: 'text', text: ' ' }, { type: 'inlineCard', attrs: { url: 'https://example.com/a' } }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
      { type: 'orderedList', attrs: { order: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'four' }] }] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1\nconst b = 2' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] }] }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x', type: 'file' } }] },
      { type: 'someFutureBlock', content: [{ type: 'someFutureInline', attrs: { text: 'kept' } }, { type: 'text', text: ' words' }] },
      { type: 'rule' },
      { type: 'paragraph', content: [{ type: 'status', attrs: { text: 'BLOCKED' } }, { type: 'text', text: ' until ' }, { type: 'date', attrs: { timestamp: '1762732800000' } }] },
    ],
  }
  assert.equal(adfToText(doc), [
    'Steps', 'Open the page\nthen ask @Ana https://example.com/a', '- one\n- two', '3. three\n4. four', 'const a = 1\nconst b = 2', 'Name | Value',
    'kept words', '---', 'BLOCKED until 2025-11-10',
  ].join('\n\n'))
  assert.equal(adfToText(null), '')
  assert.equal(adfToText(42), '')
  assert.equal(adfToText({ type: 'doc', content: 'nope' }), '')
  assert.equal(adfToText('  plain\r\nold style  '), 'plain\nold style')
})

test('a Jira issue becomes a card; a broken one is skipped', () => {
  const c = mapIssue(issue('WEB-12', { summary: ' Login loops ', status: 'In Review', cat: 'indeterminate', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It loops.' }] }] } }), SITE)
  assert.deepEqual(c, {
    key: 'WEB-12', summary: 'Login loops', type: 'Bug', priority: 'High', project: 'WEB', projectName: 'Acme Web', status: 'In Review', column: 'review',
    updated: Date.UTC(2026, 10, 10, 14, 3, 11), url: `${SITE}/browse/WEB-12`, description: 'It loops.',
  })
  assert.equal(card('WEB-1', { priority: null }).priority, '')
  assert.equal(mapIssue({ key: 'WEB-9' }, SITE)!.project, 'WEB') // no fields at all: still a card, the project from the key
  for (const bad of [null, 'x', {}, { key: 'no key' }, { key: '../../x-1' }]) assert.equal(mapIssue(bad, SITE), null)
})

test('columns: To do, In progress, In review only when such a status exists, Done; newest first', () => {
  assert.equal(columnOf('new', 'Backlog'), 'todo')
  assert.equal(columnOf('indeterminate', 'In Progress'), 'progress')
  assert.equal(columnOf('indeterminate', 'Code Review'), 'review')
  assert.equal(columnOf('new', 'Needs review'), 'review')
  assert.equal(columnOf('done', 'Reviewed'), 'done')
  assert.equal(columnOf('', 'Odd'), 'progress')
  const cards = [
    card('A-1', { status: 'Done', cat: 'done' }), card('A-2', { status: 'In Progress', cat: 'indeterminate', updated: '2026-11-01T00:00:00.000+0000' }),
    card('A-3', { status: 'Blocked', cat: 'indeterminate', updated: '2026-11-09T00:00:00.000+0000' }), card('A-4', { status: 'Backlog' }),
  ]
  const cols = columnsOf(cards)
  assert.deepEqual(cols.map((c) => c.label), ['To do', 'In progress', 'Done']) // empty columns stay, In review does not
  assert.deepEqual(cols.map((c) => c.cards.map((x) => x.key)), [['A-4'], ['A-3', 'A-2'], ['A-1']])
  assert.deepEqual(columnsOf([...cards, card('A-5', { status: 'In Review', cat: 'indeterminate' })]).map((c) => c.label), ['To do', 'In progress', 'In review', 'Done'])
  assert.deepEqual(columnsOf([]).map((c) => c.cards.length), [0, 0, 0])
})

test('the real status shows on the card only when it differs from the column name', () => {
  assert.equal(statusNote(card('A-1', { status: 'To Do' })), '')
  assert.equal(statusNote(card('A-2', { status: 'Backlog' })), 'Backlog')
  assert.equal(statusNote(card('A-3', { status: 'Blocked', cat: 'indeterminate' })), 'Blocked')
  assert.equal(statusNote(card('A-4', { status: 'In Review', cat: 'indeterminate' })), '')
  assert.equal(statusNote(card('A-5', { status: 'Done', cat: 'done' })), '')
})

test('the filter narrows by key, summary or project', () => {
  const cards = [card('WEB-1', { summary: 'Login loops' }), card('API-2', { summary: 'Slow export' })]
  assert.deepEqual(filterCards(cards, ' web-1 ').map((c) => c.key), ['WEB-1'])
  assert.deepEqual(filterCards(cards, 'EXPORT').map((c) => c.key), ['API-2'])
  assert.deepEqual(filterCards(cards, 'api').map((c) => c.key), ['API-2'])
  assert.deepEqual(filterCards(cards, 'acme web').length, 2) // the project's name
  assert.deepEqual(filterCards(cards, 'High'), []) // not by priority
  assert.equal(filterCards(cards, '  '), cards)
})

test('a long description is cut at a word, and says so', () => {
  assert.deepEqual(trimDescription('  short  '), { text: 'short', cut: false })
  assert.deepEqual(trimDescription('one two three four', 12), { text: 'one two', cut: true }) // "one two thre" goes back to the last space
  assert.deepEqual(trimDescription('x'.repeat(30), 10), { text: 'x'.repeat(10), cut: true }) // nothing to break at
  assert.deepEqual(trimDescription('exactly ten', 11), { text: 'exactly ten', cut: false })
})

test('the first message: key and summary, the description, a link and the ask; a cut is noted', () => {
  const c = card('WEB-12', { summary: 'Login loops', description: 'It loops.\n\nSince Monday.' })
  assert.equal(threadTitle(c), 'WEB-12 Login loops')
  assert.equal(firstMessage(c), `WEB-12 Login loops\n\nIt loops.\n\nSince Monday.\n\n${SITE}/browse/WEB-12\n\nRead the ticket and propose a plan before changing anything.`)
  assert.equal(firstMessage(card('WEB-13', { summary: 'Empty' })).split('\n\n')[1], 'The ticket has no description.')
  const long = firstMessage(card('WEB-14', { description: 'word '.repeat(50) }), 40).split('\n\n')
  assert.equal(long[1], 'word word word word word word word word')
  assert.equal(long[2], '(Description cut at 40 characters; the ticket has the rest.)')
  assert.equal(long.length, 5)
})

test('a card finds its open thread by the title starting with the key', () => {
  const threads = [{ id: 'a', title: 'SCRUM-12 Fix export' }, { id: 'b', title: 'About SCRUM-1' }, { id: 'c', title: 'scrum-3: lower case' }, { id: 'd', title: 'SCRUM-4' }]
  assert.equal(threadFor('SCRUM-12', threads)?.id, 'a')
  assert.equal(threadFor('SCRUM-1', threads), null) // not SCRUM-12, and not a title that only mentions it
  assert.equal(threadFor('SCRUM-3', threads)?.id, 'c')
  assert.equal(threadFor('SCRUM-4', threads)?.id, 'd')
  assert.equal(threadFor('SCRUM-5', []), null)
})
