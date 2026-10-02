import Editor from '@monaco-editor/react'
import '../monaco'
import { useEffect, useRef } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { editor as MonacoEditor } from 'monaco-editor'
import type { CodeStatement, DecompilerLanguage } from '../../../shared/protocol'
import { codeStatementAt, lineBreakpointMarkers, methodBreakpointName, useAppStore } from '../app-store'
import type { LineBreakpoint } from '../app-store'
import { useLanguage } from '../localization'

// One decoration per breakpoint that has a line in this document. A disabled breakpoint keeps its dot but draws it
// hollow; one the engine has not bound (module not loaded yet, or no sequence point at that offset) draws it grey.
const breakpointDecorations = (
  nodeId: string,
  statements: CodeStatement[] | undefined,
  breakpoints: LineBreakpoint[],
  translate: (message: string) => string,
): MonacoEditor.IModelDeltaDecoration[] =>
  lineBreakpointMarkers(nodeId, statements, breakpoints).map((marker) => ({
    range: { startLineNumber: marker.line, startColumn: 1, endLineNumber: marker.line, endColumn: 1 },
    options: {
      glyphMarginClassName: !marker.enabled ? 'breakpoint-glyph-disabled' : marker.state === 'unbound' ? 'breakpoint-glyph-unbound' : 'breakpoint-glyph',
      hoverMessage: {
        value: [
          marker.description ?? '',
          marker.enabled ? translate('Enabled') : translate('Disabled'),
          marker.state === 'bound' ? '' : marker.message ?? (marker.state === 'pending' ? translate('Module not loaded yet.') : ''),
        ].filter(Boolean).join('\n'),
      },
    },
  }))

export const DocumentView = ({ documentId, viewId, theme, onNavigate }: { documentId: string; viewId: string; theme: string; onNavigate(targetNodeId: string): void }): React.JSX.Element => {
  const wordWrap = useAppStore((state) => state.wordWrap)
  const highlightCurrentLine = useAppStore((state) => state.highlightCurrentLine)
  const document = useAppStore((state) => state.documents[documentId])
  const changeLanguage = useAppStore((state) => state.changeDocumentLanguage)
  const lineBreakpoints = useAppStore((state) => state.lineBreakpoints)
  const toggleLineBreakpoint = useAppStore((state) => state.toggleLineBreakpoint)
  const toggleFunctionBreakpoint = useAppStore((state) => state.toggleFunctionBreakpoint)
  const stoppedLocation = useAppStore((state) => state.stoppedLocation)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | undefined>(undefined)
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | undefined>(undefined)
  const breakpointDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | undefined>(undefined)
  const stoppedDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | undefined>(undefined)
  // onMount registers the mouse handler once, so it reads the current values through refs instead of the closure.
  const spansRef = useRef(document?.spans ?? [])
  const statementsRef = useRef(document?.codeStatements)
  const breakpointsRef = useRef(lineBreakpoints)
  const toggleLineBreakpointRef = useRef(toggleLineBreakpoint)
  const toggleFunctionBreakpointRef = useRef(toggleFunctionBreakpoint)
  const { locale, t } = useLanguage()
  const tRef = useRef(t)
  tRef.current = t
  spansRef.current = document?.spans ?? []
  statementsRef.current = document?.codeStatements
  breakpointsRef.current = lineBreakpoints
  toggleLineBreakpointRef.current = toggleLineBreakpoint
  toggleFunctionBreakpointRef.current = toggleFunctionBreakpoint

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

  useEffect(() => {
    breakpointDecorationsRef.current?.set(breakpointDecorations(documentId, document?.codeStatements, lineBreakpoints, t))
  }, [documentId, lineBreakpoints, document?.codeStatements, document?.text, locale])

  // The line the selected frame is stopped at, in the document that frame decompiles to. Stepping moves it one
  // statement at a time, so the view follows it — otherwise the marker would advance off-screen and the step
  // would look like nothing happened.
  useEffect(() => {
    const line = stoppedLocation?.nodeId === documentId ? stoppedLocation.line : 0
    stoppedDecorationsRef.current?.set(line > 0
      ? [{
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: {
            isWholeLine: true,
            className: 'debug-stopped-line',
            glyphMarginClassName: 'debug-stopped-glyph',
            hoverMessage: { value: `${t('Stopped here')}: ${stoppedLocation?.name ?? ''}` },
          },
        }]
      : [])
    if (line > 0)
      editorRef.current?.revealLineInCenterIfOutsideViewport(line)
  }, [documentId, stoppedLocation, document?.text, locale])

  if (!document)
    return <div className="pane-empty">{t('Document closed')}</div>

  const editorLanguage = document.language === 'visual-basic'
    ? 'vb'
    : document.language === 'il'
      ? 'il'
      : document.language === 'plaintext'
        ? 'plaintext'
        : document.language === 'xml'
          ? 'xml'
          : 'csharp'
  const editorTheme = theme === 'light' ? 'dnspy-light' : theme === 'hc' ? 'dnspy-high-contrast' : 'dnspy-dark'

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
            <option value="ilWithCSharp">IL with C#</option>
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
            path={`${viewId}.${editorLanguage}`}
            value={document.text}
            language={editorLanguage}
            theme={editorTheme}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              const updateLanguageId = (): void => {
                const languageId = editor.getModel()?.getLanguageId()
                if (languageId)
                  editor.getDomNode()?.setAttribute('data-language-id', languageId)
              }
              updateLanguageId()
              editor.onDidChangeModel(updateLanguageId)
              decorationsRef.current = editor.createDecorationsCollection()
              breakpointDecorationsRef.current = editor.createDecorationsCollection()
              breakpointDecorationsRef.current.set(breakpointDecorations(documentId, statementsRef.current, breakpointsRef.current, tRef.current))
              stoppedDecorationsRef.current = editor.createDecorationsCollection()
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
              // F9 in the editor sets a line breakpoint at the cursor; the window-level handler in App.tsx only sees
              // F9 when the focus is outside the editor, so the two never both fire.
              editor.addCommand(monaco.KeyCode.F9, () => {
                const position = editor.getPosition()
                if (position)
                  void toggleLineBreakpointRef.current(documentId, position.lineNumber, position.column)
              })
              // Method breakpoints are demoted to the context menu now that a plain gutter click sets a line
              // breakpoint: this is the way left to say "break wherever this method starts".
              let contextMenuLine = 0
              editor.onContextMenu((event) => {
                contextMenuLine = event.target.position?.lineNumber ?? 0
              })
              editor.addAction({
                id: 'dnspy.toggleMethodBreakpoint',
                label: tRef.current('Toggle Method Breakpoint'),
                contextMenuGroupId: 'dnspy-breakpoints',
                contextMenuOrder: 1,
                run: () => {
                  if (contextMenuLine <= 0) return
                  const name = methodBreakpointName(codeStatementAt(statementsRef.current, contextMenuLine)?.description)
                  if (name)
                    void toggleFunctionBreakpointRef.current(name)
                },
              })
              editor.onMouseDown((event) => {
                // A click in the margin next to the line numbers toggles a breakpoint on that line. The click does not
                // have to land on a statement — the store snaps it to the nearest one the engine can bind.
                if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                  void toggleLineBreakpointRef.current(documentId, event.target.position?.lineNumber ?? 0)
                  return
                }
                if (event.event.ctrlKey && event.target.position) {
                  editor.setPosition(event.target.position)
                  navigateAtCursor()
                }
              })
            }}
            options={{
              readOnly: true,
              automaticLayout: true,
              glyphMargin: true,
              wordWrap: wordWrap ? 'on' : 'off',
              renderLineHighlight: highlightCurrentLine ? 'all' : 'none',
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
