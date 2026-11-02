// Monaco <-> the language servers in the main process (Pyright, TypeScript, Vue): open files are synced, Monaco's
// completion, hover, definition, references, rename and signature help ask the server, and the server's
// diagnostics become the squiggles. Positions: LSP counts lines and characters from 0, Monaco from 1.
import { monaco } from './monacoSetup'
import { langOf } from '../../shared/editorCore'

type M = monaco.editor.ITextModel
type L = { line: number; character: number }
type R = { start: L; end: L }

const fileOf = (m: M): string | null => (m.uri.scheme === 'file' ? m.uri.fsPath : null)
const served = (m: M) => { const f = fileOf(m); return f && langOf(f) ? f : null }
const pos = (p: monaco.Position): L => ({ line: p.lineNumber - 1, character: p.column - 1 })
const range = (r: R): monaco.IRange => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 })
const at = (m: M, p: monaco.Position) => ({ textDocument: { uri: m.uri.toString(true) }, position: pos(p) })
const markdown = (c: any): monaco.IMarkdownString[] => {
  if (!c) return []
  if (Array.isArray(c)) return c.flatMap(markdown)
  if (typeof c === 'string') return [{ value: c }]
  if (c.kind) return [{ value: c.value }]
  if (c.language) return [{ value: `\`\`\`${c.language}\n${c.value}\n\`\`\`` }]
  return []
}
const ask = async (m: M, method: string, params: unknown): Promise<any> => {
  const f = served(m)
  if (!f) return null
  try { return await window.api.lspRequest(f, method, params) } catch { return null }
}

// LSP CompletionItemKind (1-25) -> Monaco's
const K = monaco.languages.CompletionItemKind
const KIND = [K.Text, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit,
  K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter]

// ---- document sync ----
const versions = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

// a model the editor opened: tell its server, and keep it posted while it is edited
export function attach(m: M): monaco.IDisposable {
  const f = served(m)
  if (!f) return { dispose() {} }
  versions.set(f, 1)
  void window.api.lspOpen(f, m.getValue())
  const sub = m.onDidChangeContent(() => {
    clearTimeout(timers.get(f))
    timers.set(f, setTimeout(() => {
      const v = (versions.get(f) ?? 1) + 1
      versions.set(f, v)
      void window.api.lspChange(f, m.getValue(), v)
    }, 250))
  })
  return { dispose() { sub.dispose(); clearTimeout(timers.get(f)); versions.delete(f); void window.api.lspClose(f) } }
}
export const saved = (m: M) => { const f = served(m); if (f) void window.api.lspSaved(f) }

// opens a file into a model (the editor sets it): a rename can edit files that are not open yet
let ensureModel: (path: string) => Promise<void> = async () => {}
export const setEnsureModel = (f: (path: string) => Promise<void>) => { ensureModel = f }

// ---- features (registered once; each asks the server of the model's file) ----
let registered = false
export function registerLanguageFeatures(openLocation: (file: string, line: number, column: number) => void): void {
  if (registered) return
  registered = true
  const langs = ['python', 'typescript', 'javascript', 'html'] // .vue files are coloured as html

  window.api.onLspDiagnostics(({ uri, diagnostics }) => {
    const m = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (!m) return
    const sev = (s?: number) => (s === 1 ? monaco.MarkerSeverity.Error : s === 2 ? monaco.MarkerSeverity.Warning : s === 3 ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Hint)
    monaco.editor.setModelMarkers(m, 'lsp', diagnostics.map((d: any) => ({ ...range(d.range), severity: sev(d.severity), message: d.message, source: d.source, code: d.code ? String(d.code) : undefined })))
  })

  for (const lang of langs) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '(', ','],
      async provideCompletionItems(m, p) {
        const r = await ask(m, 'textDocument/completion', { ...at(m, p), context: { triggerKind: 1 } })
        if (!r) return { suggestions: [] }
        const items: any[] = Array.isArray(r) ? r : r.items ?? []
        const word = m.getWordUntilPosition(p)
        const fallback = { startLineNumber: p.lineNumber, endLineNumber: p.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
        return {
          incomplete: !Array.isArray(r) && !!r.isIncomplete,
          suggestions: items.map((i) => {
            const edit = i.textEdit
            return {
              label: i.label, kind: KIND[i.kind ?? 1] ?? K.Text, detail: i.detail, sortText: i.sortText, filterText: i.filterText, preselect: i.preselect,
              documentation: markdown(i.documentation)[0],
              insertText: edit?.newText ?? i.insertText ?? i.label,
              insertTextRules: i.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: edit ? range(edit.range ?? edit.replace) : fallback,
              additionalTextEdits: i.additionalTextEdits?.map((e: any) => ({ range: range(e.range), text: e.newText })),
            }
          }),
        }
      },
    })
    monaco.languages.registerHoverProvider(lang, {
      async provideHover(m, p) {
        const r = await ask(m, 'textDocument/hover', at(m, p))
        return r ? { contents: markdown(r.contents), range: r.range ? range(r.range) : undefined } : null
      },
    })
    monaco.languages.registerDefinitionProvider(lang, {
      async provideDefinition(m, p) {
        const r = await ask(m, 'textDocument/definition', at(m, p))
        const all: any[] = !r ? [] : Array.isArray(r) ? r : [r]
        return all.map((d) => ({ uri: monaco.Uri.parse(d.uri ?? d.targetUri), range: range(d.range ?? d.targetSelectionRange ?? d.targetRange) }))
      },
    })
    monaco.languages.registerReferenceProvider(lang, {
      async provideReferences(m, p) {
        const r = await ask(m, 'textDocument/references', { ...at(m, p), context: { includeDeclaration: true } })
        return (r ?? []).map((d: any) => ({ uri: monaco.Uri.parse(d.uri), range: range(d.range) }))
      },
    })
    monaco.languages.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ['(', ','],
      async provideSignatureHelp(m, p) {
        const r = await ask(m, 'textDocument/signatureHelp', at(m, p))
        if (!r?.signatures?.length) return null
        return {
          value: {
            activeSignature: r.activeSignature ?? 0, activeParameter: r.activeParameter ?? 0,
            signatures: r.signatures.map((s: any) => ({ label: s.label, documentation: markdown(s.documentation)[0], parameters: (s.parameters ?? []).map((x: any) => ({ label: x.label, documentation: markdown(x.documentation)[0] })) })),
          },
          dispose() {},
        }
      },
    })
    monaco.languages.registerRenameProvider(lang, {
      async provideRenameEdits(m, p, newName) {
        const r = await ask(m, 'textDocument/rename', { ...at(m, p), newName })
        if (!r) return { edits: [] }
        // Monaco applies edits only to open models: files the rename touches are opened first
        const uris = [...Object.keys(r.changes ?? {}), ...(r.documentChanges ?? []).map((dc: any) => dc.textDocument?.uri).filter(Boolean)]
        for (const u of uris) { const uri = monaco.Uri.parse(u); if (!monaco.editor.getModel(uri)) await ensureModel(uri.fsPath) }
        const edits: monaco.languages.IWorkspaceTextEdit[] = []
        const add = (uri: string, list: any[]) => { for (const e of list) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { range: range(e.range), text: e.newText }, versionId: undefined }) }
        for (const [uri, list] of Object.entries(r.changes ?? {})) add(uri, list as any[])
        for (const dc of r.documentChanges ?? []) if (dc.textDocument) add(dc.textDocument.uri, dc.edits)
        return { edits }
      },
    })
  }

  // go-to-definition into a file that is not open: open it in a tab at that place
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selection) {
      if (resource.scheme !== 'file') return false
      const s = selection && 'startLineNumber' in selection ? selection : selection ? { startLineNumber: selection.lineNumber, startColumn: selection.column } : null
      openLocation(resource.fsPath, s?.startLineNumber ?? 1, s?.startColumn ?? 1)
      return true
    },
  })
}
