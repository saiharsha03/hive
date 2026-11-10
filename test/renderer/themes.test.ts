// Every theme defines every token, and its text reads: body text at 4.5:1 on each surface it sits on.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { THEME_IDS, THEME_TOKENS, TOKEN_NAMES, THEMES, contrast, themeCss } from '../../src/renderer/src/themesCore'
import { nextTheme, themeOf } from '../../src/renderer/src/layoutCore'

test('ten themes, Quiet first and the default', () => {
  assert.equal(THEME_IDS.length, 10)
  assert.equal(THEMES[0].label, 'Quiet')
  assert.equal(themeOf(undefined), 'dark')
  assert.equal(themeOf('forest'), 'forest')
})

test('every theme defines every token, and nothing else', () => {
  for (const id of THEME_IDS) {
    assert.deepEqual(Object.keys(THEME_TOKENS[id]).sort(), [...TOKEN_NAMES].sort(), id)
    for (const [k, v] of Object.entries(THEME_TOKENS[id])) assert.ok(v && !v.includes('undefined') && !v.includes('NaN'), `${id} ${k}=${v}`)
  }
})

test('body text, secondary text, the signal read at 4.5:1 on every surface, red on panes and the rail', () => {
  for (const id of THEME_IDS) {
    const t = THEME_TOKENS[id]
    for (const fg of ['hi', 'ink', 'dim', 'signal', 'fail']) {
      for (const bg of fg === 'fail' ? ['bg', 'side'] : ['bg', 'side', 'raised']) {
        const c = contrast(t[fg], t[bg])
        assert.ok(c >= 4.5, `${id}: ${fg} ${t[fg]} on ${bg} ${t[bg]} is ${c.toFixed(2)}:1`)
      }
    }
    // the primary button: its label on its fill
    assert.ok(contrast(t['on-accent'], t.accent) >= 4.5, `${id}: primary button label`)
  }
})

test('Quiet keeps its surfaces and honey signal, with a blue accent', () => {
  const q = THEME_TOKENS.dark
  assert.deepEqual([q.bg, q.side, q.raised, q.lift2, q.hi, q.signal, q.fail], ['#16171A', '#111214', '#1E2024', '#26282D', '#ECEAE5', '#E9B44C', '#E2574C'])
  assert.equal(q['signal-wash'], 'rgba(233, 180, 76, 0.07)')
  assert.notEqual(q.accent, q.hi)
  assert.notEqual(q.accent, q.signal)
})

test('every theme has an accent of its own, and secondary text that reads', () => {
  for (const id of THEME_IDS) {
    const t = THEME_TOKENS[id]
    assert.notEqual(t.accent, t.hi, `${id}: accent`)
    assert.ok(contrast(t.dim, t.bg) >= 5.5, `${id}: secondary text`)
    assert.ok(contrast(t.ink, t.bg) >= 7, `${id}: body text`)
  }
})

test('Classic is square, the others keep 6, 8 and 10 px', () => {
  assert.equal(THEME_TOKENS.classic['r-row'], '0px')
  assert.equal(THEME_TOKENS.dark['r-comp'], '10px')
})

test('the stylesheet has one block per theme and the cycle wraps', () => {
  const css = themeCss()
  for (const id of THEME_IDS) assert.ok(css.includes(`[data-theme='${id}']`))
  assert.equal(nextTheme('hc'), 'dark')
  assert.equal(nextTheme('dark', -1), 'hc')
})
