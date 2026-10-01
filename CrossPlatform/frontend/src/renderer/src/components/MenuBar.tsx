import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { WindowControls } from './WindowControls'

export type ThemeName = 'blue' | 'light' | 'dark' | 'hc'

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
  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Open...', shortcut: 'Ctrl+O', action: onOpen },
      { label: 'Save As...', shortcut: 'Ctrl+Shift+S', disabled: !hasWorkspace, action: onSave },
      { label: 'Close Workspace', disabled: !hasWorkspace, action: onClose },
      ...(recentWorkspaces.length > 0 ? [
        { separator: true },
        ...recentWorkspaces.map((paths, index) => ({ label: `${index + 1}  ${recentLabel(paths)}`, action: () => onOpenRecent(paths) })),
      ] : []),
      { separator: true },
      { label: 'Exit', shortcut: 'Alt+F4', action: onQuit },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, action: onUndo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, action: onRedo },
      { separator: true },
      { label: 'Find', shortcut: 'Ctrl+F', disabled: !hasWorkspace, action: onFind },
      { separator: true },
      { label: 'Rename...', shortcut: 'F2', disabled: !canRename, action: onRename },
      { label: 'Edit IL Body...', disabled: !canEditMethod, action: onEditMethod },
      { label: 'Replace Resource...', disabled: !canReplaceResource, action: onReplaceResource },
    ],
    View: [
      { label: 'Blue Theme', checked: theme === 'blue', action: () => onTheme('blue') },
      { label: 'Light Theme', checked: theme === 'light', action: () => onTheme('light') },
      { label: 'Dark Theme', checked: theme === 'dark', action: () => onTheme('dark') },
      { label: 'High Contrast', checked: theme === 'hc', action: () => onTheme('hc') },
      { separator: true },
      { label: 'Hex View', disabled: !canInspectModule, action: onHex },
      { label: 'Module Information', disabled: !canInspectModule, action: onModuleInfo },
    ],
    Debug: [
      { label: debugState === 'stopped' ? 'Continue' : 'Start Debugging', shortcut: 'F5', disabled: !debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped'), action: debugState === 'stopped' ? onContinueDebug : onStartDebug },
      { label: 'Attach to Process...', disabled: !debugAvailable || debugState !== 'inactive', action: onAttachDebug },
      { separator: true },
      { label: 'Pause', disabled: debugState !== 'running', action: onPauseDebug },
      { label: 'Step Into', shortcut: 'F11', disabled: debugState !== 'stopped', action: onStepIn },
      { label: 'Step Over', shortcut: 'F10', disabled: debugState !== 'stopped', action: onStepOver },
      { label: 'Stop Debugging', shortcut: 'Shift+F5', disabled: debugState === 'inactive', action: onStopDebug },
    ],
    Window: [
      { label: 'Assembly Explorer', checked: true, action: onShowExplorer },
      { label: 'Output', checked: true, action: onShowOutput },
      { label: 'Search', checked: true, action: onShowSearch },
    ],
    Help: [
      { label: 'About dnSpy', action: onAbout },
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

const recentLabel = (paths: string[]): string => {
  const first = paths[0]?.split(/[\\/]/).at(-1) ?? 'Workspace'
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first
}
