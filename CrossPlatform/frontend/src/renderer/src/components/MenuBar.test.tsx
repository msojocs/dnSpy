import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

type DebugState = 'inactive' | 'starting' | 'running' | 'stopped'
const renderMenu = (debugAvailable = false, onAbout = vi.fn(), debugState: DebugState = 'inactive'): void => {
  render(<MenuBar
    hasWorkspace={true}
    canRename={true}
    canEditMethod={false}
    canReplaceResource={false}
    canInspectModule={true}
    debugAvailable={debugAvailable}
    debugState={debugState}
    recentWorkspaces={[]}
    canUndo={false}
    canRedo={false}
    theme="dark"
    wordWrap={false}
    highlightCurrentLine={true}
    fullScreen={false}
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
    onHex={vi.fn()}
    onModuleInfo={vi.fn()}
    onStartDebug={vi.fn()}
    onAttachDebug={vi.fn()}
    onContinueDebug={vi.fn()}
    onPauseDebug={vi.fn()}
    onStepIn={vi.fn()}
    onStepOver={vi.fn()}
    onStopDebug={vi.fn()}
    visibleToolWindows={new Set(['explorer', 'output', 'search', 'analysis', 'locals', 'watch', 'callstack', 'breakpoints', 'threads', 'modules'])}
    onShowExplorer={vi.fn()}
    onShowOutput={vi.fn()}
    onShowSearch={vi.fn()}
    onShowAnalysis={vi.fn()}
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
    onAbout={onAbout}
    onQuit={vi.fn()}
  />)
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(screen.getByRole('menuitem', { name: /^Word Wrap/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Highlight Current Line/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Full Screen/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Assembly Explorer/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Output/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Search/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Analyzer/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Themes/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Language/ })).toBeInTheDocument()
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
    const onShowSearch = vi.fn()
    const onShowAnalysis = vi.fn()
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
      canInspectModule={true}
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
      onHex={vi.fn()}
      onModuleInfo={vi.fn()}
      onStartDebug={vi.fn()}
      onAttachDebug={vi.fn()}
      onContinueDebug={vi.fn()}
      onPauseDebug={vi.fn()}
      onStepIn={vi.fn()}
      onStepOver={vi.fn()}
      onStopDebug={vi.fn()}
      onShowExplorer={vi.fn()}
      onShowOutput={onShowOutput}
      onShowSearch={vi.fn()}
      onShowAnalysis={vi.fn()}
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
      canInspectModule={true}
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
      onHex={vi.fn()}
      onModuleInfo={vi.fn()}
      onStartDebug={vi.fn()}
      onAttachDebug={vi.fn()}
      onContinueDebug={vi.fn()}
      onPauseDebug={vi.fn()}
      onStepIn={vi.fn()}
      onStepOver={vi.fn()}
      onStopDebug={vi.fn()}
      visibleToolWindows={new Set(['explorer', 'output', 'search', 'analysis', 'locals', 'watch', 'callstack', 'breakpoints', 'threads', 'modules'])}
      onShowExplorer={vi.fn()}
      onShowOutput={vi.fn()}
      onShowSearch={vi.fn()}
      onShowAnalysis={vi.fn()}
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
    />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    const wordWrap = screen.getByRole('menuitem', { name: /^Word Wrap/ })
    const fullScreen = screen.getByRole('menuitem', { name: /Full Screen/ })
    expect(wordWrap.getAttribute('aria-checked')).toBe('true')
    expect(fullScreen.textContent).toContain('Exit Full Screen')
  })

  it('opens the About dialog from the Help menu', () => {
    const onAbout = vi.fn()
    renderMenu(false, onAbout)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About dnSpy' }))

    expect(onAbout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: 'About dnSpy' })).not.toBeInTheDocument()
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
