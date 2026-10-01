import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

const renderMenu = (debugAvailable = false, onAbout = vi.fn()): void => {
  render(<MenuBar
    hasWorkspace={true}
    canRename={true}
    canEditMethod={false}
    canReplaceResource={false}
    canInspectModule={true}
    debugAvailable={debugAvailable}
    debugState="inactive"
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
    onShowExplorer={vi.fn()}
    onShowOutput={vi.fn()}
    onShowSearch={vi.fn()}
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

  it('aligns the View menu with the upstream dnSpy View menu', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(screen.getByRole('menuitem', { name: /^Word Wrap/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Highlight Current Line/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Full Screen/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Assembly Explorer/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Output/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Search/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Themes/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Language/ })).toBeInTheDocument()
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
      onShowExplorer={vi.fn()}
      onShowOutput={vi.fn()}
      onShowSearch={vi.fn()}
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
    expect(wordWrap.getAttribute('aria-checked')).not.toBe('true')
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
