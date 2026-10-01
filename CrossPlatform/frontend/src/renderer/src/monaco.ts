import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/languages/definitions/csharp/register'
import 'monaco-editor/languages/definitions/vb/register'
import 'monaco-editor/languages/definitions/xml/register'
import { ilLanguage, ilLanguageConfiguration, ilThemeRules } from './il-language'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

if (!monaco.languages.getLanguages().some((language) => language.id === 'il'))
  monaco.languages.register({ id: 'il', extensions: ['.il'], aliases: ['IL', 'MSIL', 'CIL'] })
monaco.languages.setMonarchTokensProvider('il', ilLanguage)
monaco.languages.setLanguageConfiguration('il', ilLanguageConfiguration)
monaco.editor.defineTheme('dnspy-light', { base: 'vs', inherit: true, rules: ilThemeRules.light, colors: {} })
monaco.editor.defineTheme('dnspy-dark', { base: 'vs-dark', inherit: true, rules: ilThemeRules.dark, colors: {} })
monaco.editor.defineTheme('dnspy-high-contrast', { base: 'hc-black', inherit: true, rules: ilThemeRules.highContrast, colors: {} })

loader.config({ monaco })
