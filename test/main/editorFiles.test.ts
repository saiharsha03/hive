import { test } from 'vitest'
import assert from 'node:assert/strict'
import { vsCodeUrl } from '../../src/main/editorFiles'
import { langOf, languageIdOf, monacoLanguageOf } from '../../src/shared/editorCore'

test('Open in VS Code is a vscode:// link: no shell, odd characters escaped', () => {
  assert.equal(vsCodeUrl('C:\\Users\\me\\My Repos\\api\\views.py', 12), 'vscode://file/C:/Users/me/My%20Repos/api/views.py:12')
  assert.equal(vsCodeUrl('C:\\a&b\\x#1?.py', 0), 'vscode://file/C:/a&b/x%231%3F.py:1')
})

test('which language server and colours a file gets', () => {
  assert.deepEqual(['a.py', 'b.tsx', 'c.vue', 'd.json'].map(langOf), ['python', 'typescript', 'vue', null])
  assert.deepEqual(['b.tsx', 'c.mjs', 'd.ts'].map(languageIdOf), ['typescriptreact', 'javascript', 'typescript'])
  assert.deepEqual(['c.vue', 'Dockerfile', 'x.unknown'].map(monacoLanguageOf), ['html', 'dockerfile', 'plaintext'])
})
