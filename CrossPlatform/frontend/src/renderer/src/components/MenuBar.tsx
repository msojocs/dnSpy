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
  visibleToolWindows: ReadonlySet<string>
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
  canToggleBreakpoint: boolean
  hasFunctionBreakpoints: boolean
  canEnableAllBreakpoints: boolean
  canDisableAllBreakpoints: boolean
  onToggleBreakpoint(): void
  onDeleteAllBreakpoints(): void
  onEnableAllBreakpoints(): void
  onDisableAllBreakpoints(): void
  onShowExplorer(): void
  onShowOutput(): void
  onShowSearch(): void
  onShowAnalysis(): void
  onShowModuleBreakpoints(): void
  onShowExceptionSettings(): void
  onShowAutos(): void
  onShowStaticFields(): void
  onShowProcesses(): void
  onShowMemory(): void
  onShowDisassembly(): void
  onShowLocals(): void
  onShowWatch(): void
  onShowCallStack(): void
  onShowBreakpoints(): void
  onShowThreads(): void
  onShowModules(): void
  onTheme(theme: ThemeName): void
  onToggleWordWrap(): void
  onToggleHighlightCurrentLine(): void
  onToggleFullScreen(): void
  onSetLanguage(language: LanguagePreference): void
  onAbout(): void
  onQuit(): void
  onShowOptions(category?: 'environment' | 'decompiler' | 'debugger'): void
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
  canToggleBreakpoint,
  hasFunctionBreakpoints,
  canEnableAllBreakpoints,
  canDisableAllBreakpoints,
  onToggleBreakpoint,
  onDeleteAllBreakpoints,
  onEnableAllBreakpoints,
  onDisableAllBreakpoints,
  visibleToolWindows,
  onShowExplorer,
  onShowOutput,
  onShowSearch,
  onShowAnalysis,
  onShowModuleBreakpoints,
  onShowExceptionSettings,
  onShowAutos,
  onShowStaticFields,
  onShowProcesses,
  onShowMemory,
  onShowDisassembly,
  onShowLocals,
  onShowWatch,
  onShowCallStack,
  onShowBreakpoints,
  onShowThreads,
  onShowModules,
  onTheme,
  onToggleWordWrap,
  onToggleHighlightCurrentLine,
  onToggleFullScreen,
  onSetLanguage,
  onAbout,
  onQuit,
  onShowOptions,
}: MenuBarProps): React.JSX.Element => {
  const [openMenu, setOpenMenu] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const { language, t } = useLanguage()
  const isDebugging = debugState !== 'inactive'
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
      { label: t('Assembly Explorer'), shortcut: 'Ctrl+Alt+L', checked: visibleToolWindows.has('explorer'), action: onShowExplorer },
      { label: t('Output'), shortcut: 'Alt+2', checked: visibleToolWindows.has('output'), action: onShowOutput },
      { label: t('Search'), shortcut: 'Ctrl+Alt+F', checked: visibleToolWindows.has('search'), action: onShowSearch },
      { label: t('Analyzer'), shortcut: 'Ctrl+Alt+R', checked: visibleToolWindows.has('analysis'), action: onShowAnalysis },
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
      { label: t('Options...'), action: () => onShowOptions('environment') },
      { label: t('Hex View'), disabled: !canInspectModule, action: onHex },
      { label: t('Module Information'), disabled: !canInspectModule, action: onModuleInfo },
    ],
    [t('Debug')]: [
      {
        label: t('Window'),
        submenu: [
          { label: t('Breakpoints'), shortcut: 'Ctrl+Alt+B', checked: visibleToolWindows.has('breakpoints'), action: onShowBreakpoints },
          { label: t('Module Breakpoints'), checked: visibleToolWindows.has('module-breakpoints'), action: onShowModuleBreakpoints },
          { label: t('Exception Settings'), shortcut: 'Ctrl+Alt+E', checked: visibleToolWindows.has('exception-settings'), action: onShowExceptionSettings },
          { label: t('Output'), shortcut: 'Alt+2', checked: visibleToolWindows.has('output'), action: onShowOutput },
          ...(isDebugging ? [
            { separator: true },
            { label: t('Watch'), checked: visibleToolWindows.has('watch'), action: onShowWatch },
            { label: t('Autos'), shortcut: 'Ctrl+Alt+V, A', checked: visibleToolWindows.has('autos'), action: onShowAutos },
            { label: t('Locals'), shortcut: 'Alt+4', checked: visibleToolWindows.has('locals'), action: onShowLocals },
            { label: t('Static Fields'), checked: visibleToolWindows.has('static-fields'), action: onShowStaticFields },
            { separator: true },
            { label: t('Call Stack'), shortcut: 'Ctrl+Alt+C', checked: visibleToolWindows.has('callstack'), action: onShowCallStack },
            { label: t('Threads'), shortcut: 'Ctrl+Alt+H', checked: visibleToolWindows.has('threads'), action: onShowThreads },
            { label: t('Modules'), shortcut: 'Ctrl+Alt+U', checked: visibleToolWindows.has('modules'), action: onShowModules },
            { label: t('Processes'), shortcut: 'Ctrl+Alt+Z', checked: visibleToolWindows.has('processes'), action: onShowProcesses },
            { separator: true },
            { label: t('Memory'), checked: visibleToolWindows.has('memory'), action: onShowMemory },
            { label: t('Disassembly'), shortcut: 'Alt+8', checked: visibleToolWindows.has('disassembly'), action: onShowDisassembly },
          ] : []),
        ],
      },
      { separator: true },
      { label: debugState === 'stopped' ? t('Continue') : t('Start Debugging'), shortcut: 'F5', disabled: !debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped'), action: debugState === 'stopped' ? onContinueDebug : onStartDebug },
      { label: t('Attach to Process...'), disabled: !debugAvailable || debugState !== 'inactive', action: onAttachDebug },
      ...(isDebugging ? [
        { separator: true },
        { label: t('Pause'), disabled: debugState !== 'running', action: onPauseDebug },
        { label: t('Step Into'), shortcut: 'F11', disabled: debugState !== 'stopped', action: onStepIn },
        { label: t('Step Over'), shortcut: 'F10', disabled: debugState !== 'stopped', action: onStepOver },
        { label: t('Stop Debugging'), shortcut: 'Shift+F5', disabled: false, action: onStopDebug },
      ] : []),
      { separator: true },
      { label: t('Toggle Breakpoint'), shortcut: 'F9', disabled: !canToggleBreakpoint, action: onToggleBreakpoint },
      ...(hasFunctionBreakpoints ? [
        { label: t('Delete All Breakpoints'), shortcut: 'Ctrl+Shift+F9', action: onDeleteAllBreakpoints },
      ] : []),
      ...(canEnableAllBreakpoints ? [
        { label: t('Enable All Breakpoints'), action: onEnableAllBreakpoints },
      ] : []),
      ...(canDisableAllBreakpoints ? [
        { label: t('Disable All Breakpoints'), action: onDisableAllBreakpoints },
      ] : []),
      { separator: true },
      { label: t('Options...'), action: () => onShowOptions('debugger') },
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
            aria-checked={item.checked === undefined ? undefined : item.checked}
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
