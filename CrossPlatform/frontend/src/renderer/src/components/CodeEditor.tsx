import { lazy, Suspense } from 'react'
import MonacoEditor, { type EditorProps } from '@monaco-editor/react'
import { initializeMonaco } from '../monaco'
import { useLanguage } from '../localization'

// Wait for token providers before creating a model, including when several panes open at once.
const Editor = lazy(async () => {
  await initializeMonaco()
  return { default: MonacoEditor }
})

export default function CodeEditor(props: EditorProps): React.JSX.Element {
  const { t } = useLanguage()
  const loading = <div className="loading-state">{t('Loading')}</div>
  return <Suspense fallback={loading}><Editor loading={loading} {...props} /></Suspense>
}
