import Editor from '@monaco-editor/react'
import '../monaco'
import { useEffect, useRef } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { editor as MonacoEditor } from 'monaco-editor'
import type { DecompilerLanguage } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { useLanguage } from '../localization'

export const DocumentView = ({ documentId, theme, onNavigate }: { documentId: string; theme: string; onNavigate(targetNodeId: string): void }): React.JSX.Element => {
  const document = useAppStore((state) => state.documents[documentId])
  const changeLanguage = useAppStore((state) => state.changeDocumentLanguage)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | undefined>(undefined)
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | undefined>(undefined)
  const spansRef = useRef(document?.spans ?? [])
  const { locale, t } = useLanguage()
  spansRef.current = document?.spans ?? []

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || !decorationsRef.current) return
    decorationsRef.current.set(spansRef.current.filter((span) => span.targetNodeId).map((span) => {
      const start = model.getPositionAt(span.start)
      const end = model.getPositionAt(span.start + span.length)
      return {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        options: {
          inlineClassName: span.kind === 'definition' ? 'code-definition' : 'code-reference',
          hoverMessage: { value: span.kind === 'definition' ? t('Definition') : t('Go to definition (F12)') },
        },
      }
    }))
  }, [document?.spans, document?.text, locale])

  if (!document)
    return <div className="pane-empty">{t('Document closed')}</div>

  const editorLanguage = document.language === 'visual-basic'
    ? 'vb'
    : document.language === 'il' || document.language === 'plaintext'
      ? 'plaintext'
      : document.language === 'xml'
        ? 'xml'
        : 'csharp'
  const editorTheme = theme === 'light' ? 'vs' : theme === 'hc' ? 'hc-black' : 'vs-dark'

  return (
    <div className="document-view" data-reference-count={document.spans.filter((span) => span.targetNodeId).length}>
      <div className="document-toolbar">
        {['csharp', 'visual-basic', 'il'].includes(document.language) ? (
          <select
            aria-label={t('Decompiler language')}
            value={document.requestedLanguage}
            onChange={(event) => void changeLanguage(document.nodeId, event.target.value as DecompilerLanguage)}
          >
            <option value="cSharp">C#</option>
            <option value="visualBasic">Visual Basic</option>
            <option value="il">IL</option>
          </select>
        ) : <span className="document-language-label">{document.language === 'xml' ? 'XAML/XML' : document.language}</span>}
        {document.diagnostics.length > 0 && (
          <span className="document-diagnostic" title={document.diagnostics.map((diagnostic) => diagnostic.message).join('\n')}>
            <AlertTriangle size={14} /> {document.diagnostics.length}
          </span>
        )}
      </div>
      <div className="editor-host">
        {document.loading ? (
          <div className="loading-state"><LoaderCircle className="spin" size={18} /> {t('Loading')}</div>
        ) : (
          <Editor
            path={`${document.nodeId}.${editorLanguage}`}
            value={document.text}
            language={editorLanguage}
            theme={editorTheme}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              decorationsRef.current = editor.createDecorationsCollection()
              const model = editor.getModel()
              if (!model) return
              decorationsRef.current.set(spansRef.current.filter((span) => span.targetNodeId).map((span) => {
                const start = model.getPositionAt(span.start)
                const end = model.getPositionAt(span.start + span.length)
                return {
                  range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                  options: {
                    inlineClassName: span.kind === 'definition' ? 'code-definition' : 'code-reference',
                    hoverMessage: { value: span.kind === 'definition' ? t('Definition') : t('Go to definition (F12)') },
                  },
                }
              }))
              const navigateAtCursor = (): void => {
                const position = editor.getPosition()
                if (!position) return
                const offset = model.getOffsetAt(position)
                const span = spansRef.current.find((candidate) => candidate.targetNodeId && offset >= candidate.start && offset <= candidate.start + candidate.length)
                if (span?.targetNodeId) onNavigate(span.targetNodeId)
              }
              editor.addCommand(monaco.KeyCode.F12, navigateAtCursor)
              editor.onMouseDown((event) => {
                if (event.event.ctrlKey && event.target.position) {
                  editor.setPosition(event.target.position)
                  navigateAtCursor()
                }
              })
            }}
            options={{
              readOnly: true,
              automaticLayout: true,
              fontFamily: "'Cascadia Mono', 'JetBrains Mono', monospace",
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              smoothScrolling: true,
              tabSize: 4,
              padding: { top: 8, bottom: 8 },
            }}
          />
        )}
      </div>
    </div>
  )
}
