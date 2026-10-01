import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowControls } from './WindowControls'

const minimizeWindow = vi.fn(async () => undefined)
const toggleMaximizeWindow = vi.fn(async () => true)
const closeWindow = vi.fn(async () => undefined)

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'dnSpy', {
    configurable: true,
    value: {
      minimizeWindow,
      toggleMaximizeWindow,
      closeWindow,
      isWindowMaximized: async () => false,
      onWindowMaximizedChange: () => () => undefined,
    },
  })
})

afterEach(cleanup)

describe('WindowControls', () => {
  it('invokes native minimize and close actions', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
    expect(minimizeWindow).toHaveBeenCalledOnce()
    expect(closeWindow).toHaveBeenCalledOnce()
  })

  it('switches the maximize action to restore', async () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }))
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore window' })).toBeVisible())
  })
})
