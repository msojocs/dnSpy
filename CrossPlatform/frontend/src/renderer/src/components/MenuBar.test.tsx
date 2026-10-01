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
    onAbout={onAbout}
    onQuit={vi.fn()}
  />)
}

afterEach(cleanup)

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

  it('opens the About dialog from the Help menu', () => {
    const onAbout = vi.fn()
    renderMenu(false, onAbout)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About dnSpy' }))

    expect(onAbout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: 'About dnSpy' })).not.toBeInTheDocument()
  })
})
