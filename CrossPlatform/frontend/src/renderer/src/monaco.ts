import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/languages/definitions/csharp/register'
import 'monaco-editor/languages/definitions/vb/register'
import 'monaco-editor/languages/definitions/xml/register'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

loader.config({ monaco })
