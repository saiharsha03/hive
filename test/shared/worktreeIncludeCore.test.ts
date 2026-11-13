import { test } from 'vitest'
import assert from 'node:assert/strict'
import { included, mayReach, parseInclude } from '../../src/shared/worktreeIncludeCore'

test('.worktreeinclude: names, globs, anchored paths; comments and blank lines skipped', () => {
  const r = parseInclude('# env files\n.env\n.env.*\n\nconfig/secrets.json\n')
  assert.equal(included(r, '.env'), true)
  assert.equal(included(r, 'api/.env'), true) // no slash: any depth
  assert.equal(included(r, '.env.local'), true)
  assert.equal(included(r, 'config/secrets.json'), true)
  assert.equal(included(r, 'other/config/secrets.json'), false) // anchored to the root
  assert.equal(included(r, '.envrc'), false)
})

test('.worktreeinclude: a later ! pattern takes a file out, a folder pattern takes everything in it', () => {
  const r = parseInclude('.env*\n!.env.example\ncerts/\n!certs/old.pem')
  assert.equal(included(r, '.env.local'), true)
  assert.equal(included(r, '.env.example'), false)
  assert.equal(included(r, 'certs/a.pem'), true)
  assert.equal(included(r, 'certs/deep/b.pem'), true)
  assert.equal(included(r, 'certs/old.pem'), false)
  assert.equal(included(r, 'certs'), false) // a folder-only pattern does not match a file of that name
  assert.equal(included(parseInclude('*.json\n!config/'), 'config/a.json'), false)
})

test('.worktreeinclude: ** patterns', () => {
  const r = parseInclude('vendor/**/config.json\n/local/**')
  assert.equal(included(r, 'vendor/config.json'), true)
  assert.equal(included(r, 'vendor/a/b/config.json'), true)
  assert.equal(included(r, 'local/x/y.txt'), true)
  assert.equal(included(r, 'src/local/x.txt'), false)
})

test('.worktreeinclude: nothing matched when the file is empty or only comments', () => {
  for (const text of ['', '# nothing\n\n']) {
    const r = parseInclude(text)
    assert.equal(r.length, 0)
    assert.equal(included(r, '.env'), false)
    assert.equal(mayReach(r, 'node_modules'), false)
  }
})

test('mayReach: walks into an ignored folder only when a pattern can match inside it', () => {
  const r = parseInclude('.env\nvendor/**/config.json\n**/.claude/skills/*.md\nsecrets/')
  assert.equal(mayReach(r, 'node_modules'), false) // ".env" is **/.env and node_modules is not named .env
  assert.equal(mayReach(r, 'vendor'), true)
  assert.equal(mayReach(r, 'vendor/pkg'), true)
  assert.equal(mayReach(r, 'other'), false)
  assert.equal(mayReach(r, '.claude'), true)
  assert.equal(mayReach(r, 'secrets'), true)
  assert.equal(mayReach(r, 'secrets/sub'), true)
  assert.equal(mayReach(parseInclude('config/secrets.json'), 'config'), true)
  assert.equal(mayReach(parseInclude('config/secrets.json'), 'build'), false)
})
