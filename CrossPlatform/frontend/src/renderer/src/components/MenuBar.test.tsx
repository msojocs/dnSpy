import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

type DebugState = 'inactive' | 'starting' | 'running' | 'stopped'
type MenuBarProps = ComponentProps<typeof MenuBar>

const baseProps = (breakpoints: { canToggle?: boolean; onToggle?: () => void; items?: { name: string; enabled: boolean }[] } = {}): MenuBarProps => ({
  hasWorkspace: true,
  canRename: true,
  canEditMethod: false,
  canReplaceResource: false,
  canShowCode: false,
  debugAvailable: false,
  debugState: 'inactive',
  recentWorkspaces: [],
  canUndo: false,
  canRedo: false,
  theme: 'dark',
  wordWrap: false,
  highlightCurrentLine: true,
  fullScreen: false,
  onOpen: vi.fn(),
  onOpenRecent: vi.fn(),
  onClose: vi.fn(),
  onSave: vi.fn(),
  onFind: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onRename: vi.fn(),
  onEditMethod: vi.fn(),
  onReplaceResource: vi.fn(),
  onShowCode: vi.fn(),
  onCollapseTreeViewNodes: vi.fn(),
  onStartDebug: vi.fn(),
  onAttachDebug: vi.fn(),
  onContinueDebug: vi.fn(),
  onPauseDebug: vi.fn(),
  onStepIn: vi.fn(),
  onStepOver: vi.fn(),
  onStepOut: vi.fn(),
  onStopDebug: vi.fn(),
  canToggleBreakpoint: breakpoints.canToggle ?? false,
  hasFunctionBreakpoints: (breakpoints.items ?? []).length > 0,
  canEnableAllBreakpoints: (breakpoints.items ?? []).some((item) => !item.enabled),
  canDisableAllBreakpoints: (breakpoints.items ?? []).some((item) => item.enabled),
  onToggleBreakpoint: breakpoints.onToggle ?? vi.fn(),
  onDeleteAllBreakpoints: vi.fn(),
  onEnableAllBreakpoints: vi.fn(),
  onDisableAllBreakpoints: vi.fn(),
  visibleToolWindows: new Set(['explorer', 'output', 'locals', 'watch', 'callstack', 'breakpoints', 'threads', 'modules']),
  onShowExplorer: vi.fn(),
  onShowOutput: vi.fn(),
  onShowCSharpInteractive: vi.fn(),
  onShowModuleBreakpoints: vi.fn(),
  onShowExceptionSettings: vi.fn(),
  onShowAutos: vi.fn(),
  onShowStaticFields: vi.fn(),
  onShowProcesses: vi.fn(),
  onShowMemory: vi.fn(),
  onShowDisassembly: vi.fn(),
  onShowLocals: vi.fn(),
  onShowWatch: vi.fn(),
  onShowCallStack: vi.fn(),
  onShowBreakpoints: vi.fn(),
  onShowThreads: vi.fn(),
  onShowModules: vi.fn(),
  onTheme: vi.fn(),
  onToggleWordWrap: vi.fn(),
  onToggleHighlightCurrentLine: vi.fn(),
  onToggleFullScreen: vi.fn(),
  onSetLanguage: vi.fn(),
  onAbout: vi.fn(),
  onQuit: vi.fn(),
  onShowOptions: vi.fn(),
})

const renderMenu = (
  debugAvailable = false,
  onAbout = vi.fn(),
  debugState: DebugState = 'inactive',
  onShowOptions = vi.fn(),
  breakpoints: { canToggle?: boolean; onToggle?: () => void; items?: { name: string; enabled: boolean }[] } = {},
): void => {
  render(<MenuBar {...baseProps(breakpoints)} debugAvailable={debugAvailable} debugState={debugState} onAbout={onAbout} onShowOptions={onShowOptions} />)
}

/** Render with a few props swapped out — for tests that only care about one menu entry. */
const renderMenuWith = (overrides: Partial<MenuBarProps>): void => {
  render(<MenuBar {...baseProps()} {...overrides} />)
}

/** The labels of the open top-level popup, in render order. */
const openMenu = (name: string): string[] => {
  fireEvent.click(screen.getByRole('menuitem', { name }))
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent ?? '')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MenuBar', () => {
  it('exposes workspace commands and their shortcuts', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    expect(screen.getByRole('menuitem', { name: /^Open\.\.\./ })).toBeEnabled()
    expect(screen.getByText('Ctrl+O')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /^Save As\.\.\./ })).toBeEnabled()
  })

  it('enables CoreCLR commands only when the backend reports support', () => {
    renderMenu(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    expect(screen.getByRole('menuitem', { name: /^Start Debugging/ })).toBeDisabled()

    cleanup()
    renderMenu(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    expect(screen.getByRole('menuitem', { name: /^Start Debugging/ })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Attach to Process...' })).toBeEnabled()
  })

  it('mirrors the upstream View menu layout', () => {
    renderMenu()
    // Upstream sorts the View menu by group and then by item order, so the options come first
    // (Word Wrap … Collapse Tree View Nodes, Theme, Language), then the tool windows, then Options.
    expect(openMenu('View')).toEqual([
      'Word WrapCtrl+E, Ctrl+W',
      'Highlight Current Line',
      'Full ScreenShift+Alt+Enter',
      'Collapse Tree View NodesCtrl+Shift+P',
      'Theme',
      'Language',
      'CodeCtrl+Alt+0',
      'Assembly ExplorerCtrl+Alt+L',
      'OutputAlt+2',
      'C# InteractiveCtrl+Alt+N',
      'Options...',
    ])
    // Items that exist only in the cross-platform build must not leak back in.
    expect(screen.queryByRole('menuitem', { name: /^Search/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Analyzer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Hex View/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Module Information/ })).not.toBeInTheDocument()
  })

  it('orders the Theme submenu like upstream and marks the active theme', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: /^Theme$/ }))
    // The submenu is the second `role="menu"` in document order, nested inside the View popup.
    const entries = within(screen.getAllByRole('menu')[1]).getAllByRole('menuitem')
    expect(entries.map((item) => item.textContent)).toEqual(['Blue', 'Dark', 'Light', 'High Contrast'])
    expect(entries[0].getAttribute('aria-checked')).toBe('false')
    expect(entries[1].getAttribute('aria-checked')).toBe('true')
  })

  it('leaves Code disabled until a document tab is active', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(screen.getByRole('menuitem', { name: /^Code/ })).toBeDisabled()
  })

  it('invokes the Code handler once a document tab is active', () => {
    const onShowCode = vi.fn()
    renderMenuWith({ canShowCode: true, onShowCode })
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    const code = screen.getByRole('menuitem', { name: /^Code/ })
    expect(code).toBeEnabled()
    fireEvent.click(code)
    expect(onShowCode).toHaveBeenCalledOnce()
  })

  it('invokes the C# Interactive handler from the View menu', () => {
    const onShowCSharpInteractive = vi.fn()
    renderMenuWith({ onShowCSharpInteractive })
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^C# Interactive/ }))
    expect(onShowCSharpInteractive).toHaveBeenCalledOnce()
  })

  it('invokes the collapse handler from the View menu', () => {
    const onCollapseTreeViewNodes = vi.fn()
    renderMenuWith({ onCollapseTreeViewNodes })
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Collapse Tree View Nodes/ }))
    expect(onCollapseTreeViewNodes).toHaveBeenCalledOnce()
  })

  it('shows only the always-available tool windows before debugging starts', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const windows = screen.getByRole('menuitem', { name: 'Window' })
    fireEvent.pointerEnter(windows)
    // Upstream keeps Breakpoints, Module Breakpoints, Exception Settings and Output in the
    // Windows submenu even before a debug session exists.
    expect(screen.getByRole('menuitem', { name: /^Breakpoints/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Module Breakpoints/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Exception Settings/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Output/ })).toBeInTheDocument()
    // Debug-only tool windows (Watch, Memory, Disassembly, etc.) must stay hidden.
    expect(screen.queryByRole('menuitem', { name: /^Watch/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Autos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Locals/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Static Fields/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Call Stack/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Threads/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Modules/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Processes/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Memory/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Disassembly/ })).toBeNull()
    // Stepping / pause / stop controls only show while a debug session is active.
    fireEvent.pointerLeave(windows)
    expect(screen.queryByRole('menuitem', { name: /^Pause/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Step Into/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Step Over/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Stop Debugging/ })).not.toBeInTheDocument()
  })

  it('mirrors the upstream Debug → Windows menu layout while debugging', () => {
    renderMenu(false, vi.fn(), 'stopped')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const windows = screen.getByRole('menuitem', { name: 'Window' })
    fireEvent.pointerEnter(windows)
    // Upstream Debug → Windows menu has 14 entries (4 settings + 4 values + 4 info + 2 memory).
    expect(screen.getByRole('menuitem', { name: /^Breakpoints/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Module Breakpoints/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Exception Settings/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Output/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Watch/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Autos/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Locals/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Static Fields/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Call Stack/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Threads/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Modules/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Processes/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Memory/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Disassembly/ })).toBeInTheDocument()
    // Pause / Step / Stop controls become available during a debug session.
    fireEvent.pointerLeave(windows)
    expect(screen.getByRole('menuitem', { name: /^Pause/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Step Into/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Step Over/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Stop Debugging/ })).toBeInTheDocument()
  })

  it('marks currently visible tool windows in the Debug → Window submenu', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const windows = screen.getByRole('menuitem', { name: 'Window' })
    fireEvent.pointerEnter(windows)
    expect(screen.getByRole('menuitem', { name: /^Output/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitem', { name: /^Breakpoints/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('exposes individual callbacks to re-open each closable tool window', () => {
    const onShowOutput = vi.fn()
    const onShowLocals = vi.fn()
    const onShowWatch = vi.fn()
    const onShowCallStack = vi.fn()
    const onShowBreakpoints = vi.fn()
    const onShowThreads = vi.fn()
    const onShowModules = vi.fn()
    const onShowModuleBreakpoints = vi.fn()
    const onShowExceptionSettings = vi.fn()
    const onShowAutos = vi.fn()
    const onShowStaticFields = vi.fn()
    const onShowProcesses = vi.fn()
    const onShowMemory = vi.fn()
    const onShowDisassembly = vi.fn()
    render(<MenuBar
      hasWorkspace={true}
      canRename={false}
      canEditMethod={false}
      canReplaceResource={false}
      canShowCode={true}
      debugAvailable={false}
      debugState="stopped"
      recentWorkspaces={[]}
      canUndo={false}
      canRedo={false}
      theme="dark"
      wordWrap={false}
      highlightCurrentLine={true}
      fullScreen={false}
      visibleToolWindows={new Set(['explorer'])}
      onOpen={vi.fn()}
      onOpenRecent={vi.fn()}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onFind={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onRename={vi.fn()}
      onEditMethod={vi.fn()}
      onReplaceResource={vi.fn()}
      onShowCode={vi.fn()}
      onCollapseTreeViewNodes={vi.fn()}
      onStartDebug={vi.fn()}
      onAttachDebug={vi.fn()}
      onContinueDebug={vi.fn()}
      onPauseDebug={vi.fn()}
      onStepIn={vi.fn()}
      onStepOver={vi.fn()}
      onStepOut={vi.fn()}
      onStopDebug={vi.fn()}
      canToggleBreakpoint={false}
      hasFunctionBreakpoints={false}
      canEnableAllBreakpoints={false}
      canDisableAllBreakpoints={false}
      onToggleBreakpoint={vi.fn()}
      onDeleteAllBreakpoints={vi.fn()}
      onEnableAllBreakpoints={vi.fn()}
      onDisableAllBreakpoints={vi.fn()}
      onShowExplorer={vi.fn()}
      onShowOutput={onShowOutput}
      onShowCSharpInteractive={vi.fn()}
      onShowModuleBreakpoints={onShowModuleBreakpoints}
      onShowExceptionSettings={onShowExceptionSettings}
      onShowAutos={onShowAutos}
      onShowStaticFields={onShowStaticFields}
      onShowProcesses={onShowProcesses}
      onShowMemory={onShowMemory}
      onShowDisassembly={onShowDisassembly}
      onShowLocals={onShowLocals}
      onShowWatch={onShowWatch}
      onShowCallStack={onShowCallStack}
      onShowBreakpoints={onShowBreakpoints}
      onShowThreads={onShowThreads}
      onShowModules={onShowModules}
      onTheme={vi.fn()}
      onToggleWordWrap={vi.fn()}
      onToggleHighlightCurrentLine={vi.fn()}
      onToggleFullScreen={vi.fn()}
      onSetLanguage={vi.fn()}
      onAbout={vi.fn()}
      onQuit={vi.fn()}
      onShowOptions={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const windows = screen.getByRole('menuitem', { name: 'Window' })
    fireEvent.pointerEnter(windows)
    const labels = ['Breakpoints', 'Module Breakpoints', 'Exception Settings', 'Output', 'Watch', 'Autos', 'Locals', 'Static Fields', 'Call Stack', 'Threads', 'Modules', 'Processes', 'Memory', 'Disassembly']
    const callbacks = [
      onShowBreakpoints,
      onShowModuleBreakpoints,
      onShowExceptionSettings,
      onShowOutput,
      onShowWatch,
      onShowAutos,
      onShowLocals,
      onShowStaticFields,
      onShowCallStack,
      onShowThreads,
      onShowModules,
      onShowProcesses,
      onShowMemory,
      onShowDisassembly,
    ]
    labels.forEach((label, index) => {
      const item = screen.getByRole('menuitem', { name: new RegExp('^' + label) })
      expect(item.getAttribute('aria-checked')).not.toBe('true')
      fireEvent.click(item)
      expect(callbacks[index]).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Window' }))
    })
  })

  it('exposes View toggles in their checked state', () => {
    render(<MenuBar
      hasWorkspace={true}
      canRename={false}
      canEditMethod={false}
      canReplaceResource={false}
      canShowCode={true}
      debugAvailable={false}
      debugState="inactive"
      recentWorkspaces={[]}
      canUndo={false}
      canRedo={false}
      theme="dark"
      wordWrap={true}
      highlightCurrentLine={true}
      fullScreen={true}
      onOpen={vi.fn()}
      onOpenRecent={vi.fn()}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onFind={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onRename={vi.fn()}
      onEditMethod={vi.fn()}
      onReplaceResource={vi.fn()}
      onShowCode={vi.fn()}
      onCollapseTreeViewNodes={vi.fn()}
      onStartDebug={vi.fn()}
      onAttachDebug={vi.fn()}
      onContinueDebug={vi.fn()}
      onPauseDebug={vi.fn()}
      onStepIn={vi.fn()}
      onStepOver={vi.fn()}
      onStepOut={vi.fn()}
      onStopDebug={vi.fn()}
      canToggleBreakpoint={false}
      hasFunctionBreakpoints={false}
      canEnableAllBreakpoints={false}
      canDisableAllBreakpoints={false}
      onToggleBreakpoint={vi.fn()}
      onDeleteAllBreakpoints={vi.fn()}
      onEnableAllBreakpoints={vi.fn()}
      onDisableAllBreakpoints={vi.fn()}
      visibleToolWindows={new Set(['explorer', 'output', 'locals', 'watch', 'callstack', 'breakpoints', 'threads', 'modules'])}
      onShowExplorer={vi.fn()}
      onShowOutput={vi.fn()}
      onShowCSharpInteractive={vi.fn()}
      onShowModuleBreakpoints={vi.fn()}
      onShowExceptionSettings={vi.fn()}
      onShowAutos={vi.fn()}
      onShowStaticFields={vi.fn()}
      onShowProcesses={vi.fn()}
      onShowMemory={vi.fn()}
      onShowDisassembly={vi.fn()}
      onShowLocals={vi.fn()}
      onShowWatch={vi.fn()}
      onShowCallStack={vi.fn()}
      onShowBreakpoints={vi.fn()}
      onShowThreads={vi.fn()}
      onShowModules={vi.fn()}
      onTheme={vi.fn()}
      onToggleWordWrap={vi.fn()}
      onToggleHighlightCurrentLine={vi.fn()}
      onToggleFullScreen={vi.fn()}
      onSetLanguage={vi.fn()}
      onAbout={vi.fn()}
      onQuit={vi.fn()}
      onShowOptions={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    const wordWrap = screen.getByRole('menuitem', { name: /^Word Wrap/ })
    const highlight = screen.getByRole('menuitem', { name: /^Highlight Current Line/ })
    const fullScreen = screen.getByRole('menuitem', { name: /^Full Screen/ })
    expect(wordWrap.getAttribute('aria-checked')).toBe('true')
    expect(highlight.getAttribute('aria-checked')).toBe('true')
    // Upstream keeps the "Full Screen" label in both states and only toggles the check mark.
    expect(fullScreen.getAttribute('aria-checked')).toBe('true')
    expect(fullScreen).toHaveTextContent('Full Screen')
    expect(screen.queryByRole('menuitem', { name: /Exit Full Screen/ })).not.toBeInTheDocument()
  })

  it('opens the About dialog from the Help menu', () => {
    const onAbout = vi.fn()
    renderMenu(false, onAbout)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About dnSpy' }))

    expect(onAbout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: 'About dnSpy' })).not.toBeInTheDocument()
  })

  it('opens the Debug → Options dialog from the Debug menu', () => {
    const onShowOptions = vi.fn()
    renderMenu(false, vi.fn(), 'inactive', onShowOptions)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const optionsItem = screen.getByRole('menuitem', { name: /^Options\.\.\.$/ })
    // Upstream keeps Options as a separator-less, always-enabled entry at the bottom of the Debug menu.
    expect(optionsItem).toBeEnabled()

    fireEvent.click(optionsItem)
    expect(onShowOptions).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: /^Options\.\.\.$/ })).not.toBeInTheDocument()
  })

  it('keeps Debug → Options available while a debug session is running', () => {
    const onShowOptions = vi.fn()
    renderMenu(true, vi.fn(), 'running', onShowOptions)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    // Options stays present and reachable during a live debug session, matching upstream.
    expect(screen.getByRole('menuitem', { name: /^Options\.\.\.$/ })).toBeInTheDocument()
  })

  it('mirrors the upstream Debug breakpoint commands', () => {
    renderMenu(false, vi.fn(), 'inactive', vi.fn(), { items: [{ name: 'Ns.Type.Method', enabled: true }] })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    // Upstream shows Toggle Breakpoint unconditionally (F9) and hides the other three when they have nothing to act on.
    expect(screen.getByRole('menuitem', { name: /^Toggle Breakpoint/ })).toBeDisabled()
    expect(screen.getByText('F9')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /^Delete All Breakpoints/ })).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+F9')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /^Disable All Breakpoints/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Enable All Breakpoints/ })).not.toBeInTheDocument()
  })

  it('enables Toggle Breakpoint only when a method is current and invokes the handler', () => {
    const onToggle = vi.fn()
    renderMenu(false, vi.fn(), 'inactive', vi.fn(), { canToggle: true, onToggle })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    const toggle = screen.getByRole('menuitem', { name: /^Toggle Breakpoint/ })
    expect(toggle).toBeEnabled()
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('hides the breakpoint commands that have nothing to act on', () => {
    renderMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Debug' }))
    expect(screen.queryByRole('menuitem', { name: /^Delete All Breakpoints/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Enable All Breakpoints/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Disable All Breakpoints/ })).not.toBeInTheDocument()
  })

  it.each([
    ['Latest Release', 'https://github.com/msojocs/dnSpy/releases/latest'],
    ['Report Bug', 'https://github.com/msojocs/dnSpy/issues/new'],
    ['Source Code', 'https://github.com/msojocs/dnSpy'],
  ])('opens %s in the system browser', (label, url) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))

    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  })
})
