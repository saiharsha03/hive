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

test('the editor refuses network paths, like Preview', async () => {
  const { editorRead, editorWrite } = await import('../../src/main/editorFiles')
  await assert.rejects(editorRead('\\\\server\\share\\x.py'), /local drive/)
  await assert.rejects(editorWrite('//server/share/x.py', 'x'), /local drive/)
})

// a drive-letter path is the only kind the editor saves to (isLocalPath), so this runs on Windows
test.skipIf(process.platform !== 'win32')('a save with the mtime the editor saw writes; another mtime refuses; null skips the check', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, utimesSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { editorMtime, editorWrite, CHANGED_ON_DISK } = await import('../../src/main/editorFiles')
  const f = join(mkdtempSync(join(tmpdir(), 'hive-editor-')), 'a.txt')
  writeFileSync(f, 'one')
  const seen = (await editorMtime(f))!
  const after = await editorWrite(f, 'two', seen)
  assert.equal(readFileSync(f, 'utf8'), 'two')
  assert.equal(typeof after, 'number')
  utimesSync(f, new Date(), new Date(Date.now() + 60_000)) // something else changed it since
  await assert.rejects(editorWrite(f, 'three', after), new RegExp(CHANGED_ON_DISK))
  assert.equal(readFileSync(f, 'utf8'), 'two') // nothing written
  await editorWrite(f, 'four', null) // the user chose to overwrite
  assert.equal(readFileSync(f, 'utf8'), 'four')
})
