// Monaco (the editor inside VS Code), set up once: its workers, and TS/JS left to the language server. Monaco's own
// TypeScript service sees one file at a time, so its errors would be wrong across imports; it keeps the colours only.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

;(self as any).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

const off = {
  completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false, documentHighlights: false,
  rename: false, diagnostics: false, documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false,
  codeActions: false, inlayHints: false,
}
for (const d of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  d.setModeConfiguration(off)
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })
}

export { monaco }
