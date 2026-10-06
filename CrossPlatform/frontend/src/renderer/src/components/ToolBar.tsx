import {
  ArrowLeft,
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  FolderOpen,
  LocateFixed,
  Pause,
  Play,
  Redo2,
  Save,
  Search,
  Square,
  StepForward,
  Undo2,
} from 'lucide-react'
import { useLanguage } from '../localization'
import type { DecompilerLanguage } from '../../../shared/protocol'

interface ToolBarProps {
  hasWorkspace: boolean
  busy: boolean
  onOpen(): void
  onSave(): void
  onSearch(): void
  canGoBack: boolean
  canGoForward: boolean
  onBack(): void
  onForward(): void
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  decompilerLanguage?: DecompilerLanguage
  onLanguageChange(language: DecompilerLanguage): void
  debugAvailable: boolean
  debugState: 'inactive' | 'starting' | 'running' | 'stopped'
  onStart(): void
  onContinue(): void
  onPause(): void
  onShowNextStatement(): void
  onStepInto(): void
  onStepOver(): void
  onStepOut(): void
  onStop(): void
}

const ToolButton = ({ label, disabled, onClick, children }: React.PropsWithChildren<{ label: string; disabled?: boolean; onClick?: () => void }>): React.JSX.Element => (
  <button className="icon-button toolbar-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
)

export const ToolBar = ({ hasWorkspace, busy, onOpen, onSave, onSearch, canGoBack, canGoForward, onBack, onForward, canUndo, canRedo, onUndo, onRedo, decompilerLanguage, onLanguageChange, debugAvailable, debugState, onStart, onContinue, onPause, onShowNextStatement, onStepInto, onStepOver, onStepOut, onStop }: ToolBarProps): React.JSX.Element => {
  const { t } = useLanguage()
  const debugging = debugState !== 'inactive'
  return (
    <div className="tool-bar" role="toolbar" aria-label={t('Main toolbar')}>
      <ToolButton label={t('Open Assembly')} onClick={onOpen}><FolderOpen size={16} /></ToolButton>
      <ToolButton label={t('Save As')} disabled={!hasWorkspace} onClick={onSave}><Save size={16} /></ToolButton>
      <span className="toolbar-separator" />
      <ToolButton label={t('Back')} disabled={!canGoBack} onClick={onBack}><ArrowLeft size={16} /></ToolButton>
      <ToolButton label={t('Forward')} disabled={!canGoForward} onClick={onForward}><ArrowRight size={16} /></ToolButton>
      <span className="toolbar-separator" />
      {decompilerLanguage && <select className="toolbar-language-select" aria-label={t('Decompiler language')} value={decompilerLanguage} onChange={(event) => onLanguageChange(event.target.value as DecompilerLanguage)}>
        <option value="cSharp">C#</option>
        <option value="visualBasic">Visual Basic</option>
        <option value="il">IL</option>
        <option value="ilWithCSharp">IL with C#</option>
      </select>}
      <ToolButton label={t('Undo')} disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></ToolButton>
      <ToolButton label={t('Redo')} disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></ToolButton>
      <span className="toolbar-separator" />
      <ToolButton label={debugState === 'stopped' ? t('Continue') : t('Debug a Program')} disabled={!debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped')} onClick={debugState === 'stopped' ? onContinue : onStart}><Play size={16} /></ToolButton>
      {debugging && <>
        <ToolButton label={t('Pause')} disabled={debugState !== 'running'} onClick={onPause}><Pause size={16} /></ToolButton>
        <ToolButton label={t('Show Next Statement')} disabled={debugState !== 'stopped'} onClick={onShowNextStatement}><LocateFixed size={16} /></ToolButton>
        <ToolButton label={t('Step Into')} disabled={debugState !== 'stopped'} onClick={onStepInto}><ArrowDownToLine size={16} /></ToolButton>
        <ToolButton label={t('Step Over')} disabled={debugState !== 'stopped'} onClick={onStepOver}><StepForward size={16} /></ToolButton>
        <ToolButton label={t('Step Out')} disabled={debugState !== 'stopped'} onClick={onStepOut}><ArrowUpFromLine size={16} /></ToolButton>
        <ToolButton label={t('Stop')} disabled={debugState === 'starting'} onClick={onStop}><Square size={15} /></ToolButton>
      </>}
      <span className="toolbar-separator" />
      <ToolButton label={t('Search')} disabled={!hasWorkspace} onClick={onSearch}><Search size={16} /></ToolButton>
      <span className="toolbar-spacer" />
      {busy && <span className="toolbar-busy">{t('Working')}</span>}
    </div>
  )
}
