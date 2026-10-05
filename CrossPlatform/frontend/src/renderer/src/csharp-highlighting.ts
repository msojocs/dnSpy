import csharp from '@shikijs/langs/csharp'
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco'
import darkPlus from '@shikijs/themes/dark-plus'
import highContrast from '@shikijs/themes/github-dark-high-contrast'
import lightPlus from '@shikijs/themes/light-plus'
import type * as Monaco from 'monaco-editor/editor/editor.api'
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { ilThemeRules } from './il-language'

const themes = [
  { ...lightPlus, name: 'dnspy-light' },
  { ...darkPlus, name: 'dnspy-dark' },
  {
    ...highContrast,
    name: 'dnspy-high-contrast',
    colors: { ...highContrast.colors, 'editor.background': '#000000', 'editor.foreground': '#FFFFFF' },
  },
]

export async function installCSharpHighlighting(monaco: typeof Monaco) {
  // Import only C# and our three themes. The embedded WASM also works offline in Electron.
  const highlighter = await createHighlighterCore({
    langs: [csharp],
    themes,
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })

  // The adapter only uses editor/languages; the full API type also includes unused LSP namespaces.
  shikiToMonaco(highlighter, monaco as Parameters<typeof shikiToMonaco>[1], {
    tokenizeMaxLineLength: 20000,
    tokenizeTimeLimit: 100,
  })
  const variants = [
    { name: 'dnspy-light', base: 'vs', rules: ilThemeRules.light },
    { name: 'dnspy-dark', base: 'vs-dark', rules: ilThemeRules.dark },
    { name: 'dnspy-high-contrast', base: 'hc-black', rules: ilThemeRules.highContrast },
  ] as const
  for (const variant of variants) {
    const theme = textmateThemeToMonacoTheme(highlighter.getTheme(variant.name))
    monaco.editor.defineTheme(variant.name, {
      ...theme,
      base: variant.base,
      inherit: true,
      rules: [...theme.rules, ...variant.rules],
    })
  }
  return highlighter
}
