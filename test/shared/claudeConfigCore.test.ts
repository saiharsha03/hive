import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  agentOf, agentTemplate, editRule, foldersDown, frontmatter, hooksOf, indentOf, localCommand, mcpArgs, mcpRow, memorySpots,
  ruleProblem, rulesOf, safeUrl, sameFolder, settingsFiles, validAgentName,
} from '../../src/shared/claudeConfigCore'

test('typed configuration commands are picked out, with aliases and arguments', () => {
  assert.deepEqual(localCommand('/mcp'), { name: 'mcp', args: '' })
  assert.deepEqual(localCommand('  /allowed-tools '), { name: 'permissions', args: '' })
  assert.deepEqual(localCommand('/fork try the other way'), { name: 'branch', args: 'try the other way' })
  assert.deepEqual(localCommand('/add-dir C:\\work\\api'), { name: 'add-dir', args: 'C:\\work\\api' })
  assert.equal(localCommand('/status'), null)
  assert.equal(localCommand('please run /mcp'), null)
  assert.equal(localCommand('/mcp\nand more'), null)
  assert.deepEqual(mcpArgs('reconnect github'), { action: 'reconnect', server: 'github' })
  assert.deepEqual(mcpArgs('disable all'), { action: 'disable', server: 'all' })
  assert.equal(mcpArgs('github'), null)
})

test('frontmatter: plain values, quoted, comma lists, YAML lists and folded blocks', () => {
  const fm = frontmatter('\uFEFF---\nname: code-reviewer\ndescription: "Reviews code"\ntools: Read, Grep\nskills:\n  - a\n  - b\nnote: >\n  one\n  two\n---\nBody here\n')!
  assert.equal(fm.data.name, 'code-reviewer')
  assert.equal(fm.data.description, 'Reviews code')
  assert.equal(fm.data.tools, 'Read, Grep')
  assert.deepEqual(fm.data.skills, ['a', 'b'])
  assert.equal(fm.data.note, 'one two')
  assert.equal(fm.body, 'Body here\n')
  assert.equal(frontmatter('no frontmatter'), null)
  assert.deepEqual(frontmatter('---\r\ntools: [Read, "Bash"]\r\n---\r\n')!.data.tools, ['Read', 'Bash'])
})

test('an agent file: fields, all tools when left out, and why Claude Code would skip it', () => {
  const a = agentOf('---\nname: rev\ndescription: d\ntools: Read, Glob\nmodel: sonnet\n---\nx', '/p/.claude/agents/rev.md', 'project')
  assert.deepEqual({ name: a.name, model: a.model, tools: a.tools, problem: a.problem }, { name: 'rev', model: 'sonnet', tools: ['Read', 'Glob'], problem: undefined })
  const b = agentOf('---\nname: x\n---\n', 'C:\\h\\.claude\\agents\\x.md', 'user')
  assert.equal(b.tools, null)
  assert.equal(b.model, 'inherit')
  assert.match(b.problem!, /No description/)
  assert.equal(agentOf('hello', '/a/fallback.md', 'user').name, 'fallback')
  const t = agentOf(agentTemplate('my-agent'), '/a/my-agent.md', 'project')
  assert.equal(t.name, 'my-agent')
  assert.equal(t.problem, undefined)
  assert.ok(validAgentName('code-reviewer'))
  assert.ok(!validAgentName('Bad Name') && !validAgentName('../x') && !validAgentName(''))
})

test('permission rules: read, add without duplicates, remove, other keys kept', () => {
  const s = { model: 'opus', permissions: { allow: ['Bash(ls:*)'], defaultMode: 'plan', additionalDirectories: ['/x'] }, hooks: {} }
  assert.deepEqual(rulesOf(s), { allow: ['Bash(ls:*)'], ask: [], deny: [] })
  const added = editRule(s, 'deny', ' Read(./.env) ', true)
  assert.deepEqual(added, { model: 'opus', permissions: { allow: ['Bash(ls:*)'], defaultMode: 'plan', additionalDirectories: ['/x'], deny: ['Read(./.env)'] }, hooks: {} })
  assert.deepEqual(editRule(added, 'deny', 'Read(./.env)', true), added)
  assert.deepEqual(rulesOf(editRule(added, 'allow', 'Bash(ls:*)', false)).allow, [])
  assert.deepEqual(rulesOf(editRule(null, 'ask', 'WebFetch', true)).ask, ['WebFetch'])
  assert.equal(ruleProblem('Bash(npm run test:*)'), null)
  assert.equal(ruleProblem('mcp__github'), null)
  assert.ok(ruleProblem(''))
  assert.ok(ruleProblem('rm -rf /'))
  assert.equal(indentOf('{\n    "a": 1\n}'), '    ')
  assert.equal(indentOf('{}'), 2)
})

test('hooks per event; an http hook shows no query and no headers', () => {
  const rows = hooksOf({ hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node check.js' }] }],
    Stop: [{ hooks: [{ type: 'http', url: 'https://user:pw@hooks.example.com/stop?token=abc', headers: { Authorization: 'Bearer x' } }] }],
  } })
  assert.deepEqual(rows, [
    { event: 'PreToolUse', matcher: 'Bash', type: 'command', what: 'node check.js' },
    { event: 'Stop', matcher: '', type: 'http', what: 'https://hooks.example.com/stop' },
  ])
  assert.deepEqual(hooksOf({ hooks: 'junk' }), [])
})

test('an MCP server row never carries env or header values, args or a query string', () => {
  const r = mcpRow({ name: 'gh', status: 'connected', scope: 'project', config: { command: 'npx', args: ['--token', 'SECRET'], env: { GH_TOKEN: 'SECRET' } }, tools: [{ name: 'a' }] }, '/p', '/h')
  assert.deepEqual(r, { name: 'gh', status: 'connected', scope: 'project', file: '/p/.mcp.json', transport: 'stdio', target: 'npx', envNames: ['GH_TOKEN'], headerNames: [], tools: 1 })
  const h = mcpRow({ name: 'x', status: 'failed', source: 'user', error: 'boom', config: { type: 'http', url: 'https://mcp.example.com/v1?key=SECRET', headers: { 'X-Key': 'SECRET' } } }, 'C:\\p', 'C:\\Users\\me')
  assert.equal(h.target, 'https://mcp.example.com/v1')
  assert.deepEqual(h.headerNames, ['X-Key'])
  assert.equal(h.file, 'C:\\Users\\me\\.claude.json')
  assert.ok(!JSON.stringify([r, h]).includes('SECRET'))
  assert.equal(safeUrl('not a url'), '(address hidden)')
})

test('settings files and CLAUDE.md spots, in load order, root first, deduplicated', () => {
  assert.deepEqual(settingsFiles('C:\\p', 'C:\\Users\\me').map((f) => f.path), ['C:\\Users\\me\\.claude\\settings.json', 'C:\\p\\.claude\\settings.json', 'C:\\p\\.claude\\settings.local.json'])
  assert.deepEqual(foldersDown('C:\\a\\b\\'), ['C:\\', 'C:\\a', 'C:\\a\\b'])
  assert.deepEqual(foldersDown('/a/b'), ['/', '/a', '/a/b'])
  const spots = memorySpots('/home/me/proj', '/home/me', 'linux')
  assert.deepEqual(spots.slice(0, 3).map((s) => s.path), ['/etc/claude-code/CLAUDE.md', '/home/me/.claude/CLAUDE.md', '/home/me/.claude/rules'])
  assert.equal(spots.filter((s) => s.path === '/home/me/.claude/CLAUDE.md').length, 1) // the home folder's .claude/CLAUDE.md is the user file
  const own = spots.filter((s) => s.path.startsWith('/home/me/proj/'))
  assert.deepEqual(own.map((s) => [s.path, s.scope]), [
    ['/home/me/proj/CLAUDE.md', 'project'], ['/home/me/proj/.claude/CLAUDE.md', 'project'], ['/home/me/proj/CLAUDE.local.md', 'local'], ['/home/me/proj/.claude/rules', 'project'],
  ])
  assert.equal(spots.find((s) => s.path === '/home/CLAUDE.md')?.scope, 'parent')
  assert.ok(spots.findIndex((s) => s.path === '/home/CLAUDE.md') < spots.findIndex((s) => s.path === '/home/me/proj/CLAUDE.md'))
  assert.equal(memorySpots('C:\\x', 'C:\\Users\\me', 'win32')[0].path, 'C:\\Program Files\\ClaudeCode\\CLAUDE.md')
  assert.ok(sameFolder('C:\\Work\\Api\\', 'c:\\work\\api'))
  assert.ok(!sameFolder('/a/b', '/a/B'))
})
