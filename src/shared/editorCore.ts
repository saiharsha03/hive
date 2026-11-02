// The editor, the pure part: which language a file is, for the language servers and for Monaco's colours.
export type Lang = 'python' | 'typescript' | 'vue'

const ext = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase()

// the language server a file goes to (null: colours only, no server)
export function langOf(file: string): Lang | null {
  const e = ext(file)
  if (e === 'py' || e === 'pyi') return 'python'
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(e)) return 'typescript'
  if (e === 'vue') return 'vue'
  return null
}

// the LSP languageId of a file
export function languageIdOf(file: string): string {
  const e = ext(file)
  if (e === 'tsx') return 'typescriptreact'
  if (e === 'jsx') return 'javascriptreact'
  if (['js', 'mjs', 'cjs'].includes(e)) return 'javascript'
  if (['ts', 'mts', 'cts'].includes(e)) return 'typescript'
  return langOf(file) ?? 'plaintext'
}

const MONACO: Record<string, string> = {
  py: 'python', pyi: 'python', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', vue: 'html', json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html',
  htm: 'html', yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'shell', ps1: 'powershell', toml: 'ini', ini: 'ini', cfg: 'ini', xml: 'xml',
  svg: 'xml', dockerfile: 'dockerfile', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', rb: 'ruby', php: 'php', cs: 'csharp', txt: 'plaintext',
}
// Monaco's colouring language for a file (Vue uses HTML colouring; the Vue server does the rest)
export function monacoLanguageOf(file: string): string {
  const name = file.split(/[\\/]/).pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  return MONACO[ext(file)] ?? 'plaintext'
}
