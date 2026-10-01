import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useLanguage, type LanguagePreference } from '../localization'
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
  wordWrap: boolean
  highlightCurrentLine: boolean
  fullScreen: boolean
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
  onToggleWordWrap(): void
  onToggleHighlightCurrentLine(): void
  onToggleFullScreen(): void
  onSetLanguage(language: LanguagePreference): void
  onAbout(): void
  onQuit(): void
}

interface MenuItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  submenu?: MenuItem[]
  action?: () => void
}

const languageOptions: { value: LanguagePreference; label: string }[] = [
  { value: 'system', label: 'System Default' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: 'Simplified Chinese' },
]

export const MenuBar = ({
  hasWorkspace,
  canRename,
  canEditMethod,
  canReplaceResource,
  canInspectModule,
  debugAvailable,
  debugState,
  recentWorkspaces,
  canUndo,
  canRedo,
  theme,
  wordWrap,
  highlightCurrentLine,
  fullScreen,
  onOpen,
  onOpenRecent,
  onClose,
  onSave,
  onFind,
  onUndo,
  onRedo,
  onRename,
  onEditMethod,
  onReplaceResource,
  onHex,
  onModuleInfo,
  onStartDebug,
  onAttachDebug,
  onContinueDebug,
  onPauseDebug,
  onStepIn,
  onStepOver,
  onStopDebug,
  onShowExplorer,
  onShowOutput,
  onShowSearch,
  onTheme,
  onToggleWordWrap,
  onToggleHighlightCurrentLine,
  onToggleFullScreen,
  onSetLanguage,
  onAbout,
  onQuit,
}: MenuBarProps): React.JSX.Element => {
  const [openMenu, setOpenMenu] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const { language, t } = useLanguage()
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
      { label: t('Word Wrap'), shortcut: 'Ctrl+E Ctrl+W', checked: wordWrap, action: onToggleWordWrap },
      { label: t('Highlight Current Line'), checked: highlightCurrentLine, action: onToggleHighlightCurrentLine },
      { label: fullScreen ? t('Exit Full Screen') : t('Full Screen'), shortcut: 'Shift+Alt+Enter', checked: fullScreen, action: onToggleFullScreen },
      { separator: true },
      { label: t('Assembly Explorer'), shortcut: 'Ctrl+Alt+L', action: onShowExplorer },
      { label: t('Output'), shortcut: 'Alt+2', action: onShowOutput },
      { label: t('Search'), shortcut: 'Ctrl+Alt+F', action: onShowSearch },
      { separator: true },
      {
        label: t('Themes'),
        submenu: [
          { label: t('Blue Theme'), checked: theme === 'blue', action: () => onTheme('blue') },
          { label: t('Light Theme'), checked: theme === 'light', action: () => onTheme('light') },
          { label: t('Dark Theme'), checked: theme === 'dark', action: () => onTheme('dark') },
          { label: t('High Contrast'), checked: theme === 'hc', action: () => onTheme('hc') },
        ],
      },
      {
        label: t('Language'),
        submenu: languageOptions.map((option) => ({
          label: t(option.label),
          checked: language === option.value,
          action: () => onSetLanguage(option.value),
        })),
      },
      { separator: true },
      { label: t('Hex View'), disabled: !canInspectModule, action: onHex },
      { label: t('Module Information'), disabled: !canInspectModule, action: onModuleInfo },
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
      if (!host.current?.contains(event.target as Node))
        setOpenMenu(undefined)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const closeMenu = (): void => setOpenMenu(undefined)

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
            <MenuPopup items={items} onClose={closeMenu} />
          )}
        </div>
      ))}
      <WindowControls />
    </div>
  )
}

const MenuPopup = ({ items, onClose, depth = 0 }: { items: MenuItem[]; onClose: () => void; depth?: number }): React.JSX.Element => {
  const [openIndex, setOpenIndex] = useState<number | undefined>()
  return (
    <div className={depth === 0 ? 'menu-popup' : 'menu-popup menu-submenu'} role="menu">
      {items.map((item, index) => {
        if (item.separator)
          return <div className="menu-separator" role="separator" key={`sep:${depth}:${index}`} />
        if (item.submenu) {
          return (
            <div className="menu-item-row" key={`sub:${depth}:${index}`} onPointerEnter={() => setOpenIndex(index)} onPointerLeave={() => setOpenIndex(undefined)}>
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openIndex === index}
                className={`menu-item${openIndex === index ? ' menu-item-open' : ''}`}
                onClick={() => setOpenIndex(openIndex === index ? undefined : index)}
              >
                <span className="menu-check" />
                <span>{item.label}</span>
                <span className="menu-shortcut"><ChevronRight size={12} /></span>
              </button>
              {openIndex === index && (
                <MenuPopup items={item.submenu} onClose={onClose} depth={depth + 1} />
              )}
            </div>
          )
        }
        return (
          <button
            role="menuitem"
            className="menu-item"
            disabled={item.disabled}
            key={`it:${depth}:${index}`}
            onPointerEnter={() => setOpenIndex(undefined)}
            onClick={() => { onClose(); item.action?.() }}
          >
            <span className="menu-check">{item.checked && <Check size={13} />}</span>
            <span>{item.label}</span>
            <span className="menu-shortcut">{item.shortcut}</span>
          </button>
        )
      })}
    </div>
  )
}

const recentLabel = (paths: string[], workspaceLabel: string): string => {
  const first = paths[0]?.split(/[\\/]/).at(-1) ?? workspaceLabel
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first
}
