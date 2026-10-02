import {
  ArrowLeft,
  ArrowRight,
  Bug,
  FolderOpen,
  Pause,
  Play,
  Save,
  Search,
  Square,
  StepForward,
} from 'lucide-react'
import { useLanguage } from '../localization'

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
  debugAvailable: boolean
  debugState: 'inactive' | 'starting' | 'running' | 'stopped'
  onStart(): void
  onContinue(): void
  onPause(): void
  onStep(): void
  onStop(): void
}

const ToolButton = ({ label, disabled, onClick, children }: React.PropsWithChildren<{ label: string; disabled?: boolean; onClick?: () => void }>): React.JSX.Element => (
  <button className="icon-button toolbar-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
)

export const ToolBar = ({ hasWorkspace, busy, onOpen, onSave, onSearch, canGoBack, canGoForward, onBack, onForward, debugAvailable, debugState, onStart, onContinue, onPause, onStep, onStop }: ToolBarProps): React.JSX.Element => {
  const { t } = useLanguage()
  return (
    <div className="tool-bar" role="toolbar" aria-label={t('Main toolbar')}>
      <ToolButton label={t('Open Assembly')} onClick={onOpen}><FolderOpen size={16} /></ToolButton>
      <ToolButton label={t('Save As')} disabled={!hasWorkspace} onClick={onSave}><Save size={16} /></ToolButton>
      <span className="toolbar-separator" />
      <ToolButton label={t('Back')} disabled={!canGoBack} onClick={onBack}><ArrowLeft size={16} /></ToolButton>
      <ToolButton label={t('Forward')} disabled={!canGoForward} onClick={onForward}><ArrowRight size={16} /></ToolButton>
      <span className="toolbar-separator" />
      <ToolButton label={t('Search')} disabled={!hasWorkspace} onClick={onSearch}><Search size={16} /></ToolButton>
      <span className="toolbar-spacer" />
      <span className="debug-target"><Bug size={14} /> .NET</span>
      <ToolButton label={debugState === 'stopped' ? t('Continue') : t('Debug a Program')} disabled={!debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped')} onClick={debugState === 'stopped' ? onContinue : onStart}><Play size={16} /></ToolButton>
      <ToolButton label={t('Pause')} disabled={debugState !== 'running'} onClick={onPause}><Pause size={16} /></ToolButton>
      <ToolButton label={t('Step Over')} disabled={debugState !== 'stopped'} onClick={onStep}><StepForward size={16} /></ToolButton>
      <ToolButton label={t('Stop')} disabled={debugState === 'inactive'} onClick={onStop}><Square size={15} /></ToolButton>
      {busy && <span className="toolbar-busy">{t('Working')}</span>}
    </div>
  )
}
