import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useLanguage, type LanguagePreference } from '../localization'
import { buildEditMenu, type ActiveDocument, type CreatedKind, type HexShowKind, type MenuItem } from './edit-menu'
import { buildFileMenu } from './file-menu'
import type { HexBodyKind } from '../app-store'
import type { HexRange, HexTargetResponse } from '../../../shared/protocol'
import { WindowControls } from './WindowControls'

export type ThemeName = 'blue' | 'light' | 'dark' | 'hc'

const repositoryUrl = 'https://github.com/msojocs/dnSpy'

const openExternal = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface MenuBarProps {
  hasWorkspace: boolean
  /** Whether the workspace holds a module, which is what the File menu's "Save Module..." acts on. */
  hasModule: boolean
  /** `selectedNode.kind` / `selectedNode.label` from the assembly explorer, feeding the Edit menu. */
  selectionKind?: string
  selectionLabel?: string
  /** Whether the selected namespace's module already has an empty namespace to move its types into. */
  hasEmptyNamespaceSibling: boolean
  /** Which document the Edit menu's hex groups key off. */
  activeDocument: ActiveDocument
  canShowCode: boolean
  debugAvailable: boolean
  debugState: 'inactive' | 'starting' | 'running' | 'stopped'
  recentWorkspaces: string[][]
  canUndo: boolean
  canRedo: boolean
  theme: ThemeName
  wordWrap: boolean
  highlightCurrentLine: boolean
  fullScreen: boolean
  /** Whether the app already has elevated rights, which is what hides the File menu's restart entry. */
  elevated: boolean
  visibleToolWindows: ReadonlySet<string>
  onOpen(): void
  onOpenRecent(paths: string[]): void
  onCloseAll(): void
  /** Whether an edit is unsaved, which is what enables the File menu's Save and Save All. */
  dirty: boolean
  onSave(): void
  onSaveModule(): void
  onSaveAll(): void
  onReloadAll(): void
  onSortAssemblies(): void
  onFind(): void
  onSearchAssemblies(): void
  onUndo(): void
  onRedo(): void
  onEditMethodBody(): void
  onEditResource(): void
  onDelete(): void
  onRenameNamespace(): void
  onMoveTypesToEmptyNamespace(): void
  onReplaceMethodBodyWithStub(): void
  /** Where the hex commands point for the selection, and for the code document's caret. */
  hexTarget?: HexTargetResponse
  hexStatement?: { moduleId: string; range: HexRange }
  onOpenHex(): void
  onShowHexAt(kind: HexShowKind): void
  onHexWriteBody(kind: HexBodyKind): void
  onHexCopyBody(): void
  onHexPasteBody(): void
  onCreateMember(kind: CreatedKind): void
  onEditNode(): void
  onShowCode(): void
  onCollapseTreeViewNodes(): void
  onStartDebug(): void
  onAttachDebug(): void
  onContinueDebug(): void
  onPauseDebug(): void
  onStepIn(): void
  onStepOver(): void
  onStepOut(): void
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
  onShowCSharpInteractive(): void
  bookmarksCount: number
  canEnableAllBookmarks: boolean
  canDisableAllBookmarks: boolean
  onShowBookmarks(): void
  onToggleBookmark(): void
  onEnableBookmark(): void
  onEnableAllBookmarks(): void
  onDisableAllBookmarks(): void
  onPreviousBookmark(): void
  onNextBookmark(): void
  onPreviousBookmarkWithSameLabel(): void
  onNextBookmarkWithSameLabel(): void
  onPreviousBookmarkInDocument(): void
  onNextBookmarkInDocument(): void
  onClearBookmarks(): void
  onClearBookmarksInDocument(): void
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
  onRestartAsAdministrator(): void
  onQuit(): void
  onShowOptions(category?: 'environment' | 'decompiler' | 'debugger'): void
}

const languageOptions: { value: LanguagePreference; label: string }[] = [
  { value: 'system', label: 'System Default' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: 'Simplified Chinese' },
]

export const MenuBar = ({
  hasWorkspace,
  hasModule,
  selectionKind,
  selectionLabel,
  hasEmptyNamespaceSibling,
  activeDocument,
  canShowCode,
  debugAvailable,
  debugState,
  recentWorkspaces,
  canUndo,
  canRedo,
  theme,
  wordWrap,
  highlightCurrentLine,
  fullScreen,
  elevated,
  onOpen,
  onOpenRecent,
  onCloseAll,
  dirty,
  onSave,
  onSaveModule,
  onSaveAll,
  onReloadAll,
  onSortAssemblies,
  onFind,
  onSearchAssemblies,
  onUndo,
  onRedo,
  onEditMethodBody,
  onEditResource,
  onDelete,
  onRenameNamespace,
  onMoveTypesToEmptyNamespace,
  onReplaceMethodBodyWithStub,
  hexTarget,
  hexStatement,
  onOpenHex,
  onShowHexAt,
  onHexWriteBody,
  onHexCopyBody,
  onHexPasteBody,
  onCreateMember,
  onEditNode,
  onShowCode,
  onCollapseTreeViewNodes,
  onStartDebug,
  onAttachDebug,
  onContinueDebug,
  onPauseDebug,
  onStepIn,
  onStepOver,
  onStepOut,
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
  onShowCSharpInteractive,
  bookmarksCount,
  canEnableAllBookmarks,
  canDisableAllBookmarks,
  onShowBookmarks,
  onToggleBookmark,
  onEnableBookmark,
  onEnableAllBookmarks,
  onDisableAllBookmarks,
  onPreviousBookmark,
  onNextBookmark,
  onPreviousBookmarkWithSameLabel,
  onNextBookmarkWithSameLabel,
  onPreviousBookmarkInDocument,
  onNextBookmarkInDocument,
  onClearBookmarks,
  onClearBookmarksInDocument,
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
  onRestartAsAdministrator,
  onQuit,
  onShowOptions,
}: MenuBarProps): React.JSX.Element => {
  const [openMenu, setOpenMenu] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const { language, t } = useLanguage()
  const isDebugging = debugState !== 'inactive'
  // dnSpy's GetEnableAllBookmarksKind: an empty list gets no entry at all, every bookmark on gets
  // "Disable All", and one bookmark off is enough for "Enable All". Those first two kinds are what
  // App hands over as the two flags, so "all of them are on" is nothing left to enable.
  const allBookmarksEnabled = !canEnableAllBookmarks && canDisableAllBookmarks
  const menus: Record<string, MenuItem[]> = {
    // dnSpy's File menu in full: see file-menu.ts for the ordering and the disabled entries.
    [t('File')]: buildFileMenu({
      t,
      hasWorkspace,
      hasModule,
      dirty,
      elevated,
      recentWorkspaces,
      onOpen,
      onOpenRecent,
      onSave,
      onSaveModule,
      onSaveAll,
      onReloadAll,
      onCloseAll,
      onSortAssemblies,
      onRestartAsAdministrator,
      onQuit,
    }),
    // dnSpy's Edit menu in full: see edit-menu.ts for the ordering and visibility rules.
    [t('Edit')]: buildEditMenu({
      t,
      hasWorkspace,
      selectionKind,
      selectionLabel,
      hasEmptyNamespaceSibling,
      activeDocument,
      canUndo,
      canRedo,
      onUndo,
      onRedo,
      onFind,
      onSearchAssemblies,
      onEditMethodBody,
      onEditResource,
      onDelete,
      onRenameNamespace,
      onMoveTypesToEmptyNamespace,
      onReplaceMethodBodyWithStub,
      hexTarget,
      hexStatement,
      onOpenHex,
      onShowHexAt,
      onHexWriteBody,
      onHexCopyBody,
      onHexPasteBody,
      onCreateMember,
      onEditNode,
    }),
    [t('View')]: [
      { label: t('Word Wrap'), shortcut: 'Ctrl+E, Ctrl+W', checked: wordWrap, action: onToggleWordWrap },
      { label: t('Highlight Current Line'), checked: highlightCurrentLine, action: onToggleHighlightCurrentLine },
      { label: t('Full Screen'), shortcut: 'Shift+Alt+Enter', checked: fullScreen, action: onToggleFullScreen },
      { label: t('Collapse Tree View Nodes'), shortcut: 'Ctrl+Shift+P', action: onCollapseTreeViewNodes },
      {
        label: t('Theme'),
        submenu: [
          { label: t('Blue'), checked: theme === 'blue', action: () => onTheme('blue') },
          { label: t('Dark'), checked: theme === 'dark', action: () => onTheme('dark') },
          { label: t('Light'), checked: theme === 'light', action: () => onTheme('light') },
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
      { label: t('Code'), shortcut: 'Ctrl+Alt+0', disabled: !canShowCode, action: onShowCode },
      { label: t('Assembly Explorer'), shortcut: 'Ctrl+Alt+L', checked: visibleToolWindows.has('explorer'), action: onShowExplorer },
      { label: t('Output'), shortcut: 'Alt+2', checked: visibleToolWindows.has('output'), action: onShowOutput },
      { label: t('C# Interactive'), shortcut: 'Ctrl+Alt+N', checked: visibleToolWindows.has('csharp-interactive'), action: onShowCSharpInteractive },
      {
        // dnSpy's bookmark commands, in the order its View menu group and sort orders give them: the
        // window, the commands, then the labelled and in-document walks. Enable/Disable All is a single
        // entry whose header follows the bookmarks around it, which is how dnSpy writes it.
        label: t('Bookmarks'),
        submenu: [
          { label: t('Bookmarks Window'), shortcut: 'Ctrl+K, Ctrl+W', checked: visibleToolWindows.has('bookmarks'), action: onShowBookmarks },
          { separator: true },
          { label: t('Toggle Bookmark'), shortcut: 'Ctrl+K, Ctrl+K', action: onToggleBookmark },
          ...(bookmarksCount > 0 ? [{
            label: t(allBookmarksEnabled ? 'Disable All Bookmarks' : 'Enable All Bookmarks'),
            action: allBookmarksEnabled ? onDisableAllBookmarks : onEnableAllBookmarks,
          }] : []),
          { label: t('Enable/Disable Bookmark'), shortcut: 'Ctrl+K, Ctrl+E', action: onEnableBookmark },
          { label: t('Previous Bookmark'), shortcut: 'Ctrl+K, Ctrl+P', disabled: bookmarksCount === 0, action: onPreviousBookmark },
          { label: t('Next Bookmark'), shortcut: 'Ctrl+K, Ctrl+N', disabled: bookmarksCount === 0, action: onNextBookmark },
          { label: t('Clear Bookmarks'), shortcut: 'Ctrl+K, Ctrl+L', disabled: bookmarksCount === 0, action: onClearBookmarks },
          { separator: true },
          { label: t('Previous Bookmark With Same Label'), disabled: bookmarksCount === 0, action: onPreviousBookmarkWithSameLabel },
          { label: t('Next Bookmark With Same Label'), disabled: bookmarksCount === 0, action: onNextBookmarkWithSameLabel },
          { separator: true },
          { label: t('Previous Bookmark In Document'), disabled: bookmarksCount === 0, action: onPreviousBookmarkInDocument },
          { label: t('Next Bookmark In Document'), disabled: bookmarksCount === 0, action: onNextBookmarkInDocument },
          { label: t('Clear All Bookmarks In Document'), disabled: bookmarksCount === 0, action: onClearBookmarksInDocument },
        ],
      },
      { separator: true },
      { label: t('Options...'), action: () => onShowOptions('environment') },
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
            { label: t('Watch 1'), checked: visibleToolWindows.has('watch'), action: onShowWatch },
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
      { label: debugState === 'stopped' ? t('Continue') : t('Start Debugging...'), shortcut: 'F5', disabled: !debugAvailable || (debugState !== 'inactive' && debugState !== 'stopped'), action: debugState === 'stopped' ? onContinueDebug : onStartDebug },
      { label: t('Attach to Process...'), disabled: !debugAvailable || debugState !== 'inactive', action: onAttachDebug },
      ...(isDebugging ? [
        { separator: true },
        { label: t('Pause'), disabled: debugState !== 'running', action: onPauseDebug },
        { label: t('Step Into'), shortcut: 'F11', disabled: debugState !== 'stopped', action: onStepIn },
        { label: t('Step Over'), shortcut: 'F10', disabled: debugState !== 'stopped', action: onStepOver },
        { label: t('Step Out'), shortcut: 'Shift+F11', disabled: debugState !== 'stopped', action: onStepOut },
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
                disabled={item.disabled}
                onClick={() => setOpenIndex(openIndex === index ? undefined : index)}
              >
                <span className="menu-check" />
                <span>{item.label}</span>
                <span className="menu-shortcut"><ChevronRight size={12} /></span>
              </button>
              {openIndex === index && item.submenu.length > 0 && (
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
