import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AboutDialog } from './AboutDialog'

afterEach(cleanup)

describe('AboutDialog', () => {
  it('renders product and license information', () => {
    render(<AboutDialog onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'About dnSpy' })).toBeVisible()
    expect(screen.getByText('Version 1.0.0')).toBeVisible()
    expect(screen.getByText('Cross-platform .NET assembly browser, decompiler, editor and debugger.')).toBeVisible()
    expect(screen.getByText('Licensed under GNU GPL v3.0 only.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close About' })).toHaveFocus()
  })

  it('closes from the button and Escape key', () => {
    const onClose = vi.fn()
    render(<AboutDialog onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
