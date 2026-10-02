import type { editor as MonacoEditor } from 'monaco-editor'

// Keyed by tab id (`viewId`), not documentId: cloned tabs share one documentId, so a documentId map
// would keep only whichever clone mounted last.
const editors = new Map<string, MonacoEditor.IStandaloneCodeEditor>()
const pendingFocus = new Set<string>()

export const registerDocumentEditor = (viewId: string, editor: MonacoEditor.IStandaloneCodeEditor): void => {
  editors.set(viewId, editor)
  // Switching a document's language unmounts the editor and mounts a fresh one, so a focus request
  // that arrives mid-switch has to wait for the new editor to register.
  if (pendingFocus.delete(viewId))
    editor.focus()
}

export const unregisterDocumentEditor = (viewId: string): void => {
  editors.delete(viewId)
}

/** Focus the editor of `viewId`, or the one that replaces it if it is mid-remount. */
export const focusDocumentEditor = (viewId: string): void => {
  const editor = editors.get(viewId)
  if (editor) {
    editor.focus()
    return
  }
  pendingFocus.add(viewId)
}
