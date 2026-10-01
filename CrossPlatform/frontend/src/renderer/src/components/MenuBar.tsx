import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useLanguage } from '../localization'
import { WindowControls } from './WindowControls'

export type ThemeName = 'blue' | 'light' | 'dark' | 'hc'

const repositoryUrl = 'https://github.com/msojocs/dnSpy'

const openExternal = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface MenuBarProps {
  hasWorkspace: boolean
  canRename: boolean
  canEditMethod: boolean
  canReplaceResource: boolean
  canInspectModule: boolean
  debugAvailable: boolean
  debugState: 'inactive' | 'starting' | 'running' | 'stopped'
  recentWorkspaces: string[][]
  canUndo: boolean
  canRedo: boolean
  theme: ThemeName
  onOpen(): void
  onOpenRecent(paths: string[]): void
  onClose(): void
  onSave(): void
  onFind(): void
  onUndo(): void
  onRedo(): void
  onRename(): void
  onEditMethod(): void
  onReplaceResource(): void
  onHex(): void
  onModuleInfo(): void
  onStartDebug(): void
  onAttachDebug(): void
  onContinueDebug(): void
  onPauseDebug(): void
  onStepIn(): void
  onStepOver(): void
  onStopDebug(): void
  onShowExplorer(): void
  onShowOutput(): void
  onShowSearch(): void
  onTheme(theme: ThemeName): void
  onAbout(): void
  onQuit(): void
}

interface MenuItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  action?: () => void
}

export const MenuBar = ({ hasWorkspace, canRename, canEditMethod, canReplaceResource, canInspectModule, debugAvailable, debugState, recentWorkspaces, canUndo, canRedo, theme, onOpen, onOpenRecent, onClose, onSave, onFind, onUndo, onRedo, onRename, onEditMethod, onReplaceResource, onHex, onModuleInfo, onStartDebug, onAttachDebug, onContinueDebug, onPauseDebug, onStepIn, onStepOver, onStopDebug, onShowExplorer, onShowOutput, onShowSearch, onTheme, onAbout, onQuit }: MenuBarProps): React.JSX.Element => {
  const [openMenu, setOpenMenu] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const { language, setLanguage, t } = useLanguage()
  const menus: Record<string, MenuItem[]> = {
    [t('File')]: [
      { label: t('Open...'), shortcut: 'Ctrl+O', action: onOpen },
      { label: t('Save As...'), shortcut: 'Ctrl+Shift+S', disabled: !hasWorkspace, action: onSave },
      { label: t('Close Workspace'), disabled: !hasWorkspace, action: onClose },
      ...(recentWorkspaces.length > 0 ? [
        { separator: true },
        ...recentWorkspaces.map((paths, index) => ({ label: `${index + 1}  ${recentLabel(paths, t('Workspace'))}`, action: () => onOpenRecent(paths) })),
      ] : []),
      { separator: true },
      { label: t('Exit'), shortcut: 'Alt+F4', action: onQuit },
    ],
    [t('Edit')]: [
      { label: t('Undo'), shortcut: 'Ctrl+Z', disabled: !canUndo, action: onUndo },
      { label: t('Redo'), shortcut: 'Ctrl+Y', disabled: !canRedo, action: onRedo },
      { separator: true },
      { label: t('Find'), shortcut: 'Ctrl+F', disabled: !hasWorkspace, action: onFind },
      { separator: true },
      { label: t('Rename...'), shortcut: 'F2', disabled: !canRename, action: onRename },
      { label: t('Edit IL Body...'), disabled: !canEditMethod, action: onEditMethod },
      { label: t('Replace Resource...'), disabled: !canReplaceResource, action: onReplaceResource },
    ],
    [t('View')]: [
      { label: t('Blue Theme'), checked: theme === 'blue', action: () => onTheme('blue') },
      { label: t('Light Theme'), checked: theme === 'light', action: () => onTheme('light') },
      { label: t('Dark Theme'), checked: theme === 'dark', action: () => onTheme('dark') },
      { label: t('High Contrast'), checked: theme === 'hc', action: () => onTheme('hc') },
      { separator: true },
      { label: t('Hex View'), disabled: !canInspectModule, action: onHex },
      { label: t('Module Information'), disabled: !canInspectModule, action: onModuleInfo },
    ],
    [t('Language')]: [
      { label: t('System Default'), checked: language === 'system', action: () => setLanguage('system') },
      { label: t('English'), checked: language === 'en', action: () => setLanguage('en') },
      { label: t('Simplified Chinese'), checked: language === 'zh-CN', action: () => setLanguage('zh-CN') },
    ],
    [t('Debug')]: [
      { label: debugState === 'stopped' ? t('Continue') : t('Start Debugging'), shortcut: 'F5', disabled: !debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped'), action: debugState === 'stopped' ? onContinueDebug : onStartDebug },
      { label: t('Attach to Process...'), disabled: !debugAvailable || debugState !== 'inactive', action: onAttachDebug },
      { separator: true },
      { label: t('Pause'), disabled: debugState !== 'running', action: onPauseDebug },
      { label: t('Step Into'), shortcut: 'F11', disabled: debugState !== 'stopped', action: onStepIn },
      { label: t('Step Over'), shortcut: 'F10', disabled: debugState !== 'stopped', action: onStepOver },
      { label: t('Stop Debugging'), shortcut: 'Shift+F5', disabled: debugState === 'inactive', action: onStopDebug },
    ],
    [t('Window')]: [
      { label: t('Assembly Explorer'), checked: true, action: onShowExplorer },
      { label: t('Output'), checked: true, action: onShowOutput },
      { label: t('Search'), checked: true, action: onShowSearch },
    ],
    [t('Help')]: [
      { label: t('Latest Release'), action: () => openExternal(`${repositoryUrl}/releases/latest`) },
      { label: t('Report Bug'), action: () => openExternal(`${repositoryUrl}/issues/new`) },
      { label: t('Source Code'), action: () => openExternal(repositoryUrl) },
      { separator: true },
      { label: t('About dnSpy'), action: onAbout },
    ],
  }

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (!host.current?.contains(event.target as Node)) setOpenMenu(undefined)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="menu-bar" role="menubar" ref={host}>
      {Object.entries(menus).map(([name, items]) => (
        <div className="menu-root" key={name}>
          <button
            role="menuitem"
            className={openMenu === name ? 'active' : ''}
            onClick={() => setOpenMenu(openMenu === name ? undefined : name)}
            onPointerEnter={() => { if (openMenu) setOpenMenu(name) }}
          >
            {name}
          </button>
          {openMenu === name && (
            <div className="menu-popup" role="menu">
              {items.map((item, index) => item.separator ? (
                <div className="menu-separator" role="separator" key={index} />
              ) : (
                <button
                  role="menuitem"
                  className="menu-item"
                  disabled={item.disabled}
                  key={`${item.label}:${index}`}
                  onClick={() => {
                    setOpenMenu(undefined)
                    item.action?.()
                  }}
                >
                  <span className="menu-check">{item.checked && <Check size={13} />}</span>
                  <span>{item.label}</span>
                  <span className="menu-shortcut">{item.shortcut}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <WindowControls />
    </div>
  )
}

const recentLabel = (paths: string[], workspaceLabel: string): string => {
  const first = paths[0]?.split(/[\\/]/).at(-1) ?? workspaceLabel
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first
}
