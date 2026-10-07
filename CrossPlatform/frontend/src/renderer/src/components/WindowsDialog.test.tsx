import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowsDialog, type WindowTabEntry } from './WindowsDialog'

const tabs: WindowTabEntry[] = [
  { id: 'tab-1', name: 'Program.cs', moduleName: 'App.exe', modulePath: '/tmp/App.exe' },
  { id: 'tab-2', name: 'Library.cs', moduleName: 'Lib.dll', modulePath: '/tmp/Lib.dll' },
  { id: 'tab-3', name: 'Hex Editor', moduleName: '', modulePath: '' },
]

const renderDialog = (overrides: Partial<Parameters<typeof WindowsDialog>[0]> = {}) => {
  const props = {
    tabs,
    onActivate: vi.fn(),
    canSave: () => false,
    onSave: vi.fn(),
    onCloseTabs: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<WindowsDialog {...props} />)
  return props
}

afterEach(cleanup)

describe('WindowsDialog', () => {
  it('lists every tab with its module and path columns', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Windows' })
    const rows = within(dialog).getAllByRole('row')
    expect(within(dialog).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(within(dialog).getByRole('columnheader', { name: 'Module' })).toBeInTheDocument()
    expect(within(dialog).getByRole('columnheader', { name: 'Path' })).toBeInTheDocument()
    // Header plus one row per tab.
    expect(rows).toHaveLength(4)
    expect(within(dialog).getByText('Program.cs')).toBeInTheDocument()
    expect(within(dialog).getByText('/tmp/Lib.dll')).toBeInTheDocument()
  })

  it('activates the selected row and closes on Activate, and double-click activates directly', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByText('Library.cs'))
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    expect(props.onActivate).toHaveBeenCalledWith('tab-2')

    fireEvent.doubleClick(screen.getByText('Program.cs'))
    expect(props.onActivate).toHaveBeenCalledWith('tab-1')
    expect(props.onActivate).toHaveBeenCalledTimes(2)
  })

  it('closes every selected row with Close Window', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByText('Program.cs'))
    fireEvent.click(screen.getByText('Hex Editor'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Close Window' }))
    expect(props.onCloseTabs).toHaveBeenCalledWith(['tab-1', 'tab-3'])
  })

  it('keeps Save disabled unless the single selected row can be saved', () => {
    const props = renderDialog({ canSave: (tabId) => tabId === 'tab-2' })
    const saveButton = screen.getByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByText('Library.cs'))
    expect(saveButton).toBeEnabled()
    fireEvent.click(saveButton)
    expect(props.onSave).toHaveBeenCalledWith('tab-2')
  })

  it('closes on Escape', () => {
    const props = renderDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
